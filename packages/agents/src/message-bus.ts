import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';

export interface BusMessage {
  id: string;
  type:
    | 'consultation_request'
    | 'consultation_response'
    | 'delegation'
    | 'delegation_result'
    | 'knowledge_share'
    | 'broadcast';
  fromAgentId: string;
  toAgentId?: string;
  payload: unknown;
  priority: 'urgent' | 'normal' | 'low';
  timestamp: string;
}

type MessageHandler = (msg: BusMessage) => void;

const PRIORITY_ORDER: Record<BusMessage['priority'], number> = {
  urgent: 0,
  normal: 1,
  low: 2,
};

export class MessageBus {
  private emitter = new EventEmitter();
  private queue: BusMessage[] = [];
  private processing = false;

  publish(channel: string, message: Omit<BusMessage, 'id' | 'timestamp'>): void {
    const fullMessage: BusMessage = {
      ...message,
      id: nanoid(),
      timestamp: new Date().toISOString(),
    };

    this.queue.push(fullMessage);
    this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    this.processQueue(channel);
  }

  subscribe(channel: string, handler: MessageHandler): void {
    this.emitter.on(channel, handler);
  }

  unsubscribe(channel: string, handler: MessageHandler): void {
    this.emitter.off(channel, handler);
  }

  private processQueue(channel: string): void {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (message) {
        this.emitter.emit(channel, message);
      }
    }

    this.processing = false;
  }
}
