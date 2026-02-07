import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { createLogger, VenaError, type InboundMessage } from '@vena/shared';
import { SessionStore } from './session-store.js';
import { LaneQueue } from './lane-queue.js';
import { controlAPI, type ControlAPIOptions } from './api/control.js';
import { openaiCompatAPI, type OpenAICompatOptions } from './api/openai-compat.js';

const log = createLogger('gateway:server');

export interface GatewayConfig {
  port: number;
  host: string;
  sessionsPath?: string;
}

type MessageHandler = (msg: InboundMessage) => Promise<{ text?: string }>;
type AgentsProvider = () => Array<{ id: string; name: string; status: string }>;

interface WebSocketMessage {
  type: 'message';
  content: string;
  sessionKey?: string;
}

export class GatewayServer {
  private config: GatewayConfig;
  private fastify: FastifyInstance;
  private wss: WebSocketServer | null = null;
  private sessionStore: SessionStore;
  private laneQueue: LaneQueue;
  private startedAt: Date;
  private messageHandler: MessageHandler | null = null;
  private agentsProvider: AgentsProvider | null = null;
  private eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(config: GatewayConfig) {
    this.config = config;
    this.startedAt = new Date();
    this.sessionStore = new SessionStore(config.sessionsPath ?? 'sessions.json');
    this.laneQueue = new LaneQueue();

    this.fastify = Fastify({ logger: false });
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

    // Start HTTP server
    await this.fastify.listen({ port: this.config.port, host: this.config.host });

    // Attach WebSocket server to the same HTTP server
    const server = this.fastify.server;
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      const connectionId = nanoid(12);
      log.info({ connectionId }, 'WebSocket client connected');

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as WebSocketMessage;
          if (msg.type === 'message' && msg.content) {
            const sessionKey = msg.sessionKey ?? `ws-${connectionId}`;
            const inbound: InboundMessage = {
              channelName: 'websocket',
              sessionKey,
              userId: connectionId,
              content: msg.content,
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
