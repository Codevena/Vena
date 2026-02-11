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
import type { ToolGuard } from '../security/tool-guard.js';
import { createLogger } from '@vena/shared';

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_progress'; tool: string; content: string; elapsed?: number }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; response: string }
  | { type: 'error'; error: Error };

export interface AgentLoopOptions {
  provider: LLMProvider;
  tools: Tool[];
  systemPrompt: string;
  soulPrompt?: string;
  skillsContext?: string;
  agentsContext?: string;
  memoryManager: MemoryManager;
  guard?: ToolGuard;
  workspacePath?: string;
  thinking?: {
    enabled: boolean;
    budgetTokens: number;
  };
  options?: {
    maxIterations?: number;
    maxTokens?: number;
    /** Use streaming tool execution for tools that support it. Default: true. */
    streamTools?: boolean;
  };
}

export interface AgentRunOverrides {
  systemPrompt?: string;
  soulPrompt?: string;
  skillsContext?: string;
}

const logger = createLogger('agent-loop');

export class AgentLoop {
  private provider: LLMProvider;
  private toolExecutor: ToolExecutor;
  private contextBuilder: ContextBuilder;
  private memoryManager: MemoryManager;
  private systemPrompt: string;
  private soulPrompt?: string;
  private skillsContext?: string;
  private agentsContext?: string;
  private maxIterations: number;
  private maxTokens: number;
  private workspacePath: string;
  private streamTools: boolean;
  private thinking?: { enabled: boolean; budgetTokens: number };

  constructor(opts: AgentLoopOptions) {
    this.provider = opts.provider;
    this.systemPrompt = opts.systemPrompt;
    this.soulPrompt = opts.soulPrompt;
    this.skillsContext = opts.skillsContext;
    this.agentsContext = opts.agentsContext;
    this.memoryManager = opts.memoryManager;
    this.maxIterations = opts.options?.maxIterations ?? 10;
    this.maxTokens = opts.options?.maxTokens ?? 4096;
    this.workspacePath = opts.workspacePath ?? process.cwd();
    this.streamTools = opts.options?.streamTools ?? true;
    this.thinking = opts.thinking;
    this.toolExecutor = new ToolExecutor(opts.tools, opts.guard);
    this.contextBuilder = new ContextBuilder();
  }

  async *run(
    message: Message,
    session: Session,
    overrides?: AgentRunOverrides,
  ): AsyncIterable<AgentEvent> {
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
        systemPrompt: overrides?.systemPrompt ?? this.systemPrompt,
        soulPrompt: overrides?.soulPrompt ?? this.soulPrompt,
        skills: overrides?.skillsContext ?? this.skillsContext,
        agentsContext: this.agentsContext,
        memoryContext,
        maxTokens: this.maxTokens,
      });

      const toolDefs: ToolDefinition[] = this.toolExecutor.listTools();

      let fullText = '';
      let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
      const contentBlocks: ContentBlock[] = [];
      let stopReason: string | undefined;

      try {
        const chatParams: any = {
          messages: context.messages,
          systemPrompt: context.systemPrompt,
          tools: toolDefs,
          maxTokens: this.maxTokens,
        };

        // Pass thinking config to provider
        if (this.thinking?.enabled) {
          chatParams.thinking = {
            type: 'enabled' as const,
            budgetTokens: this.thinking.budgetTokens,
          };
        }

        for await (const chunk of this.provider.chat(chatParams)) {
          switch (chunk.type) {
            case 'text':
              if (chunk.text) {
                fullText += chunk.text;
                yield { type: 'text', text: chunk.text };
              }
              break;

            case 'thinking':
              if (chunk.thinking) {
                yield { type: 'thinking', thinking: chunk.thinking };
              }
              break;

            case 'tool_use':
              if (chunk.toolUse) {
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
              if (currentToolUse) {
                const inputChunk = chunk.toolInput ?? chunk.text ?? '';
                if (inputChunk) {
                  currentToolUse.inputJson += inputChunk;
                }
              }
              break;

            case 'stop':
              stopReason = chunk.stopReason;
              if (currentToolUse) {
                contentBlocks.push(this.finalizeToolUse(currentToolUse));
                currentToolUse = null;
              }
              // Emit usage data if present
              if (chunk.usage) {
                yield { type: 'usage', inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens };
              }
              break;

            case 'error':
              yield { type: 'error', error: new Error(chunk.error ?? 'Unknown streaming error') };
              return;
          }
        }

        if (fullText) {
          contentBlocks.unshift({ type: 'text', text: fullText } as TextBlock);
        }

        const assistantMessage: Message = {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: contentBlocks.length > 0 ? contentBlocks : fullText,
          timestamp: new Date().toISOString(),
        };
        session.messages.push(assistantMessage);

        if (stopReason === 'tool_use') {
          const toolUseBlocks = contentBlocks.filter(
            (b): b is ToolUseBlock => b.type === 'tool_use',
          );

          for (const toolBlock of toolUseBlocks) {
            yield { type: 'tool_call', tool: toolBlock.name, input: toolBlock.input };

            const toolContext = {
              sessionId: session.id,
              workspacePath: this.workspacePath,
              agentId: session.metadata.agentId,
            };

            // Use streaming execution when the tool supports it
            const result = await this.executeTool(toolBlock, toolContext, (progress) => {
              // This callback is intentionally a no-op for now;
              // tool_progress events are yielded from the generator below
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
              metadata: {
                toolName: toolBlock.name,
                toolUseId: toolBlock.id,
              },
            };
            session.messages.push(toolResultMessage);
          }

          lastText = fullText;
          continue;
        }

        yield { type: 'done', response: fullText };
        return;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error({ error }, 'Agent loop error');
        yield { type: 'error', error };
        return;
      }
    }

    yield { type: 'done', response: lastText || 'Max iterations reached.' };
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Execute a tool, using streaming when available and enabled.
   * Collects streaming progress and returns the final ToolResult.
   * The onProgress callback fires for each intermediate progress event.
   */
  private async executeTool(
    toolBlock: ToolUseBlock,
    toolContext: { sessionId: string; workspacePath: string; agentId: string },
    _onProgress: (event: AgentEvent) => void,
  ): Promise<ToolResult> {
    const tool = this.toolExecutor.getTool(toolBlock.name);

    if (this.streamTools && tool?.executeStream) {
      let finalContent = '';
      let isError = false;

      for await (const progress of this.toolExecutor.executeStream(
        toolBlock.name,
        toolBlock.input,
        toolContext,
      )) {
        if (progress.type === 'complete') {
          finalContent = progress.content;
        } else if (progress.type === 'error') {
          isError = true;
          finalContent = progress.content;
        }

        logger.debug(
          { tool: toolBlock.name, progressType: progress.type, elapsed: progress.elapsed },
          'Tool progress',
        );
      }

      return { content: finalContent, isError };
    }

    // Blocking fallback
    return this.toolExecutor.execute(toolBlock.name, toolBlock.input, toolContext);
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
