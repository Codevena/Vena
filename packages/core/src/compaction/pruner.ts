import type { Message } from '@vena/shared';

export class Pruner {
  prune(content: string, maxChars?: number): string {
    const limit = maxChars ?? 4000;

    if (content.length <= limit) {
      return content;
    }

    const half = Math.floor(limit / 2);
    return content.slice(0, half) + '\n...(truncated)...\n' + content.slice(-half);
  }

  pruneToolResults(messages: Message[]): Message[] {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') return msg;

      const prunedBlocks = msg.content.map((block) => {
        if (block.type === 'tool_result') {
          return {
            ...block,
            content: this.prune(block.content),
          };
        }
        return block;
      });

      return { ...msg, content: prunedBlocks };
    });
  }
}
