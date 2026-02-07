import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import type { MediaAttachment } from '@vena/shared';
import { ChannelError } from '@vena/shared';

export class WhatsAppMedia {
  constructor(private readonly sock: WASocket) {}

  async downloadMedia(message: WAMessage): Promise<Buffer> {
    try {
      const buffer = await downloadMediaMessage(message, 'buffer', {});
      return buffer as Buffer;
    } catch (error) {
      throw new ChannelError(
        `Failed to download WhatsApp media: ${error instanceof Error ? error.message : String(error)}`,
        'whatsapp',
      );
    }
  }

  async sendImage(jid: string, attachment: MediaAttachment): Promise<void> {
    const source = attachment.buffer ?? (attachment.url ? { url: attachment.url } : null);
    if (!source) {
      throw new ChannelError('No image source provided', 'whatsapp');
    }

    await this.sock.sendMessage(jid, {
      image: source instanceof Buffer ? source : source,
      caption: attachment.caption,
      mimetype: attachment.mimeType,
    });
  }

  async sendAudio(jid: string, attachment: MediaAttachment): Promise<void> {
    const source = attachment.buffer ?? (attachment.url ? { url: attachment.url } : null);
    if (!source) {
      throw new ChannelError('No audio source provided', 'whatsapp');
    }

    await this.sock.sendMessage(jid, {
      audio: source instanceof Buffer ? source : source,
      mimetype: attachment.mimeType,
      ptt: attachment.type === 'voice',
    });
  }

  async sendDocument(jid: string, attachment: MediaAttachment): Promise<void> {
    const source = attachment.buffer ?? (attachment.url ? { url: attachment.url } : null);
    if (!source) {
      throw new ChannelError('No document source provided', 'whatsapp');
    }

    await this.sock.sendMessage(jid, {
      document: source instanceof Buffer ? source : source,
      mimetype: attachment.mimeType,
      fileName: attachment.fileName ?? 'document',
    });
  }
}
