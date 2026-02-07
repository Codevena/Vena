import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import type { VenaConfig, InboundMessage, Message, Session } from '@vena/shared';
import { createLogger } from '@vena/shared';
import { GatewayServer } from '@vena/gateway';
import { TelegramChannel } from '@vena/channels';
import { WhatsAppChannel } from '@vena/channels';
import { AgentLoop } from '@vena/core';
import { MemoryManager } from '@vena/core';
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
  if (config.memory.semanticMemory.enabled) {
    await spinnerLine('Knowledge Graph online...', 300);
  }

  const agentName = config.agents.registry[0]?.name ?? 'Vena';
  await spinnerLine(`Agent "${agentName}" active...`, 300);

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
}

function showDashboard(config: VenaConfig, results: BootResults): void {
  const agents = config.agents.registry;
  const agentCount = agents.length;
  const agentName = agents[0]?.name ?? 'Vena';

  const enabledChannels: string[] = ['HTTP', 'WebSocket'];
  if (results.telegramConnected) enabledChannels.push('Telegram');
  if (results.whatsappConnected) enabledChannels.push('WhatsApp');

  const features: string[] = [];
  if (config.memory.semanticMemory.enabled) features.push('Memory');
  if (config.computer.shell.enabled) features.push('Shell');
  if (config.computer.browser.enabled) features.push('Browser');
  if (config.voice.autoVoiceReply) features.push('Voice');

  const dashLines = [
    colors.secondary(chalk.bold('VENA AGENT PLATFORM')),
    '',
    `${colors.dim('Port:')}        ${colors.white(String(results.gatewayPort))}     ${colors.dim('│')} ${colors.dim('Agents:')}  ${colors.white(String(agentCount))}`,
    `${colors.dim('Host:')}        ${colors.white(results.gatewayHost)}  ${colors.dim('│')} ${colors.dim('Status:')}  ${colors.success('Online')}`,
    `${colors.dim('Memory:')}      ${config.memory.semanticMemory.enabled ? colors.success('Active') : colors.dim('Off')}       ${colors.dim('│')} ${colors.dim('Model:')}   ${colors.white(results.modelName)}`,
    `${colors.dim('Channels:')}    ${colors.white(enabledChannels.join(', '))}`,
    '',
    `${colors.dim('Provider:')}    ${colors.white(results.providerName)}`,
    `${colors.dim('Agent:')}       ${colors.primary(agentName)}`,
    `${colors.dim('Features:')}    ${colors.white(features.join(', ') || 'Default')}`,
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

  if (agents.length > 0) {
    console.log(`  ${colors.secondary(chalk.bold('Active Agents'))}`);
    console.log();
    for (const agent of agents) {
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

    // ── Create LLM provider ─────────────────────────────────────────
    let provider;
    let modelName: string;
    let providerName: string;
    try {
      const result = createProvider(config);
      provider = result.provider;
      modelName = result.model;
      providerName = result.providerName;
    } catch (err) {
      console.error(colors.error(`\n  Provider error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }

    // ── Create Memory Manager ───────────────────────────────────────
    const agentId = config.agents.registry[0]?.id ?? 'main';
    const memoryManager = new MemoryManager({
      workspacePath: DATA_DIR,
      agentId,
    });

    // ── Create Agent Loop ───────────────────────────────────────────
    const systemPrompt = config.agents.registry[0]?.persona ?? 'You are a helpful AI assistant.';
    const agentLoop = new AgentLoop({
      provider,
      tools: [],
      systemPrompt,
      memoryManager,
      workspacePath: DATA_DIR,
      options: {
        maxIterations: 10,
        maxTokens: 4096,
        streamTools: true,
      },
    });

    // ── Message Handler ─────────────────────────────────────────────
    let totalMessages = 0;

    async function handleMessage(inbound: InboundMessage): Promise<{ text?: string }> {
      totalMessages++;
      const session = getOrCreateSession(
        inbound.sessionKey,
        inbound.channelName,
        inbound.userId,
        agentId,
      );

      const userMessage: Message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: inbound.content,
        timestamp: new Date().toISOString(),
        metadata: {
          userId: inbound.userId,
          userName: inbound.userName,
          channelName: inbound.channelName,
        },
      };

      let responseText = '';

      try {
        for await (const event of agentLoop.run(userMessage, session)) {
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

      // Log to memory
      try {
        await memoryManager.log(`[${inbound.channelName}/${inbound.userId}] ${inbound.content}`);
        if (responseText) {
          await memoryManager.log(`[assistant] ${responseText.slice(0, 500)}`);
        }
      } catch {
        // Non-critical
      }

      session.updatedAt = new Date().toISOString();

      return { text: responseText };
    }

    // ── Start Gateway ───────────────────────────────────────────────
    const gateway = new GatewayServer({
      port: gatewayPort,
      host: gatewayHost,
      sessionsPath: SESSIONS_PATH,
    });

    gateway.onMessage(handleMessage);
    gateway.onAgents(() =>
      config.agents.registry.map((a) => ({
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
          const response = await handleMessage(inbound);
          if (response.text) {
            await telegram.send(inbound.sessionKey, { text: response.text });
          }
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
          const response = await handleMessage(inbound);
          if (response.text) {
            await whatsapp.send(inbound.sessionKey, { text: response.text });
          }
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
