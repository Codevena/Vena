import type { FastifyInstance } from 'fastify';
import type { SessionStore } from '../session-store.js';
import type { LaneQueue } from '../lane-queue.js';
import type { InboundMessage } from '@vena/shared';

export interface ControlAPIOptions {
  sessionStore: SessionStore;
  laneQueue: LaneQueue;
  startedAt: Date;
  onMessage?: (msg: InboundMessage) => Promise<{ text?: string }>;
  getAgents?: () => Array<{ id: string; name: string; status: string }>;
}

export async function controlAPI(fastify: FastifyInstance, options: ControlAPIOptions): Promise<void> {
  const { sessionStore, laneQueue, startedAt, onMessage, getAgents } = options;

  fastify.get('/api/status', async () => {
    const memUsage = process.memoryUsage();
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      activeSessions: sessionStore.getAll().size,
      lanes: laneQueue.getStats(),
      memory: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
    };
  });

  fastify.get('/api/sessions', async () => {
    const sessions = sessionStore.getAll();
    const entries = Array.from(sessions.entries()).map(([key, entry]) => ({
      sessionKey: key,
      ...entry,
    }));
    return { sessions: entries };
  });

  fastify.get('/api/agents', async () => {
    const agents = getAgents ? getAgents() : [];
    return { agents };
  });

  fastify.post<{ Body: { channelName?: string; sessionKey?: string; userId?: string; content: string } }>(
    '/api/message',
    async (request, reply) => {
      const { channelName = 'api', sessionKey = 'api-default', userId = 'api-user', content } = request.body;
      if (!content) {
        return reply.status(400).send({ error: 'content is required' });
      }
      if (!onMessage) {
        return reply.status(503).send({ error: 'Message handler not configured' });
      }

      const inbound: InboundMessage = {
        channelName,
        sessionKey,
        userId,
        content,
      };

      const response = await onMessage(inbound);
      return { response };
    },
  );

  fastify.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    const entry = sessionStore.get(id);
    if (!entry) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    sessionStore.delete(id);
    return { deleted: true, sessionKey: id };
  });
}
