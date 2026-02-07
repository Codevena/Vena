import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { ComputerError } from '@vena/shared';

export interface FileInfo {
  size: number;
  modified: string;
  type: string;
}

export class FileSystemController {
  async revealInFinder(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('open', ['-R', path], { timeout: 5_000 }, (err) => {
        if (err) {
          reject(new ComputerError(`Failed to reveal in Finder: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  async openWithDefaultApp(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('open', [path], { timeout: 5_000 }, (err) => {
        if (err) {
          reject(new ComputerError(`Failed to open file: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  async spotlightSearch(query: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      execFile('mdfind', [query], { timeout: 15_000 }, (err, stdout) => {
        if (err) {
          reject(new ComputerError(`Spotlight search failed: ${err.message}`));
          return;
        }
        const results = stdout
          .trim()
          .split('\n')
          .filter((line) => line.length > 0);
        resolve(results);
      });
    });
  }

  async getFileInfo(path: string): Promise<FileInfo> {
    try {
      const stats = await stat(path);

      // Get content type via mdls
      const type = await new Promise<string>((resolve) => {
        execFile(
          'mdls',
          ['-name', 'kMDItemContentType', '-raw', path],
          { timeout: 5_000 },
          (err, stdout) => {
            if (err || !stdout || stdout === '(null)') {
              resolve('unknown');
              return;
            }
            resolve(stdout.trim());
          },
        );
      });

      return {
        size: stats.size,
        modified: stats.mtime.toISOString(),
        type,
      };
    } catch (err) {
      throw new ComputerError(`Failed to get file info: ${(err as Error).message}`);
    }
  }
}
