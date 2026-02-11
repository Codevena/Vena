import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SessionStore } from '../session-store.js';
import type { LaneQueue } from '../lane-queue.js';
import type { InboundMessage } from '@vena/shared';

const messageBodySchema = z.object({
  content: z.string().min(1, 'content is required'),
  channelName: z.string().optional(),
  sessionKey: z.string().optional(),
  userId: z.string().optional(),
});

export interface ControlAPIOptions {
  sessionStore: SessionStore;
  laneQueue: LaneQueue;
  startedAt: Date;
  onMessage?: (msg: InboundMessage) => Promise<{ text?: string }>;
  getAgents?: () => Array<{ id: string; name: string; status: string }>;
  getUsage?: () => {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalEstimatedCost: number;
    recordCount: number;
    byAgent: Record<string, { inputTokens: number; outputTokens: number; estimatedCost: number; count: number }>;
    byModel: Record<string, { inputTokens: number; outputTokens: number; estimatedCost: number; count: number }>;
  };
  getSenders?: () => Array<{ id: string; channelName: string; status: string; lastSeen: string }>;
  approveSender?: (userId: string, channelName: string) => void;
  blockSender?: (userId: string, channelName: string) => void;
}

export async function controlAPI(fastify: FastifyInstance, options: ControlAPIOptions): Promise<void> {
  const { sessionStore, laneQueue, startedAt, onMessage, getAgents, getUsage, getSenders, approveSender, blockSender } = options;

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

  fastify.post('/api/message', async (request, reply) => {
    const parsed = messageBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const { content, channelName = 'api', sessionKey = 'api-default', userId = 'api-user' } = parsed.data;

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
  });

  fastify.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    const entry = sessionStore.get(id);
    if (!entry) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    sessionStore.delete(id);
    return { deleted: true, sessionKey: id };
  });

  // Usage tracking endpoint
  fastify.get('/api/usage', async () => {
    if (!getUsage) return { error: 'Usage tracking not enabled' };
    return getUsage();
  });

  // Sender approval endpoints
  fastify.get('/api/senders', async () => {
    if (!getSenders) return { senders: [] };
    return { senders: getSenders() };
  });

  fastify.post<{ Params: { id: string }; Body: { channel: string } }>('/api/senders/:id/approve', async (request, reply) => {
    if (!approveSender) return reply.status(503).send({ error: 'Sender approval not enabled' });
    const { id } = request.params;
    const body = request.body as { channel?: string } | undefined;
    const channel = body?.channel ?? 'unknown';
    approveSender(id, channel);
    return { approved: true, userId: id };
  });

  fastify.post<{ Params: { id: string }; Body: { channel: string } }>('/api/senders/:id/block', async (request, reply) => {
    if (!blockSender) return reply.status(503).send({ error: 'Sender approval not enabled' });
    const { id } = request.params;
    const body = request.body as { channel?: string } | undefined;
    const channel = body?.channel ?? 'unknown';
    blockSender(id, channel);
    return { blocked: true, userId: id };
  });
}
