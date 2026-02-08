import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseConfig,
  resolveConfigEnvVars,
} from '@vena/shared';
import type { VenaConfig } from '@vena/shared';
import type { LLMProvider } from '@vena/providers';
import {
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  GeminiCliProvider,
  OllamaProvider,
} from '@vena/providers';

// ── Paths ────────────────────────────────────────────────────────────

export const CONFIG_PATH = path.join(os.homedir(), '.vena', 'vena.json');
export const DATA_DIR = path.join(os.homedir(), '.vena', 'data');
export const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
export const WHATSAPP_AUTH_DIR = path.join(os.homedir(), '.vena', 'whatsapp-auth');

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

// ── Provider Factory ─────────────────────────────────────────────────

export function createProvider(
  config: VenaConfig,
  overrideProvider?: string,
  overrideModel?: string,
): { provider: LLMProvider; model: string; providerName: string } {
  const providerName = overrideProvider ?? config.providers.default;

  switch (providerName) {
    case 'anthropic': {
      const cfg = config.providers.anthropic;
      if (!cfg?.apiKey && !cfg?.auth) {
        throw new Error('Anthropic not configured. Set providers.anthropic.apiKey or auth in ~/.vena/vena.json');
      }
      const model = overrideModel ?? cfg?.model ?? 'claude-sonnet-4-5-20250929';
      return {
        provider: new AnthropicProvider({
          apiKey: cfg?.apiKey,
          model,
          baseUrl: cfg?.baseUrl,
          auth: cfg?.auth as any,
        }),
        model,
        providerName,
      };
    }

    case 'openai': {
      const cfg = config.providers.openai;
      if (!cfg?.apiKey && !cfg?.auth) {
        throw new Error('OpenAI not configured. Set providers.openai.apiKey or auth in ~/.vena/vena.json');
      }
      const model = overrideModel ?? cfg?.model ?? 'gpt-4o';
      return {
        provider: new OpenAIProvider({
          apiKey: cfg?.apiKey,
          model,
          baseUrl: cfg?.baseUrl,
          auth: cfg?.auth as any,
        }),
        model,
        providerName,
      };
    }

    case 'gemini': {
      const cfg = config.providers.gemini;
      if (cfg?.transport === 'cli') {
        const model = overrideModel ?? cfg?.model ?? 'gemini-3-flash-preview';
        return {
          provider: new GeminiCliProvider({ model }),
          model,
          providerName,
        };
      }
      if (!cfg?.apiKey && !cfg?.auth) {
        throw new Error('Gemini not configured. Set providers.gemini.apiKey or auth in ~/.vena/vena.json');
      }
      const model = overrideModel ?? cfg?.model ?? 'gemini-2.0-flash';
      return {
        provider: new GeminiProvider({
          apiKey: cfg?.apiKey,
          model,
          auth: cfg?.auth as any,
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
      const model = overrideModel ?? cfg?.model ?? 'llama3';
      return {
        provider: new OllamaProvider({
          baseUrl: cfg?.baseUrl,
          model,
        }),
        model,
        providerName,
      };
    }

    default:
      throw new Error(`Unknown provider "${providerName}". Supported: anthropic, openai, gemini, ollama`);
  }
}
