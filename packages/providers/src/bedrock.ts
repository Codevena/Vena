import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type ContentBlock as BedrockContentBlock,
  type Message as BedrockMessage,
  type Tool as BedrockTool,
  type ToolConfiguration,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  ChatParams,
  Message,
  StreamChunk,
  ToolDefinition,
} from '@vena/shared';
import { ProviderError } from '@vena/shared';
import type { LLMProvider } from './provider.js';

export interface BedrockProviderOptions {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  model?: string;
  profile?: string;
}

export class BedrockProvider implements LLMProvider {
  readonly name = 'bedrock';
  readonly supportsTools = true;
  readonly maxContextWindow = 200_000;

  private client: BedrockRuntimeClient;
  private model: string;

  constructor(options: BedrockProviderOptions) {
    this.model = options.model ?? 'anthropic.claude-sonnet-4-5-20250929-v1:0';

    const clientConfig: Record<string, unknown> = {
      region: options.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
    };

    // Explicit credentials override the default AWS credential chain
    if (options.accessKeyId && options.secretAccessKey) {
      clientConfig['credentials'] = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
      };
    }

    this.client = new BedrockRuntimeClient(clientConfig);
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const messages = this.mapMessages(params.messages);
    const system = params.systemPrompt
      ? [{ text: params.systemPrompt } as SystemContentBlock]
      : undefined;
    const toolConfig = params.tools ? this.mapTools(params.tools) : undefined;

    const input: ConverseStreamCommandInput = {
      modelId: this.model,
      messages,
      system,
      toolConfig,
      inferenceConfig: {
        maxTokens: params.maxTokens ?? 4096,
        temperature: params.temperature,
      },
    };

    try {
      const command = new ConverseStreamCommand(input);
      const response = await this.client.send(command);

      if (!response.stream) {
        yield { type: 'error', error: 'No stream in Bedrock response' };
        return;
      }

      for await (const event of response.stream) {
        if (event.contentBlockStart) {
          const start = event.contentBlockStart.start;
          if (start?.toolUse) {
            yield {
              type: 'tool_use',
              toolUse: {
                id: start.toolUse.toolUseId ?? `tool_${Date.now()}`,
                name: start.toolUse.name ?? '',
              },
            };
          }
        }

        if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta.delta;
          if (delta?.text) {
            yield { type: 'text', text: delta.text };
          }
          if (delta?.toolUse?.input) {
            yield { type: 'tool_use_input', toolInput: delta.toolUse.input };
          }
        }

        if (event.messageStop) {
          const reason = event.messageStop.stopReason;
          yield {
            type: 'stop',
            stopReason: this.mapStopReason(reason),
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: message };
      throw new ProviderError(message, 'bedrock');
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

  private mapMessages(messages: Message[]): BedrockMessage[] {
    const result: BedrockMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      const role = msg.role === 'tool' ? 'user' : msg.role;
      const content = this.mapContent(msg);

      if (content.length > 0) {
        result.push({ role: role as 'user' | 'assistant', content });
      }
    }

    return result;
  }

  private mapContent(msg: Message): BedrockContentBlock[] {
    if (typeof msg.content === 'string') {
      if (msg.role === 'tool') {
        return [
          {
            toolResult: {
              toolUseId: (msg.metadata?.['toolUseId'] as string) ?? 'unknown',
              content: [{ text: msg.content }],
              status: msg.metadata?.['isError'] ? 'error' : 'success',
            },
          } as BedrockContentBlock,
        ];
      }
      return [{ text: msg.content } as BedrockContentBlock];
    }

    return msg.content.map((block): BedrockContentBlock => {
      switch (block.type) {
        case 'text':
          return { text: block.text } as BedrockContentBlock;

        case 'image':
          return {
            image: {
              format: this.imageFormat(block.source.mediaType),
              source: { bytes: Buffer.from(block.source.data, 'base64') },
            },
          } as BedrockContentBlock;

        case 'tool_use':
          return {
            toolUse: {
              toolUseId: block.id,
              name: block.name,
              input: block.input,
            },
          } as BedrockContentBlock;

        case 'tool_result':
          return {
            toolResult: {
              toolUseId: block.toolUseId,
              content: [{ text: block.content }],
              status: block.isError ? 'error' : 'success',
            },
          } as BedrockContentBlock;

        default:
          return { text: '' } as BedrockContentBlock;
      }
    });
  }

  private mapTools(tools: ToolDefinition[]): ToolConfiguration {
    return {
      tools: tools.map(
        (tool): BedrockTool => ({
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: tool.inputSchema as any },
          },
        }),
      ),
    };
  }

  private mapStopReason(reason?: string): StreamChunk['stopReason'] {
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

  private imageFormat(mediaType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };
    return map[mediaType] ?? 'jpeg';
  }
}
