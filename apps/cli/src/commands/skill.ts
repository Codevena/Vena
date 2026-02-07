import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SkillParser } from '@vena/skills';
import { SkillError } from '@vena/shared';

const MANAGED_DIR = path.join(os.homedir(), '.vena', 'skills');
const CONFIG_PATH = path.join(os.homedir(), '.vena', 'vena.json');

interface SkillInfo {
  name: string;
  description: string;
  version: string;
  triggers: string[];
  source: 'bundled' | 'managed' | 'workspace';
  path: string;
}

const parser = new SkillParser();

function resolvePath(input: string): string {
  return input.startsWith('~') ? input.replace('~', os.homedir()) : input;
}

function toSkillInfo(content: string, filePath: string, source: SkillInfo['source']): SkillInfo {
  const skill = parser.parse(content, source, filePath);
  return {
    name: skill.name,
    description: skill.description,
    version: skill.version,
    triggers: skill.triggers,
    source,
    path: filePath,
  };
}

function tryParseSkillFile(
  filePath: string,
  source: SkillInfo['source'],
  strict: boolean,
): SkillInfo | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return toSkillInfo(content, filePath, source);
  } catch (error) {
    if (error instanceof SkillError) {
      if (strict) {
        console.log(chalk.yellow(`  Skipping invalid skill at ${filePath}: ${error.message}`));
      }
      return null;
    }
    return null;
  }
}

function scanSkillDir(dirPath: string, source: SkillInfo['source'], strictFiles: boolean): SkillInfo[] {
  const skills: SkillInfo[] = [];
  if (!fs.existsSync(dirPath)) return skills;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillFile = path.join(dirPath, entry.name, 'SKILL.md');
      const skill = tryParseSkillFile(skillFile, source, true);
      if (skill) skills.push(skill);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const filePath = path.join(dirPath, entry.name);
      const isExplicitSkill = entry.name.toLowerCase() === 'skill.md';
      const strict = strictFiles || isExplicitSkill;
      const skill = tryParseSkillFile(filePath, source, strict);
      if (skill) skills.push(skill);
    }
  }

  return skills;
}

function collectSkillFiles(dirPath: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dirPath)) return files;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillFile = path.join(dirPath, entry.name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        files.push(skillFile);
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(path.join(dirPath, entry.name));
    }
  }

  return files;
}

function loadSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];

  // Load managed skills
  skills.push(...scanSkillDir(MANAGED_DIR, 'managed', true));

  // Load workspace skills from config
  if (fs.existsSync(CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    const skillsConfig = config['skills'] as { dirs?: string[] } | undefined;
    const dirs = skillsConfig?.dirs ?? [];
    for (const dir of dirs) {
      const resolved = resolvePath(dir);
      skills.push(...scanSkillDir(resolved, 'workspace', false));
    }
  }

  return skills;
}

export const skillCommand = new Command('skill')
  .description('Manage skills');

skillCommand
  .command('list')
  .description('List installed skills')
  .action(() => {
    const skills = loadSkills();
    console.log();
    if (skills.length === 0) {
      console.log(chalk.dim('  No skills installed.'));
      console.log(chalk.dim('  Install a skill with:'), chalk.bold('vena skill install <path>'));
    } else {
      console.log(chalk.bold('  Installed Skills'));
      console.log(chalk.dim('  ----------------'));
      for (const skill of skills) {
        const sourceLabel = skill.source === 'bundled' ? chalk.blue('[bundled]')
          : skill.source === 'managed' ? chalk.green('[managed]')
          : chalk.yellow('[workspace]');
        console.log(`  ${sourceLabel} ${chalk.bold(skill.name)} ${chalk.dim(`v${skill.version}`)}`);
        console.log(`    ${skill.description}`);
        if (skill.triggers.length > 0) {
          console.log(`    Triggers: ${chalk.dim(skill.triggers.join(', '))}`);
        }
      }
    }
    console.log();
  });

skillCommand
  .command('install <pathOrUrl>')
  .description('Install a skill from a SKILL.md file')
  .action((pathOrUrl: string) => {
    const resolved = resolvePath(pathOrUrl.startsWith('~') ? pathOrUrl : path.resolve(pathOrUrl));

    if (!fs.existsSync(resolved)) {
      console.log(chalk.red(`\n  File not found: ${resolved}\n`));
      return;
    }

    let skill: SkillInfo | null = null;
    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      skill = toSkillInfo(content, resolved, 'managed');
    } catch (error) {
      const message = error instanceof SkillError ? error.message : String(error);
      console.log(chalk.red(`\n  Failed to parse skill: ${message}\n`));
      return;
    }

    fs.mkdirSync(MANAGED_DIR, { recursive: true });
    const destDir = path.join(MANAGED_DIR, skill.name);
    const destPath = path.join(destDir, 'SKILL.md');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(resolved, destPath);

    console.log(chalk.green(`\n  \u2713 Installed skill: ${skill.name}`));
    console.log(chalk.dim(`    ${destPath}\n`));
  });

skillCommand
  .command('remove <name>')
  .description('Remove a managed skill')
  .action((name: string) => {
    const skills = loadSkills().filter(s => s.source === 'managed');
    const skill = skills.find(s => s.name.toLowerCase() === name.toLowerCase());

    if (!skill) {
      console.log(chalk.yellow(`\n  Skill "${name}" not found in managed skills.\n`));
      return;
    }

    const skillPath = skill.path;
    if (path.basename(skillPath).toLowerCase() === 'skill.md') {
      const dir = path.dirname(skillPath);
      fs.rmSync(dir, { recursive: true, force: true });
    } else {
      fs.unlinkSync(skillPath);
    }
    console.log(chalk.green(`\n  \u2713 Removed skill: ${skill.name}\n`));
  });

skillCommand
  .command('info <name>')
  .description('Show skill details')
  .action((name: string) => {
    const skills = loadSkills();
    const skill = skills.find(s => s.name.toLowerCase() === name.toLowerCase());

    if (!skill) {
      console.log(chalk.yellow(`\n  Skill "${name}" not found.\n`));
      return;
    }

    console.log();
    console.log(chalk.bold(`  ${skill.name}`), chalk.dim(`v${skill.version}`));
    console.log(chalk.dim('  ' + '-'.repeat(skill.name.length + skill.version.length + 3)));
    console.log(`  Description: ${skill.description}`);
    console.log(`  Source: ${skill.source}`);
    console.log(`  Path: ${chalk.dim(skill.path)}`);
    if (skill.triggers.length > 0) {
      console.log(`  Triggers: ${skill.triggers.join(', ')}`);
    }
    console.log();
  });

skillCommand
  .command('validate [pathOrDir]')
  .description('Validate a SKILL.md file or directory of skills')
  .action((pathOrDir?: string) => {
    const target = resolvePath(pathOrDir ?? MANAGED_DIR);

    if (!fs.existsSync(target)) {
      console.log(chalk.red(`\n  Path not found: ${target}\n`));
      process.exitCode = 1;
      return;
    }

    const stat = fs.statSync(target);
    const files = stat.isDirectory() ? collectSkillFiles(target) : [target];

    if (files.length === 0) {
      console.log(chalk.yellow(`\n  No skill files found in ${target}\n`));
      return;
    }

    let failures = 0;
    console.log();
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const skill = parser.parse(content, 'workspace', file);
        console.log(chalk.green(`  ✓ ${skill.name} v${skill.version}`), chalk.dim(file));
      } catch (error) {
        failures++;
        const msg = error instanceof SkillError ? error.message : String(error);
        console.log(chalk.red(`  ✗ ${path.basename(file)}`), chalk.dim(file));
        console.log(chalk.dim(`    ${msg}`));
      }
    }
    console.log();

    if (failures > 0) {
      process.exitCode = 1;
    }
  });
