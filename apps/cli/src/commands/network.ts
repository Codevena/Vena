import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseConfig, type VenaConfig } from '@vena/shared';

const CONFIG_PATH = path.join(os.homedir(), '.vena', 'vena.json');

function loadConfig(): VenaConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return parseConfig(raw);
}

export const networkCommand = new Command('network')
  .description('View agent mesh network');

networkCommand
  .command('status')
  .description('Show mesh network status')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    const agents = config.agents.registry;
    const mesh = config.agents.mesh;

    console.log();
    console.log(chalk.bold('  Mesh Network Status'));
    console.log(chalk.dim('  -------------------'));
    console.log(`  Status: ${mesh.enabled ? chalk.green('active') : chalk.red('disabled')}`);
    console.log(`  Agents: ${chalk.bold(String(agents.length))}`);
    console.log(`  Active consultations: ${chalk.bold('0')}`);
    console.log(`  Active delegations: ${chalk.bold('0')}`);
    console.log(`  Max concurrent consultations: ${mesh.maxConcurrentConsultations}`);
    console.log(`  Consultation timeout: ${mesh.consultationTimeout}ms`);
    console.log();

    console.log(chalk.bold('  Connected Agents'));
    console.log(chalk.dim('  ----------------'));
    for (const agent of agents) {
      const trustColor = agent.trustLevel === 'full' ? chalk.green
        : agent.trustLevel === 'limited' ? chalk.yellow
        : chalk.dim;
      console.log(`  ${chalk.green('\u25CF')} ${chalk.bold(agent.name)} ${chalk.dim(`(${agent.id})`)} - trust: ${trustColor(agent.trustLevel)}`);
    }
    console.log();
  });

networkCommand
  .command('topology')
  .description('Show ASCII network topology')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    const agents = config.agents.registry;

    console.log();
    console.log(chalk.bold('  Network Topology'));
    console.log(chalk.dim('  ----------------'));
    console.log();

    if (agents.length === 0) {
      console.log(chalk.dim('  No agents configured.'));
      console.log();
      return;
    }

    if (agents.length === 1) {
      const a = agents[0]!;
      console.log(`  ${chalk.cyan('\u250C' + '\u2500'.repeat(a.name.length + 4) + '\u2510')}`);
      console.log(`  ${chalk.cyan('\u2502')}  ${chalk.bold(a.name)}  ${chalk.cyan('\u2502')}`);
      console.log(`  ${chalk.cyan('\u2514' + '\u2500'.repeat(a.name.length + 4) + '\u2518')}`);
      console.log();
      return;
    }

    // Draw mesh topology: all agents connected to each other
    const maxNameLen = Math.max(...agents.map(a => a.name.length));
    const boxWidth = maxNameLen + 4;

    // Top agent
    const topAgent = agents[0]!;
    const topPad = Math.floor((boxWidth - topAgent.name.length) / 2);
    console.log(`  ${' '.repeat(boxWidth + 4)}${chalk.cyan('\u250C' + '\u2500'.repeat(topAgent.name.length + 4) + '\u2510')}`);
    console.log(`  ${' '.repeat(boxWidth + 4)}${chalk.cyan('\u2502')}  ${chalk.bold(topAgent.name)}${' '.repeat(topPad > 0 ? 0 : 0)}  ${chalk.cyan('\u2502')}`);
    console.log(`  ${' '.repeat(boxWidth + 4)}${chalk.cyan('\u2514' + '\u2500'.repeat(topAgent.name.length + 4) + '\u2518')}`);

    // Connection lines
    if (agents.length > 1) {
      const centerOffset = boxWidth + 4 + Math.floor((topAgent.name.length + 6) / 2);
      console.log(`  ${' '.repeat(centerOffset)}${chalk.dim('\u2502')}`);

      // Draw remaining agents
      for (let i = 1; i < agents.length; i++) {
        const agent = agents[i]!;
        const connector = i < agents.length - 1 ? '\u251C\u2500\u2500' : '\u2514\u2500\u2500';
        console.log(`  ${' '.repeat(centerOffset - 1)}${chalk.dim(connector)} ${chalk.cyan('\u250C' + '\u2500'.repeat(agent.name.length + 4) + '\u2510')}`);
        console.log(`  ${' '.repeat(centerOffset + 2)} ${chalk.cyan('\u2502')}  ${chalk.bold(agent.name)}  ${chalk.cyan('\u2502')}`);
        console.log(`  ${' '.repeat(centerOffset + 2)} ${chalk.cyan('\u2514' + '\u2500'.repeat(agent.name.length + 4) + '\u2518')}`);
        if (i < agents.length - 1) {
          console.log(`  ${' '.repeat(centerOffset)}${chalk.dim('\u2502')}`);
        }
      }
    }

    console.log();
    console.log(chalk.dim(`  ${agents.length} agents, ${agents.length * (agents.length - 1) / 2} connections`));
    console.log();
  });
