import { VoiceError } from '@vena/shared';

export interface CallerConfig {
  provider: 'twilio';
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

export interface CallResult {
  callSid: string;
}

export class VoiceCaller {
  private readonly config: CallerConfig;

  constructor(config: CallerConfig) {
    this.config = config;
  }

  async call(toNumber: string, message: string): Promise<CallResult> {
    if (this.config.provider === 'twilio') {
      return this.callTwilio(toNumber, message);
    }

    throw new VoiceError(`Unsupported calling provider: ${this.config.provider}`);
  }

  private async callTwilio(toNumber: string, message: string): Promise<CallResult> {
    const twiml = this.generateTwiML(message);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Calls.json`;

    const credentials = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

    const body = new URLSearchParams({
      To: toNumber,
      From: this.config.phoneNumber,
      Twiml: twiml,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new VoiceError(`Twilio API error: ${response.status} ${errorText}`);
      }

      const data = await response.json() as { sid: string };

      return { callSid: data.sid };
    } catch (error) {
      if (error instanceof VoiceError) throw error;
      throw new VoiceError(`Twilio call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private generateTwiML(message: string): string {
    const escaped = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escaped}</Say></Response>`;
  }
}
