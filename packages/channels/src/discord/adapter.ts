import { Client, GatewayIntentBits, Events, type Message } from 'discord.js';
import type { InboundMessage, OutboundMessage, MediaAttachment } from '@vena/shared';
import { ChannelError, createLogger } from '@vena/shared';
import type { Channel } from '../channel.js';

export interface DiscordChannelOptions {
  token: string;
  applicationId: string;
}

export class DiscordChannel implements Channel {
  public readonly name = 'discord';
  private client: Client | null = null;
  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private disconnectHandler?: (error?: Error) => void;
  private logger = createLogger('channels:discord');
  private options: DiscordChannelOptions;

  constructor(options: DiscordChannelOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (!this.messageHandler) return;

      try {
        // Ignore bot messages
        if (message.author.bot) return;

        const inbound = await this.buildInboundMessage(message);
        if (inbound) {
          await this.messageHandler(inbound);
        }
      } catch (error) {
        this.logger.error({ error }, 'Error processing Discord message');
      }
    });

    this.client.on(Events.Error, (error) => {
      this.logger.error({ error }, 'Discord client error');
      this.disconnectHandler?.(error);
    });

    this.client.on(Events.ClientReady, () => {
      this.logger.info('Discord channel connected');
    });

    await this.client.login(this.options.token);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.logger.info('Discord channel disconnected');
    }
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onDisconnect(handler: (error?: Error) => void): void {
    this.disconnectHandler = handler;
  }

  async send(sessionKey: string, content: OutboundMessage): Promise<void> {
    if (!this.client) {
      throw new ChannelError('Discord not connected', 'discord');
    }

    const channelId = this.channelIdFromSessionKey(sessionKey);

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new ChannelError(`Invalid channel: ${channelId}`, 'discord');
      }

      if (content.text && 'send' in channel) {
        await (channel as any).send({
          content: content.text,
          reply: content.replyToMessageId
            ? { messageReference: content.replyToMessageId }
            : undefined,
        });
      }

      if (content.media) {
        for (const attachment of content.media) {
          await this.sendMediaAttachment(channelId, attachment);
        }
      }
    } catch (error) {
      throw new ChannelError(
        `Failed to send Discord message: ${error instanceof Error ? error.message : String(error)}`,
        'discord',
      );
    }
  }

  getSessionKey(raw: unknown): string {
    const msg = raw as { channelId?: string };
    if (!msg.channelId) {
      throw new ChannelError('Cannot extract session key: missing channel ID', 'discord');
    }
    return `discord:${msg.channelId}`;
  }

  private async buildInboundMessage(message: Message): Promise<InboundMessage | null> {
    const channelId = message.channelId;
    const author = message.author;
    const content = message.content;

    if (!channelId || !author) return null;

    // Handle attachments
    const media: MediaAttachment[] = [];
    if (message.attachments.size > 0) {
      for (const [, attachment] of message.attachments) {
        try {
          const response = await fetch(attachment.url);
          const buffer = Buffer.from(await response.arrayBuffer());

          const mediaType = this.getMediaType(attachment.contentType || 'application/octet-stream');
          media.push({
            type: mediaType,
            buffer,
            mimeType: attachment.contentType || 'application/octet-stream',
            fileName: attachment.name,
          });
        } catch (error) {
          this.logger.error({ error, attachmentId: attachment.id }, 'Failed to download Discord attachment');
        }
      }
    }

    if (!content && media.length === 0) return null;

    return {
      channelName: this.name,
      sessionKey: `discord:${channelId}`,
      userId: author.id,
      userName: author.username,
      content,
      media: media.length > 0 ? media : undefined,
      replyToMessageId: message.reference?.messageId,
      raw: message,
    };
  }

  private async sendMediaAttachment(channelId: string, attachment: MediaAttachment): Promise<void> {
    if (!this.client || !attachment.buffer) {
      throw new ChannelError('Cannot send media: client not initialized or buffer missing', 'discord');
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new ChannelError(`Invalid channel: ${channelId}`, 'discord');
      }

      await (channel as any).send({
        files: [
          {
            attachment: attachment.buffer,
            name: attachment.fileName || 'file',
          },
        ],
      });
    } catch (error) {
      this.logger.error({ error }, 'Failed to send Discord attachment');
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
      throw new ChannelError(`Invalid session key: ${sessionKey}`, 'discord');
    }
    return channelId;
  }
}
