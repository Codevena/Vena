import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { VenaConfig } from '@vena/shared';
import { listCharacters } from '@vena/shared';
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
    const MODEL_CHOICES: Record<string, Array<{ title: string; value: string }>> = {
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
        { title: `${colors.primary('●')} Gemini 2.5 Pro         ${colors.dim('─ Most capable')}`, value: 'gemini-2.5-pro-preview-06-05' },
        { title: `${colors.primary('●')} Gemini 2.0 Flash       ${colors.dim('─ Fast & efficient (Recommended)')}`, value: 'gemini-2.0-flash' },
        { title: `${colors.primary('●')} Gemini 2.0 Flash Lite  ${colors.dim('─ Cheapest')}`, value: 'gemini-2.0-flash-lite' },
      ],
      ollama: [
        { title: `${colors.primary('●')} Llama 3.1              ${colors.dim('─ Meta open-source')}`, value: 'llama3.1' },
        { title: `${colors.primary('●')} Mistral Large          ${colors.dim('─ Best open model')}`, value: 'mistral-large' },
        { title: `${colors.primary('●')} DeepSeek V3            ${colors.dim('─ Strong reasoning')}`, value: 'deepseek-v3' },
        { title: `${colors.primary('●')} Qwen 2.5               ${colors.dim('─ Multilingual')}`, value: 'qwen2.5' },
      ],
    };

    printStepHeader(2, totalSteps, 'Choose Your Model', 'Select which model to use, or type a custom model ID.');

    const modelChoices = MODEL_CHOICES[providerKey] ?? [];
    // Add "Custom" option at the end
    modelChoices.push({
      title: `${colors.dim('●')} Custom...              ${colors.dim('─ Enter any model ID manually')}`,
      value: '__custom__',
    });

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
        hint: 'e.g. claude-opus-4-6, gpt-4-turbo, gemini-2.5-pro',
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

    // ── Step 3: Authentication ──────────────────────────────────────
    let apiKey = '';
    let authType: 'api_key' | 'oauth_token' = 'api_key';
    let oauthToken = '';

    if (providerKey !== 'ollama') {
      printStepHeader(3, totalSteps, 'Authentication', `Choose how to authenticate with ${provider}.`);

      const authChoice = await prompts({
        type: 'select',
        name: 'authType',
        message: colors.primary('▸') + ' Auth Method',
        choices: [
          { title: `${colors.primary('●')} API Key       ${colors.dim('─ Standard API key from provider dashboard')}`, value: 'api_key' },
          { title: `${colors.primary('●')} OAuth Token   ${colors.dim('─ OAuth2 access token or bearer token')}`, value: 'oauth_token' },
        ],
      }, {
        onCancel: () => {
          console.log();
          console.log(colors.secondary('  Setup cancelled.'));
          console.log();
          process.exit(0);
        },
      });

      authType = authChoice.authType as 'api_key' | 'oauth_token';

      if (authType === 'api_key') {
        console.log();
        const keyResponse = await prompts({
          type: 'password',
          name: 'apiKey',
          message: colors.primary('▸') + ' API Key',
        }, {
          onCancel: () => {
            console.log();
            console.log(colors.secondary('  Setup cancelled.'));
            console.log();
            process.exit(0);
          },
        });
        apiKey = keyResponse.apiKey as string;
        if (apiKey) {
          console.log(`  ${colors.success('✓')} ${colors.dim('API key saved')}`);
        }
      } else {
        console.log();
        console.log(`  ${colors.dim('Paste your OAuth2 access token or bearer token.')}`);
        console.log();
        const tokenResponse = await prompts({
          type: 'password',
          name: 'token',
          message: colors.primary('▸') + ' OAuth Token',
        }, {
          onCancel: () => {
            console.log();
            console.log(colors.secondary('  Setup cancelled.'));
            console.log();
            process.exit(0);
          },
        });
        oauthToken = tokenResponse.token as string;
        if (oauthToken) {
          console.log(`  ${colors.success('✓')} ${colors.dim('OAuth token saved')}`);
        }
      }
    } else {
      printStepHeader(3, totalSteps, 'Local Provider Selected', 'No API key needed for Ollama. Make sure it\'s running at localhost:11434.');
      console.log(`  ${colors.success('✓')} ${colors.dim('Ollama selected - no API key required')}`);
      await sleep(500);
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
      if (authType === 'oauth_token') {
        return {
          [providerKey]: {
            model: selectedModel,
            auth: { type: 'oauth_token' as const, oauthToken },
          },
        };
      }
      return {
        [providerKey]: { apiKey, model: selectedModel },
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
      },
      voice: {
        tts: { provider: 'elevenlabs', defaultVoice: 'adam', model: 'eleven_multilingual_v2' },
        stt: { provider: 'whisper', model: 'whisper-1' },
        calls: { enabled: false, provider: 'twilio' },
        autoVoiceReply: enableVoice,
      },
      skills: { dirs: [], managed: '~/.vena/skills' },
      ...(userName ? {
        userProfile: {
          name: userName,
          language: userLanguage,
          ...(userTimezone ? { timezone: userTimezone } : {}),
        },
      } : {}),
    };

    // Create config directory
    const venaDir = path.join(os.homedir(), '.vena');
    const skillsDir = path.join(venaDir, 'skills');
    fs.mkdirSync(venaDir, { recursive: true });
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
