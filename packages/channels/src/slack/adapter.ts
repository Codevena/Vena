import { App, type AllMiddlewareArgs, type SlackEventMiddlewareArgs } from '@slack/bolt';
import type { InboundMessage, OutboundMessage, MediaAttachment } from '@vena/shared';
import { ChannelError, createLogger } from '@vena/shared';
import type { Channel } from '../channel.js';

export interface SlackChannelOptions {
  token: string;
  signingSecret: string;
  appToken?: string;
}

export class SlackChannel implements Channel {
  public readonly name = 'slack';
  private app: App | null = null;
  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private disconnectHandler?: (error?: Error) => void;
  private logger = createLogger('channels:slack');
  private options: SlackChannelOptions;

  constructor(options: SlackChannelOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    this.app = new App({
      token: this.options.token,
      signingSecret: this.options.signingSecret,
      socketMode: !!this.options.appToken,
      appToken: this.options.appToken,
    });

    // Handle direct messages and mentions
    this.app.message(async ({ message, say }) => {
      if (!this.messageHandler) return;

      try {
        // Ignore bot messages and threaded replies
        if (message.subtype === 'bot_message') return;
        if ((message as any).thread_ts && (message as any).thread_ts !== (message as any).ts) return;

        const inbound = await this.buildInboundMessage(message);
        if (inbound) {
          await this.messageHandler(inbound);
        }
      } catch (error) {
        this.logger.error({ error }, 'Error processing Slack message');
      }
    });

    // Handle app mentions
    this.app.event('app_mention', async ({ event }) => {
      if (!this.messageHandler) return;

      try {
        const inbound = await this.buildInboundMessage(event);
        if (inbound) {
          await this.messageHandler(inbound);
        }
      } catch (error) {
        this.logger.error({ error }, 'Error processing Slack app mention');
      }
    });

    this.app.error(async (error) => {
      this.logger.error({ error }, 'Slack app error');
      const err = error instanceof Error ? error : new Error(String(error));
      this.disconnectHandler?.(err);
    });

    await this.app.start();
    this.logger.info('Slack channel connected');
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
      this.logger.info('Slack channel disconnected');
    }
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onDisconnect(handler: (error?: Error) => void): void {
    this.disconnectHandler = handler;
  }

  async send(sessionKey: string, content: OutboundMessage): Promise<void> {
    if (!this.app) {
      throw new ChannelError('Slack not connected', 'slack');
    }

    const channelId = this.channelIdFromSessionKey(sessionKey);

    try {
      if (content.text) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: content.text,
          thread_ts: content.replyToMessageId,
        });
      }

      if (content.media) {
        for (const attachment of content.media) {
          await this.sendMediaAttachment(channelId, attachment, content.replyToMessageId);
        }
      }
    } catch (error) {
      throw new ChannelError(
        `Failed to send Slack message: ${error instanceof Error ? error.message : String(error)}`,
        'slack',
      );
    }
  }

  getSessionKey(raw: unknown): string {
    const msg = raw as { channel?: string };
    if (!msg.channel) {
      throw new ChannelError('Cannot extract session key: missing channel', 'slack');
    }
    return `slack:${msg.channel}`;
  }

  private async buildInboundMessage(event: any): Promise<InboundMessage | null> {
    const channel = event.channel;
    const user = event.user;
    const text = event.text;
    const ts = event.ts;

    if (!channel || !user || !text) return null;

    // Remove bot mention from text if present
    let content = text;
    const botMentionPattern = /<@[A-Z0-9]+>/;
    content = content.replace(botMentionPattern, '').trim();

    if (!content) return null;

    // Handle files/media
    const media: MediaAttachment[] = [];
    if (event.files && Array.isArray(event.files)) {
      for (const file of event.files) {
        if (this.app && file.url_private_download) {
          try {
            // Download file using Slack API
            const response = await fetch(file.url_private_download, {
              headers: {
                Authorization: `Bearer ${this.options.token}`,
              },
            });
            const buffer = Buffer.from(await response.arrayBuffer());

            const mediaType = this.getMediaType(file.mimetype);
            media.push({
              type: mediaType,
              buffer,
              mimeType: file.mimetype,
              fileName: file.name,
            });
          } catch (error) {
            this.logger.error({ error, fileId: file.id }, 'Failed to download Slack file');
          }
        }
      }
    }

    return {
      channelName: this.name,
      sessionKey: `slack:${channel}`,
      userId: user,
      userName: undefined, // Slack doesn't provide username in events, would need separate API call
      content,
      media: media.length > 0 ? media : undefined,
      replyToMessageId: event.thread_ts || ts,
      raw: event,
    };
  }

  private async sendMediaAttachment(
    channelId: string,
    attachment: MediaAttachment,
    threadTs?: string,
  ): Promise<void> {
    if (!this.app || !attachment.buffer) {
      throw new ChannelError('Cannot send media: app not initialized or buffer missing', 'slack');
    }

    try {
      const uploadArgs: Record<string, unknown> = {
        channel_id: channelId,
        file: attachment.buffer,
        filename: attachment.fileName || 'file',
      };
      if (threadTs) {
        uploadArgs['thread_ts'] = threadTs;
      }
      await this.app.client.files.uploadV2(uploadArgs as any);
    } catch (error) {
      this.logger.error({ error }, 'Failed to upload file to Slack');
      throw error;
    }
  }

  private getMediaType(mimeType: string): MediaAttachment['type'] {
    if (mimeType.startsWith('image/')) return 'photo';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
  }

  private channelIdFromSessionKey(sessionKey: string): string {
    const parts = sessionKey.split(':');
    const channelId = parts[1];
    if (!channelId) {
      throw new ChannelError(`Invalid session key: ${sessionKey}`, 'slack');
    }
    return channelId;
  }
}
