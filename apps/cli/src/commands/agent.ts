import { Command } from 'commander';
import prompts from 'prompts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseConfig,
  listCharacters,
  loadAuthProfileStore,
  listAllProfiles,
  type VenaConfig,
  type AgentConfig,
} from '@vena/shared';
import { colors } from '../ui/terminal.js';
import { promptAuthGrouped } from '../lib/auth-prompt.js';
import { applyAuthChoice } from '../lib/auth-apply.js';
import { getModelChoices } from '../commands/onboard.js';

const VENA_DIR = path.join(os.homedir(), '.vena');
const CONFIG_PATH = path.join(VENA_DIR, 'vena.json');

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

const onCancel = (): void => {
  console.log();
  console.log(colors.secondary('  Cancelled.'));
  console.log();
  process.exit(0);
};

export const agentCommand = new Command('agent')
  .description('Manage agents');

// ── agent list ──────────────────────────────────────────────────────

agentCommand
  .command('list')
  .description('List all agents')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log(colors.secondary('\n  No configuration found. Run ') + colors.white('vena onboard') + colors.secondary(' first.\n'));
      return;
    }

    const agents = config.agents.registry;
    console.log();
    console.log(`  ${colors.white('Agents')}`);
    console.log(`  ${colors.dim('------')}`);

    for (const agent of agents) {
      const trustColor = agent.trustLevel === 'full'
        ? colors.success
        : agent.trustLevel === 'limited'
          ? colors.secondary
          : colors.dim;
      console.log(`  ${colors.success('\u25CF')} ${colors.white(agent.name)} ${colors.dim(`(${agent.id})`)}`);
      console.log(`    Provider: ${agent.provider} | Trust: ${trustColor(agent.trustLevel)}${agent.authProfile ? ` | Auth: ${colors.primary(agent.authProfile)}` : ''}`);
      console.log(`    Capabilities: ${agent.capabilities.join(', ')}`);
      if (agent.channels.length > 0) {
        console.log(`    Channels: ${agent.channels.join(', ')}`);
      }
      console.log();
    }
  });

// ── agent create ────────────────────────────────────────────────────

agentCommand
  .command('create <name>')
  .description('Create a new agent')
  .action(async (name: string) => {
    const config = loadConfig();
    if (!config) {
      console.log(colors.secondary('\n  No configuration found. Run ') + colors.white('vena onboard') + colors.secondary(' first.\n'));
      return;
    }

    console.log();
    console.log(`  ${colors.primary('Create Agent:')} ${colors.white(name)}`);
    console.log();

    // ── Step 1: Auth/Provider ─────────────────────────────────────
    console.log(`  ${colors.primary('\u25B8')} ${colors.white('Auth/Provider')}`);
    console.log();

    const authStore = loadAuthProfileStore(VENA_DIR);
    const existingProfiles = listAllProfiles(authStore);

    let authProfileName: string | undefined;
    let selectedProvider: string;

    if (existingProfiles.length > 0) {
      const profileChoices = existingProfiles.map(p => {
        const label = `${p.name} (${p.credential.provider} ${p.credential.type})`;
        return {
          title: `${colors.primary('Use existing:')} ${colors.dim(label)}`,
          value: p.name,
        };
      });
      profileChoices.push({
        title: `${colors.secondary('Add new credentials...')}`,
        value: '__new__',
      });

      const profileResponse = await prompts({
        type: 'select',
        name: 'profile',
        message: colors.primary('\u25B8') + ' Auth profile',
        choices: profileChoices,
      }, { onCancel });

      if (profileResponse.profile === '__new__') {
        const authChoice = await promptAuthGrouped({ includeSkip: true });
        if (authChoice === 'skip') {
          selectedProvider = config.providers.default;
        } else {
          const result = await applyAuthChoice(authChoice, authStore, VENA_DIR);
          if (result) {
            authProfileName = result.profileName;
            selectedProvider = result.provider;
          } else {
            selectedProvider = config.providers.default;
          }
        }
      } else {
        authProfileName = profileResponse.profile as string;
        const cred = authStore.profiles[authProfileName!];
        selectedProvider = cred?.provider ?? config.providers.default;
      }
    } else {
      const authChoice = await promptAuthGrouped({ includeSkip: true });
      if (authChoice === 'skip') {
        selectedProvider = config.providers.default;
      } else {
        const result = await applyAuthChoice(authChoice, authStore, VENA_DIR);
        if (result) {
          authProfileName = result.profileName;
          selectedProvider = result.provider;
        } else {
          selectedProvider = config.providers.default;
        }
      }
    }

    // ── Step 2: Model ─────────────────────────────────────────────
    console.log();
    console.log(`  ${colors.primary('\u25B8')} ${colors.white('Model')}`);
    console.log();

    const modelChoices = getModelChoices(selectedProvider);
    const modelResponse = await prompts({
      type: 'select',
      name: 'model',
      message: colors.primary('\u25B8') + ' Model',
      choices: modelChoices,
    }, { onCancel });

    let selectedModel: string = modelResponse.model as string;

    if (selectedModel === '__custom__') {
      const customResponse = await prompts({
        type: 'text',
        name: 'customModel',
        message: colors.primary('\u25B8') + ' Model ID',
        hint: 'e.g. claude-opus-4-6, gpt-4o, gemini-3-pro-preview',
      }, { onCancel });
      selectedModel = (customResponse.customModel as string) || 'unknown';
    }

    // ── Step 3: Character ─────────────────────────────────────────
    console.log();
    console.log(`  ${colors.primary('\u25B8')} ${colors.white('Character')}`);
    console.log();

    const characters = listCharacters();
    const characterChoices = characters.map(c => ({
      title: `${colors.primary(c.name.padEnd(8))} ${colors.dim('\u2500 ' + c.tagline)}`,
      value: c.id,
    }));

    const characterResponse = await prompts({
      type: 'select',
      name: 'character',
      message: colors.primary('\u25B8') + ' Character',
      choices: characterChoices,
    }, { onCancel });

    const selectedCharacter = (characterResponse.character as string) || 'nova';

    // ── Step 4: Capabilities ──────────────────────────────────────
    console.log();
    console.log(`  ${colors.primary('\u25B8')} ${colors.white('Capabilities')}`);
    console.log();

    const capResponse = await prompts({
      type: 'multiselect',
      name: 'capabilities',
      message: colors.primary('\u25B8') + ' Capabilities',
      choices: [
        { title: `${colors.primary('\u25CF')} General`, value: 'general', selected: true },
        { title: `${colors.primary('\u25CF')} Coding`, value: 'coding' },
        { title: `${colors.primary('\u25CF')} Research`, value: 'research' },
        { title: `${colors.primary('\u25CF')} Writing`, value: 'writing' },
        { title: `${colors.primary('\u25CF')} Data Analysis`, value: 'data-analysis' },
        { title: `${colors.primary('\u25CF')} Image Generation`, value: 'image-gen' },
      ],
      hint: '- Space to select, Enter to confirm',
    }, { onCancel });

    const capabilities = (capResponse.capabilities as string[]) ?? ['general'];

    // ── Step 5: Trust Level ───────────────────────────────────────
    console.log();
    console.log(`  ${colors.primary('\u25B8')} ${colors.white('Trust Level')}`);
    console.log();

    const trustResponse = await prompts({
      type: 'select',
      name: 'trustLevel',
      message: colors.primary('\u25B8') + ' Trust level',
      choices: [
        { title: `${colors.success('\u25CF')} Full      ${colors.dim('\u2500 Can execute all actions')}`, value: 'full' },
        { title: `${colors.secondary('\u25CF')} Limited   ${colors.dim('\u2500 Restricted actions')}`, value: 'limited' },
        { title: `${colors.dim('\u25CF')} Readonly  ${colors.dim('\u2500 Observation only')}`, value: 'readonly' },
      ],
    }, { onCancel });

    const trustLevel = (trustResponse.trustLevel as string) || 'full';

    // ── Save Agent ────────────────────────────────────────────────
    const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const newAgent: AgentConfig = {
      id,
      name,
      persona: 'Helpful assistant',
      provider: selectedProvider,
      model: selectedModel,
      capabilities,
      trustLevel: trustLevel as 'full' | 'limited' | 'readonly',
      channels: [],
      character: selectedCharacter,
      ...(authProfileName ? { authProfile: authProfileName } : {}),
    };

    const rawConfig = loadRawConfig();
    if (!rawConfig) return;

    const agents = rawConfig['agents'] as Record<string, unknown>;
    const registry = (agents['registry'] as unknown[]) ?? [];
    registry.push(newAgent);
    agents['registry'] = registry;
    saveRawConfig(rawConfig);

    console.log();
    console.log(`  ${colors.success('\u2713')} Agent "${colors.white(name)}" created ${colors.dim(`(id: ${id})`)}`);
    console.log(`    Provider: ${colors.primary(selectedProvider)} | Model: ${colors.primary(selectedModel)} | Auth: ${authProfileName ? colors.primary(authProfileName) : colors.dim('inherited')}`);
    console.log();
  });

// ── agent remove ────────────────────────────────────────────────────

agentCommand
  .command('remove <id>')
  .description('Remove an agent')
  .action((id: string) => {
    const rawConfig = loadRawConfig();
    if (!rawConfig) {
      console.log(colors.secondary('\n  No configuration found. Run ') + colors.white('vena onboard') + colors.secondary(' first.\n'));
      return;
    }

    const agents = rawConfig['agents'] as Record<string, unknown>;
    const registry = (agents['registry'] as Array<{ id: string; name: string }>) ?? [];
    const idx = registry.findIndex(a => a.id === id);

    if (idx === -1) {
      console.log(colors.secondary(`\n  Agent "${id}" not found.\n`));
      return;
    }

    const removed = registry.splice(idx, 1)[0]!;
    agents['registry'] = registry;
    saveRawConfig(rawConfig);

    console.log(`\n  ${colors.success('\u2713')} Removed agent: ${removed.name} (${removed.id})\n`);
  });

// ── agent status ────────────────────────────────────────────────────

agentCommand
  .command('status')
  .description('Show agent network status')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log(colors.secondary('\n  No configuration found. Run ') + colors.white('vena onboard') + colors.secondary(' first.\n'));
      return;
    }

    const agents = config.agents.registry;
    const mesh = config.agents.mesh;

    console.log();
    console.log(`  ${colors.white('Agent Network Status')}`);
    console.log(`  ${colors.dim('--------------------')}`);
    console.log(`  Mesh: ${mesh.enabled ? colors.success('enabled') : colors.dim('disabled')}`);
    console.log(`  Agents: ${colors.white(String(agents.length))}`);
    console.log(`  Max Concurrent: ${config.agents.defaults.maxConcurrent}`);
    console.log(`  Consultation Timeout: ${mesh.consultationTimeout}ms`);
    console.log();

    for (const agent of agents) {
      console.log(`  ${colors.success('\u25CF')} ${colors.white(agent.name)} ${colors.dim(`[${agent.provider}]`)} - ${colors.success('idle')}`);
    }
    console.log();
  });
