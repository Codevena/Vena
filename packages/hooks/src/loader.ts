import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Hook, HookEntry, HookMetadata, HookSource } from './types.js';
import { registerHook } from './registry.js';

const HOOK_FILE = 'HOOK.md';
const VENA_DIR = path.join(os.homedir(), '.vena');

// ── Hook Discovery ──────────────────────────────────────────────────

function scanHookDir(dir: string, source: HookSource): Hook[] {
  if (!fs.existsSync(dir)) return [];

  const hooks: Hook[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const hookDir = path.join(dir, entry.name);
      const hookFile = path.join(hookDir, HOOK_FILE);
      if (!fs.existsSync(hookFile)) continue;

      const content = fs.readFileSync(hookFile, 'utf-8');
      const { metadata, description } = parseHookMd(content);

      const handlerPath = resolveHandlerPath(hookDir);

      hooks.push({
        name: entry.name,
        description,
        source,
        filePath: hookFile,
        baseDir: hookDir,
        handlerPath,
      });
    }
  } catch {
    // Directory unreadable, skip
  }
  return hooks;
}

function resolveHandlerPath(hookDir: string): string | undefined {
  for (const ext of ['handler.ts', 'handler.js', 'index.ts', 'index.js']) {
    const p = path.join(hookDir, ext);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function parseHookMd(content: string): { metadata?: HookMetadata; description: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { description: content.trim().split('\n')[0] ?? '' };
  }

  const fmRaw = fmMatch[1] ?? '';
  const body = fmMatch[2] ?? '';

  try {
    // Simple YAML-like parsing for common fields
    const metadata: HookMetadata = { events: [] };

    for (const line of fmRaw.split('\n')) {
      const [key, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      if (!key || !value) continue;

      const k = key.trim();
      if (k === 'events') {
        metadata.events = parseYamlArray(value);
      } else if (k === 'emoji') {
        metadata.emoji = value;
      } else if (k === 'hookKey') {
        metadata.hookKey = value;
      } else if (k === 'always') {
        metadata.always = value === 'true';
      } else if (k === 'homepage') {
        metadata.homepage = value;
      } else if (k === 'os') {
        metadata.os = parseYamlArray(value);
      }
    }

    return {
      metadata: metadata.events.length > 0 ? metadata : undefined,
      description: body.trim().split('\n')[0] ?? '',
    };
  } catch {
    return { description: body.trim().split('\n')[0] ?? '' };
  }
}

function parseYamlArray(value: string): string[] {
  // Handle ["a", "b"] or [a, b]
  const match = value.match(/^\[(.+)\]$/);
  if (match) {
    return match[1]!.split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  }
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

// ── Eligibility Checking ────────────────────────────────────────────

function checkEligibility(metadata: HookMetadata): boolean {
  if (metadata.always) return true;

  // OS check
  if (metadata.os && metadata.os.length > 0) {
    if (!metadata.os.includes(process.platform)) return false;
  }

  // Env var check
  if (metadata.requires?.env) {
    for (const envVar of metadata.requires.env) {
      if (!process.env[envVar]) return false;
    }
  }

  return true;
}

// ── Three-Tier Discovery ────────────────────────────────────────────

export function discoverHooks(workspaceDir?: string): HookEntry[] {
  const entries: HookEntry[] = [];
  const seen = new Set<string>();

  // 1. Workspace hooks (highest priority)
  if (workspaceDir) {
    const wsHooksDir = path.join(workspaceDir, 'hooks');
    for (const hook of scanHookDir(wsHooksDir, 'vena-workspace')) {
      if (!seen.has(hook.name)) {
        seen.add(hook.name);
        const meta = parseHookMd(fs.readFileSync(hook.filePath, 'utf-8')).metadata;
        entries.push({
          hook,
          metadata: meta,
          enabled: meta ? checkEligibility(meta) : true,
        });
      }
    }
  }

  // 2. Managed hooks (~/.vena/hooks/)
  const managedDir = path.join(VENA_DIR, 'hooks');
  for (const hook of scanHookDir(managedDir, 'vena-managed')) {
    if (!seen.has(hook.name)) {
      seen.add(hook.name);
      const meta = parseHookMd(fs.readFileSync(hook.filePath, 'utf-8')).metadata;
      entries.push({
        hook,
        metadata: meta,
        enabled: meta ? checkEligibility(meta) : true,
      });
    }
  }

  // 3. Bundled hooks (lowest priority)
  const bundledDir = path.join(VENA_DIR, 'hooks-bundled');
  for (const hook of scanHookDir(bundledDir, 'vena-bundled')) {
    if (!seen.has(hook.name)) {
      seen.add(hook.name);
      const meta = parseHookMd(fs.readFileSync(hook.filePath, 'utf-8')).metadata;
      entries.push({
        hook,
        metadata: meta,
        enabled: meta ? checkEligibility(meta) : true,
      });
    }
  }

  return entries;
}

// ── Auto-Register Hooks ─────────────────────────────────────────────

export async function loadAndRegisterHooks(workspaceDir?: string): Promise<HookEntry[]> {
  const entries = discoverHooks(workspaceDir);
  let registered = 0;

  for (const entry of entries) {
    if (!entry.enabled) continue;
    if (!entry.hook.handlerPath) continue;
    if (!entry.metadata?.events?.length) continue;

    try {
      // Dynamic import with cache busting
      const modulePath = `file://${entry.hook.handlerPath}?t=${Date.now()}`;
      const mod = await import(modulePath);
      const exportName = entry.metadata.export ?? 'default';
      const handler = mod[exportName];

      if (typeof handler !== 'function') continue;

      for (const eventKey of entry.metadata.events) {
        registerHook(eventKey, handler);
      }
      registered++;
    } catch (err) {
      console.error(
        `[vena:hook] Failed to load ${entry.hook.name}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return entries;
}
