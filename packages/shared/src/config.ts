import { z } from 'zod';

const authConfigSchema = z.object({
  type: z.enum(['api_key', 'oauth_token', 'bearer_token']).default('api_key'),
  apiKey: z.string().optional(),
  oauthToken: z.string().optional(),
  refreshToken: z.string().optional(),
  tokenUrl: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  expiresAt: z.number().optional(),
}).refine(
  (data) => data.apiKey || data.oauthToken,
  { message: 'Either apiKey or oauthToken must be provided' }
);

const providerConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string(),
  baseUrl: z.string().optional(),
  auth: authConfigSchema.optional(),
});

const geminiConfigSchema = providerConfigSchema.extend({
  transport: z.enum(['api', 'cli']).optional(),
  vertexai: z.boolean().optional(),
  project: z.string().optional(),
  location: z.string().optional(),
  apiVersion: z.string().optional(),
});

const agentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  persona: z.string().default('Helpful personal assistant'),
  provider: z.string().default('anthropic'),
  model: z.string().optional(),
  capabilities: z.array(z.string()).default(['general']),
  trustLevel: z.enum(['full', 'limited', 'readonly']).default('full'),
  channels: z.array(z.string()).default([]),
  voiceId: z.string().optional(),
  character: z.string().default('nova'),
  authProfile: z.string().optional(),
});

export const venaConfigSchema = z.object({
  providers: z.object({
    default: z.string().default('anthropic'),
    anthropic: providerConfigSchema.optional(),
    openai: providerConfigSchema.optional(),
    gemini: geminiConfigSchema.optional(),
    ollama: z.object({
      baseUrl: z.string().default('http://localhost:11434'),
      model: z.string().default('llama3'),
    }).optional(),
    groq: providerConfigSchema.optional(),
    openrouter: providerConfigSchema.optional(),
  }),

  channels: z.object({
    telegram: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
    }).optional(),
    whatsapp: z.object({
      enabled: z.boolean().default(false),
    }).optional(),
    slack: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
      signingSecret: z.string().optional(),
      appToken: z.string().optional(),
    }).optional(),
    discord: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
      applicationId: z.string().optional(),
    }).optional(),
  }).default({}),

  gateway: z.object({
    port: z.number().default(18789),
    host: z.string().default('127.0.0.1'),
    auth: z.object({
      enabled: z.boolean().default(false),
      apiKeys: z.array(z.string()).default([]),
    }).default({}),
    rateLimit: z.object({
      enabled: z.boolean().default(true),
      windowMs: z.number().default(60000),
      maxRequests: z.number().default(120),
    }).default({}),
    maxMessageSize: z.number().default(102400),
  }).default({}),

  agents: z.object({
    defaults: z.object({
      maxConcurrent: z.number().default(4),
    }).default({}),
    registry: z.array(agentConfigSchema).default([{
      id: 'main',
      name: 'Vena',
      persona: 'Helpful personal assistant',
      provider: 'anthropic',
      capabilities: ['general', 'coding', 'research'],
      trustLevel: 'full',
      character: 'nova',
    }]),
    mesh: z.object({
      enabled: z.boolean().default(true),
      consultationTimeout: z.number().default(30000),
      maxConcurrentConsultations: z.number().default(3),
    }).default({}),
  }).default({}),

  memory: z.object({
    vectorSearch: z.boolean().default(true),
    embeddingProvider: z.string().default('anthropic'),
    semanticMemory: z.object({
      enabled: z.boolean().default(true),
      entityExtraction: z.boolean().default(true),
      knowledgeGraph: z.boolean().default(true),
      autoConsolidate: z.boolean().default(true),
      consolidateInterval: z.string().default('24h'),
    }).default({}),
    sharedMemory: z.object({
      enabled: z.boolean().default(true),
      crossAgentSearch: z.boolean().default(true),
    }).default({}),
  }).default({}),

  security: z.object({
    defaultTrustLevel: z.enum(['full', 'limited', 'readonly']).default('limited'),
    pathPolicy: z.object({
      blockedPatterns: z.array(z.string()).default(['.env', '.ssh', '.aws', '.git/config']),
    }).default({}),
    shell: z.object({
      allowedCommands: z.array(z.string()).default(['git', 'npm', 'pnpm', 'node', 'npx', 'ls', 'cat', 'find', 'grep']),
      envPassthrough: z.array(z.string()).default(['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'NODE_ENV']),
    }).default({}),
    urlPolicy: z.object({
      allowPrivateIPs: z.boolean().default(false),
    }).default({}),
  }).default({}),

  computer: z.object({
    shell: z.object({
      enabled: z.boolean().default(true),
      allowedCommands: z.array(z.string()).default(['git', 'npm', 'pnpm', 'node', 'npx', 'ls', 'find', 'grep']),
    }).default({}),
    browser: z.object({
      enabled: z.boolean().default(true),
      headless: z.boolean().default(false),
    }).default({}),
    keyboard: z.object({
      enabled: z.boolean().default(false),
    }).default({}),
    screenshot: z.object({
      enabled: z.boolean().default(true),
    }).default({}),
    docker: z.object({
      enabled: z.boolean().default(false),
      image: z.string().default('node:22-slim'),
      memoryLimit: z.string().default('512m'),
      cpuLimit: z.string().default('1.0'),
      network: z.enum(['none', 'host', 'bridge']).default('none'),
      readOnlyRoot: z.boolean().default(true),
    }).default({}),
  }).default({}),

  voice: z.object({
    tts: z.object({
      provider: z.enum(['elevenlabs', 'openai-tts']).default('elevenlabs'),
      apiKey: z.string().optional(),
      defaultVoice: z.string().default('adam'),
      model: z.string().default('eleven_multilingual_v2'),
    }).default({}),
    stt: z.object({
      provider: z.enum(['whisper', 'deepgram']).default('whisper'),
      model: z.string().default('whisper-1'),
      apiKey: z.string().optional(),
    }).default({}),
    calls: z.object({
      enabled: z.boolean().default(false),
      provider: z.enum(['twilio', 'vapi']).default('twilio'),
      accountSid: z.string().optional(),
      authToken: z.string().optional(),
      phoneNumber: z.string().optional(),
    }).default({}),
    autoVoiceReply: z.boolean().default(true),
  }).default({}),

  google: z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    scopes: z.array(z.string()).default(['gmail', 'docs', 'sheets', 'calendar', 'drive']),
  }).optional(),

  skills: z.object({
    dirs: z.array(z.string()).default([]),
    managed: z.string().default('~/.vena/skills'),
  }).default({}),

  userProfile: z.object({
    name: z.string(),
    preferredName: z.string().optional(),
    language: z.string().default('en'),
    timezone: z.string().optional(),
    notes: z.string().optional(),
  }).optional(),
});

export type VenaConfig = z.infer<typeof venaConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AuthConfig = z.infer<typeof authConfigSchema>;

export function parseConfig(raw: unknown): VenaConfig {
  return venaConfigSchema.parse(raw);
}

export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '');
}

export function resolveConfigEnvVars(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      result[key] = resolveEnvVars(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = resolveConfigEnvVars(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
