import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import type { VenaConfig, InboundMessage, Message } from '@vena/shared';
import { createLogger } from '@vena/shared';
import { GatewayServer } from '@vena/gateway';
import { SenderApproval } from '@vena/gateway';
import { UsageTracker } from '@vena/core';
import type { BrowserAdapter, GoogleAdapters, SemanticMemoryProvider } from '@vena/core';
import type { LLMProvider } from '@vena/providers';
import { MemoryEngine } from '@vena/semantic-memory';
import { VoiceMessagePipeline, TextToSpeech, SpeechToText } from '@vena/voice';
import { SkillLoader, SkillRegistry, SkillInjector } from '@vena/skills';
import { triggerHook, createHookEvent, loadAndRegisterHooks } from '@vena/hooks';
import { CronService } from '@vena/cron';
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
import { ChatSessionManager } from '../lib/session-manager.js';
import { collectStreamText, createAgentLoops } from '../lib/agent-factory.js';
import { createMessageHandler } from '../lib/message-handler.js';
import { connectAllChannels } from '../lib/channel-connector.js';
import type { ToolBuilderDeps } from '../lib/tool-builder.js';

const log = createLogger('cli:start');

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
  if (results.slackConnected) {
    await spinnerLine('Connecting Slack...', 300);
  }
  if (results.discordConnected) {
    await spinnerLine('Connecting Discord...', 300);
  }
  if (results.signalConnected) {
    await spinnerLine('Connecting Signal...', 300);
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
  if (results.hookCount > 0) {
    await spinnerLine(`${results.hookCount} hook(s) loaded...`, 200);
  }
  if (results.cronJobs > 0) {
    await spinnerLine(`${results.cronJobs} cron job(s) scheduled...`, 200);
  }
  if (results.usageEnabled) {
    await spinnerLine('Usage tracking active...', 200);
  }

  for (const name of results.agentNames) {
    await spinnerLine(`Agent "${name}" active...`, 200);
  }

  if (results.agentNames.length > 1) {
    await spinnerLine('Mesh network + intent routing...', 300);
  }

  console.log();
  await sleep(200);
}

// ── Status Dashboard ──────────────────────────────────────────────────

interface BootResults {
  telegramConnected: boolean;
  whatsappConnected: boolean;
  slackConnected: boolean;
  discordConnected: boolean;
  signalConnected: boolean;
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
  hookCount: number;
  cronJobs: number;
  usageEnabled: boolean;
  senderApprovalMode: string;
}

function showDashboard(config: VenaConfig, results: BootResults): void {
  const agentCount = results.agentNames.length;
  const agentName = results.agentNames[0] ?? 'Vena';

  const enabledChannels: string[] = ['HTTP', 'WebSocket', 'WebChat'];
  if (results.telegramConnected) enabledChannels.push('Telegram');
  if (results.whatsappConnected) enabledChannels.push('WhatsApp');
  if (results.slackConnected) enabledChannels.push('Slack');
  if (results.discordConnected) enabledChannels.push('Discord');
  if (results.signalConnected) enabledChannels.push('Signal');

  const features: string[] = [];
  if (results.semanticMemoryActive) features.push('KnowledgeGraph');
  if (results.toolNames.length > 0) features.push(`${results.toolNames.length} Tools`);
  if (results.voiceEnabled) features.push('Voice');
  if (results.googleServices.length > 0) features.push('Google');
  if (agentCount > 1) features.push('MeshNetwork');
  if (results.hookCount > 0) features.push(`${results.hookCount} Hooks`);
  if (results.cronJobs > 0) features.push(`${results.cronJobs} Cron`);
  if (results.usageEnabled) features.push('UsageTracking');
  if (results.senderApprovalMode !== 'open') features.push(`DM:${results.senderApprovalMode}`);

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
  console.log(`  ${colors.dim('WebChat:')}      ${colors.white(`http://${results.gatewayHost}:${results.gatewayPort}/chat`)}`);
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

      const loader = new SkillLoader(bundledPath, managedPath, workspaceDirs);
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

    // ── Load Hooks ─────────────────────────────────────────────────────
    let hookCount = 0;
    try {
      const discovered = await loadAndRegisterHooks();
      hookCount = discovered.length;
      if (hookCount > 0) {
        log.info({ count: hookCount }, 'Hooks loaded');
      }
    } catch (err) {
      log.warn({ error: err }, 'Failed to load hooks (non-critical)');
    }

    // ── Sessions + Channels Map ──────────────────────────────────────
    const sessions = new ChatSessionManager();
    const connectedChannels = new Map<string, { channel: any; connected: boolean }>();

    // ── Cron Service ─────────────────────────────────────────────────
    // Forward-declare so cron callback can reference handleMessage + agentLoops
    let handleMessage: (inbound: InboundMessage) => Promise<{ text?: string }>;
    let agentLoopsMap: Map<string, any>;
    let defaultAgentId: string;

    const cronService = new CronService({
      callback: async (job) => {
        log.info({ jobId: job.id, name: job.name }, 'Cron job executing');

        if (job.payload.kind === 'systemEvent') {
          await triggerHook(createHookEvent('agent', 'cron', `cron:${job.id}`, {
            jobId: job.id,
            jobName: job.name,
            text: job.payload.text,
          }));
          return;
        }

        const targetAgent = job.agentId ?? defaultAgentId;
        const loop = agentLoopsMap.get(targetAgent);
        if (!loop) {
          log.warn({ jobId: job.id, agent: targetAgent }, 'Cron: agent not found');
          return;
        }

        const inbound: InboundMessage = {
          channelName: 'cron',
          sessionKey: `cron:${job.id}`,
          userId: 'cron-scheduler',
          content: job.payload.message,
        };

        try {
          await handleMessage(inbound);
        } catch (err) {
          log.error({ error: err, jobId: job.id }, 'Cron job handler error');
          throw err;
        }
      },
    });

    try {
      await cronService.start();
      const jobs = cronService.listJobs();
      if (jobs.length > 0) {
        log.info({ count: jobs.length }, 'Cron scheduler started');
      }
    } catch (err) {
      log.warn({ error: err }, 'Failed to start cron service (non-critical)');
    }

    // ── Usage Tracker + Sender Approval ──────────────────────────────
    const usageTracker = new UsageTracker(DATA_DIR);
    const senderApproval = new SenderApproval({
      mode: config.gateway.senderApproval.mode,
      dataDir: DATA_DIR,
    });

    // ── Build Agents ─────────────────────────────────────────────────
    const toolBuilderDeps: ToolBuilderDeps = {
      config,
      dataDir: DATA_DIR,
      browserAdapter,
      googleAdapters,
      cronService,
      sessions,
      connectedChannels,
    };

    const agents = createAgentLoops({
      config,
      dataDir: DATA_DIR,
      defaultProvider,
      providerName,
      modelName,
      semanticProvider,
      skillsContext,
      toolBuilderDeps,
      createProvider,
    });

    agentLoopsMap = agents.agentLoops;
    defaultAgentId = agents.defaultAgentId;

    // ── Message Handler ─────────────────────────────────────────────
    const handler = createMessageHandler({
      config,
      registry: config.agents.registry,
      defaultAgentId: agents.defaultAgentId,
      providerName,
      modelName,
      agentLoops: agents.agentLoops,
      agentMemory: agents.agentMemory,
      agentProviderNames: agents.agentProviderNames,
      mesh: agents.mesh,
      voicePipeline,
      sessions,
      usageTracker,
      senderApproval,
    });

    handleMessage = handler.handleMessage;

    // ── Start Gateway ───────────────────────────────────────────────
    const registry = config.agents.registry;
    const gateway = new GatewayServer({
      port: gatewayPort,
      host: gatewayHost,
      sessionsPath: SESSIONS_PATH,
    });

    gateway.onMessage(handler.handleMessage);
    gateway.onAgents(() =>
      registry.map((a) => ({
        id: a.id,
        name: a.name,
        status: 'active',
      })),
    );
    gateway.onUsage(() => usageTracker.getSummary());
    gateway.onSenders(
      () => senderApproval.listSenders(),
      (userId, channel) => senderApproval.approve(userId, channel),
      (userId, channel) => senderApproval.block(userId, channel),
    );

    try {
      await gateway.start();
      await triggerHook(createHookEvent('gateway', 'start', 'system', {
        port: gatewayPort,
        host: gatewayHost,
        agents: registry.map(a => a.id),
      }));
    } catch (err) {
      console.error(colors.error(`\n  Failed to start gateway: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }

    // ── Connect Channels ────────────────────────────────────────────
    const channelResult = await connectAllChannels({
      config,
      whatsappAuthDir: WHATSAPP_AUTH_DIR,
      onMessage: handler.handleChannelMessage,
      channelMap: connectedChannels,
    });

    // ── Boot Sequence + Dashboard ───────────────────────────────────
    const bootResults: BootResults = {
      telegramConnected: channelResult.telegramConnected,
      whatsappConnected: channelResult.whatsappConnected,
      slackConnected: channelResult.slackConnected,
      discordConnected: channelResult.discordConnected,
      signalConnected: channelResult.signalConnected,
      gatewayPort,
      gatewayHost,
      providerName,
      modelName,
      messageCount: handler.getMessageCount(),
      toolNames: agents.displayTools.map(t => t.name),
      semanticMemoryActive: !!memoryEngine,
      voiceEnabled: !!voicePipeline,
      googleServices: googleAdapters ? Object.keys(googleAdapters) : [],
      agentNames: registry.map(a => a.name),
      hookCount,
      cronJobs: cronService.listJobs().filter(j => j.enabled).length,
      usageEnabled: true,
      senderApprovalMode: config.gateway.senderApproval.mode,
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

      for (const channel of channelResult.channels) {
        try {
          await channel.disconnect();
          console.log(`  ${colors.dim('●')} ${channel.name} disconnected`);
        } catch (err) {
          log.error({ error: err, channel: channel.name }, 'Error disconnecting channel');
        }
      }

      try {
        await cronService.stop();
        console.log(`  ${colors.dim('●')} Cron scheduler stopped`);
      } catch {
        // Non-critical
      }

      await triggerHook(createHookEvent('gateway', 'stop', 'system', {})).catch(() => {});

      try {
        usageTracker.stop();
        console.log(`  ${colors.dim('●')} Usage tracker saved`);
      } catch {
        // Non-critical
      }

      if (agents.consultationManager || agents.delegationManager) {
        console.log(`  ${colors.dim('●')} Collaboration managers cleared`);
      }

      if (browserAdapter) {
        try {
          await browserAdapter.close();
          console.log(`  ${colors.dim('●')} Browser closed`);
        } catch {
          // May not have been launched
        }
      }

      if (memoryEngine) {
        try {
          memoryEngine.close();
          console.log(`  ${colors.dim('●')} Knowledge Graph closed`);
        } catch (err) {
          log.error({ error: err }, 'Error closing semantic memory');
        }
      }

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
