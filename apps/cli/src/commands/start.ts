import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseConfig, type VenaConfig } from '@vena/shared';
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

function loadConfig(): VenaConfig | null {
  const configPath = path.join(os.homedir(), '.vena', 'vena.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return parseConfig(raw);
}

// ── Boot Sequence ─────────────────────────────────────────────────────
async function showBootSequence(config: VenaConfig): Promise<void> {
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

  // Boot sequence items
  await spinnerLine('Loading configuration...', 400);
  await spinnerLine('Initializing memory...', 500);
  await spinnerLine('Starting gateway...', 600);

  // Channel-specific boot lines
  if (config.channels.telegram?.enabled) {
    await spinnerLine('Connecting Telegram...', 450);
  }
  if (config.channels.whatsapp?.enabled) {
    await spinnerLine('Connecting WhatsApp...', 450);
  }

  if (config.memory.semanticMemory.enabled) {
    await spinnerLine('Knowledge Graph online...', 500);
  }

  const agentName = config.agents.registry[0]?.name ?? 'Vena';
  await spinnerLine(`Agent "${agentName}" active...`, 400);

  console.log();
  await sleep(300);
}

// ── Status Dashboard ──────────────────────────────────────────────────
function showDashboard(config: VenaConfig): void {
  const { host, port } = config.gateway;
  const agents = config.agents.registry;
  const agentCount = agents.length;
  const agentName = agents[0]?.name ?? 'Vena';

  // Collect enabled channels
  const enabledChannels: string[] = [];
  if (config.channels.telegram?.enabled) enabledChannels.push('Telegram');
  if (config.channels.whatsapp?.enabled) enabledChannels.push('WhatsApp');
  const channelStr = enabledChannels.length > 0 ? enabledChannels.join(', ') : 'None';

  // Count features
  const features: string[] = [];
  if (config.memory.semanticMemory.enabled) features.push('Memory');
  if (config.computer.shell.enabled) features.push('Shell');
  if (config.computer.browser.enabled) features.push('Browser');
  if (config.voice.autoVoiceReply) features.push('Voice');

  const dashLines = [
    colors.secondary(chalk.bold('VENA AGENT PLATFORM')),
    '',
    `${colors.dim('Port:')}        ${colors.white(String(port))}     ${colors.dim('│')} ${colors.dim('Agents:')}  ${colors.white(String(agentCount))}`,
    `${colors.dim('Host:')}        ${colors.white(host)}  ${colors.dim('│')} ${colors.dim('Status:')}  ${colors.success('Online')}`,
    `${colors.dim('Memory:')}      ${config.memory.semanticMemory.enabled ? colors.success('Active') : colors.dim('Off')}       ${colors.dim('│')} ${colors.dim('Skills:')}  ${colors.white('0')}`,
    `${colors.dim('Channels:')}    ${colors.white(channelStr)}`,
    '',
    `${colors.dim('Provider:')}    ${colors.white(config.providers.default)}`,
    `${colors.dim('Agent:')}       ${colors.primary(agentName)}`,
    `${colors.dim('Features:')}    ${colors.white(features.join(', ') || 'Default')}`,
  ];

  const box = boxed(dashLines, {
    title: 'STATUS',
    padding: 2,
    width: 56,
  });

  for (const line of box.split('\n')) {
    console.log('  ' + line);
  }

  console.log();

  // Agent list
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

  const width = getTerminalWidth();
  const divLine = divider('━', Math.min(50, width - 4));
  const divClean = '━'.repeat(Math.min(50, width - 4));
  const dPad = ' '.repeat(Math.max(0, Math.floor((width - divClean.length) / 2)));
  console.log(dPad + divLine);
  console.log();
  console.log(`  ${colors.success('●')} ${chalk.bold(`Gateway listening on ${host}:${port}`)}`);
  console.log();
  console.log(`  ${colors.dim('Press')} ${chalk.bold('Ctrl+C')} ${colors.dim('to stop')}`);
  console.log();
}

// ── Start Command ─────────────────────────────────────────────────────
export const startCommand = new Command('start')
  .description('Start the Vena agent platform')
  .action(async () => {
    const config = loadConfig();

    if (!config) {
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

    await showBootSequence(config);
    showDashboard(config);

    // Keep process alive (placeholder for actual gateway)
    await new Promise(() => {});
  });
