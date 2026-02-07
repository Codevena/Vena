import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import { spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB

const CATASTROPHIC_PATTERNS = [
  /rm\s+-rf\s+\/(?:\s|$)/,
  /mkfs\./,
  /dd\s+if=.*of=\/dev\//,
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

  private envPassthrough?: string[];

  constructor(options?: { envPassthrough?: string[] }) {
    this.envPassthrough = options?.envPassthrough;
  }

  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = input['command'] as string;
    const timeout = (input['timeout'] as number) ?? 30000;
    const cwd = (input['cwd'] as string) ?? (context.workspacePath || process.cwd());

    for (const pattern of CATASTROPHIC_PATTERNS) {
      if (pattern.test(command)) {
        return {
          content: `Command blocked for safety: matches catastrophic pattern`,
          isError: true,
        };
      }
    }

    const env = this.buildEnv();

    return new Promise<ToolResult>((resolve) => {
      const proc = spawn('bash', ['-c', command], {
        cwd,
        timeout,
        env,
      });

      let stdout = '';
      let stderr = '';
      let totalBytes = 0;
      let truncated = false;

      proc.stdout.on('data', (data: Buffer) => {
        totalBytes += data.length;
        if (totalBytes <= MAX_OUTPUT_BYTES) {
          stdout += data.toString();
        } else if (!truncated) {
          truncated = true;
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        totalBytes += data.length;
        if (totalBytes <= MAX_OUTPUT_BYTES) {
          stderr += data.toString();
        } else if (!truncated) {
          truncated = true;
        }
      });

      proc.on('close', (code) => {
        let output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
        if (truncated) {
          output += '\n[output truncated — exceeded 1MB limit]';
        }
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

  private buildEnv(): Record<string, string> {
    if (!this.envPassthrough) {
      return { ...process.env } as Record<string, string>;
    }
    const env: Record<string, string> = {};
    for (const key of this.envPassthrough) {
      if (process.env[key] !== undefined) {
        env[key] = process.env[key]!;
      }
    }
    return env;
  }
}
