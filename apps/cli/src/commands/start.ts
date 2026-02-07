import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import type { VenaConfig, InboundMessage, Message, Session, OutboundMessage, MediaAttachment } from '@vena/shared';
import { createLogger } from '@vena/shared';
import type { Tool } from '@vena/shared';
import { GatewayServer } from '@vena/gateway';
import { TelegramChannel } from '@vena/channels';
import { WhatsAppChannel } from '@vena/channels';
import {
  AgentLoop,
  MemoryManager,
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  WebBrowseTool,
  BrowserTool,
  GoogleTool,
  ToolGuard,
} from '@vena/core';
import type { BrowserAdapter, GoogleAdapters } from '@vena/core';
import type { SecurityPolicy, SemanticMemoryProvider } from '@vena/core';
import { MemoryEngine } from '@vena/semantic-memory';
import type { LLMProvider } from '@vena/providers';
import { VoiceMessagePipeline, TextToSpeech, SpeechToText } from '@vena/voice';
import { AgentRegistry, MessageBus, MeshNetwork } from '@vena/agents';
import { SkillLoader, SkillRegistry, SkillInjector } from '@vena/skills';
import {
  loadConfig,
  createProvider,
  ensureDataDir,
  DATA_DIR,
  SESSIONS_PATH,
  WHATSAPP_AUTH_DIR,
} from '../lib/runtime.js';
import {
  colors,
  sleep,
  clearScreen,
  printLogo,
  spinnerLine,
  boxed,
  divider,
  getTerminalWidth,
} from '../ui/terminal.js';

const log = createLogger('cli:start');

// ── Helpers ─────────────────────────────────────────────────────────────

async function collectStreamText(provider: LLMProvider, prompt: string): Promise<string> {
  let text = '';
  for await (const chunk of provider.chat({
    messages: [{ id: 'q', role: 'user', content: prompt, timestamp: new Date().toISOString() }],
    maxTokens: 2048,
  })) {
    if (chunk.type === 'text' && chunk.text) text += chunk.text;
  }
  return text;
}

// ── Session Management ───────────────────────────────────────────────

const sessions = new Map<string, Session>();

function getOrCreateSession(sessionKey: string, channelName: string, userId: string, agentId: string): Session {
  let session = sessions.get(sessionKey);
  if (!session) {
    session = {
      id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channelName,
      sessionKey,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        userId,
        agentId,
        tokenCount: 0,
        compactionCount: 0,
      },
    };
    sessions.set(sessionKey, session);
  }
  return session;
}

function createEphemeralSession(
  sessionKey: string,
  channelName: string,
  userId: string,
  agentId: string,
  seedMessages: Message[] = [],
): Session {
  return {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    channelName,
    sessionKey,
    messages: seedMessages,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      userId,
      agentId,
      tokenCount: 0,
      compactionCount: 0,
    },
  };
}

type OpenAICompatRaw = {
  messages?: Array<{ role: string; content: string }>;
};

function extractOpenAiHistory(rawMessages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
  const lastUserIndex = [...rawMessages].map(m => m.role).lastIndexOf('user');
  if (lastUserIndex <= 0) return [];
  return rawMessages.slice(0, lastUserIndex).filter(m => m.role !== 'system');
}

function extractOpenAiSystemMessages(rawMessages: Array<{ role: string; content: string }>): string[] {
  const seen = new Set<string>();
  const system: string[] = [];
  for (const msg of rawMessages) {
    if (msg.role !== 'system') continue;
    const normalized = msg.content.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    system.push(normalized);
  }
  return system;
}

function extractOpenAiSystemPrompt(rawMessages: Array<{ role: string; content: string }>): string | undefined {
  const system = extractOpenAiSystemMessages(rawMessages).join('\n\n').trim();
  return system.length > 0 ? system : undefined;
}

function mapOpenAiMessages(rawMessages: Array<{ role: string; content: string }>): Message[] {
  const now = () => new Date().toISOString();
  return rawMessages.map((m, idx) => {
    const role: Message['role'] =
      m.role === 'assistant' || m.role === 'system' || m.role === 'tool'
        ? m.role
        : 'user';
    return {
      id: `msg_hist_${idx}_${Date.now()}`,
      role,
      content: m.content,
      timestamp: now(),
    };
  });
}

// ── Boot Sequence ─────────────────────────────────────────────────────

async function showBootSequence(config: VenaConfig, results: BootResults): Promise<void> {
  clearScreen();
  console.log();

  await printLogo(true);

  const width = getTerminalWidth();
  const subtitle = colors.dim('AI Agent Platform');
  const subtitleClean = 'AI Agent Platform';
  const subPad = ' '.repeat(Math.max(0, Math.floor((width - subtitleClean.length) / 2)));
  console.log(subPad + subtitle);
  console.log();

  const divLine = divider('━', Math.min(50, width - 4));
  const divClean = '━'.repeat(Math.min(50, width - 4));
  const dPad = ' '.repeat(Math.max(0, Math.floor((width - divClean.length) / 2)));
  console.log(dPad + divLine);
  console.log();

  await spinnerLine('Loading configuration...', 300);
  await spinnerLine('Initializing memory...', 300);
  await spinnerLine('Starting gateway...', 400);

  if (results.telegramConnected) {
    await spinnerLine('Connecting Telegram...', 300);
  }
  if (results.whatsappConnected) {
    await spinnerLine('Connecting WhatsApp...', 300);
  }
  if (results.semanticMemoryActive) {
    await spinnerLine('Knowledge Graph online...', 300);
  }
  if (results.voiceEnabled) {
    await spinnerLine('Voice pipeline active...', 300);
  }
  if (results.googleServices.length > 0) {
    await spinnerLine(`Google Workspace (${results.googleServices.join(', ')})...`, 300);
  }

  for (const name of results.agentNames) {
    await spinnerLine(`Agent "${name}" active...`, 200);
  }

  if (results.agentNames.length > 1) {
    await spinnerLine('Mesh network connected...', 300);
  }

  console.log();
  await sleep(200);
}

// ── Status Dashboard ──────────────────────────────────────────────────

interface BootResults {
  telegramConnected: boolean;
  whatsappConnected: boolean;
  gatewayPort: number;
  gatewayHost: string;
  providerName: string;
  modelName: string;
  messageCount: number;
  toolNames: string[];
  semanticMemoryActive: boolean;
  voiceEnabled: boolean;
  googleServices: string[];
  agentNames: string[];
}

function showDashboard(config: VenaConfig, results: BootResults): void {
  const agentCount = results.agentNames.length;
  const agentName = results.agentNames[0] ?? 'Vena';

  const enabledChannels: string[] = ['HTTP', 'WebSocket'];
  if (results.telegramConnected) enabledChannels.push('Telegram');
  if (results.whatsappConnected) enabledChannels.push('WhatsApp');

  const features: string[] = [];
  if (results.semanticMemoryActive) features.push('KnowledgeGraph');
  if (results.toolNames.length > 0) features.push(`${results.toolNames.length} Tools`);
  if (results.voiceEnabled) features.push('Voice');
  if (results.googleServices.length > 0) features.push('Google');
  if (agentCount > 1) features.push('MeshNetwork');

  const dashLines = [
    colors.secondary(chalk.bold('VENA AGENT PLATFORM')),
    '',
    `${colors.dim('Port:')}        ${colors.white(String(results.gatewayPort))}     ${colors.dim('│')} ${colors.dim('Agents:')}  ${colors.white(String(agentCount))}`,
    `${colors.dim('Host:')}        ${colors.white(results.gatewayHost)}  ${colors.dim('│')} ${colors.dim('Status:')}  ${colors.success('Online')}`,
    `${colors.dim('Memory:')}      ${results.semanticMemoryActive ? colors.success('Graph') : colors.dim('Flat')}       ${colors.dim('│')} ${colors.dim('Model:')}   ${colors.white(results.modelName)}`,
    `${colors.dim('Channels:')}    ${colors.white(enabledChannels.join(', '))}`,
    '',
    `${colors.dim('Provider:')}    ${colors.white(results.providerName)}`,
    `${colors.dim('Agent:')}       ${colors.primary(agentName)}`,
    `${colors.dim('Features:')}    ${colors.white(features.join(', ') || 'Default')}`,
    `${colors.dim('Tools:')}       ${colors.white(results.toolNames.join(', ') || 'None')}`,
  ];

  const box = boxed(dashLines, {
    title: 'STATUS',
    padding: 2,
    width: 60,
  });

  for (const line of box.split('\n')) {
    console.log('  ' + line);
  }

  console.log();

  if (agentCount > 0) {
    console.log(`  ${colors.secondary(chalk.bold('Active Agents'))}`);
    console.log();
    for (const agent of config.agents.registry) {
      const trustColor = agent.trustLevel === 'full' ? colors.success
        : agent.trustLevel === 'limited' ? colors.secondary
        : colors.dim;
      console.log(`  ${colors.success('●')} ${chalk.bold(agent.name)} ${colors.dim(`(${agent.id})`)} ${colors.dim('─')} ${trustColor(agent.trustLevel)} ${colors.dim('─')} ${colors.dim(agent.provider)}`);
      console.log(`    ${colors.dim('Capabilities:')} ${agent.capabilities.join(', ')}`);
    }
    console.log();
  }

  // Endpoints
  console.log(`  ${colors.secondary(chalk.bold('Endpoints'))}`);
  console.log();
  console.log(`  ${colors.dim('Health:')}       ${colors.white(`http://${results.gatewayHost}:${results.gatewayPort}/health`)}`);
  console.log(`  ${colors.dim('API:')}          ${colors.white(`http://${results.gatewayHost}:${results.gatewayPort}/api/message`)}`);
  console.log(`  ${colors.dim('OpenAI:')}       ${colors.white(`http://${results.gatewayHost}:${results.gatewayPort}/v1/chat/completions`)}`);
  console.log(`  ${colors.dim('WebSocket:')}    ${colors.white(`ws://${results.gatewayHost}:${results.gatewayPort}`)}`);
  console.log(`  ${colors.dim('Status:')}       ${colors.white(`http://${results.gatewayHost}:${results.gatewayPort}/api/status`)}`);
  console.log();

  const width = getTerminalWidth();
  const dLine = divider('━', Math.min(50, width - 4));
  const dClean = '━'.repeat(Math.min(50, width - 4));
  const pad = ' '.repeat(Math.max(0, Math.floor((width - dClean.length) / 2)));
  console.log(pad + dLine);
  console.log();
  console.log(`  ${colors.success('●')} ${chalk.bold(`Gateway listening on ${results.gatewayHost}:${results.gatewayPort}`)}`);
  console.log();
  console.log(`  ${colors.dim('Press')} ${chalk.bold('Ctrl+C')} ${colors.dim('to stop')}`);
  console.log();
}

// ── Start Command ─────────────────────────────────────────────────────

export const startCommand = new Command('start')
  .description('Start the Vena agent platform')
  .option('-p, --port <port>', 'Override gateway port')
  .option('--host <host>', 'Override gateway host')
  .action(async (opts: { port?: string; host?: string }) => {
    // ── Load config ──────────────────────────────────────────────────
    let config: VenaConfig;
    try {
      config = loadConfig();
    } catch (err) {
      clearScreen();
      console.log();
      await printLogo(false);
      console.log();
      console.log(`  ${colors.error('✗')} ${chalk.bold('No configuration found')}`);
      console.log();
      console.log(`  ${colors.dim('Run')} ${chalk.bold('vena onboard')} ${colors.dim('to set up your configuration.')}`);
      console.log();
      return;
    }

    // Apply CLI overrides
    const gatewayPort = opts.port ? parseInt(opts.port, 10) : config.gateway.port;
    const gatewayHost = opts.host ?? config.gateway.host;

    ensureDataDir();

    // ── Create default LLM provider ──────────────────────────────────
    let defaultProvider: LLMProvider;
    let modelName: string;
    let providerName: string;
    try {
      const result = createProvider(config);
      defaultProvider = result.provider;
      modelName = result.model;
      providerName = result.providerName;
    } catch (err) {
      console.error(colors.error(`\n  Provider error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }

    // ── Semantic Memory (Knowledge Graph) ────────────────────────────
    let memoryEngine: MemoryEngine | undefined;
    let semanticProvider: SemanticMemoryProvider | undefined;

    if (config.memory.semanticMemory.enabled) {
      try {
        const graphDir = path.join(DATA_DIR, 'semantic');
        fs.mkdirSync(graphDir, { recursive: true });

        memoryEngine = new MemoryEngine({
          dbPath: path.join(graphDir, 'knowledge.db'),
          indexDbPath: path.join(graphDir, 'index.db'),
          extractFn: (prompt: string) => collectStreamText(defaultProvider, prompt),
          summarizeFn: (texts: string[]) =>
            collectStreamText(defaultProvider, `Summarize these related memories concisely:\n\n${texts.join('\n---\n')}`),
        });

        semanticProvider = {
          async recall(query: string, maxTokens: number): Promise<string> {
            const result = await memoryEngine!.recall(query, { maxTokens });
            return result.context;
          },
          async ingest(messages: Message[], agentId: string): Promise<void> {
            await memoryEngine!.ingest(messages, agentId);
          },
        };

        log.info('Semantic memory (Knowledge Graph) initialized');
      } catch (err) {
        log.error({ error: err }, 'Failed to initialize semantic memory, falling back to flat memory');
      }
    }

    // ── Voice Pipeline ───────────────────────────────────────────────
    let voicePipeline: VoiceMessagePipeline | undefined;

    const ttsKey = config.voice.tts.apiKey;
    const sttKey = config.voice.stt.apiKey;

    if (ttsKey && sttKey) {
      try {
        const tts = new TextToSpeech({
          provider: config.voice.tts.provider,
          apiKey: ttsKey,
          defaultVoice: config.voice.tts.defaultVoice,
          model: config.voice.tts.model,
        });
        const stt = new SpeechToText({
          provider: config.voice.stt.provider,
          apiKey: sttKey,
          model: config.voice.stt.model,
        });
        voicePipeline = new VoiceMessagePipeline(tts, stt);
        log.info('Voice pipeline initialized (TTS + STT)');
      } catch (err) {
        log.error({ error: err }, 'Failed to initialize voice pipeline');
      }
    }

    // ── Browser Adapter (lazy Playwright import) ──────────────────────
    let browserAdapter: BrowserAdapter | undefined;

    if (config.computer.browser.enabled) {
      try {
        const { BrowserController } = await import('@vena/computer');
        const controller = new BrowserController();
        browserAdapter = controller;
        log.info('Browser adapter available (Playwright)');
      } catch {
        log.warn('Playwright not available — browser tool disabled. Install with: npx playwright install');
      }
    }

    // ── Google Integrations (lazy import) ──────────────────────────────
    let googleAdapters: GoogleAdapters | undefined;

    if (config.google?.clientId && config.google?.clientSecret) {
      try {
        const { GoogleAuth, GmailService, CalendarService, DriveService, DocsService, SheetsService } =
          await import('@vena/integrations');

        const auth = new GoogleAuth({
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
        });

        const tokens = auth.loadTokens();
        if (tokens) {
          const scopes = config.google.scopes ?? [];
          const adapters: GoogleAdapters = {};

          if (scopes.includes('gmail'))    adapters.gmail    = new GmailService(auth);
          if (scopes.includes('calendar')) adapters.calendar = new CalendarService(auth);
          if (scopes.includes('drive'))    adapters.drive    = new DriveService(auth);
          if (scopes.includes('docs'))     adapters.docs     = new DocsService(auth);
          if (scopes.includes('sheets'))   adapters.sheets   = new SheetsService(auth);

          if (Object.keys(adapters).length > 0) {
            googleAdapters = adapters;
            log.info({ services: Object.keys(adapters) }, 'Google integrations initialized');
          }
        } else {
          log.warn('Google OAuth tokens not found — run `vena config google-auth` to authorize');
        }
      } catch (err) {
        log.warn({ error: err }, 'Google integrations not available (googleapis not installed?)');
      }
    }

    // ── Load Skills ──────────────────────────────────────────────────
    const skillRegistry = new SkillRegistry();
    const injector = new SkillInjector();
    let skillsContext = '';

    try {
      const managedPath = config.skills.managed.replace('~', process.env['HOME'] ?? '');
      const bundledPath = path.join(DATA_DIR, 'skills', 'bundled');
      const workspaceDirs = config.skills.dirs;

      const loader = new SkillLoader(
        bundledPath,
        managedPath,
        workspaceDirs,
      );

      const loadedSkills = await loader.loadAll();
      for (const skill of loadedSkills) {
        skillRegistry.register(skill);
      }

      const enabledSkills = skillRegistry.getEnabled();
      if (enabledSkills.length > 0) {
        skillsContext = injector.generate(enabledSkills);
        log.info({ count: enabledSkills.length, names: enabledSkills.map(s => s.name) }, 'Skills loaded');
      }
    } catch (err) {
      log.warn({ error: err }, 'Failed to load skills (non-critical)');
    }

    // ── Build Tools + Security Guard ─────────────────────────────────
    function buildToolsForTrust(trustLevel: 'full' | 'limited' | 'readonly'): { tools: Tool[]; guard: ToolGuard } {
      const securityPolicy: SecurityPolicy = {
        trustLevel,
        allowedTools: ['*'],
        allowedPaths: [DATA_DIR],
        blockedPaths: config.security.pathPolicy.blockedPatterns,
        allowedCommands: config.security.shell.allowedCommands,
        maxOutputBytes: 1024 * 1024,
        envPassthrough: config.security.shell.envPassthrough,
        allowPrivateIPs: config.security.urlPolicy.allowPrivateIPs,
      };

      const guard = new ToolGuard(securityPolicy);
      const tools: Tool[] = [
        new ReadTool(),
        new WebBrowseTool({ allowPrivateIPs: config.security.urlPolicy.allowPrivateIPs }),
      ];

      if (trustLevel !== 'readonly') {
        tools.push(new WriteTool());
        tools.push(new EditTool());
      }

      if (trustLevel === 'full' && config.computer.shell.enabled) {
        tools.push(new BashTool({ envPassthrough: config.security.shell.envPassthrough }));
      }

      if (trustLevel !== 'readonly' && config.computer.browser.enabled && browserAdapter) {
        tools.push(new BrowserTool(browserAdapter, config.computer.browser.headless));
      }

      if (googleAdapters) {
        tools.push(new GoogleTool(googleAdapters));
      }

      return { tools, guard };
    }

    // ── Create Agent Loops (per agent in registry) ───────────────────
    const agentLoops = new Map<string, AgentLoop>();
    const agentMemory = new Map<string, MemoryManager>();
    const agentProviderNames = new Map<string, string>();
    const registry = config.agents.registry;

    for (const agentConfig of registry) {
      const trustLevel = (agentConfig.trustLevel ?? config.security.defaultTrustLevel ?? 'limited') as
        'full' | 'limited' | 'readonly';

      // Per-agent provider (may differ by provider/model)
      let agentProvider: LLMProvider;
      let agentProviderName = providerName;
      try {
        const result = createProvider(config, agentConfig.provider, agentConfig.model);
        agentProvider = result.provider;
        agentProviderName = result.providerName;
      } catch {
        agentProvider = defaultProvider;
      }
      agentProviderNames.set(agentConfig.id, agentProviderName);

      // Per-agent memory
      const mm = new MemoryManager({
        workspacePath: DATA_DIR,
        agentId: agentConfig.id,
        semantic: semanticProvider,
      });
      agentMemory.set(agentConfig.id, mm);

      // Per-agent tools
      const { tools, guard } = buildToolsForTrust(trustLevel);

      const loop = new AgentLoop({
        provider: agentProvider,
        tools,
        systemPrompt: agentConfig.persona ?? 'You are a helpful AI assistant.',
        skillsContext: skillsContext || undefined,
        memoryManager: mm,
        guard,
        workspacePath: DATA_DIR,
        options: {
          maxIterations: 10,
          maxTokens: 4096,
          streamTools: true,
        },
      });

      agentLoops.set(agentConfig.id, loop);
      log.info({ agent: agentConfig.name, id: agentConfig.id, trustLevel, tools: tools.map(t => t.name) }, 'Agent loop created');
    }

    // Collect all tool names from the first agent for display
    const firstAgentConfig = registry[0];
    const firstTrust = (firstAgentConfig?.trustLevel ?? 'limited') as 'full' | 'limited' | 'readonly';
    const displayTools = buildToolsForTrust(firstTrust).tools;

    // ── Mesh Network (multi-agent routing) ───────────────────────────
    let mesh: MeshNetwork | undefined;

    if (registry.length > 1) {
      const agentReg = new AgentRegistry();
      const bus = new MessageBus();
      mesh = new MeshNetwork(agentReg, bus);

      for (const agentConfig of registry) {
        mesh.addAgent({
          id: agentConfig.id,
          name: agentConfig.name,
          persona: agentConfig.persona,
          capabilities: agentConfig.capabilities,
          provider: agentConfig.provider,
          model: agentConfig.model ?? modelName,
          status: 'active',
          channels: agentConfig.channels,
          trustLevel: agentConfig.trustLevel,
          memoryNamespace: `agent-${agentConfig.id}`,
        });
      }

      log.info({ agents: registry.length }, 'Mesh network initialized');
    }

    const defaultAgentId = firstAgentConfig?.id ?? 'main';

    // ── Message Handler ─────────────────────────────────────────────
    let totalMessages = 0;

    function selectAgent(content: string): string {
      if (!mesh || registry.length <= 1) return defaultAgentId;

      try {
        return mesh.routeMessage(content, defaultAgentId);
      } catch {
        return defaultAgentId;
      }
    }

    async function handleMessage(inbound: InboundMessage): Promise<{ text?: string }> {
      totalMessages++;

      // Voice transcription: if inbound has audio/voice media, transcribe it
      let content = inbound.content;
      const hasVoice = inbound.media?.some(m => m.type === 'voice' || m.type === 'audio');

      if (voicePipeline && hasVoice) {
        const voiceMedia = inbound.media!.find(m => m.type === 'voice' || m.type === 'audio');
        if (voiceMedia?.buffer) {
          try {
            const transcribed = await voicePipeline.processIncoming(voiceMedia.buffer, voiceMedia.mimeType);
            if (transcribed) {
              content = transcribed;
              log.info({ original: !!inbound.content, transcribed: transcribed.slice(0, 100) }, 'Voice transcribed');
            }
          } catch (err) {
            log.error({ error: err }, 'Voice transcription failed');
          }
        }
      }

      // Route to best agent
      const targetAgentId = selectAgent(content);
      const loop = agentLoops.get(targetAgentId) ?? agentLoops.get(defaultAgentId)!;
      const mm = agentMemory.get(targetAgentId) ?? agentMemory.get(defaultAgentId)!;

      if (targetAgentId !== defaultAgentId) {
        log.info({ target: targetAgentId, content: content.slice(0, 80) }, 'Routed to agent');
      }

      let session: Session;
      let systemPromptOverride: string | undefined;
      const raw = inbound.raw as OpenAICompatRaw | undefined;
      const rawMessages = Array.isArray(raw?.messages) ? raw!.messages! : null;
      if (rawMessages && inbound.channelName === 'openai-compat') {
        const targetProvider = agentProviderNames.get(targetAgentId) ?? providerName;
        const isOpenAIProvider = targetProvider === 'openai';
        const history = extractOpenAiHistory(rawMessages);
        const systemMessages = extractOpenAiSystemMessages(rawMessages);
        let seedMessages = mapOpenAiMessages(history);

        if (isOpenAIProvider && systemMessages.length > 0) {
          const systemSeeds = mapOpenAiMessages(systemMessages.map((content) => ({ role: 'system', content })));
          seedMessages = [...systemSeeds, ...seedMessages];
        }
        session = createEphemeralSession(
          inbound.sessionKey,
          inbound.channelName,
          inbound.userId,
          targetAgentId,
          seedMessages,
        );
        const systemPrompt = !isOpenAIProvider ? extractOpenAiSystemPrompt(rawMessages) : undefined;
        if (systemPrompt) {
          const targetConfig = registry.find(a => a.id === targetAgentId) ?? firstAgentConfig;
          const basePrompt = targetConfig?.persona ?? 'You are a helpful AI assistant.';
          systemPromptOverride = [systemPrompt, basePrompt].join('\n\n');
        }
      } else {
        session = getOrCreateSession(
          inbound.sessionKey,
          inbound.channelName,
          inbound.userId,
          targetAgentId,
        );
      }

      const userMessage: Message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        metadata: {
          userId: inbound.userId,
          userName: inbound.userName,
          channelName: inbound.channelName,
        },
      };

      let responseText = '';

      try {
        const overrides = systemPromptOverride ? { systemPrompt: systemPromptOverride } : undefined;
        for await (const event of loop.run(userMessage, session, overrides)) {
          switch (event.type) {
            case 'text':
              responseText += event.text;
              break;
            case 'done':
              responseText = event.response || responseText;
              break;
            case 'error':
              log.error({ error: event.error }, 'Agent error');
              responseText = 'Sorry, I encountered an error processing your message.';
              break;
          }
        }
      } catch (err) {
        log.error({ error: err }, 'Agent loop error');
        responseText = 'Sorry, something went wrong.';
      }

      // Log to flat + semantic memory
      try {
        await mm.log(`[${inbound.channelName}/${inbound.userId}] ${content}`);
        if (responseText) {
          await mm.log(`[assistant] ${responseText.slice(0, 500)}`);
        }
        // Ingest into knowledge graph (fire-and-forget)
        mm.ingestMessages([
          userMessage,
          { id: `msg_${Date.now()}_resp`, role: 'assistant', content: responseText, timestamp: new Date().toISOString() },
        ]).catch(() => {});
      } catch {
        // Non-critical
      }

      session.updatedAt = new Date().toISOString();

      return { text: responseText };
    }

    // Voice-aware channel handler: wraps handleMessage with STT/TTS
    async function handleChannelMessage(
      inbound: InboundMessage,
      sendFn: (sessionKey: string, content: OutboundMessage) => Promise<void>,
    ): Promise<void> {
      const response = await handleMessage(inbound);
      const outbound: OutboundMessage = { text: response.text };

      // Synthesize voice reply if input was voice and autoVoiceReply is on
      if (voicePipeline && response.text) {
        const shouldVoice = voicePipeline.shouldReplyWithVoice(inbound, {
          autoVoiceReply: config.voice.autoVoiceReply,
        });

        if (shouldVoice) {
          try {
            // Find agent voiceId if configured
            const targetAgent = registry.find(a => a.id === selectAgent(inbound.content));
            const audioBuffer = await voicePipeline.processOutgoing(response.text, targetAgent?.voiceId);
            outbound.media = [{
              type: 'voice' as const,
              buffer: audioBuffer,
              mimeType: 'audio/ogg',
            }];
            log.info({ bytes: audioBuffer.length }, 'Voice response synthesized');
          } catch (err) {
            log.error({ error: err }, 'Voice synthesis failed, sending text only');
          }
        }
      }

      await sendFn(inbound.sessionKey, outbound);
    }

    // ── Start Gateway ───────────────────────────────────────────────
    const gateway = new GatewayServer({
      port: gatewayPort,
      host: gatewayHost,
      sessionsPath: SESSIONS_PATH,
    });

    gateway.onMessage(handleMessage);
    gateway.onAgents(() =>
      registry.map((a) => ({
        id: a.id,
        name: a.name,
        status: 'active',
      })),
    );

    try {
      await gateway.start();
    } catch (err) {
      console.error(colors.error(`\n  Failed to start gateway: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }

    // ── Connect Channels ────────────────────────────────────────────
    const channels: Array<{ name: string; disconnect: () => Promise<void> }> = [];
    let telegramConnected = false;
    let whatsappConnected = false;

    // Telegram
    if (config.channels.telegram?.enabled && config.channels.telegram?.token) {
      try {
        const telegram = new TelegramChannel(config.channels.telegram.token);
        telegram.onMessage(async (inbound) => {
          await handleChannelMessage(inbound, (key, content) => telegram.send(key, content));
        });
        await telegram.connect();
        channels.push({ name: 'telegram', disconnect: () => telegram.disconnect() });
        telegramConnected = true;
        log.info('Telegram channel connected');
      } catch (err) {
        log.error({ error: err }, 'Failed to connect Telegram');
      }
    }

    // WhatsApp
    if (config.channels.whatsapp?.enabled) {
      try {
        fs.mkdirSync(WHATSAPP_AUTH_DIR, { recursive: true });
        const whatsapp = new WhatsAppChannel({
          authDir: WHATSAPP_AUTH_DIR,
          printQRInTerminal: true,
        });
        whatsapp.onMessage(async (inbound) => {
          await handleChannelMessage(inbound, (key, content) => whatsapp.send(key, content));
        });
        await whatsapp.connect();
        channels.push({ name: 'whatsapp', disconnect: () => whatsapp.disconnect() });
        whatsappConnected = true;
        log.info('WhatsApp channel connected');
      } catch (err) {
        log.error({ error: err }, 'Failed to connect WhatsApp');
      }
    }

    // ── Boot Sequence + Dashboard ───────────────────────────────────
    const bootResults: BootResults = {
      telegramConnected,
      whatsappConnected,
      gatewayPort,
      gatewayHost,
      providerName,
      modelName,
      messageCount: totalMessages,
      toolNames: displayTools.map(t => t.name),
      semanticMemoryActive: !!memoryEngine,
      voiceEnabled: !!voicePipeline,
      googleServices: googleAdapters ? Object.keys(googleAdapters) : [],
      agentNames: registry.map(a => a.name),
    };

    await showBootSequence(config, bootResults);
    showDashboard(config, bootResults);

    // ── Graceful Shutdown ───────────────────────────────────────────
    let shuttingDown = false;

    async function shutdown(signal: string): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log();
      console.log(colors.dim(`  Received ${signal}, shutting down...`));
      console.log();

      // Disconnect channels
      for (const channel of channels) {
        try {
          await channel.disconnect();
          console.log(`  ${colors.dim('●')} ${channel.name} disconnected`);
        } catch (err) {
          log.error({ error: err, channel: channel.name }, 'Error disconnecting channel');
        }
      }

      // Close browser
      if (browserAdapter) {
        try {
          await browserAdapter.close();
          console.log(`  ${colors.dim('●')} Browser closed`);
        } catch {
          // May not have been launched
        }
      }

      // Close semantic memory
      if (memoryEngine) {
        try {
          memoryEngine.close();
          console.log(`  ${colors.dim('●')} Knowledge Graph closed`);
        } catch (err) {
          log.error({ error: err }, 'Error closing semantic memory');
        }
      }

      // Stop gateway
      try {
        await gateway.stop();
        console.log(`  ${colors.dim('●')} Gateway stopped`);
      } catch (err) {
        log.error({ error: err }, 'Error stopping gateway');
      }

      console.log();
      console.log(colors.dim('  Goodbye!'));
      console.log();
      process.exit(0);
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Keep process alive
    await new Promise(() => {});
  });
