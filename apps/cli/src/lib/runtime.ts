import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseConfig,
  resolveConfigEnvVars,
  loadAuthProfileStore,
  getAuthProfile,
} from '@vena/shared';
import type { VenaConfig, AgentConfig } from '@vena/shared';
import type { LLMProvider } from '@vena/providers';
import {
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  GeminiCliProvider,
  OllamaProvider,
  GroqProvider,
  OpenRouterProvider,
} from '@vena/providers';

// ── Paths ────────────────────────────────────────────────────────────

export const VENA_DIR = path.join(os.homedir(), '.vena');
export const CONFIG_PATH = path.join(VENA_DIR, 'vena.json');
export const DATA_DIR = path.join(VENA_DIR, 'data');
export const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
export const WHATSAPP_AUTH_DIR = path.join(VENA_DIR, 'whatsapp-auth');

// ── Config ───────────────────────────────────────────────────────────

export function loadConfig(): VenaConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `No config found at ${CONFIG_PATH}. Run "vena onboard" first.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
  const resolved = resolveConfigEnvVars(raw);
  return parseConfig(resolved);
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Auth Profile Resolution ─────────────────────────────────────────

function resolveAuthFromProfile(
  profileName: string,
): { apiKey?: string; auth?: Record<string, unknown>; extras?: Record<string, unknown> } | null {
  const store = loadAuthProfileStore(VENA_DIR);
  const profile = getAuthProfile(store, profileName);
  if (!profile) return null;

  switch (profile.type) {
    case 'api_key':
      return { apiKey: profile.key };

    case 'oauth':
      return {
        auth: {
          type: 'oauth_token',
          oauthToken: profile.accessToken,
          refreshToken: profile.refreshToken,
          tokenUrl: profile.tokenUrl,
          clientId: profile.clientId,
          clientSecret: profile.clientSecret,
          expiresAt: profile.expiresAt,
        },
      };

    case 'token':
      if (profile.token === '__cli__') {
        return { extras: { transport: 'cli' } };
      }
      if (profile.token === '__local__') {
        return {};
      }
      return { auth: { type: 'bearer_token', oauthToken: profile.token } };

    default:
      return null;
  }
}

// ── Provider Factory ─────────────────────────────────────────────────

export function createProvider(
  config: VenaConfig,
  overrideProvider?: string,
  overrideModel?: string,
  agentConfig?: AgentConfig,
): { provider: LLMProvider; model: string; providerName: string } {
  const providerName = overrideProvider ?? agentConfig?.provider ?? config.providers.default;

  // Resolve auth from profile store if agent has an authProfile
  let profileAuth: ReturnType<typeof resolveAuthFromProfile> = null;
  if (agentConfig?.authProfile) {
    profileAuth = resolveAuthFromProfile(agentConfig.authProfile);
  }

  switch (providerName) {
    case 'anthropic': {
      const cfg = config.providers.anthropic;
      const apiKey = profileAuth?.apiKey ?? cfg?.apiKey;
      const auth = profileAuth?.auth ?? cfg?.auth;
      if (!apiKey && !auth) {
        throw new Error('Anthropic not configured. Set providers.anthropic.apiKey or auth in ~/.vena/vena.json');
      }
      const model = overrideModel ?? agentConfig?.model ?? cfg?.model ?? 'claude-sonnet-4-5-20250929';
      return {
        provider: new AnthropicProvider({
          apiKey,
          model,
          baseUrl: cfg?.baseUrl,
          auth: auth as any,
        }),
        model,
        providerName,
      };
    }

    case 'openai': {
      const cfg = config.providers.openai;
      const apiKey = profileAuth?.apiKey ?? cfg?.apiKey;
      const auth = profileAuth?.auth ?? cfg?.auth;
      if (!apiKey && !auth) {
        throw new Error('OpenAI not configured. Set providers.openai.apiKey or auth in ~/.vena/vena.json');
      }
      const model = overrideModel ?? agentConfig?.model ?? cfg?.model ?? 'gpt-4o';
      return {
        provider: new OpenAIProvider({
          apiKey,
          model,
          baseUrl: cfg?.baseUrl,
          auth: auth as any,
        }),
        model,
        providerName,
      };
    }

    case 'gemini': {
      const cfg = config.providers.gemini;
      const isCli = profileAuth?.extras?.transport === 'cli' || cfg?.transport === 'cli';
      if (isCli) {
        const model = overrideModel ?? agentConfig?.model ?? cfg?.model ?? 'gemini-3-flash-preview';
        return {
          provider: new GeminiCliProvider({ model }),
          model,
          providerName,
        };
      }
      const apiKey = profileAuth?.apiKey ?? cfg?.apiKey;
      const auth = profileAuth?.auth ?? cfg?.auth;
      if (!apiKey && !auth) {
        throw new Error('Gemini not configured. Set providers.gemini.apiKey or auth in ~/.vena/vena.json');
      }
      const model = overrideModel ?? agentConfig?.model ?? cfg?.model ?? 'gemini-2.0-flash';
      return {
        provider: new GeminiProvider({
          apiKey,
          model,
          auth: auth as any,
          vertexai: cfg?.vertexai,
          project: cfg?.project,
          location: cfg?.location,
          apiVersion: cfg?.apiVersion,
        }),
        model,
        providerName,
      };
    }

    case 'ollama': {
      const cfg = config.providers.ollama;
      const model = overrideModel ?? agentConfig?.model ?? cfg?.model ?? 'llama3';
      return {
        provider: new OllamaProvider({
          baseUrl: cfg?.baseUrl,
          model,
        }),
        model,
        providerName,
      };
    }

    case 'groq': {
      const cfg = config.providers.groq;
      const apiKey = profileAuth?.apiKey ?? cfg?.apiKey;
      if (!apiKey) {
        throw new Error('Groq not configured. Set providers.groq.apiKey in ~/.vena/vena.json');
      }
      const model = overrideModel ?? agentConfig?.model ?? cfg?.model ?? 'llama-3.3-70b-versatile';
      return {
        provider: new GroqProvider({ apiKey, model }),
        model,
        providerName,
      };
    }

    case 'openrouter': {
      const cfg = config.providers.openrouter;
      const apiKey = profileAuth?.apiKey ?? cfg?.apiKey;
      if (!apiKey) {
        throw new Error('OpenRouter not configured. Set providers.openrouter.apiKey in ~/.vena/vena.json');
      }
      const model = overrideModel ?? agentConfig?.model ?? cfg?.model ?? 'anthropic/claude-sonnet-4';
      return {
        provider: new OpenRouterProvider({ apiKey, model }),
        model,
        providerName,
      };
    }

    default:
      throw new Error(`Unknown provider "${providerName}". Supported: anthropic, openai, gemini, ollama, groq, openrouter`);
  }
}
