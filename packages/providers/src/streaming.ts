import type { ContentBlock, LLMResponse, StreamChunk, TextBlock, ToolUseBlock } from '@vena/shared';

export async function collectStream(stream: AsyncIterable<StreamChunk>): Promise<LLMResponse> {
  const contentBlocks: ContentBlock[] = [];
  let currentText = '';
  let currentToolUse: { id: string; name: string; input: string } | null = null;
  let stopReason: LLMResponse['stopReason'] = 'end_turn';

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text':
        currentText += chunk.text ?? '';
        break;

      case 'tool_use':
        if (currentText) {
          contentBlocks.push({ type: 'text', text: currentText } satisfies TextBlock);
          currentText = '';
        }
        currentToolUse = {
          id: chunk.toolUse!.id,
          name: chunk.toolUse!.name,
          input: '',
        };
        break;

      case 'tool_use_input':
        if (currentToolUse) {
          currentToolUse.input += chunk.toolInput ?? '';
        }
        break;

      case 'stop':
        if (currentToolUse) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(currentToolUse.input || '{}') as Record<string, unknown>;
          } catch {
            // keep empty object
          }
          contentBlocks.push({
            type: 'tool_use',
            id: currentToolUse.id,
            name: currentToolUse.name,
            input: parsedInput,
          } satisfies ToolUseBlock);
          currentToolUse = null;
        }
        if (currentText) {
          contentBlocks.push({ type: 'text', text: currentText } satisfies TextBlock);
          currentText = '';
        }
        stopReason = chunk.stopReason ?? 'end_turn';
        break;

      case 'error':
        break;
    }
  }

  // Flush remaining content
  if (currentToolUse) {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(currentToolUse.input || '{}') as Record<string, unknown>;
    } catch {
      // keep empty object
    }
    contentBlocks.push({
      type: 'tool_use',
      id: currentToolUse.id,
      name: currentToolUse.name,
      input: parsedInput,
    } satisfies ToolUseBlock);
  }
  if (currentText) {
    contentBlocks.push({ type: 'text', text: currentText } satisfies TextBlock);
  }

  return {
    id: crypto.randomUUID(),
    content: contentBlocks,
    stopReason,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export async function streamToText(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    if (chunk.type === 'text' && chunk.text) {
      text += chunk.text;
    }
  }
  return text;
}
