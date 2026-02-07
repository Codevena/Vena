import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SkillLoader } from '../loader.js';

function skillContent(name: string): string {
  return `---
name: ${name}
description: ${name} description
version: 1.0.0
triggers:
  - ${name}
---
You are the ${name} skill.`;
}

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('SkillLoader', () => {
  it('loads skills from directories and files with precedence', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'vena-skills-'));
    const bundled = path.join(tempDir, 'bundled');
    const managed = path.join(tempDir, 'managed');
    const workspace = path.join(tempDir, 'workspace');

    await mkdir(bundled, { recursive: true });
    await mkdir(managed, { recursive: true });
    await mkdir(workspace, { recursive: true });

    // Bundled skill in folder
    await mkdir(path.join(bundled, 'shared-skill'), { recursive: true });
    await writeFile(
      path.join(bundled, 'shared-skill', 'SKILL.md'),
      skillContent('shared-skill'),
      'utf-8',
    );

    // Managed skill as single file
    await writeFile(
      path.join(managed, 'managed-skill.md'),
      skillContent('managed-skill'),
      'utf-8',
    );

    // Workspace skill overrides bundled
    await writeFile(
      path.join(workspace, 'shared-skill.md'),
      skillContent('shared-skill'),
      'utf-8',
    );

    // Workspace non-skill markdown should be ignored (lenient)
    await writeFile(path.join(workspace, 'notes.md'), '# Not a skill', 'utf-8');

    const loader = new SkillLoader(bundled, managed, workspace);
    const skills = await loader.loadAll();

    const names = skills.map((s) => s.name);
    expect(names).toContain('shared-skill');
    expect(names).toContain('managed-skill');
    expect(names).not.toContain('notes');

    const shared = skills.find((s) => s.name === 'shared-skill');
    expect(shared?.source).toBe('workspace');
  });
});
