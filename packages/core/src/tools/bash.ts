import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import { spawn } from 'node:child_process';

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(?:\s|$)/,
  /mkfs\./,
  /dd\s+if=.*of=\/dev\//,
  />\s*\/dev\/sd/,
  /chmod\s+-R\s+777\s+\//,
];

export class BashTool implements Tool {
  name = 'bash';
  description = 'Execute shell commands';
  inputSchema = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      cwd: { type: 'string', description: 'Working directory for the command' },
    },
    required: ['command'],
  };

  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = input['command'] as string;
    const timeout = (input['timeout'] as number) ?? 30000;
    const cwd = (input['cwd'] as string) ?? (context.workspacePath || process.cwd());

    // Safety check
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return {
          content: `Command blocked for safety: matches dangerous pattern`,
          isError: true,
        };
      }
    }

    return new Promise<ToolResult>((resolve) => {
      const proc = spawn('bash', ['-c', command], {
        cwd,
        timeout,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
        resolve({
          content: output || '(no output)',
          isError: code !== 0,
          metadata: { exitCode: code },
        });
      });

      proc.on('error', (err) => {
        resolve({
          content: `Failed to execute command: ${err.message}`,
          isError: true,
        });
      });
    });
  }
}
