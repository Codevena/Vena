import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions/completions';
import type {
  ChatParams,
  Message,
  StreamChunk,
  ToolDefinition,
} from '@vena/shared';
import { ProviderError } from '@vena/shared';
import type { LLMProvider } from './provider.js';

import type { AuthConfig } from '@vena/shared';
import { resolveAuth } from './auth.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  auth?: AuthConfig;
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string = 'openai';
  readonly supportsTools: boolean = true;
  readonly maxContextWindow: number = 128_000;

  private client!: OpenAI;
  private model: string;
  private options: OpenAIProviderOptions;
  private initialized = false;

  constructor(options: OpenAIProviderOptions) {
    this.options = options;
    this.model = options.model ?? 'gpt-4o';
    if (options.apiKey && !options.auth) {
      this.client = new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
      });
      this.initialized = true;
    }
  }

  private async ensureClient(): Promise<OpenAI> {
    if (this.initialized) return this.client;
    const token = await resolveAuth(this.options.auth, this.options.apiKey, 'openai');
    this.client = new OpenAI({
      apiKey: token,
      baseURL: this.options.baseUrl,
    });
    this.initialized = true;
    return this.client;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const messages = this.mapMessages(params);
    const tools = params.tools ? this.mapTools(params.tools) : undefined;

    try {
      const client = await this.ensureClient();
      const stream = await client.chat.completions.create({
        model: this.model,
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature,
        messages,
        tools,
        stream: true,
      });

      const toolCalls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content
        if (delta.content) {
          yield { type: 'text', text: delta.content };
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCalls.get(tc.index);
            if (!existing) {
              // New tool call
              const id = tc.id ?? `call_${tc.index}`;
              const name = tc.function?.name ?? '';
              const args = tc.function?.arguments ?? '';
              toolCalls.set(tc.index, { id, name, args });
              yield {
                type: 'tool_use',
                toolUse: { id, name },
              };
              if (args) {
                yield {
                  type: 'tool_use_input',
                  toolInput: args,
                };
              }
            } else {
              // Accumulate arguments
              if (tc.function?.arguments) {
                existing.args += tc.function.arguments;
                yield {
                  type: 'tool_use_input',
                  toolInput: tc.function.arguments,
                };
              }
            }
          }
        }

        // Stop
        if (choice.finish_reason) {
          yield {
            type: 'stop',
            stopReason: this.mapFinishReason(choice.finish_reason),
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: message };
      throw new ProviderError(message, 'openai');
    }
  }

  async countTokens(messages: Message[]): Promise<number> {
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

  private mapMessages(params: ChatParams): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = [];

    if (params.systemPrompt) {
      result.push({ role: 'system', content: params.systemPrompt });
    }

    for (const msg of params.messages) {
      if (msg.role === 'system') {
        result.push({ role: 'system', content: this.getTextContent(msg) });
      } else if (msg.role === 'user') {
        result.push({ role: 'user', content: this.getTextContent(msg) });
      } else if (msg.role === 'assistant') {
        const toolCalls = this.extractToolCalls(msg);
        if (toolCalls.length > 0) {
          result.push({
            role: 'assistant',
            content: this.getTextContent(msg) || null,
            tool_calls: toolCalls,
          });
        } else {
          result.push({ role: 'assistant', content: this.getTextContent(msg) });
        }
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          tool_call_id: (msg.metadata?.['toolUseId'] as string) ?? 'unknown',
          content: this.getTextContent(msg),
        });
      }
    }

    return result;
  }

  private getTextContent(msg: Message): string {
    if (typeof msg.content === 'string') return msg.content;
    return msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
  }

  private extractToolCalls(msg: Message): ChatCompletionMessageToolCall[] {
    if (typeof msg.content === 'string') return [];
    return msg.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => {
        const block = b as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
        return {
          id: block.id,
          type: 'function' as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        };
      });
  }

  private mapTools(tools: ToolDefinition[]): ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  private mapFinishReason(reason: string): StreamChunk['stopReason'] {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }
}
