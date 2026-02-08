import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GoogleAuth } from '@vena/integrations';
import {
  canUseLocalCallback,
  extractOAuthCode,
  extractOAuthCodeAndState,
  generatePkce,
  openBrowser,
  shouldUseManualOAuthFlow,
  waitForOAuthCallback,
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

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type GoogleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUris?: string[];
};

function loadGoogleOAuthCredentials(filePath: string): GoogleOAuthCredentials | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw) as Record<string, unknown>;
    const source = (json['installed'] ?? json['web'] ?? json) as Record<string, unknown>;
    const clientId = normalizeString(source['client_id'] ?? source['clientId']);
    const clientSecret = normalizeString(source['client_secret'] ?? source['clientSecret']);
    if (!clientId || !clientSecret) return null;
    const redirectUris = Array.isArray(source['redirect_uris'])
      ? source['redirect_uris'].filter((uri): uri is string => typeof uri === 'string' && uri.length > 0)
      : undefined;
    return { clientId, clientSecret, redirectUris };
  } catch {
    return null;
  }
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

configCommand
  .command('google-auth')
  .description('Authorize Google Workspace access via OAuth')
  .option('--redirect <url>', 'Override OAuth redirect URI')
  .option('--scopes <list>', 'Comma-separated scopes or scope keys (gmail, docs, sheets, calendar, drive)')
  .option('--client-id <id>', 'OAuth client ID (skips prompt)')
  .option('--client-secret <secret>', 'OAuth client secret (skips prompt)')
  .option('--credentials <path>', 'Path to OAuth client JSON from Google Cloud Console')
  .option('--code <value>', 'Authorization code or full redirect URL (skips prompt)')
  .action(async (opts: {
    redirect?: string;
    scopes?: string;
    clientId?: string;
    clientSecret?: string;
    credentials?: string;
    code?: string;
  }) => {
    const config = loadRawConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    const googleConfig = (config['google'] as Record<string, unknown> | undefined) ?? {};
    let clientId = normalizeString(opts.clientId) ?? normalizeString(googleConfig['clientId']);
    let clientSecret = normalizeString(opts.clientSecret) ?? normalizeString(googleConfig['clientSecret']);
    let redirectUri = normalizeString(opts.redirect);

    if (opts.credentials) {
      const creds = loadGoogleOAuthCredentials(opts.credentials);
      if (!creds) {
        console.log(chalk.red('\n  Invalid OAuth credentials JSON. Expected a file with client_id and client_secret.\n'));
        return;
      }
      clientId = creds.clientId;
      clientSecret = creds.clientSecret;
      if (!redirectUri && creds.redirectUris && creds.redirectUris.length > 0) {
        redirectUri = creds.redirectUris[0];
      }
    }

    if (!clientId || !clientSecret) {
      console.log();
      console.log(chalk.bold('  Google OAuth setup'));
      console.log(chalk.dim('  Enter your Google OAuth client ID and secret.'));
      console.log(chalk.dim('  You can also pass --credentials /path/to/client.json'));
      const defaultRedirect = redirectUri ?? 'http://localhost:3000/oauth2callback';
      console.log(chalk.dim(`  Redirect URI must include: ${defaultRedirect}`));
      console.log();

      const creds = await prompts([
        {
          type: 'text',
          name: 'clientId',
          message: 'Client ID',
          initial: clientId,
          validate: (value: string) => (normalizeString(value) ? true : 'Required'),
        },
        {
          type: 'password',
          name: 'clientSecret',
          message: 'Client Secret',
          initial: clientSecret,
          validate: (value: string) => (normalizeString(value) ? true : 'Required'),
        },
      ], {
        onCancel: () => {
          console.log();
          console.log(chalk.yellow('  Cancelled.'));
          process.exit(0);
        },
      });

      clientId = normalizeString(creds.clientId) ?? clientId;
      clientSecret = normalizeString(creds.clientSecret) ?? clientSecret;

      if (!clientId || !clientSecret) {
        console.log(chalk.red('\n  Client ID and secret are required.\n'));
        return;
      }

      googleConfig['clientId'] = clientId;
      googleConfig['clientSecret'] = clientSecret;
      config['google'] = googleConfig;
      saveConfig(config);
      console.log(chalk.green('\n  \u2713 Saved Google OAuth credentials to config\n'));
    } else {
      const existingId = normalizeString(googleConfig['clientId']);
      const existingSecret = normalizeString(googleConfig['clientSecret']);
      if (clientId !== existingId || clientSecret !== existingSecret) {
        googleConfig['clientId'] = clientId;
        googleConfig['clientSecret'] = clientSecret;
        config['google'] = googleConfig;
        saveConfig(config);
        console.log(chalk.green('\n  \u2713 Saved Google OAuth credentials to config\n'));
      }
    }

    const scopeInput = opts.scopes
      ? opts.scopes.split(',').map((s) => s.trim()).filter(Boolean)
      : (googleConfig['scopes'] as string[] | undefined);

    if (scopeInput && scopeInput.length > 0) {
      googleConfig['scopes'] = scopeInput;
      config['google'] = googleConfig;
      saveConfig(config);
    } else if (!googleConfig['scopes']) {
      googleConfig['scopes'] = [...DEFAULT_GOOGLE_SCOPE_KEYS];
      config['google'] = googleConfig;
      saveConfig(config);
    }

    const { scopeKeys, oauthScopes } = normalizeGoogleScopes(googleConfig['scopes'] as string[] | undefined);

    const effectiveRedirectUri = redirectUri ?? 'http://localhost:3000/oauth2callback';
    const auth = new GoogleAuth({
      clientId,
      clientSecret,
      redirectUri: effectiveRedirectUri,
    });

    const authUrl = auth.getAuthUrl(oauthScopes);

    console.log(chalk.bold('  Google OAuth Authorization'));
    console.log(chalk.dim(`  Scopes: ${scopeKeys.join(', ')}`));
    console.log();

    let rawInput = normalizeString(opts.code) ?? '';
    const manualFlow = shouldUseManualOAuthFlow() || !canUseLocalCallback(effectiveRedirectUri);

    if (!rawInput && !manualFlow) {
      console.log(chalk.dim('  Opening your browser to authorize...'));
      try {
        await openBrowser(authUrl);
      } catch {
        console.log(chalk.dim('  Unable to open browser automatically.'));
        console.log(chalk.dim('  Open this URL in your browser to authorize:'));
        console.log(`  ${authUrl}`);
      }

      try {
        const callback = await waitForOAuthCallback({
          redirectUri: effectiveRedirectUri,
          timeoutMs: 5 * 60 * 1000,
        });
        rawInput = callback.code;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow(`\n  OAuth callback failed: ${message}\n`));
      }
    }

    if (!rawInput) {
      console.log(chalk.dim('  Open this URL in your browser to authorize:'));
      console.log(`  ${authUrl}`);
      console.log();
      console.log(chalk.dim('  Tip: You can paste the full redirect URL here; Vena will extract the code.'));
      console.log();

      const codeResponse = await prompts({
        type: 'text',
        name: 'code',
        message: 'Authorization Code or Redirect URL',
      }, {
        onCancel: () => {
          console.log();
          console.log(chalk.yellow('  Cancelled.'));
          process.exit(0);
        },
      });
      rawInput = normalizeString(codeResponse.code) ?? '';
    }

    const code = extractOAuthCode(rawInput);
    if (!code) {
      console.log(chalk.yellow('\n  No authorization code provided.\n'));
      return;
    }

    await auth.exchangeCode(code);

    const tokenPath = path.join(os.homedir(), '.vena', 'google-tokens.json');
    console.log(chalk.green(`\n  \u2713 Tokens saved to ${tokenPath}\n`));
  });

configCommand
  .command('gemini-auth')
  .description('Authorize Gemini via OAuth (Vertex AI / Google Cloud)')
  .option('--redirect <url>', 'Override OAuth redirect URI')
  .option('--client-id <id>', 'OAuth client ID (optional)')
  .option('--client-secret <secret>', 'OAuth client secret (optional)')
  .option('--project <id>', 'Google Cloud project ID (Vertex AI)')
  .option('--location <region>', 'Google Cloud location (Vertex AI)')
  .option('--code <value>', 'Authorization code or full redirect URL (skips prompt)')
  .option('--manual', 'Force manual copy/paste flow (no local callback)')
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (opts: {
    redirect?: string;
    clientId?: string;
    clientSecret?: string;
    project?: string;
    location?: string;
    code?: string;
    manual?: boolean;
    open?: boolean;
  }) => {
    const config = loadRawConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    let clientId = normalizeString(opts.clientId) ?? resolveEnvValue(GEMINI_CLIENT_ID_KEYS);
    let clientSecret = normalizeString(opts.clientSecret) ?? resolveEnvValue(GEMINI_CLIENT_SECRET_KEYS);

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
          console.log(chalk.yellow('  Cancelled.'));
          process.exit(0);
        },
      });

      clientId = normalizeString(creds.clientId) ?? clientId;
      clientSecret = normalizeString(creds.clientSecret) ?? clientSecret;
      if (!clientId) {
        console.log(chalk.red('\n  Client ID is required.\n'));
        return;
      }
    }

    const redirectUri = normalizeString(opts.redirect) ?? 'http://localhost:8085/oauth2callback';
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

    let rawInput = normalizeString(opts.code) ?? '';
    const manualFlow = Boolean(opts.manual) || shouldUseManualOAuthFlow() || !canUseLocalCallback(redirectUri);

    if (!rawInput && !manualFlow) {
      console.log(chalk.dim('  Opening your browser to authorize...'));
      if (opts.open !== false) {
        try {
          await openBrowser(authUrl);
        } catch {
          console.log(chalk.dim('  Unable to open browser automatically.'));
        }
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
      console.log(chalk.dim('  Open this URL in your browser to authorize:'));
      console.log(`  ${authUrl}`);
      console.log();
      console.log(chalk.dim('  Paste the full redirect URL (or just the code).'));
      console.log();

      const codeResponse = await prompts({
        type: 'text',
        name: 'code',
        message: 'Authorization Code or Redirect URL',
      }, {
        onCancel: () => {
          console.log();
          console.log(chalk.yellow('  Cancelled.'));
          process.exit(0);
        },
      });
      rawInput = normalizeString(codeResponse.code) ?? '';
    }

    const parsed = extractOAuthCodeAndState(rawInput, state);
    if ('error' in parsed) {
      console.log(chalk.red(`\n  ${parsed.error}\n`));
      return;
    }
    if (parsed.state !== state) {
      console.log(chalk.red('\n  OAuth state mismatch. Please try again.\n'));
      return;
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
      return;
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!tokenData.refresh_token) {
      console.log(chalk.red('\n  No refresh token received. Try again and ensure consent is granted.\n'));
      return;
    }

    const expiresAt = tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000
      : undefined;

    const providers = (config['providers'] as Record<string, unknown> | undefined) ?? {};
    const geminiConfig = (providers['gemini'] as Record<string, unknown> | undefined) ?? {};

    const project =
      normalizeString(opts.project) ??
      normalizeString(geminiConfig['project']) ??
      normalizeString(process.env['GOOGLE_CLOUD_PROJECT']) ??
      normalizeString(process.env['GOOGLE_CLOUD_PROJECT_ID']);

    let location =
      normalizeString(opts.location) ??
      normalizeString(geminiConfig['location']) ??
      normalizeString(process.env['GOOGLE_CLOUD_REGION']) ??
      normalizeString(process.env['GOOGLE_CLOUD_LOCATION']);

    if (!location) {
      const locationResponse = await prompts({
        type: 'text',
        name: 'location',
        message: 'Vertex AI location (e.g. us-central1)',
        initial: 'us-central1',
      }, {
        onCancel: () => {
          console.log();
          console.log(chalk.yellow('  Cancelled.'));
          process.exit(0);
        },
      });
      location = normalizeString(locationResponse.location);
    }

    const hasVertexConfig = Boolean(project && location);
    geminiConfig['auth'] = {
      type: 'oauth_token',
      oauthToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenUrl: GEMINI_OAUTH_TOKEN_URL,
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
    geminiConfig['vertexai'] = hasVertexConfig;
    if (project) geminiConfig['project'] = project;
    if (location) geminiConfig['location'] = location;
    if (!geminiConfig['model']) {
      geminiConfig['model'] = 'gemini-2.0-flash';
    }

    providers['gemini'] = geminiConfig;
    config['providers'] = providers;
    saveConfig(config);

    console.log(chalk.green('\n  \u2713 Gemini OAuth tokens saved to config\n'));
    if (!hasVertexConfig) {
      console.log(chalk.yellow('  Missing project/location. Set providers.gemini.project and providers.gemini.location for Vertex AI.\n'));
    }
  });

configCommand
  .command('openai-codex-auth')
  .description('Authorize OpenAI Codex via OAuth (ChatGPT sign-in)')
  .option('--redirect <url>', 'Override OAuth redirect URI')
  .option('--client-id <id>', 'OAuth client ID (optional)')
  .option('--client-secret <secret>', 'OAuth client secret (optional)')
  .option('--scopes <list>', 'Comma-separated OAuth scopes')
  .option('--audience <value>', 'Optional OAuth audience')
  .option('--code <value>', 'Authorization code or full redirect URL (skips prompt)')
  .option('--manual', 'Force manual copy/paste flow (no local callback)')
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (opts: {
    redirect?: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string;
    audience?: string;
    code?: string;
    manual?: boolean;
    open?: boolean;
  }) => {
    const config = loadRawConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    let clientId = normalizeString(opts.clientId) ?? resolveEnvValue(OPENAI_OAUTH_CLIENT_ID_KEYS);
    let clientSecret = normalizeString(opts.clientSecret) ?? resolveEnvValue(OPENAI_OAUTH_CLIENT_SECRET_KEYS);

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
          console.log(chalk.yellow('  Cancelled.'));
          process.exit(0);
        },
      });

      clientId = normalizeString(creds.clientId) ?? clientId;
      clientSecret = normalizeString(creds.clientSecret) ?? clientSecret;
      if (!clientId) {
        console.log(chalk.red('\n  Client ID is required.\n'));
        return;
      }
    }

    const redirectUri = normalizeString(opts.redirect) ?? OPENAI_DEFAULT_REDIRECT;
    const scopes = opts.scopes
      ? opts.scopes.split(',').map((s) => s.trim()).filter(Boolean)
      : OPENAI_DEFAULT_SCOPES;
    const audience = normalizeString(opts.audience);

    const { verifier, challenge } = generatePkce();
    const state = verifier;

    const authParams = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    if (audience) {
      authParams.set('audience', audience);
    }
    const authUrl = `${OPENAI_OAUTH_AUTH_URL}?${authParams.toString()}`;

    let rawInput = normalizeString(opts.code) ?? '';
    const manualFlow = Boolean(opts.manual) || shouldUseManualOAuthFlow() || !canUseLocalCallback(redirectUri);

    if (!rawInput && !manualFlow) {
      console.log(chalk.dim('  Opening your browser to authorize...'));
      if (opts.open !== false) {
        try {
          await openBrowser(authUrl);
        } catch {
          console.log(chalk.dim('  Unable to open browser automatically.'));
        }
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
      console.log(chalk.dim('  Open this URL in your browser to authorize:'));
      console.log(`  ${authUrl}`);
      console.log();
      console.log(chalk.dim('  Paste the full redirect URL (or just the code).'));
      console.log();

      const codeResponse = await prompts({
        type: 'text',
        name: 'code',
        message: 'Authorization Code or Redirect URL',
      }, {
        onCancel: () => {
          console.log();
          console.log(chalk.yellow('  Cancelled.'));
          process.exit(0);
        },
      });
      rawInput = normalizeString(codeResponse.code) ?? '';
    }

    const parsed = extractOAuthCodeAndState(rawInput, state);
    if ('error' in parsed) {
      console.log(chalk.red(`\n  ${parsed.error}\n`));
      return;
    }
    if (parsed.state !== state) {
      console.log(chalk.red('\n  OAuth state mismatch. Please try again.\n'));
      return;
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
      return;
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!tokenData.access_token) {
      console.log(chalk.red('\n  No access token received.\n'));
      return;
    }

    const expiresAt = tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000
      : undefined;

    const providers = (config['providers'] as Record<string, unknown> | undefined) ?? {};
    const openaiConfig = (providers['openai'] as Record<string, unknown> | undefined) ?? {};

    openaiConfig['auth'] = {
      type: 'oauth_token',
      oauthToken: tokenData.access_token,
      ...(tokenData.refresh_token ? { refreshToken: tokenData.refresh_token } : {}),
      tokenUrl: OPENAI_OAUTH_TOKEN_URL,
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
    if (!openaiConfig['model']) {
      openaiConfig['model'] = 'gpt-4o';
    }

    providers['openai'] = openaiConfig;
    config['providers'] = providers;
    saveConfig(config);

    console.log(chalk.green('\n  \u2713 OpenAI Codex OAuth tokens saved to config\n'));
  });

configCommand
  .command('claude-setup-token')
  .description('Store a Claude Code setup-token for Anthropic')
  .option('--token <value>', 'Setup-token value (skips prompt)')
  .action(async (opts: { token?: string }) => {
    const config = loadRawConfig();
    if (!config) {
      console.log(chalk.yellow('\n  No configuration found. Run'), chalk.bold('vena onboard'), chalk.yellow('first.\n'));
      return;
    }

    let token = normalizeString(opts.token) ?? '';
    if (!token) {
      console.log();
      console.log(chalk.bold('  Claude Code setup-token'));
      console.log(chalk.dim('  Run `claude setup-token` in another terminal, then paste it here.'));
      console.log();

      const tokenResponse = await prompts({
        type: 'password',
        name: 'token',
        message: 'Paste setup-token',
      }, {
        onCancel: () => {
          console.log();
          console.log(chalk.yellow('  Cancelled.'));
          process.exit(0);
        },
      });
      token = normalizeString(tokenResponse.token) ?? '';
    }

    if (!token) {
      console.log(chalk.red('\n  Setup-token is required.\n'));
      return;
    }

    const providers = (config['providers'] as Record<string, unknown> | undefined) ?? {};
    const anthropicConfig = (providers['anthropic'] as Record<string, unknown> | undefined) ?? {};
    anthropicConfig['auth'] = {
      type: 'oauth_token',
      oauthToken: token,
    };
    if (!anthropicConfig['model']) {
      anthropicConfig['model'] = 'claude-sonnet-4-5-20250929';
    }
    providers['anthropic'] = anthropicConfig;
    config['providers'] = providers;
    saveConfig(config);

    console.log(chalk.green('\n  \u2713 Claude setup-token saved to config\n'));
    console.log(chalk.yellow('  Note: If Anthropic API calls fail, use a standard API key instead.\n'));
  });
