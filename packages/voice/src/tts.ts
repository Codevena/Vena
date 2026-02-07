import { ElevenLabsClient } from 'elevenlabs';
import OpenAI from 'openai';
import { VoiceError } from '@vena/shared';

export interface TTSConfig {
  provider: 'elevenlabs' | 'openai-tts';
  apiKey: string;
  defaultVoice: string;
  model: string;
}

export interface TTSOptions {
  voiceId?: string;
}

export class TextToSpeech {
  private readonly config: TTSConfig;
  private readonly elevenLabs?: ElevenLabsClient;
  private readonly openai?: OpenAI;

  constructor(config: TTSConfig) {
    this.config = config;

    if (config.provider === 'elevenlabs') {
      this.elevenLabs = new ElevenLabsClient({ apiKey: config.apiKey });
    } else if (config.provider === 'openai-tts') {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    }
  }

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const voiceId = options?.voiceId ?? this.config.defaultVoice;

    if (this.config.provider === 'elevenlabs') {
      return this.synthesizeElevenLabs(text, voiceId);
    } else if (this.config.provider === 'openai-tts') {
      return this.synthesizeOpenAI(text, voiceId);
    }

    throw new VoiceError(`Unsupported TTS provider: ${this.config.provider}`);
  }

  async *synthesizeStream(text: string, options?: TTSOptions): AsyncIterable<Buffer> {
    const voiceId = options?.voiceId ?? this.config.defaultVoice;

    if (this.config.provider === 'elevenlabs') {
      yield* this.streamElevenLabs(text, voiceId);
    } else if (this.config.provider === 'openai-tts') {
      yield* this.streamOpenAI(text, voiceId);
    } else {
      throw new VoiceError(`Unsupported TTS provider: ${this.config.provider}`);
    }
  }

  private async synthesizeElevenLabs(text: string, voiceId: string): Promise<Buffer> {
    if (!this.elevenLabs) {
      throw new VoiceError('ElevenLabs client not initialized');
    }

    try {
      const audio = await this.elevenLabs.textToSpeech.convert(voiceId, {
        text,
        model_id: this.config.model,
      });

      const chunks: Buffer[] = [];
      for await (const chunk of audio) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      throw new VoiceError(`ElevenLabs TTS failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async synthesizeOpenAI(text: string, voice: string): Promise<Buffer> {
    if (!this.openai) {
      throw new VoiceError('OpenAI client not initialized');
    }

    try {
      const response = await this.openai.audio.speech.create({
        model: this.config.model,
        voice: voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
        input: text,
        response_format: 'mp3',
      });

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      throw new VoiceError(`OpenAI TTS failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async *streamElevenLabs(text: string, voiceId: string): AsyncIterable<Buffer> {
    if (!this.elevenLabs) {
      throw new VoiceError('ElevenLabs client not initialized');
    }

    try {
      const audioStream = await this.elevenLabs.textToSpeech.convertAsStream(voiceId, {
        text,
        model_id: this.config.model,
      });

      for await (const chunk of audioStream) {
        yield typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
      }
    } catch (error) {
      throw new VoiceError(`ElevenLabs streaming TTS failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async *streamOpenAI(text: string, voice: string): AsyncIterable<Buffer> {
    if (!this.openai) {
      throw new VoiceError('OpenAI client not initialized');
    }

    try {
      const response = await this.openai.audio.speech.create({
        model: this.config.model,
        voice: voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
        input: text,
        response_format: 'mp3',
      });

      const arrayBuffer = await response.arrayBuffer();
      yield Buffer.from(arrayBuffer);
    } catch (error) {
      throw new VoiceError(`OpenAI streaming TTS failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
