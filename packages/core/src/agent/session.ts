import type { Message, Session } from '@vena/shared';
import { nanoid } from 'nanoid';
import { createLogger } from '@vena/shared';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const logger = createLogger('session-manager');

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  create(channelName: string, sessionKey: string, agentId: string): Session {
    const session: Session = {
      id: nanoid(),
      channelName,
      sessionKey,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        agentId,
        tokenCount: 0,
        compactionCount: 0,
      },
    };

    this.sessions.set(session.id, session);
    logger.debug({ sessionId: session.id, channelName }, 'Session created');
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  resume(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updatedAt = new Date().toISOString();
    }
    return session;
  }

  addMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn({ sessionId }, 'Session not found when adding message');
      return;
    }
    session.messages.push(message);
    session.updatedAt = new Date().toISOString();
  }

  async compact(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Compaction is delegated to the Compactor class externally.
    // This method is a hook for triggering it.
    session.metadata.compactionCount++;
    session.updatedAt = new Date().toISOString();
    logger.info({ sessionId, compactionCount: session.metadata.compactionCount }, 'Compaction triggered');
  }

  async save(session: Session): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
    logger.debug({ sessionId: session.id, path: filePath }, 'Session saved');
  }

  async load(sessionId: string): Promise<Session | null> {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const session = JSON.parse(data) as Session;
      this.sessions.set(session.id, session);
      return session;
    } catch {
      return null;
    }
  }
}
