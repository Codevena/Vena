import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import * as fs from 'node:fs/promises';

export class ReadTool implements Tool {
  name = 'read';
  description = 'Read file contents';
  inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read' },
      offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
      limit: { type: 'number', description: 'Maximum number of lines to read' },
    },
    required: ['path'],
  };

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const filePath = input['path'] as string;
    const offset = (input['offset'] as number) ?? 0;
    const limit = input['limit'] as number | undefined;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      const startLine = Math.max(0, offset);
      const endLine = limit ? startLine + limit : lines.length;
      const selectedLines = lines.slice(startLine, endLine);

      // Format with line numbers
      const formatted = selectedLines
        .map((line, idx) => `${String(startLine + idx + 1).padStart(6)}\t${line}`)
        .join('\n');

      return { content: formatted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Failed to read file: ${message}`, isError: true };
    }
  }
}
