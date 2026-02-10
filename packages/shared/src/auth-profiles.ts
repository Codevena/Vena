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
