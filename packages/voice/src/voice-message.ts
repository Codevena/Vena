import type { InboundMessage } from '@vena/shared';
import type { TextToSpeech } from './tts.js';
import type { SpeechToText } from './stt.js';

export class VoiceMessagePipeline {
  private readonly tts: TextToSpeech;
  private readonly stt: SpeechToText;

  constructor(tts: TextToSpeech, stt: SpeechToText) {
    this.tts = tts;
    this.stt = stt;
  }

  async processIncoming(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const format = this.mimeTypeToFormat(mimeType);
    const result = await this.stt.transcribe(audioBuffer, { format });
    return result.text;
  }

  async processOutgoing(text: string, voiceId?: string): Promise<Buffer> {
    return this.tts.synthesize(text, voiceId ? { voiceId } : undefined);
  }

  shouldReplyWithVoice(inbound: InboundMessage, config: { autoVoiceReply: boolean }): boolean {
    if (!config.autoVoiceReply) {
      return false;
    }

    if (inbound.media?.some(m => m.type === 'voice' || m.type === 'audio')) {
      return true;
    }

    return false;
  }

  splitLongText(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) {
      return [text];
    }

    const parts: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxChars) {
        parts.push(remaining);
        break;
      }

      let splitIndex = remaining.lastIndexOf('. ', maxChars);
      if (splitIndex === -1 || splitIndex < maxChars * 0.3) {
        splitIndex = remaining.lastIndexOf(' ', maxChars);
      }
      if (splitIndex === -1 || splitIndex < maxChars * 0.3) {
        splitIndex = maxChars;
      } else {
        splitIndex += 1;
      }

      parts.push(remaining.slice(0, splitIndex).trim());
      remaining = remaining.slice(splitIndex).trim();
    }

    return parts;
  }

  private mimeTypeToFormat(mimeType: string): string {
    const map: Record<string, string> = {
      'audio/ogg': 'ogg_opus',
      'audio/ogg; codecs=opus': 'ogg_opus',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'audio/mp4': 'mp4',
    };

    return map[mimeType] ?? 'ogg_opus';
  }
}
