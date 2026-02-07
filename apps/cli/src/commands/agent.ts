import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseConfig, type VenaConfig, type AgentConfig } from '@vena/shared';

const CONFIG_PATH = path.join(os.homedir(), '.vena', 'vena.json');

function loadConfig(): VenaConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return parseConfig(raw);
}

function saveRawConfig(config: unknown): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadRawConfig(): Record<string, unknown> | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
}

export const agentCommand = new Command('agent')
  .description('Manage agents');

agentCommand
  .command('list')
  .description('List all agents')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    const agents = config.agents.registry;
    console.log();
    console.log(chalk.bold('  Agents'));
    console.log(chalk.dim('  ------'));

    for (const agent of agents) {
      const statusColor = agent.trustLevel === 'full' ? chalk.green : agent.trustLevel === 'limited' ? chalk.yellow : chalk.dim;
      console.log(`  ${chalk.green('\u25CF')} ${chalk.bold(agent.name)} ${chalk.dim(`(${agent.id})`)}`);
      console.log(`    Provider: ${agent.provider} | Trust: ${statusColor(agent.trustLevel)}`);
      console.log(`    Capabilities: ${agent.capabilities.join(', ')}`);
      if (agent.channels.length > 0) {
        console.log(`    Channels: ${agent.channels.join(', ')}`);
      }
      console.log();
    }
  });

agentCommand
  .command('create <name>')
  .description('Create a new agent')
  .action(async (name: string) => {
    const config = loadConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    console.log();
    console.log(chalk.bold(`  Create Agent: ${name}`));
    console.log();

    const response = await prompts([
      {
        type: 'text',
        name: 'persona',
        message: 'Agent persona/description',
        initial: 'Helpful assistant',
      },
      {
        type: 'multiselect',
        name: 'capabilities',
        message: 'Select capabilities',
        choices: [
          { title: 'General', value: 'general', selected: true },
          { title: 'Coding', value: 'coding' },
          { title: 'Research', value: 'research' },
          { title: 'Writing', value: 'writing' },
          { title: 'Data Analysis', value: 'data-analysis' },
          { title: 'Image Generation', value: 'image-gen' },
        ],
        hint: '- Space to select',
      },
      {
        type: 'select',
        name: 'provider',
        message: 'LLM provider',
        choices: [
          { title: 'Anthropic', value: 'anthropic' },
          { title: 'OpenAI', value: 'openai' },
          { title: 'Gemini', value: 'gemini' },
          { title: 'Ollama', value: 'ollama' },
        ],
      },
      {
        type: 'select',
        name: 'trustLevel',
        message: 'Trust level',
        choices: [
          { title: 'Full - Can execute all actions', value: 'full' },
          { title: 'Limited - Restricted actions', value: 'limited' },
          { title: 'Readonly - Observation only', value: 'readonly' },
        ],
      },
    ], {
      onCancel: () => {
        console.log(chalk.yellow('\n  Cancelled.\n'));
        process.exit(0);
      },
    });

    const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const newAgent: AgentConfig = {
      id,
      name,
      persona: response.persona,
      provider: response.provider,
      capabilities: response.capabilities,
      trustLevel: response.trustLevel,
      channels: [],
    };

    const rawConfig = loadRawConfig();
    if (!rawConfig) return;

    const agents = rawConfig['agents'] as Record<string, unknown>;
    const registry = (agents['registry'] as unknown[]) ?? [];
    registry.push(newAgent);
    agents['registry'] = registry;
    saveRawConfig(rawConfig);

    console.log(chalk.green(`\n  \u2713 Agent "${name}" created (id: ${id})`));
    console.log(chalk.dim(`  Provider: ${response.provider} | Trust: ${response.trustLevel}\n`));
  });

agentCommand
  .command('remove <id>')
  .description('Remove an agent')
  .action((id: string) => {
    const rawConfig = loadRawConfig();
    if (!rawConfig) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    const agents = rawConfig['agents'] as Record<string, unknown>;
    const registry = (agents['registry'] as Array<{ id: string; name: string }>) ?? [];
    const idx = registry.findIndex(a => a.id === id);

    if (idx === -1) {
      console.log(chalk.yellow(`\n  Agent "${id}" not found.\n`));
      return;
    }

    const removed = registry.splice(idx, 1)[0]!;
    agents['registry'] = registry;
    saveRawConfig(rawConfig);

    console.log(chalk.green(`\n  \u2713 Removed agent: ${removed.name} (${removed.id})\n`));
  });

agentCommand
  .command('status')
  .description('Show agent network status')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    const agents = config.agents.registry;
    const mesh = config.agents.mesh;

    console.log();
    console.log(chalk.bold('  Agent Network Status'));
    console.log(chalk.dim('  --------------------'));
    console.log(`  Mesh: ${mesh.enabled ? chalk.green('enabled') : chalk.dim('disabled')}`);
    console.log(`  Agents: ${chalk.bold(String(agents.length))}`);
    console.log(`  Max Concurrent: ${config.agents.defaults.maxConcurrent}`);
    console.log(`  Consultation Timeout: ${mesh.consultationTimeout}ms`);
    console.log();

    for (const agent of agents) {
      console.log(`  ${chalk.green('\u25CF')} ${chalk.bold(agent.name)} ${chalk.dim(`[${agent.provider}]`)} - ${chalk.green('idle')}`);
    }
    console.log();
  });
