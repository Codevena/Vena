import type { MediaAttachment } from '@vena/shared';
import { createLogger } from '@vena/shared';

const logger = createLogger('channels:signal:media');

export class SignalMedia {
  constructor(
    private apiUrl: string,
    private phoneNumber: string,
  ) {}

  async downloadAttachment(attachmentId: string): Promise<Buffer> {
    const url = `${this.apiUrl}/v1/attachments/${encodeURIComponent(attachmentId)}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      throw new Error(`Failed to download attachment ${attachmentId}: ${resp.status}`);
    }

    return Buffer.from(await resp.arrayBuffer());
  }

  async sendAttachment(recipient: string, attachment: MediaAttachment): Promise<void> {
    if (!attachment.buffer) {
      logger.warn('Skipping attachment without buffer');
      return;
    }

    const base64 = attachment.buffer.toString('base64');

    const body = {
      number: this.phoneNumber,
      recipients: [recipient],
      message: attachment.caption ?? '',
      base64_attachments: [
        {
          contentType: attachment.mimeType,
          filename: attachment.fileName ?? 'file',
          base64: base64,
        },
      ],
    };

    const resp = await fetch(`${this.apiUrl}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to send attachment: ${resp.status} ${text}`);
    }
  }
}
