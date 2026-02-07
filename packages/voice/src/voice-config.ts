import type { VoiceConfig } from '@vena/shared';
import { ElevenLabsClient } from 'elevenlabs';
import { VoiceError } from '@vena/shared';

export interface VoiceInfo {
  id: string;
  name: string;
  preview?: string;
}

export class VoiceConfigManager {
  private readonly configs = new Map<string, VoiceConfig>();
  private elevenLabsApiKey?: string;

  constructor(elevenLabsApiKey?: string) {
    this.elevenLabsApiKey = elevenLabsApiKey;
  }

  getVoiceForAgent(agentId: string): VoiceConfig | undefined {
    return this.configs.get(agentId);
  }

  setVoiceForAgent(agentId: string, config: VoiceConfig): void {
    this.configs.set(agentId, config);
  }

  async listAvailableVoices(): Promise<VoiceInfo[]> {
    if (!this.elevenLabsApiKey) {
      throw new VoiceError('ElevenLabs API key required to list voices');
    }

    try {
      const client = new ElevenLabsClient({ apiKey: this.elevenLabsApiKey });
      const response = await client.voices.getAll();

      return response.voices.map(voice => ({
        id: voice.voice_id,
        name: voice.name ?? voice.voice_id,
        preview: voice.preview_url ?? undefined,
      }));
    } catch (error) {
      throw new VoiceError(`Failed to list voices: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
