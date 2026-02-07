import type { Message } from '@vena/shared';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class TranscriptStore {
  private dirPath: string;

  constructor(dirPath: string) {
    this.dirPath = dirPath;
  }

  async save(sessionId: string, messages: Message[]): Promise<void> {
    await fs.mkdir(this.dirPath, { recursive: true });
    const filePath = path.join(this.dirPath, `${sessionId}.jsonl`);
    const lines = messages.map((m) => JSON.stringify(m)).join('\n');
    await fs.writeFile(filePath, lines + '\n', 'utf-8');
  }

  async load(sessionId: string): Promise<Message[]> {
    const filePath = path.join(this.dirPath, `${sessionId}.jsonl`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.map((line) => JSON.parse(line) as Message);
    } catch {
      return [];
    }
  }

  async search(
    query: string,
    limit?: number,
  ): Promise<{ sessionId: string; messages: Message[] }[]> {
    const results: { sessionId: string; messages: Message[] }[] = [];
    const queryLower = query.toLowerCase();
    const maxResults = limit ?? 10;

    try {
      const files = await fs.readdir(this.dirPath);
      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

      for (const file of jsonlFiles) {
        if (results.length >= maxResults) break;

        const content = await fs.readFile(path.join(this.dirPath, file), 'utf-8');
        if (content.toLowerCase().includes(queryLower)) {
          const sessionId = file.replace('.jsonl', '');
          const lines = content.trim().split('\n').filter(Boolean);
          const messages = lines.map((line) => JSON.parse(line) as Message);
          results.push({ sessionId, messages });
        }
      }
    } catch {
      // Directory may not exist yet
    }

    return results;
  }
}
