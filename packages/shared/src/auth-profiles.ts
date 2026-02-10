import fs from 'node:fs';
import path from 'node:path';

// ── Credential Types ────────────────────────────────────────────────

export type ApiKeyCredential = {
  type: 'api_key';
  provider: string;
  key: string;
  email?: string;
  metadata?: Record<string, string>;
};

export type OAuthCredential = {
  type: 'oauth';
  provider: string;
  accessToken: string;
  refreshToken?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  expiresAt?: number;
  email?: string;
};

export type TokenCredential = {
  type: 'token';
  provider: string;
  token: string;
  expires?: number;
  email?: string;
};

export type AuthProfileCredential = ApiKeyCredential | OAuthCredential | TokenCredential;

// ── Usage Stats ─────────────────────────────────────────────────────

export type ProfileUsageStats = {
  lastUsed?: number;
  cooldownUntil?: number;
  errorCount?: number;
  lastFailureAt?: number;
};

// ── Store ───────────────────────────────────────────────────────────

export type AuthProfileStore = {
  version: 1;
  profiles: Record<string, AuthProfileCredential>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, ProfileUsageStats>;
};

const STORE_FILE = 'auth-profiles.json';

function storePath(venaDir: string): string {
  return path.join(venaDir, STORE_FILE);
}

function emptyStore(): AuthProfileStore {
  return { version: 1, profiles: {} };
}

export function loadAuthProfileStore(venaDir: string): AuthProfileStore {
  const p = storePath(venaDir);
  if (!fs.existsSync(p)) {
    return emptyStore();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as AuthProfileStore;
    if (raw.version !== 1) return emptyStore();
    return raw;
  } catch {
    return emptyStore();
  }
}

export function saveAuthProfileStore(venaDir: string, store: AuthProfileStore): void {
  fs.mkdirSync(venaDir, { recursive: true });
  const p = storePath(venaDir);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, p);
}

export function upsertAuthProfile(
  store: AuthProfileStore,
  name: string,
  cred: AuthProfileCredential,
): void {
  store.profiles[name] = cred;
}

export function listProfilesForProvider(
  store: AuthProfileStore,
  provider: string,
): string[] {
  return Object.entries(store.profiles)
    .filter(([, cred]) => cred.provider === provider)
    .map(([name]) => name);
}

export function getAuthProfile(
  store: AuthProfileStore,
  name: string,
): AuthProfileCredential | undefined {
  return store.profiles[name];
}

export function listAllProfiles(
  store: AuthProfileStore,
): Array<{ name: string; credential: AuthProfileCredential }> {
  return Object.entries(store.profiles).map(([name, credential]) => ({
    name,
    credential,
  }));
}

// ── Profile Rotation ────────────────────────────────────────────────

/**
 * Select the best auth profile for a provider, considering:
 * - Agent-specific profile ordering
 * - Cooldown periods
 * - Last known good profile
 * - Round-robin through remaining healthy profiles
 */
export function selectProfile(
  store: AuthProfileStore,
  provider: string,
  agentId?: string,
): string | undefined {
  const now = Date.now();

  // Get all profiles for this provider
  const candidateProfiles = listProfilesForProvider(store, provider);
  if (candidateProfiles.length === 0) return undefined;

  // Filter out profiles in cooldown
  const availableProfiles = candidateProfiles.filter((name) => {
    const stats = store.usageStats?.[name];
    return !stats?.cooldownUntil || stats.cooldownUntil <= now;
  });

  if (availableProfiles.length === 0) return undefined;

  // Check agent-specific ordering first
  if (agentId && store.order?.[agentId]) {
    const agentOrder = store.order[agentId];
    for (const profileName of agentOrder) {
      if (availableProfiles.includes(profileName)) {
        return profileName;
      }
    }
  }

  // Prefer last known good profile if available and not in cooldown
  const lastGood = store.lastGood?.[provider];
  if (lastGood && availableProfiles.includes(lastGood)) {
    return lastGood;
  }

  // Round-robin: pick the least recently used profile
  let leastRecentlyUsed: string | undefined;
  let oldestTimestamp = Number.MAX_SAFE_INTEGER;

  for (const name of availableProfiles) {
    const stats = store.usageStats?.[name];
    const lastUsed = stats?.lastUsed ?? 0;
    if (lastUsed < oldestTimestamp) {
      oldestTimestamp = lastUsed;
      leastRecentlyUsed = name;
    }
  }

  return leastRecentlyUsed ?? availableProfiles[0];
}

/**
 * Mark a profile as successfully used.
 * Updates usage stats and marks as last good for its provider.
 */
export function markProfileSuccess(store: AuthProfileStore, name: string): void {
  const profile = store.profiles[name];
  if (!profile) return;

  // Initialize usageStats map if needed
  if (!store.usageStats) {
    store.usageStats = {};
  }

  // Initialize or update stats for this profile
  const stats = store.usageStats[name] ?? {};
  stats.lastUsed = Date.now();
  stats.errorCount = 0;
  delete stats.cooldownUntil;
  delete stats.lastFailureAt;
  store.usageStats[name] = stats;

  // Update last good for the provider
  if (!store.lastGood) {
    store.lastGood = {};
  }
  store.lastGood[profile.provider] = name;
}

/**
 * Mark a profile as failed.
 * Increments error count and applies cooldown if threshold is reached.
 */
export function markProfileFailure(
  store: AuthProfileStore,
  name: string,
  cooldownMs: number = 300000, // 5 minutes default
): void {
  const profile = store.profiles[name];
  if (!profile) return;

  // Initialize usageStats map if needed
  if (!store.usageStats) {
    store.usageStats = {};
  }

  // Initialize or update stats for this profile
  const stats = store.usageStats[name] ?? {};
  stats.errorCount = (stats.errorCount ?? 0) + 1;
  stats.lastFailureAt = Date.now();

  // Apply cooldown if error threshold reached
  if (stats.errorCount >= 3) {
    stats.cooldownUntil = Date.now() + cooldownMs;
  }

  store.usageStats[name] = stats;
}

/**
 * Get the health status of a profile based on usage stats.
 */
export function getProfileHealth(
  store: AuthProfileStore,
  name: string,
): 'healthy' | 'degraded' | 'cooldown' | 'unknown' {
  const stats = store.usageStats?.[name];
  if (!stats) return 'unknown';

  const now = Date.now();

  if (stats.cooldownUntil && stats.cooldownUntil > now) {
    return 'cooldown';
  }

  const errorCount = stats.errorCount ?? 0;

  if (errorCount === 0 && stats.lastUsed) {
    return 'healthy';
  }

  if (errorCount > 0 && errorCount < 3) {
    return 'degraded';
  }

  return 'unknown';
}

/**
 * Clear cooldown for a profile, allowing it to be used again.
 */
export function clearCooldown(store: AuthProfileStore, name: string): void {
  if (!store.usageStats?.[name]) return;

  const stats = store.usageStats[name];
  delete stats.cooldownUntil;
  stats.errorCount = 0;
}
