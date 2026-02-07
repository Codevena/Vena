import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class LongTermMemory {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async read(): Promise<string> {
    try {
      return await fs.readFile(this.filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  async write(content: string): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, content, 'utf-8');
  }

  async update(section: string, content: string): Promise<void> {
    const existing = await this.read();
    const sectionHeader = `## ${section}`;
    const sectionRegex = new RegExp(
      `${escapeRegExp(sectionHeader)}\\n[\\s\\S]*?(?=\\n## |$)`,
    );

    let updated: string;
    if (existing.includes(sectionHeader)) {
      updated = existing.replace(sectionRegex, `${sectionHeader}\n${content}\n`);
    } else {
      updated = existing
        ? `${existing.trimEnd()}\n\n${sectionHeader}\n${content}\n`
        : `${sectionHeader}\n${content}\n`;
    }

    await this.write(updated);
  }

  async append(content: string): Promise<void> {
    const existing = await this.read();
    const updated = existing ? `${existing.trimEnd()}\n\n${content}\n` : `${content}\n`;
    await this.write(updated);
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
