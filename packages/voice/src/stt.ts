import OpenAI from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import { Readable, Writable } from 'node:stream';
import { VoiceError } from '@vena/shared';

export interface STTConfig {
  provider: 'whisper' | 'deepgram';
  model: string;
  apiKey: string;
}

export interface STTOptions {
  language?: string;
  format?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
}

export class SpeechToText {
  private readonly config: STTConfig;
  private readonly openai?: OpenAI;

  constructor(config: STTConfig) {
    this.config = config;

    if (config.provider === 'whisper') {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    }
  }

  async transcribe(audio: Buffer, options?: STTOptions): Promise<TranscriptionResult> {
    if (this.config.provider === 'whisper') {
      return this.transcribeWhisper(audio, options);
    } else if (this.config.provider === 'deepgram') {
      return this.transcribeDeepgram(audio, options);
    }

    throw new VoiceError(`Unsupported STT provider: ${this.config.provider}`);
  }

  private async transcribeWhisper(audio: Buffer, options?: STTOptions): Promise<TranscriptionResult> {
    if (!this.openai) {
      throw new VoiceError('OpenAI client not initialized');
    }

    try {
      const format = options?.format ?? 'ogg';
      const processedAudio = format === 'ogg_opus' ? await this.convertToWav(audio) : audio;
      const fileName = format === 'ogg_opus' ? 'audio.wav' : `audio.${format}`;

      const file = new File([processedAudio], fileName, {
        type: format === 'ogg_opus' ? 'audio/wav' : `audio/${format}`,
      });

      const response = await this.openai.audio.transcriptions.create({
        model: this.config.model,
        file,
        ...(options?.language ? { language: options.language } : {}),
      });

      return {
        text: response.text,
        language: options?.language,
      };
    } catch (error) {
      throw new VoiceError(`Whisper transcription failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async transcribeDeepgram(audio: Buffer, options?: STTOptions): Promise<TranscriptionResult> {
    try {
      const url = new URL('https://api.deepgram.com/v1/listen');
      url.searchParams.set('model', this.config.model);
      if (options?.language) {
        url.searchParams.set('language', options.language);
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.config.apiKey}`,
          'Content-Type': options?.format === 'ogg_opus' ? 'audio/ogg' : `audio/${options?.format ?? 'wav'}`,
        },
        body: audio,
      });

      if (!response.ok) {
        throw new VoiceError(`Deepgram API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        results?: {
          channels?: Array<{
            alternatives?: Array<{
              transcript?: string;
            }>;
          }>;
        };
        metadata?: {
          detected_language?: string;
        };
      };

      const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

      return {
        text: transcript,
        language: data.metadata?.detected_language ?? options?.language,
      };
    } catch (error) {
      if (error instanceof VoiceError) throw error;
      throw new VoiceError(`Deepgram transcription failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private convertToWav(audio: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const inputStream = new Readable();
      inputStream.push(audio);
      inputStream.push(null);

      const outputStream = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });

      ffmpeg(inputStream)
        .inputFormat('ogg')
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav')
        .on('error', (err: Error) => {
          reject(new VoiceError(`Audio conversion failed: ${err.message}`));
        })
        .on('end', () => {
          resolve(Buffer.concat(chunks));
        })
        .pipe(outputStream);
    });
  }
}
