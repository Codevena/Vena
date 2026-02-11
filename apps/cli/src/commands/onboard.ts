import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AuthConfig, VenaConfig } from '@vena/shared';
import { listCharacters, loadAuthProfileStore, getAuthProfile } from '@vena/shared';
import { promptAuthGrouped, providerFromChoice } from '../lib/auth-prompt.js';
import { applyAuthChoice } from '../lib/auth-apply.js';
import { GoogleAuth } from '@vena/integrations';
import {
  canUseLocalCallback,
  extractOAuthCode,
  extractOAuthCodeAndState,
  generatePkce,
  openBrowser,
  shouldUseManualOAuthFlow,
  waitForOAuthCallback,
  findInPath,
} from '../lib/oauth.js';
import {
  extractGeminiCliCredentials,
  extractOpenAiCodexClient,
  GEMINI_CLIENT_ID_KEYS,
  GEMINI_CLIENT_SECRET_KEYS,
  GEMINI_OAUTH_AUTH_URL,
  GEMINI_OAUTH_SCOPES,
  GEMINI_OAUTH_TOKEN_URL,
  OPENAI_DEFAULT_REDIRECT,
  OPENAI_DEFAULT_SCOPES,
  OPENAI_OAUTH_AUTH_URL,
  OPENAI_OAUTH_CLIENT_ID_KEYS,
  OPENAI_OAUTH_CLIENT_SECRET_KEYS,
  OPENAI_OAUTH_TOKEN_URL,
  resolveEnvValue,
} from '../lib/provider-auth.js';
import { DEFAULT_GOOGLE_SCOPE_KEYS, normalizeGoogleScopes } from '../lib/google-scopes.js';
import {
  colors,
  sleep,
  clearScreen,
  printLogo,
  progressBar,
  boxed,
  typewriter,
  divider,
  badge,
  stepIndicator,
  getTerminalWidth,
} from '../ui/terminal.js';

// ── Personality suggestions for agent naming ──────────────────────────
const PERSONALITY_TRAITS = [
  'curious and analytical',
  'warm and empathetic',
  'precise and methodical',
  'creative and bold',
  'calm and thoughtful',
  'sharp and efficient',
  'friendly and proactive',
  'witty and resourceful',
];

function randomTrait(): string {
  return PERSONALITY_TRAITS[Math.floor(Math.random() * PERSONALITY_TRAITS.length)] ?? 'helpful and versatile';
}

// ── Provider descriptions ─────────────────────────────────────────────
const PROVIDER_INFO: Record<string, string> = {
  anthropic: 'Most capable, best for coding & reasoning',
  openai: 'Versatile, wide ecosystem',
  gemini: 'Fast, great multimodal',
  ollama: 'Private, runs on your machine',
};

const PROVIDER_AUTH_HELP: Record<string, {
  apiKeyUrl?: string;
  oauthUrl?: string;
  oauthGuideUrl?: string;
  oauthNote?: string;
}> = {
  anthropic: {
    apiKeyUrl: 'https://platform.claude.com/',
    oauthNote: 'For Claude Code setup-token, run: vena config claude-setup-token',
  },
  openai: {
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    oauthNote: 'For Codex (ChatGPT) OAuth, run: vena config openai-codex-auth',
  },
  gemini: {
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    oauthUrl: 'https://console.cloud.google.com/apis/credentials',
    oauthGuideUrl: 'https://ai.google.dev/palm_docs/oauth_quickstart',
    oauthNote: 'For Gemini CLI, install `gemini` and run it once to login. For Vertex AI OAuth, run: vena config gemini-auth. For Workspace tools, run: vena config google-auth',
  },
};

function printAuthHelp(providerKey: string, authType: 'api_key' | 'oauth_token'): void {
  const help = PROVIDER_AUTH_HELP[providerKey];
  if (!help) return;

  if (authType === 'api_key' && help.apiKeyUrl) {
    console.log(`  ${colors.dim('Get an API key:')} ${colors.secondary(help.apiKeyUrl)}`);
    console.log();
  }

  if (authType === 'oauth_token') {
    if (help.oauthUrl) {
      console.log(`  ${colors.dim('Create OAuth client:')} ${colors.secondary(help.oauthUrl)}`);
    }
    if (help.oauthGuideUrl) {
      console.log(`  ${colors.dim('OAuth guide:')} ${colors.secondary(help.oauthGuideUrl)}`);
    }
    if (help.oauthNote) {
      console.log(`  ${colors.dim(help.oauthNote)}`);
    }
    console.log();
  }
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export type OAuthFlowResult = {
  auth: AuthConfig;
  extras?: Record<string, unknown>;
};

type AuthMethod = 'api_key' | 'oauth_login' | 'oauth_token' | 'cli';

export async function promptToken(message: string): Promise<string> {
  const tokenResponse = await prompts({
    type: 'password',
    name: 'token',
    message: colors.primary('▸') + ` ${message}`,
  }, {
    onCancel: () => {
      console.log();
      console.log(colors.secondary('  Setup cancelled.'));
      console.log();
      process.exit(0);
    },
  });
  return (tokenResponse.token as string) ?? '';
}

async function promptText(message: string): Promise<string> {
  const response = await prompts({
    type: 'text',
    name: 'value',
    message: colors.primary('▸') + ` ${message}`,
  }, {
    onCancel: () => {
      console.log();
      console.log(colors.secondary('  Setup cancelled.'));
      console.log();
      process.exit(0);
    },
  });
  return (response.value as string) ?? '';
}

export async function runGeminiOAuthFlow(): Promise<OAuthFlowResult | null> {
  let clientId = resolveEnvValue(GEMINI_CLIENT_ID_KEYS);
  let clientSecret = resolveEnvValue(GEMINI_CLIENT_SECRET_KEYS);

  if (!clientId) {
    const extracted = extractGeminiCliCredentials();
    if (extracted) {
      clientId = extracted.clientId;
      if (!clientSecret && extracted.clientSecret) {
        clientSecret = extracted.clientSecret;
      }
    }
  }

  if (!clientId) {
    console.log();
    console.log(chalk.bold('  Gemini OAuth setup'));
    console.log(chalk.dim('  No Gemini CLI credentials found.'));
    console.log(chalk.dim('  If you have Gemini CLI installed, this will auto-detect.'));
    console.log();

    const creds = await prompts([
      {
        type: 'text',
        name: 'clientId',
        message: 'Client ID',
        validate: (value: string) => (normalizeString(value) ? true : 'Required'),
      },
      {
        type: 'password',
        name: 'clientSecret',
        message: 'Client Secret (optional)',
      },
    ], {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });

    clientId = normalizeString(creds.clientId) ?? clientId;
    clientSecret = normalizeString(creds.clientSecret) ?? clientSecret;
    if (!clientId) {
      console.log(chalk.red('\n  Client ID is required.\n'));
      return null;
    }
  }

  const redirectUri = 'http://localhost:8085/oauth2callback';
  const { verifier, challenge } = generatePkce();
  const state = verifier;

  const authParams = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: GEMINI_OAUTH_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  const authUrl = `${GEMINI_OAUTH_AUTH_URL}?${authParams.toString()}`;

  let rawInput = '';
  const manualFlow = shouldUseManualOAuthFlow() || !canUseLocalCallback(redirectUri);

  if (!manualFlow) {
    console.log(colors.dim('  Opening your browser to authorize...'));
    try {
      await openBrowser(authUrl);
    } catch {
      console.log(colors.dim('  Unable to open browser automatically.'));
    }
    try {
      const callback = await waitForOAuthCallback({
        redirectUri,
        expectedState: state,
        timeoutMs: 5 * 60 * 1000,
      });
      rawInput = callback.code;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`\n  OAuth callback failed: ${message}\n`));
    }
  }

  if (!rawInput) {
    console.log(colors.dim('  Open this URL in your browser to authorize:'));
    console.log(`  ${authUrl}`);
    console.log();
    console.log(colors.dim('  Paste the full redirect URL (or just the code).'));
    console.log();
    rawInput = await promptText('Authorization Code or Redirect URL');
  }

  const parsed = extractOAuthCodeAndState(rawInput, state);
  if ('error' in parsed) {
    console.log(chalk.red(`\n  ${parsed.error}\n`));
    return null;
  }
  if (parsed.state !== state) {
    console.log(chalk.red('\n  OAuth state mismatch. Please try again.\n'));
    return null;
  }

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    code: parsed.code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (clientSecret) {
    tokenBody.set('client_secret', clientSecret);
  }

  const tokenResponse = await fetch(GEMINI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    console.log(chalk.red(`\n  Token exchange failed: ${tokenResponse.status} ${text}\n`));
    return null;
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokenData.refresh_token) {
    console.log(chalk.red('\n  No refresh token received. Try again and ensure consent is granted.\n'));
    return null;
  }

  const expiresAt = tokenData.expires_in
    ? Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000
    : undefined;

  let project =
    normalizeString(process.env['GOOGLE_CLOUD_PROJECT']) ??
    normalizeString(process.env['GOOGLE_CLOUD_PROJECT_ID']);
  let location =
    normalizeString(process.env['GOOGLE_CLOUD_REGION']) ??
    normalizeString(process.env['GOOGLE_CLOUD_LOCATION']);

  if (!project) {
    const projectResponse = await prompts({
      type: 'text',
      name: 'project',
      message: 'Google Cloud project ID (optional)',
    }, {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });
    project = normalizeString(projectResponse.project);
  }

  if (!location) {
    const locationResponse = await prompts({
      type: 'text',
      name: 'location',
      message: 'Vertex AI location (e.g. us-central1)',
      initial: 'us-central1',
    }, {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });
    location = normalizeString(locationResponse.location);
  }

  const hasVertexConfig = Boolean(project && location);
  if (!hasVertexConfig) {
    console.log(chalk.yellow('  Missing project/location. Set providers.gemini.project and providers.gemini.location later.'));
  }

  return {
    auth: {
      type: 'oauth_token',
      oauthToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenUrl: GEMINI_OAUTH_TOKEN_URL,
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    },
    extras: {
      vertexai: hasVertexConfig,
      ...(project ? { project } : {}),
      ...(location ? { location } : {}),
    },
  };
}

export async function runOpenAICodexOAuthFlow(): Promise<OAuthFlowResult | null> {
  let clientId = resolveEnvValue(OPENAI_OAUTH_CLIENT_ID_KEYS);
  let clientSecret = resolveEnvValue(OPENAI_OAUTH_CLIENT_SECRET_KEYS);

  if (!clientId) {
    const extracted = extractOpenAiCodexClient();
    if (extracted) {
      clientId = extracted.clientId;
    }
  }

  if (!clientId) {
    console.log();
    console.log(chalk.bold('  OpenAI Codex OAuth setup'));
    console.log(chalk.dim('  No Codex CLI client ID detected.'));
    console.log(chalk.dim('  Set OPENAI_CODEX_OAUTH_CLIENT_ID or enter it below.'));
    console.log();

    const creds = await prompts([
      {
        type: 'text',
        name: 'clientId',
        message: 'Client ID',
        validate: (value: string) => (normalizeString(value) ? true : 'Required'),
      },
      {
        type: 'password',
        name: 'clientSecret',
        message: 'Client Secret (optional)',
      },
    ], {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });

    clientId = normalizeString(creds.clientId) ?? clientId;
    clientSecret = normalizeString(creds.clientSecret) ?? clientSecret;
    if (!clientId) {
      console.log(chalk.red('\n  Client ID is required.\n'));
      return null;
    }
  }

  const redirectUri = OPENAI_DEFAULT_REDIRECT;
  const { verifier, challenge } = generatePkce();
  const state = verifier;

  const authParams = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: OPENAI_DEFAULT_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  const authUrl = `${OPENAI_OAUTH_AUTH_URL}?${authParams.toString()}`;

  let rawInput = '';
  const manualFlow = shouldUseManualOAuthFlow() || !canUseLocalCallback(redirectUri);

  if (!manualFlow) {
    console.log(colors.dim('  Opening your browser to authorize...'));
    try {
      await openBrowser(authUrl);
    } catch {
      console.log(colors.dim('  Unable to open browser automatically.'));
    }
    try {
      const callback = await waitForOAuthCallback({
        redirectUri,
        expectedState: state,
        timeoutMs: 5 * 60 * 1000,
      });
      rawInput = callback.code;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`\n  OAuth callback failed: ${message}\n`));
    }
  }

  if (!rawInput) {
    console.log(colors.dim('  Open this URL in your browser to authorize:'));
    console.log(`  ${authUrl}`);
    console.log();
    console.log(colors.dim('  Paste the full redirect URL (or just the code).'));
    console.log();
    rawInput = await promptText('Authorization Code or Redirect URL');
  }

  const parsed = extractOAuthCodeAndState(rawInput, state);
  if ('error' in parsed) {
    console.log(chalk.red(`\n  ${parsed.error}\n`));
    return null;
  }
  if (parsed.state !== state) {
    console.log(chalk.red('\n  OAuth state mismatch. Please try again.\n'));
    return null;
  }

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    code: parsed.code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (clientSecret) {
    tokenBody.set('client_secret', clientSecret);
  }

  const tokenResponse = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    console.log(chalk.red(`\n  Token exchange failed: ${tokenResponse.status} ${text}\n`));
    return null;
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokenData.access_token) {
    console.log(chalk.red('\n  No access token received.\n'));
    return null;
  }

  const expiresAt = tokenData.expires_in
    ? Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000
    : undefined;

  return {
    auth: {
      type: 'oauth_token',
      oauthToken: tokenData.access_token,
      ...(tokenData.refresh_token ? { refreshToken: tokenData.refresh_token } : {}),
      tokenUrl: OPENAI_OAUTH_TOKEN_URL,
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    },
  };
}

export async function runClaudeSetupTokenFlow(): Promise<OAuthFlowResult | null> {
  console.log();
  console.log(chalk.bold('  Claude Code setup-token'));
  console.log(chalk.dim('  Run `claude setup-token` in another terminal, then paste it here.'));
  console.log();

  const token = normalizeString(await promptToken('Paste setup-token'));
  if (!token) {
    console.log(chalk.red('\n  Setup-token is required.\n'));
    return null;
  }

  return {
    auth: {
      type: 'oauth_token',
      oauthToken: token,
    },
  };
}

async function runGoogleWorkspaceOAuthFlow(): Promise<{ clientId: string; clientSecret: string; scopes: string[] } | null> {
  console.log();
  console.log(chalk.bold('  Google Workspace OAuth'));
  console.log(chalk.dim('  Authorize Gmail, Docs, Sheets, Calendar, Drive.'));
  console.log();

  const proceed = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: 'Authorize Google Workspace now?',
    initial: true,
  }, {
    onCancel: () => {
      console.log();
      console.log(colors.secondary('  Setup cancelled.'));
      console.log();
      process.exit(0);
    },
  });
  if (!proceed.confirm) {
    console.log(colors.dim('  Skipped — you can run `vena config google-auth` later.'));
    return null;
  }

  const creds = await prompts([
    {
      type: 'text',
      name: 'clientId',
      message: 'Google OAuth Client ID',
      validate: (value: string) => (normalizeString(value) ? true : 'Required'),
    },
    {
      type: 'password',
      name: 'clientSecret',
      message: 'Google OAuth Client Secret',
      validate: (value: string) => (normalizeString(value) ? true : 'Required'),
    },
  ], {
    onCancel: () => {
      console.log();
      console.log(colors.secondary('  Setup cancelled.'));
      console.log();
      process.exit(0);
    },
  });

  const clientId = normalizeString(creds.clientId);
  const clientSecret = normalizeString(creds.clientSecret);
  if (!clientId || !clientSecret) {
    console.log(chalk.red('\n  Client ID and secret are required.\n'));
    return null;
  }

  const { scopeKeys, oauthScopes } = normalizeGoogleScopes([...DEFAULT_GOOGLE_SCOPE_KEYS]);
  const redirectUri = 'http://localhost:3000/oauth2callback';
  const auth = new GoogleAuth({
    clientId,
    clientSecret,
    redirectUri,
  });
  const authUrl = auth.getAuthUrl(oauthScopes);

  let rawInput = '';
  const manualFlow = shouldUseManualOAuthFlow() || !canUseLocalCallback(redirectUri);

  if (!manualFlow) {
    console.log(colors.dim('  Opening your browser to authorize...'));
    try {
      await openBrowser(authUrl);
    } catch {
      console.log(colors.dim('  Unable to open browser automatically.'));
    }
    try {
      const callback = await waitForOAuthCallback({
        redirectUri,
        timeoutMs: 5 * 60 * 1000,
      });
      rawInput = callback.code;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`\n  OAuth callback failed: ${message}\n`));
    }
  }

  if (!rawInput) {
    console.log(colors.dim('  Open this URL in your browser to authorize:'));
    console.log(`  ${authUrl}`);
    console.log();
    console.log(colors.dim('  Paste the full redirect URL (or just the code).'));
    console.log();
    rawInput = await promptText('Authorization Code or Redirect URL');
  }

  const code = extractOAuthCode(rawInput);
  if (!code) {
    console.log(chalk.red('\n  No authorization code provided.\n'));
    return null;
  }

  await auth.exchangeCode(code);
  console.log(chalk.green('\n  ✓ Google Workspace tokens saved to ~/.vena/google-tokens.json\n'));

  return {
    clientId,
    clientSecret,
    scopes: scopeKeys,
  };
}

// ── Model Choices ─────────────────────────────────────────────────
export const MODEL_CHOICES: Record<string, Array<{ title: string; value: string }>> = {
  anthropic: [
    { title: `${colors.primary('●')} Claude Opus 4.6        ${colors.dim('─ Most capable, best reasoning')}`, value: 'claude-opus-4-6' },
    { title: `${colors.primary('●')} Claude Sonnet 4.5      ${colors.dim('─ Fast & capable (Recommended)')}`, value: 'claude-sonnet-4-5-20250929' },
    { title: `${colors.primary('●')} Claude Haiku 4.5       ${colors.dim('─ Fastest, cheapest')}`, value: 'claude-haiku-4-5-20251001' },
  ],
  openai: [
    { title: `${colors.primary('●')} GPT-4o                 ${colors.dim('─ Most capable, multimodal')}`, value: 'gpt-4o' },
    { title: `${colors.primary('●')} GPT-4o Mini            ${colors.dim('─ Faster, cheaper')}`, value: 'gpt-4o-mini' },
    { title: `${colors.primary('●')} o1                     ${colors.dim('─ Advanced reasoning')}`, value: 'o1' },
    { title: `${colors.primary('●')} o3-mini                ${colors.dim('─ Fast reasoning')}`, value: 'o3-mini' },
  ],
  gemini: [
    { title: `${colors.primary('●')} Gemini 3 Pro (Preview)    ${colors.dim('─ Most capable')}`, value: 'gemini-3-pro-preview' },
    { title: `${colors.primary('●')} Gemini 3 Flash (Preview)  ${colors.dim('─ Fast & efficient (Recommended)')}`, value: 'gemini-3-flash-preview' },
    { title: `${colors.primary('●')} Gemini 2.5 Pro            ${colors.dim('─ Strong previous gen')}`, value: 'gemini-2.5-pro' },
    { title: `${colors.primary('●')} Gemini 2.5 Flash          ${colors.dim('─ Balanced cost/perf')}`, value: 'gemini-2.5-flash' },
    { title: `${colors.primary('●')} Gemini 2.5 Flash Lite     ${colors.dim('─ Cheapest')}`, value: 'gemini-2.5-flash-lite' },
  ],
  ollama: [
    { title: `${colors.primary('●')} Llama 3.1              ${colors.dim('─ Meta open-source')}`, value: 'llama3.1' },
    { title: `${colors.primary('●')} Mistral Large          ${colors.dim('─ Best open model')}`, value: 'mistral-large' },
    { title: `${colors.primary('●')} DeepSeek V3            ${colors.dim('─ Strong reasoning')}`, value: 'deepseek-v3' },
    { title: `${colors.primary('●')} Qwen 2.5               ${colors.dim('─ Multilingual')}`, value: 'qwen2.5' },
  ],
};

export function getModelChoices(providerKey: string): Array<{ title: string; value: string }> {
  const choices = [...(MODEL_CHOICES[providerKey] ?? [])];
  choices.push({
    title: `${colors.dim('●')} Custom...              ${colors.dim('─ Enter any model ID manually')}`,
    value: '__custom__',
  });
  return choices;
}

// ── Welcome Animation ─────────────────────────────────────────────────
async function showWelcome(): Promise<void> {
  clearScreen();
  console.log();

  await printLogo(true);

  const width = getTerminalWidth();
  const subtitle = colors.dim('AI Agent Platform');
  const subtitleClean = 'AI Agent Platform';
  const subPad = ' '.repeat(Math.max(0, Math.floor((width - subtitleClean.length) / 2)));
  console.log(subPad + subtitle);

  await sleep(200);

  const versionStr = badge('v0.1.0');
  const versionClean = ' v0.1.0 ';
  const vPad = ' '.repeat(Math.max(0, Math.floor((width - versionClean.length) / 2)));
  console.log(vPad + versionStr);
  console.log();

  // Divider
  const divLine = divider('━', Math.min(50, width - 4));
  const divClean = '━'.repeat(Math.min(50, width - 4));
  const dPad = ' '.repeat(Math.max(0, Math.floor((width - divClean.length) / 2)));
  console.log(dPad + divLine);
  console.log();

  // Animated tagline
  const tagline = 'Your personal AI that remembers, learns, and acts.';
  const tPad = ' '.repeat(Math.max(0, Math.floor((width - tagline.length) / 2)));
  process.stdout.write(tPad);
  await typewriter(colors.secondary(tagline), 30);

  console.log();
  await sleep(400);
}

// ── Step Header ───────────────────────────────────────────────────────
function printStepHeader(step: number, total: number, title: string, description: string): void {
  console.log();
  console.log(`  ${progressBar(step - 1, total, 40)}`);
  console.log();
  console.log(`  ${stepIndicator(step, total)}`);
  console.log(`  ${chalk.bold(title)}`);
  console.log(`  ${colors.dim(description)}`);
  console.log();
}

// ── Completion Screen ─────────────────────────────────────────────────
async function showCompletion(config: {
  provider: string;
  agentName: string;
  channels: string[];
  features: string[];
}): Promise<void> {
  clearScreen();
  console.log();

  await printLogo(false);
  console.log();

  // Big animated checkmark
  const width = getTerminalWidth();
  const checkLines = [
    colors.success('     ✓     '),
    colors.success('   ✓ ✓ ✓   '),
    colors.success(' ✓ ✓ ✓ ✓ ✓ '),
    colors.success('   ✓ ✓ ✓   '),
    colors.success('     ✓     '),
  ];

  for (const line of checkLines) {
    const cleanLen = 11; // approximate clean length
    const pad = ' '.repeat(Math.max(0, Math.floor((width - cleanLen) / 2)));
    console.log(pad + line);
    await sleep(50);
  }

  console.log();
  const setupComplete = chalk.bold('Setup Complete!');
  const scClean = 'Setup Complete!';
  const scPad = ' '.repeat(Math.max(0, Math.floor((width - scClean.length) / 2)));
  console.log(scPad + colors.success(setupComplete));
  console.log();

  // Summary box
  const summaryLines = [
    chalk.bold(colors.secondary('Configuration Summary')),
    '',
    `${colors.dim('Provider:')}     ${colors.white(config.provider)}`,
    `${colors.dim('Agent:')}        ${colors.white(config.agentName)}`,
    `${colors.dim('Channels:')}     ${config.channels.length > 0 ? colors.white(config.channels.join(', ')) : colors.dim('None')}`,
    `${colors.dim('Features:')}     ${config.features.length > 0 ? colors.white(config.features.join(', ')) : colors.dim('Default')}`,
    '',
    `${colors.dim('Config:')}       ${colors.dim('~/.vena/vena.json')}`,
    `${colors.dim('Skills:')}       ${colors.dim('~/.vena/skills/')}`,
  ];

  const box = boxed(summaryLines, {
    title: 'VENA',
    padding: 2,
    width: 52,
  });
  for (const line of box.split('\n')) {
    console.log('  ' + line);
  }

  console.log();

  // Neural network ASCII art
  const neuralArt = [
    '    ○───○───○',
    '   /│╲ /│╲ /│╲',
    '  ○─┼─○─┼─○─┼─○',
    '   ╲│╱ ╲│╱ ╲│╱',
    '    ○───○───○',
  ];
  for (const line of neuralArt) {
    const pad = ' '.repeat(Math.max(0, Math.floor((width - line.length) / 2)));
    console.log(pad + colors.primary(line));
  }

  console.log();

  // What's next section
  console.log(`  ${colors.secondary(chalk.bold("What's next?"))}`);
  console.log();
  console.log(`  ${colors.primary('1.')} Run ${chalk.bold('vena start')}    ${colors.dim('to launch the platform')}`);
  console.log(`  ${colors.primary('2.')} Run ${chalk.bold('vena chat')}     ${colors.dim('to chat with your agent')}`);
  console.log(`  ${colors.primary('3.')} Run ${chalk.bold('vena config')}   ${colors.dim('to view configuration')}`);
  console.log(`  ${colors.primary('4.')} Run ${chalk.bold('vena skill')}    ${colors.dim('to manage skills')}`);
  console.log();

  const finalMsg = divider('━', Math.min(50, width - 4));
  const finalMsgClean = '━'.repeat(Math.min(50, width - 4));
  const fPad = ' '.repeat(Math.max(0, Math.floor((width - finalMsgClean.length) / 2)));
  console.log(fPad + finalMsg);
  console.log();

  const closingText = 'Vena is ready. Let\'s build something amazing.';
  const cPad = ' '.repeat(Math.max(0, Math.floor((width - closingText.length) / 2)));
  await typewriter(cPad + colors.secondary(chalk.bold(closingText)), 35);
  console.log();
}

// ── Main Onboard Command ──────────────────────────────────────────────
export const onboardCommand = new Command('onboard')
  .description('Interactive setup wizard for Vena')
  .action(async () => {
    // prompts/readline create multiple exit listeners; bump limit to avoid warnings during onboarding
    const previousMaxListeners = process.getMaxListeners();
    if (previousMaxListeners !== 0 && previousMaxListeners < 30) {
      process.setMaxListeners(30);
    }

    const totalSteps = 8;

    // ── Welcome Screen ────────────────────────────────────────────────
    await showWelcome();

    // ── Step 1: Choose Provider ───────────────────────────────────────
    printStepHeader(1, totalSteps, 'Choose Your LLM Provider', 'Select the AI model provider for your agent.');

    const providerChoices = [
      { title: `${colors.primary('Anthropic')} ${colors.dim('(Claude)')}   ${colors.dim('─ ' + PROVIDER_INFO['anthropic'])}`, value: 'anthropic' },
      { title: `${colors.primary('OpenAI')} ${colors.dim('(GPT)')}      ${colors.dim('─ ' + PROVIDER_INFO['openai'])}`, value: 'openai' },
      { title: `${colors.primary('Google')} ${colors.dim('(Gemini)')}   ${colors.dim('─ ' + PROVIDER_INFO['gemini'])}`, value: 'google' },
      { title: `${colors.primary('Ollama')} ${colors.dim('(Local)')}    ${colors.dim('─ ' + PROVIDER_INFO['ollama'])}`, value: 'ollama' },
    ];

    const providerResponse = await prompts({
      type: 'select',
      name: 'provider',
      message: colors.primary('▸') + ' Provider',
      choices: providerChoices,
    }, {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled. Run ') + chalk.bold('vena onboard') + colors.secondary(' when ready.'));
        console.log();
        process.exit(0);
      },
    });

    const provider: string = providerResponse.provider as string;

    // Map 'google' back to 'gemini' for config compatibility
    const providerKey = provider === 'google' ? 'gemini' : provider;

    // ── Step 2: Choose Model ────────────────────────────────────────
    printStepHeader(2, totalSteps, 'Choose Your Model', 'Select which model to use, or type a custom model ID.');

    const modelChoices = getModelChoices(providerKey);

    const modelResponse = await prompts({
      type: 'select',
      name: 'model',
      message: colors.primary('▸') + ' Model',
      choices: modelChoices,
    }, {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });

    let selectedModel: string = modelResponse.model as string;

    if (selectedModel === '__custom__') {
      const customModelResponse = await prompts({
        type: 'text',
        name: 'customModel',
        message: colors.primary('▸') + ' Model ID',
        hint: 'e.g. claude-opus-4-6, gpt-4-turbo, gemini-3-pro-preview',
      }, {
        onCancel: () => {
          console.log();
          console.log(colors.secondary('  Setup cancelled.'));
          console.log();
          process.exit(0);
        },
      });
      selectedModel = (customModelResponse.customModel as string) || 'unknown';
    }

    console.log(`  ${colors.success('✓')} ${colors.dim(`Model: ${selectedModel}`)}`);

    // ── Step 3: Authentication (Grouped Auth Prompt) ──────────────
    const venaDir = path.join(os.homedir(), '.vena');
    fs.mkdirSync(venaDir, { recursive: true });
    const authStore = loadAuthProfileStore(venaDir);

    let authProfileName: string | undefined;
    let apiKey = '';
    let authType: 'api_key' | 'oauth_token' = 'api_key';
    let selectedAuthMethod: AuthMethod = 'api_key';
    let providerAuth: AuthConfig | null = null;
    let providerExtras: Record<string, unknown> = {};

    printStepHeader(3, totalSteps, 'Authentication', 'Choose your model provider and auth method.');

    const authChoice = await promptAuthGrouped({ includeSkip: false });
    const authResult = await applyAuthChoice(authChoice, authStore, venaDir);

    if (authResult) {
      authProfileName = authResult.profileName;
      providerExtras = authResult.extras ?? {};

      // Also populate legacy inline config for backward compat
      const profile = getAuthProfile(authStore, authResult.profileName);
      if (profile) {
        if (profile.type === 'api_key') {
          apiKey = profile.key;
          selectedAuthMethod = 'api_key';
          authType = 'api_key';
        } else if (profile.type === 'oauth') {
          providerAuth = {
            type: 'oauth_token',
            oauthToken: profile.accessToken,
            refreshToken: profile.refreshToken,
            tokenUrl: profile.tokenUrl,
            clientId: profile.clientId,
            clientSecret: profile.clientSecret,
            expiresAt: profile.expiresAt,
          };
          selectedAuthMethod = 'oauth_login';
          authType = 'oauth_token';
        } else if (profile.type === 'token' && profile.token === '__cli__') {
          selectedAuthMethod = 'cli';
          providerExtras = { ...providerExtras, transport: 'cli' };
        } else if (profile.type === 'token' && profile.token === '__local__') {
          selectedAuthMethod = 'api_key';
        }
      }
    } else {
      console.log(colors.secondary('\n  Auth setup failed. Please try again.\n'));
      process.exit(0);
    }

    // ── Step 3: Name Your Agent ───────────────────────────────────────
    const trait = randomTrait();
    printStepHeader(4, totalSteps, 'Name Your Agent', `Give your AI a name. Suggested personality: ${colors.secondary(trait)}`);

    const nameResponse = await prompts({
      type: 'text',
      name: 'agentName',
      message: colors.primary('▸') + ' Agent Name',
      initial: 'Vena',
    }, {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });

    const agentName = (nameResponse.agentName as string) || 'Vena';

    // ── Step 5: Choose Character ────────────────────────────────────────
    const characters = listCharacters();
    const characterChoices = characters.map(c => ({
      title: `${colors.primary('●')} ${c.name.padEnd(8)} ${colors.dim('─ ' + c.tagline)}`,
      value: c.id,
    }));

    printStepHeader(5, totalSteps, 'Choose Character', 'Pick a personality for your agent.');

    const characterResponse = await prompts({
      type: 'select',
      name: 'character',
      message: colors.primary('▸') + ' Character',
      choices: characterChoices,
    }, {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });

    const selectedCharacter = (characterResponse.character as string) || 'nova';
    const charObj = characters.find(c => c.id === selectedCharacter);
    console.log(`  ${colors.success('✓')} ${colors.dim(`Character: ${charObj?.name ?? selectedCharacter}`)}`);

    // ── Step 6: User Profile ────────────────────────────────────────────
    printStepHeader(6, totalSteps, 'About You', 'Tell your agent a bit about yourself (optional).');

    const userNameResponse = await prompts({
      type: 'text',
      name: 'userName',
      message: colors.primary('▸') + ' Your Name',
      hint: 'So your agent knows what to call you',
    }, {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });

    const userName = (userNameResponse.userName as string) || '';

    let userTimezone: string | undefined;
    let userLanguage = 'en';

    if (userName) {
      const langResponse = await prompts({
        type: 'text',
        name: 'language',
        message: colors.primary('▸') + ' Preferred Language',
        initial: 'en',
        hint: 'e.g. en, de, fr, es, ja',
      }, {
        onCancel: () => {
          console.log();
          console.log(colors.secondary('  Setup cancelled.'));
          console.log();
          process.exit(0);
        },
      });
      userLanguage = (langResponse.language as string) || 'en';

      const tzResponse = await prompts({
        type: 'text',
        name: 'timezone',
        message: colors.primary('▸') + ' Timezone',
        hint: 'e.g. America/New_York, Europe/Berlin',
      }, {
        onCancel: () => {
          console.log();
          console.log(colors.secondary('  Setup cancelled.'));
          console.log();
          process.exit(0);
        },
      });
      userTimezone = (tzResponse.timezone as string) || undefined;

      console.log(`  ${colors.success('✓')} ${colors.dim(`Profile saved for ${userName}`)}`);
    } else {
      console.log(`  ${colors.dim('Skipped — you can set this later in ~/.vena/vena.json')}`);
    }

    // ── Step 7: Enable Channels & Telegram Token ──────────────────────
    printStepHeader(7, totalSteps, 'Enable Channels', 'Choose which messaging channels to connect.');

    const channelResponse = await prompts({
      type: 'multiselect',
      name: 'channels',
      message: colors.primary('▸') + ' Channels',
      choices: [
        { title: `${colors.primary('●')} Telegram   ${colors.dim('─ Bot messaging via Telegram')}`, value: 'telegram' },
        { title: `${colors.primary('●')} WhatsApp   ${colors.dim('─ WhatsApp Business API')}`, value: 'whatsapp' },
      ],
      hint: '- Space to select, Enter to confirm',
    }, {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });

    const channels = (channelResponse.channels as string[]) ?? [];

    // Telegram token if selected
    let telegramToken = '';
    if (channels.includes('telegram')) {
      console.log();
      console.log(`  ${colors.dim('Get a token from')} ${colors.secondary('@BotFather')} ${colors.dim('on Telegram')}`);
      console.log();

      const tokenResponse = await prompts({
        type: 'password',
        name: 'telegramToken',
        message: colors.primary('▸') + ' Telegram Bot Token',
      }, {
        onCancel: () => {
          console.log();
          console.log(colors.secondary('  Setup cancelled.'));
          console.log();
          process.exit(0);
        },
      });

      telegramToken = (tokenResponse.telegramToken as string) ?? '';
      if (telegramToken) {
        console.log(`  ${colors.success('✓')} ${colors.dim('Telegram token saved')}`);
      }
    }

    // ── Step 8: Feature Selection ─────────────────────────────────────
    printStepHeader(8, totalSteps, 'Enable Features', 'Select which capabilities to enable for your agent.');

    const featureResponse = await prompts({
      type: 'multiselect',
      name: 'features',
      message: colors.primary('▸') + ' Features',
      choices: [
        { title: `${colors.primary('●')} Semantic Memory     ${colors.dim('─ Knowledge Graph & entity extraction')}`, value: 'memory', selected: true },
        { title: `${colors.primary('●')} Computer Use        ${colors.dim('─ macOS shell, browser, screenshots')}`, value: 'computer', selected: true },
        { title: `${colors.primary('●')} Voice (TTS/STT)     ${colors.dim('─ Speech synthesis & recognition')}`, value: 'voice' },
        { title: `${colors.primary('●')} Google Workspace    ${colors.dim('─ Gmail, Docs, Sheets, Calendar')}`, value: 'google' },
      ],
      hint: '- Space to select, Enter to confirm',
    }, {
      onCancel: () => {
        console.log();
        console.log(colors.secondary('  Setup cancelled.'));
        console.log();
        process.exit(0);
      },
    });

    const features = (featureResponse.features as string[]) ?? [];

    let googleConfig: { clientId: string; clientSecret: string; scopes: string[] } | null = null;
    if (features.includes('google')) {
      googleConfig = await runGoogleWorkspaceOAuthFlow();
    }

    // ── Build Configuration ───────────────────────────────────────────
    console.log();
    console.log(`  ${progressBar(totalSteps, totalSteps, 40)}`);
    console.log();

    const enableMemory = features.includes('memory');
    const enableComputer = features.includes('computer');
    const enableVoice = features.includes('voice');

    // Build provider auth config
    const buildProviderEntry = () => {
      if (providerKey === 'ollama') {
        return { ollama: { baseUrl: 'http://localhost:11434', model: selectedModel } };
      }
      if (selectedAuthMethod === 'cli') {
        return {
          [providerKey]: {
            model: selectedModel,
            ...providerExtras,
          },
        };
      }
      if (authType === 'oauth_token') {
        const auth = providerAuth ?? undefined;
        if (!auth) {
          throw new Error('OAuth selected but no credentials were captured.');
        }
        return {
          [providerKey]: {
            model: selectedModel,
            auth,
            ...providerExtras,
          },
        };
      }
      return {
        [providerKey]: { apiKey, model: selectedModel, ...providerExtras },
      };
    };

    const config: VenaConfig = {
      providers: {
        default: providerKey,
        ...buildProviderEntry(),
      },
      channels: {
        telegram: {
          enabled: channels.includes('telegram'),
          ...(telegramToken ? { token: telegramToken } : {}),
        },
        whatsapp: {
          enabled: channels.includes('whatsapp'),
        },
      },
      gateway: {
        port: 18789,
        host: '127.0.0.1',
        auth: { enabled: false, apiKeys: [] },
        rateLimit: { enabled: true, windowMs: 60000, maxRequests: 120 },
        maxMessageSize: 102400,
        senderApproval: { mode: 'open' },
      },
      agents: {
        defaults: { maxConcurrent: 4 },
        registry: [{
          id: 'main',
          name: agentName,
          persona: `${trait.charAt(0).toUpperCase() + trait.slice(1)} personal assistant`,
          provider: providerKey,
          capabilities: ['general', 'coding', 'research'],
          trustLevel: 'full',
          channels,
          character: selectedCharacter,
          ...(authProfileName ? { authProfile: authProfileName } : {}),
        }],
        mesh: {
          enabled: true,
          consultationTimeout: 30000,
          maxConcurrentConsultations: 3,
        },
      },
      memory: {
        vectorSearch: enableMemory,
        embeddingProvider: 'anthropic',
        semanticMemory: {
          enabled: enableMemory,
          entityExtraction: enableMemory,
          knowledgeGraph: enableMemory,
          autoConsolidate: enableMemory,
          consolidateInterval: '24h',
        },
        sharedMemory: { enabled: enableMemory, crossAgentSearch: enableMemory },
      },
      security: {
        defaultTrustLevel: 'limited' as const,
        pathPolicy: { blockedPatterns: ['.env', '.ssh', '.aws', '.git/config'] },
        shell: {
          allowedCommands: ['git', 'npm', 'pnpm', 'node', 'npx', 'ls', 'cat', 'find', 'grep'],
          envPassthrough: ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'NODE_ENV'],
        },
        urlPolicy: { allowPrivateIPs: false },
      },
      computer: {
        shell: { enabled: enableComputer, allowedCommands: ['git', 'npm', 'pnpm', 'node', 'npx', 'ls', 'find', 'grep'] },
        browser: { enabled: enableComputer, headless: false },
        keyboard: { enabled: false },
        screenshot: { enabled: enableComputer },
        docker: { enabled: false, image: 'node:22-slim', memoryLimit: '512m', cpuLimit: '1.0', network: 'none', readOnlyRoot: true },
      },
      voice: {
        tts: { provider: 'elevenlabs', defaultVoice: 'adam', model: 'eleven_multilingual_v2' },
        stt: { provider: 'whisper', model: 'whisper-1' },
        calls: { enabled: false, provider: 'twilio' },
        autoVoiceReply: enableVoice,
      },
      skills: { dirs: [], managed: '~/.vena/skills' },
      ...(googleConfig ? { google: googleConfig } : {}),
      ...(userName ? {
        userProfile: {
          name: userName,
          language: userLanguage,
          ...(userTimezone ? { timezone: userTimezone } : {}),
        },
      } : {}),
    };

    // Create config directory (venaDir declared earlier in step 3)
    const skillsDir = path.join(venaDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    // Write config
    const configPath = path.join(venaDir, 'vena.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // ── Completion Screen ─────────────────────────────────────────────
    const featureLabels: Record<string, string> = {
      memory: 'Semantic Memory',
      computer: 'Computer Use',
      voice: 'Voice (TTS/STT)',
      google: 'Google Workspace',
    };

    await showCompletion({
      provider: providerKey,
      agentName,
      channels,
      features: features.map(f => featureLabels[f] ?? f),
    });
  });
