import type { Message } from '@vena/shared';
import { createLogger } from '@vena/shared';

const logger = createLogger('compactor');

export type SummarizeFn = (messages: Message[]) => Promise<string>;

export class Compactor {
  private summarizeFn?: SummarizeFn;

  constructor(summarizeFn?: SummarizeFn) {
    this.summarizeFn = summarizeFn;
  }

  async compact(messages: Message[], options?: { maxTokens?: number }): Promise<Message[]> {
    const maxTokens = options?.maxTokens ?? 4096;
    const maxChars = maxTokens * 4;

    if (this.estimateSize(messages) <= maxChars) {
      return messages;
    }

    logger.info({ messageCount: messages.length }, 'Starting compaction');

    // Keep last N messages intact
    const recentCount = Math.min(6, Math.floor(messages.length / 2));
    const recentMessages = messages.slice(-recentCount);
    const olderMessages = messages.slice(0, -recentCount);

    // Pass 1: Prune old tool results
    const pruned = this.pruneToolResults(olderMessages);

    // Pass 2: Summarize older conversation if we have a summarize function
    if (this.summarizeFn && pruned.length > 0) {
      try {
        const summary = await this.summarizeFn(pruned);
        const summaryMessage: Message = {
          id: `compact_${Date.now()}`,
          role: 'system',
          content: `[Conversation Summary]\n${summary}`,
          timestamp: new Date().toISOString(),
        };
        return [summaryMessage, ...recentMessages];
      } catch (err) {
        logger.warn({ error: err }, 'Summarization failed, falling back to pruning');
      }
    }

    // Pass 3: If no summarizer or it failed, just keep pruned + recent
    const result = [...pruned, ...recentMessages];

    // If still too large, drop more old messages
    while (result.length > 2 && this.estimateSize(result) > maxChars) {
      result.shift();
    }

    logger.info(
      { originalCount: messages.length, compactedCount: result.length },
      'Compaction complete',
    );

    return result;
  }

  private pruneToolResults(messages: Message[]): Message[] {
    return messages.map((msg) => {
      if (msg.role !== 'tool' && msg.role !== 'assistant') return msg;

      if (typeof msg.content === 'string') return msg;

      const prunedBlocks = msg.content.map((block) => {
        if (block.type === 'tool_result' && block.content.length > 500) {
          return {
            ...block,
            content: block.content.slice(0, 200) + '...(truncated)',
          };
        }
        return block;
      });

      return { ...msg, content: prunedBlocks };
    });
  }

  private estimateSize(messages: Message[]): number {
    let size = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        size += msg.content.length;
      } else {
        for (const block of msg.content) {
          if ('text' in block) size += (block as { text: string }).text.length;
          if ('content' in block) size += (block as { content: string }).content.length;
          if ('input' in block)
            size += JSON.stringify((block as { input: unknown }).input).length;
        }
      }
    }
    return size;
  }
}
