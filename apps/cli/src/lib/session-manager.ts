import type { Message, Session } from '@vena/shared';

export class ChatSessionManager {
  private sessions = new Map<string, Session>();

  get(key: string): Session | undefined {
    return this.sessions.get(key);
  }

  getOrCreate(
    sessionKey: string,
    channelName: string,
    userId: string,
    agentId: string,
  ): Session {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = {
        id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        channelName,
        sessionKey,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          userId,
          agentId,
          tokenCount: 0,
          compactionCount: 0,
        },
      };
      this.sessions.set(sessionKey, session);
    }
    return session;
  }

  createEphemeral(
    sessionKey: string,
    channelName: string,
    userId: string,
    agentId: string,
    seedMessages: Message[] = [],
  ): Session {
    return {
      id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channelName,
      sessionKey,
      messages: seedMessages,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        userId,
        agentId,
        tokenCount: 0,
        compactionCount: 0,
      },
    };
  }

  list(): Array<[string, Session]> {
    return Array.from(this.sessions.entries());
  }

  delete(key: string): boolean {
    return this.sessions.delete(key);
  }

  entries(): IterableIterator<[string, Session]> {
    return this.sessions.entries();
  }
}
