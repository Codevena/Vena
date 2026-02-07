import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import type { InboundMessage, OutboundMessage, MediaAttachment } from '@vena/shared';
import { ChannelError, createLogger } from '@vena/shared';
import type { Channel } from '../channel.js';
import { WhatsAppMedia } from './media.js';

export interface WhatsAppChannelOptions {
  authDir: string;
  printQRInTerminal?: boolean;
}

export class WhatsAppChannel implements Channel {
  public readonly name = 'whatsapp';
  private sock: WASocket | null = null;
  private media: WhatsAppMedia | null = null;
  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private logger = createLogger('channels:whatsapp');
  private options: WhatsAppChannelOptions;

  constructor(options: WhatsAppChannelOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.options.authDir);

    const silentLogger = pino({ level: 'silent' });

    this.sock = makeWASocket({
      auth: state,
      logger: silentLogger as never,
      printQRInTerminal: this.options.printQRInTerminal ?? true,
    });

    this.media = new WhatsAppMedia(this.sock);

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        this.logger.warn({ statusCode }, 'WhatsApp connection closed');

        if (shouldReconnect) {
          this.logger.info('Reconnecting to WhatsApp...');
          this.connect();
        } else {
          this.logger.info('WhatsApp logged out, not reconnecting');
        }
      } else if (connection === 'open') {
        this.logger.info('WhatsApp channel connected');
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !this.messageHandler) return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;

        try {
          const inbound = await this.buildInboundMessage(msg);
          if (inbound) {
            await this.messageHandler(inbound);
          }
        } catch (error) {
          this.logger.error({ error }, 'Error processing WhatsApp message');
        }
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
      this.media = null;
      this.logger.info('WhatsApp channel disconnected');
    }
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async send(sessionKey: string, content: OutboundMessage): Promise<void> {
    if (!this.sock) {
      throw new ChannelError('WhatsApp not connected', 'whatsapp');
    }

    const jid = this.jidFromSessionKey(sessionKey);

    try {
      if (content.text) {
        await this.sock.sendMessage(jid, {
          text: content.text,
        });
      }

      if (content.media && this.media) {
        for (const attachment of content.media) {
          await this.sendMediaAttachment(jid, attachment);
        }
      }
    } catch (error) {
      throw new ChannelError(
        `Failed to send WhatsApp message: ${error instanceof Error ? error.message : String(error)}`,
        'whatsapp',
      );
    }
  }

  getSessionKey(raw: unknown): string {
    const msg = raw as { key?: { remoteJid?: string } };
    const jid = msg.key?.remoteJid;
    if (!jid) {
      throw new ChannelError('Cannot extract session key: missing JID', 'whatsapp');
    }
    return `whatsapp:${jid}`;
  }

  private async buildInboundMessage(msg: WAMessage): Promise<InboundMessage | null> {
    const key = msg.key;
    const jid = key.remoteJid;
    if (!jid) return null;

    const pushName = msg.pushName ?? undefined;
    const message = msg.message;
    if (!message) return null;

    const media: MediaAttachment[] = [];
    let content = '';

    // Text message
    const conversation = message.conversation;
    const extendedText = message.extendedTextMessage;

    if (conversation) {
      content = conversation;
    } else if (extendedText?.text) {
      content = extendedText.text;
    }

    // Image message
    const imageMessage = message.imageMessage;
    if (imageMessage && this.media) {
      const buffer = await this.media.downloadMedia(msg);
      media.push({
        type: 'photo',
        buffer,
        mimeType: imageMessage.mimetype ?? 'image/jpeg',
        caption: imageMessage.caption ?? undefined,
      });
      if (imageMessage.caption) content = imageMessage.caption;
    }

    // Audio/voice message
    const audioMessage = message.audioMessage;
    if (audioMessage && this.media) {
      const buffer = await this.media.downloadMedia(msg);
      media.push({
        type: audioMessage.ptt ? 'voice' : 'audio',
        buffer,
        mimeType: audioMessage.mimetype ?? 'audio/ogg; codecs=opus',
      });
    }

    // Document message
    const documentMessage = message.documentMessage;
    if (documentMessage && this.media) {
      const buffer = await this.media.downloadMedia(msg);
      media.push({
        type: 'document',
        buffer,
        mimeType: documentMessage.mimetype ?? 'application/octet-stream',
        fileName: documentMessage.fileName ?? undefined,
        caption: documentMessage.caption ?? undefined,
      });
      if (documentMessage.caption) content = documentMessage.caption;
    }

    if (!content && media.length === 0) return null;

    const senderId = key.participant ?? jid;
    const quotedStanzaId = extendedText?.contextInfo?.stanzaId;

    return {
      channelName: this.name,
      sessionKey: `whatsapp:${jid}`,
      userId: senderId,
      userName: pushName,
      content,
      media: media.length > 0 ? media : undefined,
      replyToMessageId: quotedStanzaId ?? undefined,
      raw: msg,
    };
  }

  private async sendMediaAttachment(jid: string, attachment: MediaAttachment): Promise<void> {
    if (!this.media) {
      throw new ChannelError('WhatsApp media handler not initialized', 'whatsapp');
    }

    switch (attachment.type) {
      case 'photo':
        await this.media.sendImage(jid, attachment);
        break;
      case 'voice':
      case 'audio':
        await this.media.sendAudio(jid, attachment);
        break;
      case 'document':
      case 'video':
        await this.media.sendDocument(jid, attachment);
        break;
    }
  }

  private jidFromSessionKey(sessionKey: string): string {
    const parts = sessionKey.split(':');
    const jid = parts[1];
    if (!jid) {
      throw new ChannelError(`Invalid session key: ${sessionKey}`, 'whatsapp');
    }
    return jid;
  }
}
