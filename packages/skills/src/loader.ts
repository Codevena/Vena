import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Skill, SkillError } from '@vena/shared';
import { SkillParser } from './parser.js';

export class SkillLoader {
  private readonly parser = new SkillParser();
  private loaded = false;
  private skills: Skill[] = [];

  constructor(
    private readonly bundledPath: string,
    private readonly managedPath: string,
    private readonly workspacePath?: string,
  ) {}

  async loadAll(): Promise<Skill[]> {
    if (this.loaded) {
      return this.skills;
    }

    const bundled = await this.scanDirectory(this.bundledPath, 'bundled');
    const managed = await this.scanDirectory(this.managedPath, 'managed');
    const workspace = this.workspacePath
      ? await this.scanDirectory(this.workspacePath, 'workspace')
      : [];

    // Merge with precedence: workspace > managed > bundled
    const skillMap = new Map<string, Skill>();

    for (const skill of bundled) {
      skillMap.set(skill.name, skill);
    }
    for (const skill of managed) {
      skillMap.set(skill.name, skill);
    }
    for (const skill of workspace) {
      skillMap.set(skill.name, skill);
    }

    this.skills = Array.from(skillMap.values());
    this.loaded = true;
    return this.skills;
  }

  private async scanDirectory(
    dirPath: string,
    source: Skill['source'],
  ): Promise<Skill[]> {
    const skills: Skill[] = [];

    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch {
      return skills;
    }

    for (const entry of entries) {
      const skillFile = join(dirPath, entry, 'SKILL.md');
      try {
        const content = await readFile(skillFile, 'utf-8');
        const skill = this.parser.parse(content, source, skillFile);
        skills.push(skill);
      } catch (error) {
        if (error instanceof SkillError) {
          throw error;
        }
        // Skip directories without valid SKILL.md
      }
    }

    return skills;
  }
}
