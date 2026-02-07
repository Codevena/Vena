import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComputerError } from '@vena/shared';

export class ScreenCapture {
  private async captureToFile(args: string[]): Promise<Buffer> {
    const tempPath = join(tmpdir(), `vena-screenshot-${randomUUID()}.png`);

    return new Promise((resolve, reject) => {
      execFile('screencapture', [...args, tempPath], { timeout: 10_000 }, async (err) => {
        if (err) {
          reject(new ComputerError(`Screen capture failed: ${err.message}`));
          return;
        }
        try {
          const buffer = await readFile(tempPath);
          await unlink(tempPath).catch(() => {});
          resolve(buffer);
        } catch (readErr) {
          reject(new ComputerError(`Failed to read screenshot: ${(readErr as Error).message}`));
        }
      });
    });
  }

  async captureScreen(): Promise<Buffer> {
    return this.captureToFile(['-x']);
  }

  async captureWindow(appName?: string): Promise<Buffer> {
    if (appName) {
      // Focus the app first, then capture the frontmost window
      await new Promise<void>((resolve, reject) => {
        execFile(
          'osascript',
          ['-e', `tell application "${appName}" to activate`],
          { timeout: 5_000 },
          (err) => {
            if (err) {
              reject(new ComputerError(`Failed to focus app: ${err.message}`));
              return;
            }
            resolve();
          },
        );
      });
      // Small delay to let the window come to front
      await new Promise((r) => setTimeout(r, 500));
    }
    return this.captureToFile(['-x', '-w']);
  }

  async captureArea(x: number, y: number, w: number, h: number): Promise<Buffer> {
    return this.captureToFile(['-x', '-R', `${x},${y},${w},${h}`]);
  }
}
