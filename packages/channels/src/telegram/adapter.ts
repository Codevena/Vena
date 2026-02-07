import { Bot, type Context } from 'grammy';
import type { InboundMessage, OutboundMessage, MediaAttachment } from '@vena/shared';
import { ChannelError, createLogger } from '@vena/shared';
import type { Channel } from '../channel.js';
import { TelegramMedia } from './media.js';

export class TelegramChannel implements Channel {
  public readonly name = 'telegram';
  private bot: Bot;
  private media: TelegramMedia;
  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private logger = createLogger('channels:telegram');

  constructor(token: string) {
    this.bot = new Bot(token);
    this.media = new TelegramMedia(this.bot);
  }

  async connect(): Promise<void> {
    this.bot.on('message', async (ctx) => {
      if (!this.messageHandler) return;

      try {
        const inbound = await this.buildInboundMessage(ctx);
        if (inbound) {
          await this.messageHandler(inbound);
        }
      } catch (error) {
        this.logger.error({ error }, 'Error processing Telegram message');
      }
    });

    this.bot.catch((err) => {
      this.logger.error({ error: err.error }, 'Telegram bot error');
    });

    this.bot.start();
    this.logger.info('Telegram channel connected');
  }

  async disconnect(): Promise<void> {
    this.bot.stop();
    this.logger.info('Telegram channel disconnected');
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async send(sessionKey: string, content: OutboundMessage): Promise<void> {
    const chatId = this.chatIdFromSessionKey(sessionKey);

    const replyToMessageId = content.replyToMessageId
      ? parseInt(content.replyToMessageId, 10)
      : undefined;

    try {
      if (content.text) {
        await this.bot.api.sendMessage(chatId, content.text, {
          parse_mode: content.parseMode === 'html' ? 'HTML' : 'MarkdownV2',
          reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
        });
      }

      if (content.media) {
        for (const attachment of content.media) {
          await this.sendMediaAttachment(chatId, attachment, replyToMessageId);
        }
      }
    } catch (error) {
      throw new ChannelError(
        `Failed to send Telegram message: ${error instanceof Error ? error.message : String(error)}`,
        'telegram',
      );
    }
  }

  getSessionKey(raw: unknown): string {
    const ctx = raw as { chat?: { id: number } };
    if (!ctx.chat?.id) {
      throw new ChannelError('Cannot extract session key: missing chat ID', 'telegram');
    }
    return `telegram:${ctx.chat.id}`;
  }

  private async buildInboundMessage(ctx: Context): Promise<InboundMessage | null> {
    const msg = ctx.message;
    if (!msg) return null;

    const chatId = ctx.chat?.id;
    const from = ctx.from;
    if (!chatId || !from) return null;

    const media: MediaAttachment[] = [];
    let content = '';

    if (msg.text) {
      content = msg.text;
    }

    if (msg.caption) {
      content = msg.caption;
    }

    // Handle photo
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      if (largest) {
        const buffer = await this.media.downloadFile(largest.file_id);
        media.push({
          type: 'photo',
          buffer,
          mimeType: 'image/jpeg',
        });
      }
    }

    // Handle voice
    if (msg.voice) {
      const buffer = await this.media.downloadFile(msg.voice.file_id);
      media.push({
        type: 'voice',
        buffer,
        mimeType: msg.voice.mime_type ?? 'audio/ogg',
      });
    }

    // Handle document
    if (msg.document) {
      const buffer = await this.media.downloadFile(msg.document.file_id);
      media.push({
        type: 'document',
        buffer,
        mimeType: msg.document.mime_type ?? 'application/octet-stream',
        fileName: msg.document.file_name,
      });
    }

    if (!content && media.length === 0) return null;

    const replyTo = msg.reply_to_message;

    return {
      channelName: this.name,
      sessionKey: `telegram:${chatId}`,
      userId: String(from.id),
      userName: from.username ?? from.first_name,
      content,
      media: media.length > 0 ? media : undefined,
      replyToMessageId: replyTo?.message_id ? String(replyTo.message_id) : undefined,
      raw: ctx,
    };
  }

  private async sendMediaAttachment(
    chatId: number,
    attachment: MediaAttachment,
    replyToMessageId?: number,
  ): Promise<void> {
    switch (attachment.type) {
      case 'photo':
        await this.media.uploadPhoto(chatId, attachment, replyToMessageId);
        break;
      case 'voice':
      case 'audio':
        await this.media.uploadVoice(chatId, attachment, replyToMessageId);
        break;
      case 'document':
      case 'video':
        await this.media.uploadDocument(chatId, attachment, replyToMessageId);
        break;
    }
  }

  private chatIdFromSessionKey(sessionKey: string): number {
    const parts = sessionKey.split(':');
    const id = parts[1];
    if (!id) {
      throw new ChannelError(`Invalid session key: ${sessionKey}`, 'telegram');
    }
    return parseInt(id, 10);
  }
}
