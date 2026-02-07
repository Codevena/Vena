import type { Tool, ToolContext, ToolResult, ToolDefinition, ToolProgress } from '@vena/shared';
import { createLogger } from '@vena/shared';
import type { ToolGuard } from '../security/tool-guard.js';

const logger = createLogger('tool-executor');

/** Max chars of stack trace to include in error context for the LLM. */
const MAX_STACK_CHARS = 600;
/** Max chars of input JSON to include in error context. */
const MAX_INPUT_CHARS = 400;

export class ToolExecutor {
  private tools: Map<string, Tool>;
  private guard?: ToolGuard;

  constructor(tools: Tool[], guard?: ToolGuard) {
    this.tools = new Map();
    this.guard = guard;
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Execute a tool (blocking). Returns a single ToolResult.
   * For long-running tools, prefer `executeStream` when available.
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const guardResult = this.checkGuard(toolName, input);
    if (guardResult) return guardResult;

    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        content: this.formatToolNotFound(toolName),
        isError: true,
      };
    }

    try {
      logger.debug({ tool: toolName, input }, 'Executing tool');
      const startMs = Date.now();
      const result = await tool.execute(input, context);
      const elapsed = Date.now() - startMs;
      logger.debug({ tool: toolName, success: !result.isError, elapsed }, 'Tool execution complete');
      return result;
    } catch (err) {
      return {
        content: this.formatError(toolName, input, err),
        isError: true,
      };
    }
  }

  /**
   * Execute a tool with streaming progress. Falls back to blocking execute
   * if the tool doesn't implement `executeStream`.
   */
  async *executeStream(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ): AsyncIterable<ToolProgress> {
    const guardResult = this.checkGuard(toolName, input);
    if (guardResult) {
      yield { type: 'error', content: guardResult.content };
      yield { type: 'complete', content: guardResult.content };
      return;
    }

    const tool = this.tools.get(toolName);
    if (!tool) {
      const msg = this.formatToolNotFound(toolName);
      yield { type: 'error', content: msg };
      yield { type: 'complete', content: msg };
      return;
    }

    // Prefer streaming execute if the tool supports it
    if (tool.executeStream) {
      const startMs = Date.now();
      let lastContent = '';
      try {
        logger.debug({ tool: toolName }, 'Executing tool (streaming)');
        for await (const progress of tool.executeStream(input, context)) {
          lastContent = progress.content;
          yield { ...progress, elapsed: Date.now() - startMs };
        }
      } catch (err) {
        const errorContent = this.formatError(toolName, input, err);
        yield { type: 'error', content: errorContent, elapsed: Date.now() - startMs };
        yield { type: 'complete', content: errorContent, elapsed: Date.now() - startMs };
        return;
      }
      // If no 'complete' was yielded by the tool, yield one
      if (lastContent) {
        yield { type: 'complete', content: lastContent, elapsed: Date.now() - startMs };
      }
      return;
    }

    // Fallback: blocking execute wrapped as a single progress event
    yield { type: 'status', content: `Running ${toolName}...` };

    try {
      const startMs = Date.now();
      const result = await tool.execute(input, context);
      const elapsed = Date.now() - startMs;

      if (result.isError) {
        yield { type: 'error', content: result.content, elapsed };
      } else {
        yield { type: 'output', content: result.content, elapsed };
      }
      yield { type: 'complete', content: result.content, elapsed };
    } catch (err) {
      const errorContent = this.formatError(toolName, input, err);
      yield { type: 'error', content: errorContent };
      yield { type: 'complete', content: errorContent };
    }
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  listTools(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      defs.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
    return defs;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private checkGuard(toolName: string, input: Record<string, unknown>): ToolResult | null {
    if (!this.guard) return null;

    const canUse = this.guard.canUseTool(toolName);
    if (!canUse.allowed) {
      return { content: `Security: ${canUse.reason}`, isError: true };
    }

    if (['read', 'write', 'edit'].includes(toolName) && input['path']) {
      const pathCheck = this.guard.validatePath(input['path'] as string);
      if (!pathCheck.allowed) {
        return { content: `Security: ${pathCheck.reason}`, isError: true };
      }
    }

    if (toolName === 'bash' && input['command']) {
      const cmdCheck = this.guard.validateCommand(input['command'] as string);
      if (!cmdCheck.allowed) {
        return { content: `Security: ${cmdCheck.reason}`, isError: true };
      }
    }

    if (toolName === 'web_browse' && input['url']) {
      const urlCheck = this.guard.validateUrl(input['url'] as string);
      if (!urlCheck.allowed) {
        return { content: `Security: ${urlCheck.reason}`, isError: true };
      }
    }

    if (toolName === 'browser') {
      const action = input['action'] as string | undefined;
      if (action === 'navigate' && input['url']) {
        const urlCheck = this.guard.validateUrl(input['url'] as string);
        if (!urlCheck.allowed) {
          return { content: `Security: ${urlCheck.reason}`, isError: true };
        }
      }
    }

    return null;
  }

  /**
   * Format a rich error message that gives the LLM enough context
   * to reason about what went wrong and potentially recover.
   */
  private formatError(toolName: string, input: Record<string, unknown>, err: unknown): string {
    const error = err instanceof Error ? err : new Error(String(err));
    const message = error.message;
    const stack = error.stack
      ? error.stack.split('\n').slice(1, 6).join('\n').slice(0, MAX_STACK_CHARS)
      : '(no stack trace)';

    let inputStr: string;
    try {
      inputStr = JSON.stringify(input, null, 2);
      if (inputStr.length > MAX_INPUT_CHARS) {
        inputStr = inputStr.slice(0, MAX_INPUT_CHARS) + '...(truncated)';
      }
    } catch {
      inputStr = '(unserializable input)';
    }

    logger.error({ tool: toolName, error: message }, 'Tool execution failed');

    return [
      `Tool "${toolName}" failed.`,
      '',
      `Error: ${message}`,
      '',
      `Stack trace:`,
      stack,
      '',
      `Input provided:`,
      inputStr,
      '',
      `You can try: adjusting the input, using a different approach, or skipping this step.`,
    ].join('\n');
  }

  private formatToolNotFound(toolName: string): string {
    const available = Array.from(this.tools.keys());
    return [
      `Tool "${toolName}" not found.`,
      '',
      available.length > 0
        ? `Available tools: ${available.join(', ')}`
        : `No tools are currently registered.`,
      '',
      `Check the tool name and try again.`,
    ].join('\n');
  }
}
