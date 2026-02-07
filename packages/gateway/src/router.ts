import type { InboundMessage, OutboundMessage } from '@vena/shared';
import { createLogger, VenaError } from '@vena/shared';

const log = createLogger('gateway:router');

export interface RouterOptions {
  onMessage: (msg: InboundMessage) => Promise<OutboundMessage>;
}

interface ActiveRoute {
  channelName: string;
  sessionKey: string;
  startedAt: string;
}

export class MessageRouter {
  private onMessage: (msg: InboundMessage) => Promise<OutboundMessage>;
  private activeRoutes = new Map<string, ActiveRoute>();

  constructor(options: RouterOptions) {
    this.onMessage = options.onMessage;
  }

  async route(inbound: InboundMessage): Promise<OutboundMessage> {
    const routeKey = `${inbound.channelName}:${inbound.sessionKey}`;

    log.debug({ routeKey, userId: inbound.userId }, 'Routing message');

    this.activeRoutes.set(routeKey, {
      channelName: inbound.channelName,
      sessionKey: inbound.sessionKey,
      startedAt: new Date().toISOString(),
    });

    try {
      const response = await this.onMessage(inbound);
      return response;
    } catch (err) {
      log.error({ err, routeKey }, 'Error routing message');
      throw new VenaError('Message routing failed', 'ROUTER_ERROR', { routeKey });
    } finally {
      this.activeRoutes.delete(routeKey);
    }
  }

  getActiveRoutes(): Map<string, ActiveRoute> {
    return new Map(this.activeRoutes);
  }
}
