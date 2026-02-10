import prompts from 'prompts';
import { colors } from '../ui/terminal.js';

// ── Auth Choice Types ───────────────────────────────────────────────

export type AuthChoice =
  | 'anthropic-setup-token'
  | 'anthropic-api-key'
  | 'openai-codex'
  | 'openai-api-key'
  | 'gemini-api-key'
  | 'gemini-cli'
  | 'gemini-oauth'
  | 'ollama'
  | 'skip';

type AuthGroupOption = {
  label: string;
  description: string;
  value: AuthChoice;
};

type AuthGroup = {
  label: string;
  description: string;
  provider: string;
  options: AuthGroupOption[];
};

// ── Provider Groups ─────────────────────────────────────────────────

export const AUTH_GROUPS: AuthGroup[] = [
  {
    label: 'Anthropic',
    description: 'Setup token + API key',
    provider: 'anthropic',
    options: [
      { label: 'Setup Token', description: 'Claude Code setup-token', value: 'anthropic-setup-token' },
      { label: 'API Key', description: 'Standard API key', value: 'anthropic-api-key' },
    ],
  },
  {
    label: 'OpenAI',
    description: 'Codex OAuth + API key',
    provider: 'openai',
    options: [
      { label: 'Codex OAuth', description: 'ChatGPT sign-in (recommended)', value: 'openai-codex' },
      { label: 'API Key', description: 'Standard API key', value: 'openai-api-key' },
    ],
  },
  {
    label: 'Google',
    description: 'Gemini API key + CLI + OAuth',
    provider: 'gemini',
    options: [
      { label: 'API Key', description: 'Gemini API key', value: 'gemini-api-key' },
      { label: 'Gemini CLI', description: 'Local CLI, no API key', value: 'gemini-cli' },
      { label: 'OAuth', description: 'Gemini/Vertex AI OAuth', value: 'gemini-oauth' },
    ],
  },
  {
    label: 'Ollama',
    description: 'Local, no auth needed',
    provider: 'ollama',
    options: [
      { label: 'Local', description: 'No authentication required', value: 'ollama' },
    ],
  },
];

const onCancel = (): void => {
  console.log();
  console.log(colors.secondary('  Setup cancelled.'));
  console.log();
  process.exit(0);
};

// ── Grouped Two-Level Prompt ────────────────────────────────────────

export async function promptAuthGrouped(opts: {
  includeSkip: boolean;
}): Promise<AuthChoice> {
  // Level 1: Provider group selection
  const groupChoices = AUTH_GROUPS.map(g => ({
    title: `${colors.primary(g.label.padEnd(14))} ${colors.dim(g.description)}`,
    value: g.provider,
  }));

  if (opts.includeSkip) {
    groupChoices.push({
      title: `${colors.dim('\u2190 Skip for now')}`,
      value: 'skip',
    });
  }

  const groupResponse = await prompts({
    type: 'select',
    name: 'group',
    message: colors.primary('\u25B8') + ' Model/auth provider',
    choices: groupChoices,
  }, { onCancel });

  const selectedGroup: string = groupResponse.group as string;

  if (selectedGroup === 'skip') {
    return 'skip';
  }

  const group = AUTH_GROUPS.find(g => g.provider === selectedGroup);
  if (!group) return 'skip';

  // Single-option groups (ollama) skip level 2
  if (group.options.length === 1) {
    return group.options[0]!.value;
  }

  // Level 2: Auth method within group
  const methodChoices = group.options.map(o => ({
    title: `${colors.primary(o.label.padEnd(16))} ${colors.dim(o.description)}`,
    value: o.value,
  }));

  methodChoices.push({
    title: `${colors.dim('\u2190 Back')}`,
    value: '__back__' as AuthChoice,
  });

  const methodResponse = await prompts({
    type: 'select',
    name: 'method',
    message: colors.primary('\u25B8') + ` ${group.label} auth method`,
    choices: methodChoices,
  }, { onCancel });

  const method = methodResponse.method as AuthChoice | '__back__';

  if (method === '__back__') {
    return promptAuthGrouped(opts);
  }

  return method;
}

// ── Helper: Get provider name from AuthChoice ───────────────────────

export function providerFromChoice(choice: AuthChoice): string {
  if (choice.startsWith('anthropic')) return 'anthropic';
  if (choice.startsWith('openai')) return 'openai';
  if (choice.startsWith('gemini')) return 'gemini';
  if (choice === 'ollama') return 'ollama';
  return 'unknown';
}
