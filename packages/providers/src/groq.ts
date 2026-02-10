import { OpenAIProvider, type OpenAIProviderOptions } from './openai.js';

export interface GroqProviderOptions extends Omit<OpenAIProviderOptions, 'baseUrl'> {
  apiKey?: string;
  model?: string;
}

/**
 * Groq provider — fast inference via OpenAI-compatible API.
 * Default model: llama-3.3-70b-versatile
 */
export class GroqProvider extends OpenAIProvider {
  override readonly name = 'groq';
  override readonly maxContextWindow = 128_000;

  constructor(options: GroqProviderOptions) {
    super({
      ...options,
      model: options.model ?? 'llama-3.3-70b-versatile',
      baseUrl: 'https://api.groq.com/openai/v1',
    });
  }
}
