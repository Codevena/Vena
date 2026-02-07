#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startCommand } from './commands/start.js';
import { onboardCommand } from './commands/onboard.js';
import { configCommand } from './commands/config.js';
import { skillCommand } from './commands/skill.js';
import { chatCommand } from './commands/chat.js';
import { agentCommand } from './commands/agent.js';
import { networkCommand } from './commands/network.js';

const program = new Command();

// Prevent noisy MaxListenersExceededWarning on process exit listeners in CLI flows.
const previousMaxListeners = process.getMaxListeners();
if (previousMaxListeners !== 0 && previousMaxListeners < 30) {
  process.setMaxListeners(30);
}

program
  .name('vena')
  .description('Vena - AI Agent Platform')
  .version('0.1.0');

program.addCommand(startCommand);
program.addCommand(onboardCommand);
program.addCommand(configCommand);
program.addCommand(skillCommand);
program.addCommand(chatCommand);
program.addCommand(agentCommand);
program.addCommand(networkCommand);

// Auto-detect first run: if no config exists and no subcommand/flags given, launch onboarding
const configPath = path.join(os.homedir(), '.vena', 'vena.json');
const args = process.argv.slice(2);
const isBareLaunch = args.length === 0;

if (isBareLaunch && !fs.existsSync(configPath)) {
  // First run with no arguments - auto-launch onboarding
  program.parse(['node', 'vena', 'onboard']);
} else {
  program.parse();
}
