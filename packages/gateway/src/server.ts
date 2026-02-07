import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { createLogger, VenaError, type InboundMessage } from '@vena/shared';
import { SessionStore } from './session-store.js';
import { LaneQueue } from './lane-queue.js';
import { controlAPI, type ControlAPIOptions } from './api/control.js';
import { openaiCompatAPI, type OpenAICompatOptions } from './api/openai-compat.js';
import { authMiddleware, type AuthConfig } from './middleware/auth.js';
import { RateLimiter, type RateLimitConfig } from './middleware/rate-limit.js';

const log = createLogger('gateway:server');

export interface GatewayConfig {
  port: number;
  host: string;
  sessionsPath?: string;
  auth?: {
    enabled: boolean;
    apiKeys: string[];
  };
  rateLimit?: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
  };
  maxMessageSize?: number;
}

type MessageHandler = (msg: InboundMessage) => Promise<{ text?: string }>;
type AgentsProvider = () => Array<{ id: string; name: string; status: string }>;

interface WebSocketMessage {
  type: 'message';
  content: string;
  sessionKey?: string;
  character?: string;
}

export class GatewayServer {
  private config: GatewayConfig;
  private fastify: FastifyInstance;
  private wss: WebSocketServer | null = null;
  private sessionStore: SessionStore;
  private laneQueue: LaneQueue;
  private rateLimiter: RateLimiter;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private startedAt: Date;
  private messageHandler: MessageHandler | null = null;
  private agentsProvider: AgentsProvider | null = null;
  private eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(config: GatewayConfig) {
    this.config = config;
    this.startedAt = new Date();
    this.sessionStore = new SessionStore(config.sessionsPath ?? 'sessions.json');
    this.laneQueue = new LaneQueue();
    this.rateLimiter = new RateLimiter(config.rateLimit ?? { enabled: true, windowMs: 60000, maxRequests: 120 });

    this.fastify = Fastify({
      logger: false,
      bodyLimit: config.maxMessageSize ?? 102400,
    });
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onAgents(provider: AgentsProvider): void {
    this.agentsProvider = provider;
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  getLaneQueue(): LaneQueue {
    return this.laneQueue;
  }

  async start(): Promise<void> {
    // Health check route
    this.fastify.get('/health', async () => {
      return { status: 'ok', uptime: Math.floor((Date.now() - this.startedAt.getTime()) / 1000) };
    });

    // Register auth middleware (excludes health check)
    const authConfig: AuthConfig = {
      enabled: this.config.auth?.enabled ?? false,
      apiKeys: this.config.auth?.apiKeys ?? [],
      excludePaths: ['/health'],
    };
    await this.fastify.register(authMiddleware(authConfig));

    // HTTP rate limiting hook
    this.fastify.addHook('onRequest', async (request, reply) => {
      const result = this.rateLimiter.checkHttp(request.ip);
      if (!result.allowed) {
        return reply
          .status(429)
          .header('Retry-After', String(result.retryAfter ?? 60))
          .send({ error: 'Too many requests', retryAfter: result.retryAfter });
      }
    });

    // Register control API
    const controlOpts: ControlAPIOptions = {
      sessionStore: this.sessionStore,
      laneQueue: this.laneQueue,
      startedAt: this.startedAt,
      onMessage: this.messageHandler ?? undefined,
      getAgents: this.agentsProvider ?? undefined,
    };
    await this.fastify.register(controlAPI, controlOpts);

    // Register OpenAI-compatible API if message handler is set
    if (this.messageHandler) {
      const openaiOpts: OpenAICompatOptions = {
        onMessage: this.messageHandler,
      };
      await this.fastify.register(openaiCompatAPI, openaiOpts);
    }

    // Start rate limiter cleanup interval (every 60s)
    this.cleanupInterval = setInterval(() => this.rateLimiter.cleanup(), 60000);

    // Start HTTP server
    await this.fastify.listen({ port: this.config.port, host: this.config.host });

    // Attach WebSocket server to the same HTTP server
    const server = this.fastify.server;
    this.wss = new WebSocketServer({ server });

    const maxMessageSize = this.config.maxMessageSize ?? 102400;

    this.wss.on('connection', (ws: WebSocket) => {
      const connectionId = nanoid(12);
      const sessionKey = `ws-${connectionId}`;
      log.info({ connectionId }, 'WebSocket client connected');

      ws.on('message', (data: Buffer) => {
        try {
          // Check message size
          if (data.length > maxMessageSize) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'error', error: 'Message too large' }));
            }
            return;
          }

          // Check rate limit
          const rateCheck = this.rateLimiter.checkWs(connectionId);
          if (!rateCheck.allowed) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'error', error: 'Too many messages' }));
            }
            return;
          }

          const msg = JSON.parse(data.toString()) as WebSocketMessage;
          if (msg.type === 'message' && msg.content) {
            const inbound: InboundMessage = {
              channelName: 'websocket',
              sessionKey,
              userId: connectionId,
              content: msg.content,
              raw: msg.character ? { character: msg.character } : undefined,
            };

            this.emit('message', inbound);

            if (this.messageHandler) {
              this.messageHandler(inbound)
                .then((response) => {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                      type: 'response',
                      content: response.text ?? '',
                      sessionKey,
                    }));
                  }
                })
                .catch((err) => {
                  log.error({ err, connectionId }, 'Error handling WebSocket message');
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'error', error: 'Internal error' }));
                  }
                });
            }
          }
        } catch (err) {
          log.error({ err, connectionId }, 'Invalid WebSocket message');
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
          }
        }
      });

      ws.on('close', () => {
        log.info({ connectionId }, 'WebSocket client disconnected');
      });

      ws.on('error', (err) => {
        log.error({ err, connectionId }, 'WebSocket error');
      });
    });

    log.info({ port: this.config.port, host: this.config.host }, 'Gateway server started');
  }

  async stop(): Promise<void> {
    log.info('Shutting down gateway server');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close(1001, 'Server shutting down');
      }
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    await this.fastify.close();
    this.sessionStore.save();

    log.info('Gateway server stopped');
  }
}
