import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { SkillParser } from '@vena/skills';
import { SkillError } from '@vena/shared';
import { colors, spinnerLine, boxed } from '../ui/terminal.js';
import readline from 'node:readline';

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

function isGitHubUrl(input: string): boolean {
  return input.startsWith('https://github.com/') || input.startsWith('git@github.com:');
}

function cloneGitHubRepo(url: string, tempDir: string): void {
  execSync(`git clone --depth 1 "${url}" "${tempDir}"`, {
    stdio: 'pipe',
    encoding: 'utf-8',
  });
}

function findSkillFiles(dirPath: string): string[] {
  const files: string[] = [];

  function scan(currentPath: string): void {
    if (!fs.existsSync(currentPath)) return;

    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      // Skip node_modules, .git, etc.
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) {
        continue;
      }

      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        files.push(fullPath);
      }
    }
  }

  scan(dirPath);
  return files;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(colors.primary(question + ' (y/N): '), (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
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
      console.log(colors.dim('  No skills installed.'));
      console.log(colors.dim('  Install a skill with:'), chalk.bold('vena skill install <path>'));
    } else {
      console.log(colors.primary('  Installed Skills'));
      console.log(colors.dim('  ' + '─'.repeat(60)));
      console.log();

      for (const skill of skills) {
        const sourceLabel = skill.source === 'bundled' ? colors.accent('[bundled]')
          : skill.source === 'managed' ? colors.success('[managed]')
          : colors.secondary('[workspace]');

        console.log(`  ${sourceLabel} ${chalk.bold(skill.name)} ${colors.dim(`v${skill.version}`)}`);
        console.log(`    ${colors.white(skill.description)}`);

        if (skill.triggers.length > 0) {
          console.log(`    ${colors.dim('Triggers:')} ${colors.secondary(skill.triggers.join(', '))}`);
        }

        console.log(`    ${colors.dim('Source:')} ${colors.dim(skill.path)}`);
        console.log();
      }

      console.log(colors.dim(`  Total: ${skills.length} skill${skills.length !== 1 ? 's' : ''}`));
    }
    console.log();
  });

skillCommand
  .command('install <source>')
  .description('Install skills from a local path or GitHub repository')
  .action(async (source: string) => {
    console.log();

    let skillFiles: string[] = [];
    let tempDir: string | null = null;

    try {
      // Handle GitHub URLs
      if (isGitHubUrl(source)) {
        await spinnerLine('Cloning repository...', 800);

        tempDir = path.join(os.tmpdir(), `vena-skill-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        try {
          cloneGitHubRepo(source, tempDir);
        } catch (error) {
          console.log(colors.error(`\n  Failed to clone repository: ${error instanceof Error ? error.message : String(error)}\n`));
          if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
          return;
        }

        await spinnerLine('Scanning for SKILL.md files...', 600);
        skillFiles = findSkillFiles(tempDir);
      } else {
        // Handle local paths
        const resolved = resolvePath(source.startsWith('~') ? source : path.resolve(source));

        if (!fs.existsSync(resolved)) {
          console.log(colors.error(`\n  Path not found: ${resolved}\n`));
          return;
        }

        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          await spinnerLine('Scanning for SKILL.md files...', 600);
          skillFiles = findSkillFiles(resolved);
        } else if (resolved.endsWith('.md')) {
          skillFiles = [resolved];
        } else {
          console.log(colors.error(`\n  Invalid file: ${resolved}\n`));
          console.log(colors.dim('  Please provide a SKILL.md file or directory containing SKILL.md files.\n'));
          return;
        }
      }

      if (skillFiles.length === 0) {
        console.log(colors.dim('\n  No SKILL.md files found in the source.\n'));
        return;
      }

      console.log(colors.secondary(`\n  Found ${skillFiles.length} skill file${skillFiles.length !== 1 ? 's' : ''}\n`));

      // Validate and install each skill
      const installed: string[] = [];
      const failed: Array<{ file: string; error: string }> = [];

      fs.mkdirSync(MANAGED_DIR, { recursive: true });

      for (const filePath of skillFiles) {
        let skill: SkillInfo | null = null;

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          skill = toSkillInfo(content, filePath, 'managed');
        } catch (error) {
          const message = error instanceof SkillError ? error.message : String(error);
          failed.push({ file: path.basename(filePath), error: message });
          continue;
        }

        // Check if skill already exists
        const existingSkills = loadSkills().filter(s => s.source === 'managed');
        const existing = existingSkills.find(s => s.name === skill.name);

        if (existing) {
          console.log(colors.dim(`  Skipping ${skill.name} (already installed)`));
          continue;
        }

        const destDir = path.join(MANAGED_DIR, skill.name);
        const destPath = path.join(destDir, 'SKILL.md');
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(filePath, destPath);

        installed.push(skill.name);
        console.log(colors.success(`  ✓ Installed ${skill.name} v${skill.version}`));
      }

      console.log();

      if (installed.length > 0) {
        const lines = [
          colors.success(`Successfully installed ${installed.length} skill${installed.length !== 1 ? 's' : ''}`),
          '',
          ...installed.map(name => colors.white(`  • ${name}`)),
        ];
        console.log(boxed(lines, { title: 'Installation Complete', borderColor: colors.success }));
      }

      if (failed.length > 0) {
        console.log();
        console.log(colors.error(`  Failed to install ${failed.length} skill${failed.length !== 1 ? 's' : ''}:`));
        for (const { file, error } of failed) {
          console.log(colors.dim(`    ${file}: ${error}`));
        }
      }

      console.log();
    } finally {
      // Clean up temp directory
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

skillCommand
  .command('uninstall <name>')
  .alias('remove')
  .description('Remove a managed skill')
  .action(async (name: string) => {
    const skills = loadSkills().filter(s => s.source === 'managed');
    const skill = skills.find(s => s.name.toLowerCase() === name.toLowerCase());

    if (!skill) {
      console.log(colors.dim(`\n  Skill "${name}" not found in managed skills.\n`));
      return;
    }

    console.log();
    console.log(colors.secondary(`  Skill: ${skill.name} v${skill.version}`));
    console.log(colors.dim(`  Path: ${skill.path}`));
    console.log();

    const confirmed = await confirm('Are you sure you want to remove this skill?');

    if (!confirmed) {
      console.log(colors.dim('\n  Cancelled.\n'));
      return;
    }

    const skillPath = skill.path;
    if (path.basename(skillPath).toLowerCase() === 'skill.md') {
      const dir = path.dirname(skillPath);
      fs.rmSync(dir, { recursive: true, force: true });
    } else {
      fs.unlinkSync(skillPath);
    }
    console.log(colors.success(`\n  ✓ Removed skill: ${skill.name}\n`));
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
