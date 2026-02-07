import type { ChatParams, Message, StreamChunk } from '@vena/shared';

export interface LLMProvider {
  readonly name: string;
  readonly supportsTools: boolean;
  readonly maxContextWindow: number;

  chat(params: ChatParams): AsyncIterable<StreamChunk>;
  countTokens(messages: Message[]): Promise<number>;
}
