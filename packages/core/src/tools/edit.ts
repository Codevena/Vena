import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import * as fs from 'node:fs/promises';

export class EditTool implements Tool {
  name = 'edit';
  description = 'Edit a file by replacing text';
  inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit' },
      old_string: { type: 'string', description: 'The text to find and replace' },
      new_string: { type: 'string', description: 'The replacement text' },
    },
    required: ['path', 'old_string', 'new_string'],
  };

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const filePath = input['path'] as string;
    const oldString = input['old_string'] as string;
    const newString = input['new_string'] as string;

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (!content.includes(oldString)) {
        return {
          content: `old_string not found in ${filePath}`,
          isError: true,
        };
      }

      const newContent = content.replace(oldString, newString);
      await fs.writeFile(filePath, newContent, 'utf-8');

      return { content: `Successfully edited ${filePath}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Failed to edit file: ${message}`, isError: true };
    }
  }
}
