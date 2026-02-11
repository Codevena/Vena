import type { InboundMessage, OutboundMessage, MediaAttachment } from '@vena/shared';
import { ChannelError, createLogger } from '@vena/shared';
import type { Channel } from '../channel.js';
import { SignalMedia } from './media.js';

export interface SignalChannelOptions {
  apiUrl: string;
  phoneNumber: string;
  pollIntervalMs?: number;
}

interface SignalEnvelope {
  envelope: {
    source?: string;
    sourceName?: string;
    sourceDevice?: number;
    timestamp?: number;
    dataMessage?: {
      timestamp?: number;
      message?: string;
      attachments?: Array<{
        contentType: string;
        filename?: string;
        id: string;
        size?: number;
      }>;
      groupInfo?: {
        groupId: string;
        type?: string;
      };
    };
  };
}

export class SignalChannel implements Channel {
  public readonly name = 'signal';
  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private disconnectHandler?: (error?: Error) => void;
  private logger = createLogger('channels:signal');
  private options: SignalChannelOptions;
  private media: SignalMedia;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private consecutivePollErrors = 0;

  constructor(options: SignalChannelOptions) {
    this.options = options;
    this.media = new SignalMedia(options.apiUrl, options.phoneNumber);
  }

  async connect(): Promise<void> {
    // Verify the signal-cli REST API is reachable
    try {
      const resp = await fetch(`${this.options.apiUrl}/v1/about`);
      if (!resp.ok) {
        throw new Error(`Signal REST API returned ${resp.status}`);
      }
    } catch (error) {
      throw new ChannelError(
        `Cannot reach signal-cli REST API at ${this.options.apiUrl}: ${error instanceof Error ? error.message : String(error)}`,
        'signal',
      );
    }

    this.connected = true;
    const intervalMs = this.options.pollIntervalMs ?? 1000;

    this.consecutivePollErrors = 0;
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error({ error: err }, 'Signal poll error');
      });
    }, intervalMs);

    this.logger.info({ apiUrl: this.options.apiUrl, phone: this.options.phoneNumber }, 'Signal channel connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.info('Signal channel disconnected');
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onDisconnect(handler: (error?: Error) => void): void {
    this.disconnectHandler = handler;
  }

  async send(sessionKey: string, content: OutboundMessage): Promise<void> {
    if (!this.connected) {
      throw new ChannelError('Signal not connected', 'signal');
    }

    const recipient = this.recipientFromSessionKey(sessionKey);

    try {
      if (content.text) {
        const body: Record<string, unknown> = {
          message: content.text,
          number: this.options.phoneNumber,
          recipients: [recipient],
        };

        const resp = await fetch(`${this.options.apiUrl}/v2/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Send failed (${resp.status}): ${text}`);
        }
      }

      if (content.media) {
        for (const attachment of content.media) {
          await this.media.sendAttachment(recipient, attachment);
        }
      }
    } catch (error) {
      throw new ChannelError(
        `Failed to send Signal message: ${error instanceof Error ? error.message : String(error)}`,
        'signal',
      );
    }
  }

  getSessionKey(raw: unknown): string {
    const msg = raw as { source?: string };
    if (!msg.source) {
      throw new ChannelError('Cannot extract session key: missing source', 'signal');
    }
    return `signal:${msg.source}`;
  }

  private async poll(): Promise<void> {
    if (!this.connected || !this.messageHandler) return;

    try {
      const resp = await fetch(
        `${this.options.apiUrl}/v1/receive/${encodeURIComponent(this.options.phoneNumber)}`,
      );

      if (!resp.ok) return;

      this.consecutivePollErrors = 0;

      const envelopes = (await resp.json()) as SignalEnvelope[];
      if (!Array.isArray(envelopes)) return;

      for (const env of envelopes) {
        const data = env.envelope?.dataMessage;
        if (!data?.message && !data?.attachments?.length) continue;

        const source = env.envelope.source;
        if (!source) continue;

        const media: MediaAttachment[] = [];
        if (data.attachments) {
          for (const att of data.attachments) {
            try {
              const downloaded = await this.media.downloadAttachment(att.id);
              media.push({
                type: this.getMediaType(att.contentType),
                buffer: downloaded,
                mimeType: att.contentType,
                fileName: att.filename,
              });
            } catch (err) {
              this.logger.error({ error: err, attachmentId: att.id }, 'Failed to download Signal attachment');
            }
          }
        }

        const sessionKey = data.groupInfo
          ? `signal:group:${data.groupInfo.groupId}`
          : `signal:${source}`;

        const inbound: InboundMessage = {
          channelName: this.name,
          sessionKey,
          userId: source,
          userName: env.envelope.sourceName,
          content: data.message ?? '',
          media: media.length > 0 ? media : undefined,
          raw: env,
        };

        try {
          await this.messageHandler(inbound);
        } catch (err) {
          this.logger.error({ error: err, source }, 'Error processing Signal message');
        }
      }
    } catch (error) {
      this.consecutivePollErrors++;
      if (this.consecutivePollErrors >= 3) {
        const err = error instanceof Error ? error : new Error('Signal API unreachable');
        this.connected = false;
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        this.disconnectHandler?.(err);
      }
    }
  }

  private getMediaType(mimeType: string): MediaAttachment['type'] {
    if (mimeType.startsWith('image/')) return 'photo';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
  }

  private recipientFromSessionKey(sessionKey: string): string {
    // "signal:+1234567890" or "signal:group:abc123"
    const parts = sessionKey.split(':');
    if (parts[1] === 'group') {
      return parts.slice(2).join(':');
    }
    return parts.slice(1).join(':');
  }
}
