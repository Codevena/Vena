import type { Tool, ToolContext, ToolResult, ToolDefinition } from '@vena/shared';
import { VenaError } from '@vena/shared';
import { createLogger } from '@vena/shared';

const logger = createLogger('tool-executor');

export class ToolExecutor {
  private tools: Map<string, Tool>;

  constructor(tools: Tool[]) {
    this.tools = new Map();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  async execute(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        content: `Tool not found: ${toolName}`,
        isError: true,
      };
    }

    try {
      logger.debug({ tool: toolName, input }, 'Executing tool');
      const result = await tool.execute(input, context);
      logger.debug({ tool: toolName, success: !result.isError }, 'Tool execution complete');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ tool: toolName, error: message }, 'Tool execution failed');
      return {
        content: `Tool execution error: ${message}`,
        isError: true,
      };
    }
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
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
}
