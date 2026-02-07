import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatParams,
  ContentBlock,
  Message,
  StreamChunk,
  ToolDefinition,
} from '@vena/shared';
import { ProviderError } from '@vena/shared';
import type { LLMProvider } from './provider.js';

import type { AuthConfig } from '@vena/shared';
import { resolveAuth } from './auth.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  auth?: AuthConfig;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly supportsTools = true;
  readonly maxContextWindow = 200_000;

  private client!: Anthropic;
  private model: string;
  private options: AnthropicProviderOptions;
  private initialized = false;

  constructor(options: AnthropicProviderOptions) {
    this.options = options;
    this.model = options.model ?? 'claude-sonnet-4-5-20250929';
    // Eagerly init if we have a plain API key
    if (options.apiKey && !options.auth) {
      this.client = new Anthropic({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
      });
      this.initialized = true;
    }
  }

  private async ensureClient(): Promise<Anthropic> {
    if (this.initialized) return this.client;
    const token = await resolveAuth(this.options.auth, this.options.apiKey, 'anthropic');
    this.client = new Anthropic({
      apiKey: token,
      baseURL: this.options.baseUrl,
    });
    this.initialized = true;
    return this.client;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const messages = this.mapMessages(params.messages);
    const tools = params.tools ? this.mapTools(params.tools) : undefined;

    try {
      const client = await this.ensureClient();
      const stream = client.messages.stream({
        model: this.model,
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature,
        system: params.systemPrompt,
        messages,
        tools,
      });

      for await (const event of stream) {
        const chunk = this.mapStreamEvent(event);
        if (chunk) yield chunk;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: message };
      throw new ProviderError(message, 'anthropic');
    }
  }

  async countTokens(messages: Message[]): Promise<number> {
    // Approximate: ~4 chars per token
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') totalChars += block.text.length;
          else if (block.type === 'tool_use') totalChars += JSON.stringify(block.input).length;
          else if (block.type === 'tool_result') totalChars += block.content.length;
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  private mapMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'tool' ? ('user' as const) : (m.role as 'user' | 'assistant'),
        content: this.mapContent(m),
      }));
  }

  private mapContent(message: Message): string | Anthropic.ContentBlockParam[] {
    if (typeof message.content === 'string') {
      if (message.role === 'tool') {
        return [
          {
            type: 'tool_result' as const,
            tool_use_id: message.metadata?.['toolUseId'] as string ?? 'unknown',
            content: message.content,
          },
        ];
      }
      return message.content;
    }

    return message.content.map((block): Anthropic.ContentBlockParam => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'image':
          return {
            type: 'image',
            source: {
              type: block.source.type as 'base64',
              media_type: block.source.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: block.source.data,
            },
          };
        case 'tool_use':
          return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError,
          };
        default:
          return { type: 'text', text: '' };
      }
    });
  }

  private mapTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }

  private mapStreamEvent(event: Anthropic.MessageStreamEvent): StreamChunk | null {
    switch (event.type) {
      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          return {
            type: 'tool_use',
            toolUse: {
              id: event.content_block.id,
              name: event.content_block.name,
            },
          };
        }
        return null;

      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          return { type: 'text', text: event.delta.text };
        }
        if (event.delta.type === 'input_json_delta') {
          return { type: 'tool_use_input', toolInput: event.delta.partial_json };
        }
        return null;

      case 'message_stop':
        return null;

      case 'message_delta':
        if (event.delta.stop_reason) {
          return {
            type: 'stop',
            stopReason: this.mapStopReason(event.delta.stop_reason),
          };
        }
        return null;

      default:
        return null;
    }
  }

  private mapStopReason(reason: string): StreamChunk['stopReason'] {
    switch (reason) {
      case 'end_turn':
        return 'end_turn';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }
}
