import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Skill, SkillError } from '@vena/shared';
import { SkillParser } from './parser.js';

export class SkillLoader {
  private readonly parser = new SkillParser();
  private loaded = false;
  private skills: Skill[] = [];
  private workspacePaths: string[] = [];

  constructor(
    private readonly bundledPath: string,
    private readonly managedPath: string,
    workspacePath?: string | string[],
  ) {
    if (Array.isArray(workspacePath)) {
      this.workspacePaths = workspacePath.filter(Boolean);
    } else if (workspacePath) {
      this.workspacePaths = [workspacePath];
    }
  }

  async loadAll(): Promise<Skill[]> {
    if (this.loaded) {
      return this.skills;
    }

    const bundled = await this.scanDirectory(this.bundledPath, 'bundled');
    const managed = await this.scanDirectory(this.managedPath, 'managed');
    const workspace: Skill[] = [];
    for (const dir of this.workspacePaths) {
      const loaded = await this.scanDirectory(dir, 'workspace');
      workspace.push(...loaded);
    }

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

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return skills;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = join(dirPath, entry.name, 'SKILL.md');
        const skill = await this.tryParseSkill(skillFile, source, { strict: true });
        if (skill) skills.push(skill);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const skillFile = join(dirPath, entry.name);
        const isExplicitSkill = entry.name.toLowerCase() === 'skill.md';
        const strict = source !== 'workspace' || isExplicitSkill;
        const skill = await this.tryParseSkill(skillFile, source, { strict });
        if (skill) skills.push(skill);
      }
    }

    return skills;
  }

  private async tryParseSkill(
    filePath: string,
    source: Skill['source'],
    opts: { strict: boolean },
  ): Promise<Skill | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return this.parser.parse(content, source, filePath);
    } catch (error) {
      if (error instanceof SkillError && opts.strict) {
        throw error;
      }
      return null;
    }
  }
}
