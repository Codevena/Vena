import { spawn, execFile } from 'node:child_process';
import { ComputerError } from '@vena/shared';

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellOptions {
  timeout?: number;
  cwd?: string;
}

export class ShellController {
  private allowedCommands: string[];

  constructor(allowedCommands: string[] = ['*']) {
    this.allowedCommands = allowedCommands;
  }

  isAllowed(command: string): boolean {
    if (this.allowedCommands.includes('*')) return true;
    const binary = command.trim().split(/\s+/)[0] ?? '';
    return this.allowedCommands.includes(binary);
  }

  async execute(command: string, options?: ShellOptions): Promise<ShellResult> {
    if (!this.isAllowed(command)) {
      throw new ComputerError(`Command not allowed: ${command}`);
    }

    const timeout = options?.timeout ?? 30_000;

    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], {
        cwd: options?.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
      }, timeout);

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new ComputerError(`Shell execution failed: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          reject(new ComputerError(`Command timed out after ${timeout}ms: ${command}`));
          return;
        }
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
    });
  }

  async executeAppleScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', script], { timeout: 15_000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new ComputerError(`AppleScript failed: ${err.message}`, { stderr }));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async openApp(appName: string): Promise<void> {
    await this.execute(`open -a "${appName}"`);
  }

  async quitApp(appName: string): Promise<void> {
    await this.executeAppleScript(`tell application "${appName}" to quit`);
  }
}
