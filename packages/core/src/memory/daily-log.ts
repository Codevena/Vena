import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class DailyLog {
  private dirPath: string;

  constructor(dirPath: string) {
    this.dirPath = dirPath;
  }

  async append(entry: string): Promise<void> {
    await fs.mkdir(this.dirPath, { recursive: true });
    const filename = this.todayFilename();
    const filePath = path.join(this.dirPath, filename);
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${entry}\n`;
    await fs.appendFile(filePath, line, 'utf-8');
  }

  async read(date?: string): Promise<string> {
    const filename = date ? `${date}.md` : this.todayFilename();
    const filePath = path.join(this.dirPath, filename);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  async search(query: string): Promise<string[]> {
    const results: string[] = [];
    const queryLower = query.toLowerCase();

    try {
      const files = await fs.readdir(this.dirPath);
      const mdFiles = files.filter((f) => f.endsWith('.md')).sort().reverse();

      for (const file of mdFiles.slice(0, 30)) {
        const content = await fs.readFile(path.join(this.dirPath, file), 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes(queryLower)) {
            results.push(line);
          }
        }
      }
    } catch {
      // Directory may not exist yet
    }

    return results;
  }

  private todayFilename(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}.md`;
  }
}
