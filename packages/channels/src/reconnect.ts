import type { InboundMessage, OutboundMessage } from '@vena/shared';
import { createLogger } from '@vena/shared';
import type { Channel } from './channel.js';

export interface ReconnectOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  onReconnect?: (attempt: number, delayMs: number) => void;
  onReconnectFailed?: (error: Error, attempt: number) => void;
  onMaxRetriesReached?: () => void;
}

const DEFAULTS = {
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
} as const;

export function withReconnect(channel: Channel, options?: ReconnectOptions): Channel {
  const opts = { ...DEFAULTS, ...options };
  const logger = createLogger(`channels:reconnect:${channel.name}`);

  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connected = false;
  let stopped = false;
  let messageHandler: ((msg: InboundMessage) => Promise<void>) | undefined;

  function computeDelay(): number {
    const delay = opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt);
    return Math.min(delay, opts.maxDelayMs);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  async function attemptReconnect(): Promise<void> {
    if (stopped) return;

    if (opts.maxRetries > 0 && attempt >= opts.maxRetries) {
      logger.error({ attempt, maxRetries: opts.maxRetries }, 'Max reconnect retries reached');
      opts.onMaxRetriesReached?.();
      return;
    }

    attempt++;
    const delay = computeDelay();
    logger.info({ attempt, delayMs: delay }, 'Scheduling reconnect attempt');
    opts.onReconnect?.(attempt, delay);

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (stopped) return;

      try {
        await channel.connect();
        connected = true;
        attempt = 0;
        logger.info('Reconnected successfully');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error({ error: err, attempt }, 'Reconnect attempt failed');
        opts.onReconnectFailed?.(err, attempt);
        attemptReconnect();
      }
    }, delay);
  }

  function handleDisconnect(error?: Error): void {
    if (stopped) return;
    connected = false;
    logger.warn({ error }, 'Channel disconnected, starting reconnect');
    attemptReconnect();
  }

  const wrapper: Channel = {
    get name() {
      return channel.name;
    },

    async connect(): Promise<void> {
      stopped = false;
      attempt = 0;
      clearReconnectTimer();

      try {
        await channel.connect();
        connected = true;

        // Register disconnect handler on the inner channel if supported
        if (channel.onDisconnect) {
          channel.onDisconnect(handleDisconnect);
        }
      } catch (error) {
        connected = false;
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error({ error: err }, 'Initial connect failed, starting reconnect');
        opts.onReconnectFailed?.(err, 0);
        await attemptReconnect();
      }
    },

    async disconnect(): Promise<void> {
      stopped = true;
      connected = false;
      clearReconnectTimer();
      await channel.disconnect();
    },

    onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
      messageHandler = handler;
      channel.onMessage(handler);
    },

    async send(sessionKey: string, content: OutboundMessage): Promise<void> {
      if (!connected) {
        throw new Error(`Channel ${channel.name} is not connected (reconnecting)`);
      }

      try {
        await channel.send(sessionKey, content);
      } catch (error) {
        // If send fails, it may indicate a connection loss
        const err = error instanceof Error ? error : new Error(String(error));
        connected = false;
        handleDisconnect(err);
        throw error;
      }
    },

    getSessionKey(raw: unknown): string {
      return channel.getSessionKey(raw);
    },
  };

  return wrapper;
}
