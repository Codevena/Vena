import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class WriteTool implements Tool {
  name = 'write';
  description = 'Write content to a file';
  inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['path', 'content'],
  };

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const filePath = input['path'] as string;
    const content = input['content'] as string;

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return { content: `Successfully wrote to ${filePath}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Failed to write file: ${message}`, isError: true };
    }
  }
}
