import type { Bot } from 'grammy';
import { InputFile } from 'grammy';
import type { MediaAttachment } from '@vena/shared';
import { ChannelError } from '@vena/shared';

export class TelegramMedia {
  constructor(private readonly bot: Bot) {}

  async downloadFile(fileId: string): Promise<Buffer> {
    try {
      const file = await this.bot.api.getFile(fileId);
      const filePath = file.file_path;
      if (!filePath) {
        throw new ChannelError('File path not available', 'telegram');
      }

      const url = `https://api.telegram.org/file/bot${this.bot.token}/${filePath}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new ChannelError(`Failed to download file: ${response.statusText}`, 'telegram');
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof ChannelError) throw error;
      throw new ChannelError(
        `Failed to download file: ${error instanceof Error ? error.message : String(error)}`,
        'telegram',
      );
    }
  }

  async uploadPhoto(chatId: number | string, attachment: MediaAttachment, replyToMessageId?: number): Promise<void> {
    const source = attachment.buffer
      ? new InputFile(attachment.buffer, attachment.fileName ?? 'photo.jpg')
      : attachment.url;

    if (!source) {
      throw new ChannelError('No photo source provided', 'telegram');
    }

    await this.bot.api.sendPhoto(chatId, source, {
      caption: attachment.caption,
      reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
    });
  }

  async uploadVoice(chatId: number | string, attachment: MediaAttachment, replyToMessageId?: number): Promise<void> {
    const source = attachment.buffer
      ? new InputFile(attachment.buffer, attachment.fileName ?? 'voice.ogg')
      : attachment.url;

    if (!source) {
      throw new ChannelError('No voice source provided', 'telegram');
    }

    await this.bot.api.sendVoice(chatId, source, {
      caption: attachment.caption,
      reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
    });
  }

  async uploadDocument(chatId: number | string, attachment: MediaAttachment, replyToMessageId?: number): Promise<void> {
    const source = attachment.buffer
      ? new InputFile(attachment.buffer, attachment.fileName ?? 'document')
      : attachment.url;

    if (!source) {
      throw new ChannelError('No document source provided', 'telegram');
    }

    await this.bot.api.sendDocument(chatId, source, {
      caption: attachment.caption,
      reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
    });
  }
}
