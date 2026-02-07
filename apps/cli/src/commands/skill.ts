import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

function parseSkillMd(content: string, filePath: string, source: SkillInfo['source']): SkillInfo {
  const nameMatch = content.match(/^#\s+(.+)/m);
  const descMatch = content.match(/^>\s*(.+)/m) ?? content.match(/description:\s*(.+)/i);
  const versionMatch = content.match(/version:\s*(.+)/i);
  const triggerMatch = content.match(/triggers?:\s*(.+)/i);

  return {
    name: nameMatch?.[1]?.trim() ?? path.basename(filePath, '.md'),
    description: descMatch?.[1]?.trim() ?? 'No description',
    version: versionMatch?.[1]?.trim() ?? '0.1.0',
    triggers: triggerMatch?.[1]?.split(',').map(t => t.trim()) ?? [],
    source,
    path: filePath,
  };
}

function loadSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];

  // Load managed skills
  if (fs.existsSync(MANAGED_DIR)) {
    const files = fs.readdirSync(MANAGED_DIR).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(MANAGED_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      skills.push(parseSkillMd(content, filePath, 'managed'));
    }
  }

  // Load workspace skills from config
  if (fs.existsSync(CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    const skillsConfig = config['skills'] as { dirs?: string[] } | undefined;
    const dirs = skillsConfig?.dirs ?? [];
    for (const dir of dirs) {
      const resolved = dir.startsWith('~') ? dir.replace('~', os.homedir()) : dir;
      if (fs.existsSync(resolved)) {
        const files = fs.readdirSync(resolved).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const filePath = path.join(resolved, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          skills.push(parseSkillMd(content, filePath, 'workspace'));
        }
      }
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
    const resolved = pathOrUrl.startsWith('~') ? pathOrUrl.replace('~', os.homedir()) : path.resolve(pathOrUrl);

    if (!fs.existsSync(resolved)) {
      console.log(chalk.red(`\n  File not found: ${resolved}\n`));
      return;
    }

    fs.mkdirSync(MANAGED_DIR, { recursive: true });
    const destName = path.basename(resolved);
    const destPath = path.join(MANAGED_DIR, destName);
    fs.copyFileSync(resolved, destPath);

    const content = fs.readFileSync(destPath, 'utf-8');
    const skill = parseSkillMd(content, destPath, 'managed');

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

    fs.unlinkSync(skill.path);
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
