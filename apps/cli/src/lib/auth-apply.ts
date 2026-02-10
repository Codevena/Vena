import prompts from 'prompts';
import type {
  AuthProfileCredential,
  AuthProfileStore,
} from '@vena/shared';
import {
  upsertAuthProfile,
  saveAuthProfileStore,
} from '@vena/shared';
import {
  runClaudeSetupTokenFlow,
  runOpenAICodexOAuthFlow,
  runGeminiOAuthFlow,
  promptToken,
} from '../commands/onboard.js';
import { findInPath } from './oauth.js';
import { colors } from '../ui/terminal.js';
import type { AuthChoice } from './auth-prompt.js';
import { providerFromChoice } from './auth-prompt.js';

// ── Result Type ─────────────────────────────────────────────────────

export type ApplyResult = {
  profileName: string;
  provider: string;
  model?: string;
  extras?: Record<string, unknown>;
};

const onCancel = (): void => {
  console.log();
  console.log(colors.secondary('  Setup cancelled.'));
  console.log();
  process.exit(0);
};

// ── Profile Name Generation ─────────────────────────────────────────

function generateProfileName(provider: string, method: string, store: AuthProfileStore): string {
  const base = `${provider}-${method}`;
  if (!store.profiles[base]) return base;
  let i = 2;
  while (store.profiles[`${base}-${i}`]) i++;
  return `${base}-${i}`;
}

// ── Env Var Detection ───────────────────────────────────────────────

const ENV_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

async function checkEnvKey(provider: string): Promise<string | null> {
  const envVar = ENV_KEY_MAP[provider];
  if (!envVar) return null;
  const value = process.env[envVar];
  if (!value) return null;

  const { reuse } = await prompts({
    type: 'confirm',
    name: 'reuse',
    message: `Found ${envVar} in environment. Use it?`,
    initial: true,
  }, { onCancel });

  return reuse ? value : null;
}

// ── Apply Auth Choice ───────────────────────────────────────────────

export async function applyAuthChoice(
  choice: AuthChoice,
  store: AuthProfileStore,
  venaDir: string,
): Promise<ApplyResult | null> {
  const provider = providerFromChoice(choice);

  switch (choice) {
    case 'anthropic-api-key': {
      const envKey = await checkEnvKey('anthropic');
      let key = envKey;
      if (!key) {
        console.log(`  ${colors.dim('Get an API key:')} ${colors.secondary('https://platform.claude.com/')}`);
        console.log();
        key = await promptToken('Anthropic API Key');
      }
      if (!key) return null;
      const name = generateProfileName('anthropic', 'key', store);
      const cred: AuthProfileCredential = { type: 'api_key', provider: 'anthropic', key };
      upsertAuthProfile(store, name, cred);
      saveAuthProfileStore(venaDir, store);
      console.log(`  ${colors.success('\u2713')} ${colors.dim(`Saved as profile: ${name}`)}`);
      return { profileName: name, provider: 'anthropic' };
    }

    case 'anthropic-setup-token': {
      const result = await runClaudeSetupTokenFlow();
      if (!result) return null;
      const name = generateProfileName('anthropic', 'setup-token', store);
      const cred: AuthProfileCredential = {
        type: 'oauth',
        provider: 'anthropic',
        accessToken: result.auth.oauthToken!,
      };
      upsertAuthProfile(store, name, cred);
      saveAuthProfileStore(venaDir, store);
      console.log(`  ${colors.success('\u2713')} ${colors.dim(`Saved as profile: ${name}`)}`);
      return { profileName: name, provider: 'anthropic' };
    }

    case 'openai-api-key': {
      const envKey = await checkEnvKey('openai');
      let key = envKey;
      if (!key) {
        console.log(`  ${colors.dim('Get an API key:')} ${colors.secondary('https://platform.openai.com/api-keys')}`);
        console.log();
        key = await promptToken('OpenAI API Key');
      }
      if (!key) return null;
      const name = generateProfileName('openai', 'key', store);
      const cred: AuthProfileCredential = { type: 'api_key', provider: 'openai', key };
      upsertAuthProfile(store, name, cred);
      saveAuthProfileStore(venaDir, store);
      console.log(`  ${colors.success('\u2713')} ${colors.dim(`Saved as profile: ${name}`)}`);
      return { profileName: name, provider: 'openai' };
    }

    case 'openai-codex': {
      const result = await runOpenAICodexOAuthFlow();
      if (!result) return null;
      const name = generateProfileName('openai', 'codex', store);
      const cred: AuthProfileCredential = {
        type: 'oauth',
        provider: 'openai',
        accessToken: result.auth.oauthToken!,
        refreshToken: result.auth.refreshToken,
        tokenUrl: result.auth.tokenUrl,
        clientId: result.auth.clientId,
        clientSecret: result.auth.clientSecret,
        expiresAt: result.auth.expiresAt,
      };
      upsertAuthProfile(store, name, cred);
      saveAuthProfileStore(venaDir, store);
      console.log(`  ${colors.success('\u2713')} ${colors.dim(`Saved as profile: ${name}`)}`);
      return { profileName: name, provider: 'openai' };
    }

    case 'gemini-api-key': {
      const envKey = await checkEnvKey('gemini');
      let key = envKey;
      if (!key) {
        console.log(`  ${colors.dim('Get an API key:')} ${colors.secondary('https://aistudio.google.com/app/apikey')}`);
        console.log();
        key = await promptToken('Gemini API Key');
      }
      if (!key) return null;
      const name = generateProfileName('gemini', 'key', store);
      const cred: AuthProfileCredential = { type: 'api_key', provider: 'gemini', key };
      upsertAuthProfile(store, name, cred);
      saveAuthProfileStore(venaDir, store);
      console.log(`  ${colors.success('\u2713')} ${colors.dim(`Saved as profile: ${name}`)}`);
      return { profileName: name, provider: 'gemini' };
    }

    case 'gemini-cli': {
      const geminiPath = findInPath('gemini');
      if (!geminiPath) {
        console.log();
        console.log(colors.error('  Gemini CLI not found.'));
        console.log(colors.dim('  Install: brew install gemini-cli (or npm install -g @google/gemini-cli)'));
        console.log(colors.dim('  Then run `gemini` once to complete login.'));
        console.log();
        return null;
      }
      const name = generateProfileName('gemini', 'cli', store);
      const cred: AuthProfileCredential = {
        type: 'token',
        provider: 'gemini',
        token: '__cli__',
        email: 'gemini-cli',
      };
      upsertAuthProfile(store, name, cred);
      saveAuthProfileStore(venaDir, store);
      console.log(`  ${colors.success('\u2713')} ${colors.dim('Gemini CLI selected')}`);
      return { profileName: name, provider: 'gemini', extras: { transport: 'cli' } };
    }

    case 'gemini-oauth': {
      const result = await runGeminiOAuthFlow();
      if (!result) return null;
      const name = generateProfileName('gemini', 'oauth', store);
      const cred: AuthProfileCredential = {
        type: 'oauth',
        provider: 'gemini',
        accessToken: result.auth.oauthToken!,
        refreshToken: result.auth.refreshToken,
        tokenUrl: result.auth.tokenUrl,
        clientId: result.auth.clientId,
        clientSecret: result.auth.clientSecret,
        expiresAt: result.auth.expiresAt,
      };
      upsertAuthProfile(store, name, cred);
      saveAuthProfileStore(venaDir, store);
      console.log(`  ${colors.success('\u2713')} ${colors.dim(`Saved as profile: ${name}`)}`);
      return { profileName: name, provider: 'gemini', extras: result.extras };
    }

    case 'ollama': {
      const name = generateProfileName('ollama', 'local', store);
      const cred: AuthProfileCredential = {
        type: 'token',
        provider: 'ollama',
        token: '__local__',
      };
      upsertAuthProfile(store, name, cred);
      saveAuthProfileStore(venaDir, store);
      console.log(`  ${colors.success('\u2713')} ${colors.dim('Ollama selected — no API key required')}`);
      return { profileName: name, provider: 'ollama' };
    }

    case 'skip':
      return null;

    default:
      return null;
  }
}
