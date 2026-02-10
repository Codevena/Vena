import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CronStoreFile } from './types.js';

const VENA_DIR = path.join(os.homedir(), '.vena');
const DEFAULT_CRON_DIR = path.join(VENA_DIR, 'cron');
export const DEFAULT_CRON_STORE_PATH = path.join(DEFAULT_CRON_DIR, 'jobs.json');

export function resolveCronStorePath(storePath?: string): string {
  if (storePath?.trim()) {
    const raw = storePath.trim();
    if (raw.startsWith('~')) {
      return path.resolve(raw.replace('~', os.homedir()));
    }
    return path.resolve(raw);
  }
  return DEFAULT_CRON_STORE_PATH;
}

export async function loadCronStore(storePath: string): Promise<CronStoreFile> {
  try {
    const raw = await fs.promises.readFile(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const jobs = Array.isArray(parsed.jobs) ? (parsed.jobs as CronStoreFile['jobs']) : [];
    return { version: 1, jobs: jobs.filter(Boolean) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { version: 1, jobs: [] };
    }
    throw err;
  }
}

export async function saveCronStore(storePath: string, store: CronStoreFile): Promise<void> {
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = JSON.stringify(store, null, 2);
  await fs.promises.writeFile(tmp, json, 'utf-8');
  await fs.promises.rename(tmp, storePath);
}
