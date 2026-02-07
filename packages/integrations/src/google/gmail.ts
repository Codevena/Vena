import { google, type gmail_v1 } from 'googleapis';
import { IntegrationError } from '@vena/shared';
import type { GoogleAuth } from './auth.js';

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  labels: string[];
  snippet: string;
}

export class GmailService {
  private gmail: gmail_v1.Gmail;

  constructor(auth: GoogleAuth) {
    this.gmail = google.gmail({ version: 'v1', auth: auth.getClient() });
  }

  async listMessages(options?: {
    query?: string;
    maxResults?: number;
    labelIds?: string[];
  }): Promise<GmailMessage[]> {
    try {
      const res = await this.gmail.users.messages.list({
        userId: 'me',
        q: options?.query,
        maxResults: options?.maxResults ?? 20,
        labelIds: options?.labelIds,
      });

      const messages = res.data.messages ?? [];
      const results: GmailMessage[] = [];

      for (const msg of messages) {
        if (msg.id) {
          const full = await this.getMessage(msg.id);
          results.push(full);
        }
      }

      return results;
    } catch (error) {
      throw new IntegrationError(
        `Failed to list Gmail messages: ${error instanceof Error ? error.message : String(error)}`,
        'gmail',
      );
    }
  }

  async getMessage(id: string): Promise<GmailMessage> {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });

      const headers = res.data.payload?.headers ?? [];
      const getHeader = (name: string): string =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      const body = this.extractBody(res.data.payload);

      return {
        id: res.data.id ?? id,
        threadId: res.data.threadId ?? '',
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        body,
        date: getHeader('Date'),
        labels: res.data.labelIds ?? [],
        snippet: res.data.snippet ?? '',
      };
    } catch (error) {
      throw new IntegrationError(
        `Failed to get Gmail message ${id}: ${error instanceof Error ? error.message : String(error)}`,
        'gmail',
      );
    }
  }

  async sendMessage(
    to: string,
    subject: string,
    body: string,
    options?: { cc?: string; threadId?: string },
  ): Promise<string> {
    try {
      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
      ];

      if (options?.cc) {
        headers.push(`Cc: ${options.cc}`);
      }

      const email = `${headers.join('\r\n')}\r\n\r\n${body}`;
      const encodedEmail = Buffer.from(email).toString('base64url');

      const res = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail,
          threadId: options?.threadId,
        },
      });

      return res.data.id ?? '';
    } catch (error) {
      throw new IntegrationError(
        `Failed to send Gmail message: ${error instanceof Error ? error.message : String(error)}`,
        'gmail',
      );
    }
  }

  async replyToMessage(messageId: string, body: string): Promise<string> {
    try {
      const original = await this.getMessage(messageId);

      const headers = [
        `To: ${original.from}`,
        `Subject: Re: ${original.subject}`,
        `In-Reply-To: ${messageId}`,
        `References: ${messageId}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
      ];

      const email = `${headers.join('\r\n')}\r\n\r\n${body}`;
      const encodedEmail = Buffer.from(email).toString('base64url');

      const res = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail,
          threadId: original.threadId,
        },
      });

      return res.data.id ?? '';
    } catch (error) {
      throw new IntegrationError(
        `Failed to reply to Gmail message ${messageId}: ${error instanceof Error ? error.message : String(error)}`,
        'gmail',
      );
    }
  }

  async listLabels(): Promise<{ id: string; name: string }[]> {
    try {
      const res = await this.gmail.users.labels.list({ userId: 'me' });
      return (res.data.labels ?? []).map((label) => ({
        id: label.id ?? '',
        name: label.name ?? '',
      }));
    } catch (error) {
      throw new IntegrationError(
        `Failed to list Gmail labels: ${error instanceof Error ? error.message : String(error)}`,
        'gmail',
      );
    }
  }

  private extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return '';

    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    }

    if (payload.parts) {
      const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
      if (htmlPart?.body?.data) {
        return Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8');
      }

      const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        return Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
      }

      for (const part of payload.parts) {
        const nested = this.extractBody(part);
        if (nested) return nested;
      }
    }

    return '';
  }
}
