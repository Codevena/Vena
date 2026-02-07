import type {
  Message,
  Session,
  ToolDefinition,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  TextBlock,
  Tool,
  ToolResult,
} from '@vena/shared';
import type { LLMProvider } from '@vena/providers';
import { ToolExecutor } from './tool-executor.js';
import { ContextBuilder } from './context-builder.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { createLogger } from '@vena/shared';

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'done'; response: string }
  | { type: 'error'; error: Error };

export interface AgentLoopOptions {
  provider: LLMProvider;
  tools: Tool[];
  systemPrompt: string;
  memoryManager: MemoryManager;
  options?: {
    maxIterations?: number;
    maxTokens?: number;
  };
}

const logger = createLogger('agent-loop');

export class AgentLoop {
  private provider: LLMProvider;
  private toolExecutor: ToolExecutor;
  private contextBuilder: ContextBuilder;
  private memoryManager: MemoryManager;
  private systemPrompt: string;
  private maxIterations: number;
  private maxTokens: number;

  constructor(opts: AgentLoopOptions) {
    this.provider = opts.provider;
    this.systemPrompt = opts.systemPrompt;
    this.memoryManager = opts.memoryManager;
    this.maxIterations = opts.options?.maxIterations ?? 10;
    this.maxTokens = opts.options?.maxTokens ?? 4096;
    this.toolExecutor = new ToolExecutor(opts.tools);
    this.contextBuilder = new ContextBuilder();
  }

  async *run(message: Message, session: Session): AsyncIterable<AgentEvent> {
    session.messages.push(message);

    let iterations = 0;
    let lastText = '';

    while (iterations < this.maxIterations) {
      iterations++;

      const memoryContext = await this.memoryManager.getRelevantContext(
        typeof message.content === 'string' ? message.content : '',
        2000,
      );

      const context = this.contextBuilder.build(session, {
        systemPrompt: this.systemPrompt,
        memoryContext,
        maxTokens: this.maxTokens,
      });

      const toolDefs: ToolDefinition[] = this.toolExecutor.listTools();

      let fullText = '';
      let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
      const contentBlocks: ContentBlock[] = [];
      let stopReason: string | undefined;

      try {
        for await (const chunk of this.provider.chat({
          messages: context.messages,
          systemPrompt: context.systemPrompt,
          tools: toolDefs,
          maxTokens: this.maxTokens,
        })) {
          switch (chunk.type) {
            case 'text':
              if (chunk.text) {
                fullText += chunk.text;
                yield { type: 'text', text: chunk.text };
              }
              break;

            case 'tool_use':
              if (chunk.toolUse) {
                // Finalize any previous tool_use that was being built
                if (currentToolUse) {
                  contentBlocks.push(this.finalizeToolUse(currentToolUse));
                }
                currentToolUse = {
                  id: chunk.toolUse.id,
                  name: chunk.toolUse.name,
                  inputJson: '',
                };
              }
              break;

            case 'tool_use_input':
              if (currentToolUse && chunk.text) {
                currentToolUse.inputJson += chunk.text;
              }
              break;

            case 'stop':
              stopReason = chunk.stopReason;
              // Finalize any pending tool_use
              if (currentToolUse) {
                contentBlocks.push(this.finalizeToolUse(currentToolUse));
                currentToolUse = null;
              }
              break;

            case 'error':
              yield { type: 'error', error: new Error(chunk.error ?? 'Unknown streaming error') };
              return;
          }
        }

        // Add text block if any
        if (fullText) {
          contentBlocks.unshift({ type: 'text', text: fullText } as TextBlock);
        }

        // Add assistant message to session
        const assistantMessage: Message = {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: contentBlocks.length > 0 ? contentBlocks : fullText,
          timestamp: new Date().toISOString(),
        };
        session.messages.push(assistantMessage);

        // If the stop reason is tool_use, execute tools and loop
        if (stopReason === 'tool_use') {
          const toolUseBlocks = contentBlocks.filter(
            (b): b is ToolUseBlock => b.type === 'tool_use',
          );

          for (const toolBlock of toolUseBlocks) {
            yield { type: 'tool_call', tool: toolBlock.name, input: toolBlock.input };

            const result = await this.toolExecutor.execute(toolBlock.name, toolBlock.input, {
              sessionId: session.id,
              workspacePath: '',
              agentId: session.metadata.agentId,
            });

            yield { type: 'tool_result', result };

            const toolResultBlock: ToolResultBlock = {
              type: 'tool_result',
              toolUseId: toolBlock.id,
              content: result.content,
              isError: result.isError,
            };

            const toolResultMessage: Message = {
              id: `msg_${Date.now()}_tool`,
              role: 'tool',
              content: [toolResultBlock],
              timestamp: new Date().toISOString(),
            };
            session.messages.push(toolResultMessage);
          }

          lastText = fullText;
          continue;
        }

        // end_turn or max_tokens - we're done
        yield { type: 'done', response: fullText };
        return;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error({ error }, 'Agent loop error');
        yield { type: 'error', error };
        return;
      }
    }

    // Max iterations reached
    yield { type: 'done', response: lastText || 'Max iterations reached.' };
  }

  private finalizeToolUse(toolUse: {
    id: string;
    name: string;
    inputJson: string;
  }): ToolUseBlock {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(toolUse.inputJson || '{}') as Record<string, unknown>;
    } catch {
      // If JSON parse fails, use empty object
    }
    return {
      type: 'tool_use',
      id: toolUse.id,
      name: toolUse.name,
      input,
    };
  }
}
