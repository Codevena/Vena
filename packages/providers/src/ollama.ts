import type {
  ChatParams,
  Message,
  StreamChunk,
  ToolDefinition,
} from '@vena/shared';
import { ProviderError } from '@vena/shared';
import type { LLMProvider } from './provider.js';

interface OllamaProviderOptions {
  model?: string;
  baseUrl?: string;
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaStreamChunk {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly supportsTools = true;
  readonly maxContextWindow = 128_000;

  private baseUrl: string;
  private model: string;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://localhost:11434';
    this.model = options.model ?? 'llama3.1';
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const messages = this.mapMessages(params);
    const tools = params.tools ? this.mapTools(params.tools) : undefined;

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          tools,
          options: {
            num_predict: params.maxTokens ?? 4096,
            temperature: params.temperature,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${text}`);
      }

      if (!response.body) {
        throw new Error('No response body from Ollama');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          let chunk: OllamaStreamChunk;
          try {
            chunk = JSON.parse(line) as OllamaStreamChunk;
          } catch {
            continue;
          }

          // Handle tool calls
          if (chunk.message.tool_calls) {
            for (const tc of chunk.message.tool_calls) {
              const callId = `ollama_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              yield {
                type: 'tool_use',
                toolUse: {
                  id: callId,
                  name: tc.function.name,
                },
              };
              yield {
                type: 'tool_use_input',
                toolInput: JSON.stringify(tc.function.arguments),
              };
            }
          }

          // Handle text content
          if (chunk.message.content) {
            yield { type: 'text', text: chunk.message.content };
          }

          // Handle done
          if (chunk.done) {
            const hasTools = chunk.message.tool_calls && chunk.message.tool_calls.length > 0;

            const usage = (chunk.prompt_eval_count !== undefined || chunk.eval_count !== undefined)
              ? {
                  inputTokens: chunk.prompt_eval_count ?? 0,
                  outputTokens: chunk.eval_count ?? 0,
                }
              : undefined;

            yield {
              type: 'stop',
              stopReason: hasTools
                ? 'tool_use'
                : chunk.done_reason === 'length'
                  ? 'max_tokens'
                  : 'end_turn',
              usage,
            };
          }
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: message };
      throw new ProviderError(message, 'ollama');
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

  private mapMessages(params: ChatParams): OllamaMessage[] {
    const result: OllamaMessage[] = [];

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
        const ollamaMsg: OllamaMessage = {
          role: 'assistant',
          content: this.getTextContent(msg),
        };
        if (toolCalls.length > 0) {
          ollamaMsg.tool_calls = toolCalls;
        }
        result.push(ollamaMsg);
      } else if (msg.role === 'tool') {
        result.push({ role: 'tool', content: this.getTextContent(msg) });
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

  private extractToolCalls(msg: Message): OllamaToolCall[] {
    if (typeof msg.content === 'string') return [];
    return msg.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => {
        const block = b as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
        return {
          function: {
            name: block.name,
            arguments: block.input,
          },
        };
      });
  }

  private mapTools(tools: ToolDefinition[]): OllamaTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
}
