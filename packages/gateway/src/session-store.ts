import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger, VenaError } from '@vena/shared';

const log = createLogger('gateway:session-store');

export interface SessionEntry {
  sessionId: string;
  channelName: string;
  agentId: string;
  lastActivity: string;
}

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  get(sessionKey: string): SessionEntry | undefined {
    return this.sessions.get(sessionKey);
  }

  set(sessionKey: string, entry: SessionEntry): void {
    this.sessions.set(sessionKey, entry);
    this.save();
  }

  delete(sessionKey: string): void {
    this.sessions.delete(sessionKey);
    this.save();
  }

  getAll(): Map<string, SessionEntry> {
    return new Map(this.sessions);
  }

  save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const data = Object.fromEntries(this.sessions);
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      log.error({ err }, 'Failed to save sessions');
      throw new VenaError('Failed to save sessions', 'SESSION_STORE_ERROR', { filePath: this.filePath });
    }
  }

  load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, SessionEntry>;
      this.sessions.clear();
      for (const [key, entry] of Object.entries(data)) {
        this.sessions.set(key, entry);
      }
      log.info({ count: this.sessions.size }, 'Loaded sessions from disk');
    } catch {
      log.info('No existing sessions file, starting fresh');
      this.sessions.clear();
    }
  }
}
