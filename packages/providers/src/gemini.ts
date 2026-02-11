import { GoogleGenAI } from '@google/genai';
import type {
  ChatParams,
  Message,
  StreamChunk,
  ToolDefinition,
} from '@vena/shared';
import { ProviderError } from '@vena/shared';
import type { LLMProvider } from './provider.js';

import type {
  Content,
  FunctionDeclaration,
  Part,
  Tool,
} from '@google/genai';

import type { AuthConfig } from '@vena/shared';
import { resolveAuth } from './auth.js';

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  auth?: AuthConfig;
  vertexai?: boolean;
  project?: string;
  location?: string;
  apiVersion?: string;
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly supportsTools = true;
  readonly maxContextWindow = 1_000_000;

  private client!: GoogleGenAI;
  private model: string;
  private options: GeminiProviderOptions;
  private initialized = false;

  constructor(options: GeminiProviderOptions) {
    this.options = options;
    this.model = options.model ?? 'gemini-2.0-flash';
    if (options.apiKey && !options.auth && !options.vertexai) {
      this.client = new GoogleGenAI({ apiKey: options.apiKey });
      this.initialized = true;
    }
  }

  private async ensureClient(): Promise<GoogleGenAI> {
    if (this.initialized) return this.client;

    const auth = this.options.auth;
    if (auth && (auth.type === 'oauth_token' || auth.type === 'bearer_token') && (this.options.vertexai || this.options.project || this.options.location)) {
      const project =
        this.options.project ??
        process.env['GOOGLE_CLOUD_PROJECT'] ??
        process.env['GOOGLE_CLOUD_PROJECT_ID'];
      const location =
        this.options.location ??
        process.env['GOOGLE_CLOUD_REGION'] ??
        process.env['GOOGLE_CLOUD_LOCATION'];

      if (!project || !location) {
        throw new ProviderError('Gemini OAuth requires project and location for Vertex AI', 'gemini');
      }
      if (!auth.refreshToken || !auth.clientId) {
        throw new ProviderError('Gemini OAuth requires refreshToken and clientId for Vertex AI', 'gemini');
      }

      this.client = new GoogleGenAI({
        vertexai: true,
        project,
        location,
        apiVersion: this.options.apiVersion,
        googleAuthOptions: {
          credentials: {
            type: 'authorized_user',
            client_id: auth.clientId,
            client_secret: auth.clientSecret,
            refresh_token: auth.refreshToken,
          },
        },
      });
      this.initialized = true;
      return this.client;
    }

    const token = await resolveAuth(this.options.auth, this.options.apiKey, 'gemini');
    this.client = new GoogleGenAI({ apiKey: token, apiVersion: this.options.apiVersion });
    this.initialized = true;
    return this.client;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const contents = this.mapMessages(params.messages);
    const tools = params.tools ? this.mapTools(params.tools) : undefined;

    try {
      const client = await this.ensureClient();
      const response = await client.models.generateContentStream({
        model: this.model,
        contents,
        config: {
          maxOutputTokens: params.maxTokens ?? 4096,
          temperature: params.temperature,
          systemInstruction: params.systemPrompt,
          tools,
        },
      });

      let hasToolCalls = false;
      let usageData: { inputTokens: number; outputTokens: number } | undefined;

      for await (const chunk of response) {
        // Check for usage metadata
        if (chunk.usageMetadata) {
          usageData = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
          };
        }

        if (!chunk.candidates?.[0]) continue;

        const candidate = chunk.candidates[0];
        const parts = candidate.content?.parts;

        if (parts) {
          for (const part of parts) {
            if (part.text) {
              yield { type: 'text', text: part.text };
            }

            if (part.functionCall) {
              hasToolCalls = true;
              const callId = `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              yield {
                type: 'tool_use',
                toolUse: {
                  id: callId,
                  name: part.functionCall.name ?? '',
                },
              };
              yield {
                type: 'tool_use_input',
                toolInput: JSON.stringify(part.functionCall.args ?? {}),
              };
            }
          }
        }

        if (candidate.finishReason) {
          yield {
            type: 'stop',
            stopReason: hasToolCalls ? 'tool_use' : this.mapFinishReason(candidate.finishReason),
            usage: usageData,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: message };
      throw new ProviderError(message, 'gemini');
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

  private mapMessages(messages: Message[]): Content[] {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: this.mapRole(m.role),
        parts: this.mapParts(m),
      }));
  }

  private mapRole(role: Message['role']): string {
    switch (role) {
      case 'user':
      case 'tool':
        return 'user';
      case 'assistant':
        return 'model';
      default:
        return 'user';
    }
  }

  private mapParts(message: Message): Part[] {
    if (typeof message.content === 'string') {
      if (message.role === 'tool') {
        return [
          {
            functionResponse: {
              name: (message.metadata?.['toolName'] as string) ?? 'unknown',
              response: { result: message.content },
            },
          },
        ];
      }
      return [{ text: message.content }];
    }

    return message.content.map((block): Part => {
      switch (block.type) {
        case 'text':
          return { text: block.text };
        case 'tool_use':
          return {
            functionCall: {
              name: block.name,
              args: block.input,
            },
          };
        case 'tool_result':
          return {
            functionResponse: {
              name: (message.metadata?.['toolName'] as string) ?? 'unknown',
              response: { result: block.content },
            },
          };
        default:
          return { text: '' };
      }
    });
  }

  private mapTools(tools: ToolDefinition[]): Tool[] {
    const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as FunctionDeclaration['parameters'],
    }));
    return [{ functionDeclarations }];
  }

  private mapFinishReason(reason: string): StreamChunk['stopReason'] {
    switch (reason) {
      case 'STOP':
        return 'end_turn';
      case 'MAX_TOKENS':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }
}
