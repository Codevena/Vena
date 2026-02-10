import { OpenAIProvider, type OpenAIProviderOptions } from './openai.js';

export interface OpenRouterProviderOptions extends Omit<OpenAIProviderOptions, 'baseUrl'> {
  apiKey?: string;
  model?: string;
}

/**
 * OpenRouter provider — multi-model gateway via OpenAI-compatible API.
 * Supports 100+ models from Anthropic, OpenAI, Google, Meta, Mistral, etc.
 * Default model: anthropic/claude-sonnet-4
 */
export class OpenRouterProvider extends OpenAIProvider {
  override readonly name = 'openrouter';
  override readonly maxContextWindow = 200_000;

  constructor(options: OpenRouterProviderOptions) {
    super({
      ...options,
      model: options.model ?? 'anthropic/claude-sonnet-4',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  }
}
