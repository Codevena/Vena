import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_PATH = path.join(os.homedir(), '.vena', 'vena.json');

function loadRawConfig(): Record<string, unknown> | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
}

function saveConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getNestedValue(obj: Record<string, unknown>, keyPath: string): unknown {
  const keys = keyPath.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const keys = keyPath.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1]!;

  // Try to parse JSON values (booleans, numbers)
  if (typeof value === 'string') {
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\d+$/.test(value)) value = parseInt(value, 10);
  }

  current[lastKey] = value;
}

function maskSecrets(obj: unknown, depth = 0): unknown {
  if (depth > 10) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(v => maskSecrets(v, depth + 1));
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (/key|token|secret|password|auth/i.test(key) && typeof value === 'string' && value.length > 0) {
        result[key] = value.slice(0, 4) + '****' + value.slice(-4);
      } else {
        result[key] = maskSecrets(value, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

export const configCommand = new Command('config')
  .description('View and modify Vena configuration');

configCommand
  .command('show')
  .description('Display current configuration')
  .action(() => {
    const config = loadRawConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }
    console.log();
    console.log(chalk.bold('  Vena Configuration'));
    console.log(chalk.dim('  ' + CONFIG_PATH));
    console.log();
    console.log(JSON.stringify(maskSecrets(config), null, 2).split('\n').map(l => '  ' + l).join('\n'));
    console.log();
  });

configCommand
  .command('get <key>')
  .description('Get a configuration value (dot notation)')
  .action((key: string) => {
    const config = loadRawConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }
    const value = getNestedValue(config, key);
    if (value === undefined) {
      console.log(chalk.yellow(`\n  Key "${key}" not found.\n`));
      return;
    }
    console.log();
    if (typeof value === 'object') {
      console.log(`  ${chalk.bold(key)}:`);
      console.log(JSON.stringify(maskSecrets(value), null, 2).split('\n').map(l => '    ' + l).join('\n'));
    } else {
      console.log(`  ${chalk.bold(key)}: ${value}`);
    }
    console.log();
  });

configCommand
  .command('set <key> <value>')
  .description('Set a configuration value (dot notation)')
  .action((key: string, value: string) => {
    const config = loadRawConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }
    setNestedValue(config, key, value);
    saveConfig(config);
    console.log(chalk.green(`\n  \u2713 Set ${key} = ${value}\n`));
  });
