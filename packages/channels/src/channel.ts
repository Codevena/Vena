import type { InboundMessage, OutboundMessage } from '@vena/shared';

export interface Channel {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void;
  send(sessionKey: string, content: OutboundMessage): Promise<void>;
  getSessionKey(raw: unknown): string;
}
