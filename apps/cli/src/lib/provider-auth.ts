import fs from 'node:fs';
import path from 'node:path';
import { findInPath, resolveExecutableRoot } from './oauth.js';

export const GEMINI_CLIENT_ID_KEYS = [
  'VENA_GEMINI_OAUTH_CLIENT_ID',
  'GEMINI_CLI_OAUTH_CLIENT_ID',
  'OPENCLAW_GEMINI_OAUTH_CLIENT_ID',
];
export const GEMINI_CLIENT_SECRET_KEYS = [
  'VENA_GEMINI_OAUTH_CLIENT_SECRET',
  'GEMINI_CLI_OAUTH_CLIENT_SECRET',
  'OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET',
];
export const GEMINI_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GEMINI_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GEMINI_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export const OPENAI_OAUTH_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
export const OPENAI_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const OPENAI_OAUTH_CLIENT_ID_KEYS = [
  'VENA_OPENAI_OAUTH_CLIENT_ID',
  'OPENAI_CODEX_OAUTH_CLIENT_ID',
  'OPENAI_OAUTH_CLIENT_ID',
];
export const OPENAI_OAUTH_CLIENT_SECRET_KEYS = [
  'VENA_OPENAI_OAUTH_CLIENT_SECRET',
  'OPENAI_CODEX_OAUTH_CLIENT_SECRET',
  'OPENAI_OAUTH_CLIENT_SECRET',
];
export const OPENAI_DEFAULT_SCOPES = ['openid', 'profile', 'email', 'offline_access'];
export const OPENAI_DEFAULT_REDIRECT = 'http://127.0.0.1:1455/auth/callback';

export type OAuthClientInfo = { clientId: string; clientSecret?: string };

let cachedGeminiClient: OAuthClientInfo | null = null;

export function resolveEnvValue(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function findFile(dir: string, name: string, depth: number): string | null {
  if (depth <= 0) return null;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === name) return p;
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const found = findFile(p, name, depth - 1);
        if (found) return found;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function extractGeminiCliCredentials(): OAuthClientInfo | null {
  if (cachedGeminiClient) return cachedGeminiClient;

  try {
    const geminiPath = findInPath('gemini');
    if (!geminiPath) return null;
    const root = resolveExecutableRoot(geminiPath);
    if (!root) return null;

    const searchPaths = [
      path.join(
        root,
        'node_modules',
        '@google',
        'gemini-cli-core',
        'dist',
        'src',
        'code_assist',
        'oauth2.js',
      ),
      path.join(
        root,
        'node_modules',
        '@google',
        'gemini-cli-core',
        'dist',
        'code_assist',
        'oauth2.js',
      ),
    ];

    let content: string | null = null;
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        content = fs.readFileSync(p, 'utf8');
        break;
      }
    }

    if (!content) {
      const found = findFile(root, 'oauth2.js', 10);
      if (found) {
        content = fs.readFileSync(found, 'utf8');
      }
    }

    if (!content) return null;

    const idMatch = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/);
    const secretMatch = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
    const clientId = idMatch?.[1];
    if (clientId) {
      cachedGeminiClient = { clientId, clientSecret: secretMatch?.[1] };
      return cachedGeminiClient;
    }
  } catch {
    // ignore
  }
  return null;
}

function extractOpenAiClientIdFromContent(content: string): string | null {
  const urlMatch = content.match(/https:\/\/auth\.openai\.com\/oauth\/authorize[^"'\s]+/);
  if (urlMatch) {
    try {
      const url = new URL(urlMatch[0]);
      const id = url.searchParams.get('client_id');
      if (id) return id;
    } catch {
      // ignore
    }
  }

  const inlineMatch = content.match(/client_id["']?\s*[:=]\s*["']([^"']+)["']/);
  const inlineId = inlineMatch?.[1];
  if (inlineId) return inlineId;

  const oaicpMatch = content.match(/\boaicp-[A-Za-z0-9_-]+\b/);
  if (oaicpMatch) return oaicpMatch[0];

  return null;
}

function findFileContaining(
  dir: string,
  pattern: RegExp,
  depth: number,
  maxFiles: number,
  scanned: { count: number },
): string | null {
  if (depth <= 0 || scanned.count >= maxFiles) return null;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (scanned.count >= maxFiles) break;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const found = findFileContaining(p, pattern, depth - 1, maxFiles, scanned);
        if (found) return found;
      } else if (entry.isFile() && /\.(mjs|cjs|js)$/.test(entry.name)) {
        scanned.count += 1;
        try {
          const content = fs.readFileSync(p, 'utf8');
          if (pattern.test(content)) return p;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function extractOpenAiCodexClient(): OAuthClientInfo | null {
  try {
    const codexPath = findInPath('codex');
    if (!codexPath) return null;
    const root = resolveExecutableRoot(codexPath);
    if (!root) return null;

    const scanned = { count: 0 };
    const found = findFileContaining(root, /auth\.openai\.com\/oauth\/authorize/, 8, 1500, scanned);
    if (!found) return null;
    const content = fs.readFileSync(found, 'utf8');
    const clientId = extractOpenAiClientIdFromContent(content);
    if (!clientId) return null;
    return { clientId };
  } catch {
    return null;
  }
}
