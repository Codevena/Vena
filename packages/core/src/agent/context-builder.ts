import type { Message, Session } from '@vena/shared';

export interface ContextBuildOptions {
  systemPrompt: string;
  soulPrompt?: string;
  skills?: string;
  agentsContext?: string;
  memoryContext?: string;
  maxTokens?: number;
}

export interface BuiltContext {
  systemPrompt: string;
  messages: Message[];
}

export class ContextBuilder {
  build(session: Session, options: ContextBuildOptions): BuiltContext {
    const maxTokens = options.maxTokens ?? 4096;
    const maxChars = maxTokens * 4; // rough estimate: 1 token ~ 4 chars

    // Assemble system prompt
    let systemPrompt = '';
    if (options.soulPrompt) {
      systemPrompt = options.soulPrompt + '\n\n';
    }
    systemPrompt += options.systemPrompt;

    if (options.memoryContext) {
      systemPrompt += `\n\n<memory>\n${options.memoryContext}\n</memory>`;
    }

    if (options.skills) {
      systemPrompt += `\n\n<skills>\n${options.skills}\n</skills>`;
    }

    if (options.agentsContext) {
      systemPrompt += `\n\n<agents>\n${options.agentsContext}\n</agents>`;
    }

    // Budget for messages = maxChars - system prompt size
    const systemSize = systemPrompt.length;
    const messageBudget = Math.max(maxChars - systemSize, maxChars * 0.5);

    // Truncate from oldest messages if over budget
    const messages = this.truncateMessages(session.messages, messageBudget);

    return { systemPrompt, messages };
  }

  private truncateMessages(messages: Message[], budgetChars: number): Message[] {
    // Calculate total size
    let totalSize = 0;
    for (const msg of messages) {
      totalSize += this.estimateMessageSize(msg);
    }

    if (totalSize <= budgetChars) {
      return [...messages];
    }

    // Remove from oldest, keeping at minimum the last message
    const result: Message[] = [];
    let currentSize = 0;

    // Walk backwards (newest first)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      const msgSize = this.estimateMessageSize(msg);

      if (currentSize + msgSize <= budgetChars) {
        result.unshift(msg);
        currentSize += msgSize;
      } else {
        break;
      }
    }

    return result;
  }

  private estimateMessageSize(msg: Message): number {
    if (typeof msg.content === 'string') {
      return msg.content.length;
    }

    let size = 0;
    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          size += block.text.length;
          break;
        case 'tool_use':
          size += JSON.stringify(block.input).length + block.name.length;
          break;
        case 'tool_result':
          size += block.content.length;
          break;
        default:
          size += 100; // rough estimate for image/audio blocks
      }
    }
    return size;
  }
}
