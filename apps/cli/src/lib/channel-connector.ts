import fs from 'node:fs';
import type { InboundMessage, OutboundMessage, VenaConfig } from '@vena/shared';
import { createLogger } from '@vena/shared';
import type { Channel } from '@vena/channels';
import { TelegramChannel, WhatsAppChannel, SlackChannel, DiscordChannel, SignalChannel } from '@vena/channels';

const log = createLogger('cli:channels');

export interface ConnectedChannel {
  name: string;
  channel: Channel;
  connected: boolean;
  disconnect: () => Promise<void>;
}

type MessageHandler = (
  inbound: InboundMessage,
  sendFn: (key: string, content: OutboundMessage) => Promise<void>,
) => Promise<void>;

export async function connectChannel(
  name: string,
  createFn: () => Channel,
  onMessage: MessageHandler,
  channelMap: Map<string, { channel: any; connected: boolean }>,
): Promise<ConnectedChannel | null> {
  try {
    const channel = createFn();
    channel.onMessage(async (inbound) => {
      await onMessage(inbound, (key, content) => channel.send(key, content));
    });
    await channel.connect();
    channelMap.set(name, { channel, connected: true });
    log.info(`${name} channel connected`);
    return {
      name,
      channel,
      connected: true,
      disconnect: () => channel.disconnect(),
    };
  } catch (err) {
    log.error({ error: err }, `Failed to connect ${name}`);
    return null;
  }
}

export interface ChannelConnectorConfig {
  config: VenaConfig;
  whatsappAuthDir: string;
  onMessage: MessageHandler;
  channelMap: Map<string, { channel: any; connected: boolean }>;
}

export interface ChannelConnectorResult {
  channels: ConnectedChannel[];
  telegramConnected: boolean;
  whatsappConnected: boolean;
  slackConnected: boolean;
  discordConnected: boolean;
  signalConnected: boolean;
}

export async function connectAllChannels(opts: ChannelConnectorConfig): Promise<ChannelConnectorResult> {
  const { config, whatsappAuthDir, onMessage, channelMap } = opts;
  const channels: ConnectedChannel[] = [];
  let telegramConnected = false;
  let whatsappConnected = false;
  let slackConnected = false;
  let discordConnected = false;
  let signalConnected = false;

  // Telegram
  if (config.channels.telegram?.enabled && config.channels.telegram?.token) {
    const result = await connectChannel('telegram', () =>
      new TelegramChannel(config.channels.telegram!.token!),
      onMessage, channelMap,
    );
    if (result) {
      channels.push(result);
      telegramConnected = true;
    }
  }

  // WhatsApp
  if (config.channels.whatsapp?.enabled) {
    fs.mkdirSync(whatsappAuthDir, { recursive: true });
    const result = await connectChannel('whatsapp', () =>
      new WhatsAppChannel({ authDir: whatsappAuthDir, printQRInTerminal: true }),
      onMessage, channelMap,
    );
    if (result) {
      channels.push(result);
      whatsappConnected = true;
    }
  }

  // Slack
  if (config.channels.slack?.enabled && config.channels.slack?.token && config.channels.slack?.signingSecret) {
    const result = await connectChannel('slack', () =>
      new SlackChannel({
        token: config.channels.slack!.token!,
        signingSecret: config.channels.slack!.signingSecret!,
        appToken: config.channels.slack!.appToken,
      }),
      onMessage, channelMap,
    );
    if (result) {
      channels.push(result);
      slackConnected = true;
    }
  }

  // Discord
  if (config.channels.discord?.enabled && config.channels.discord?.token && config.channels.discord?.applicationId) {
    const result = await connectChannel('discord', () =>
      new DiscordChannel({
        token: config.channels.discord!.token!,
        applicationId: config.channels.discord!.applicationId!,
      }),
      onMessage, channelMap,
    );
    if (result) {
      channels.push(result);
      discordConnected = true;
    }
  }

  // Signal
  if (config.channels.signal?.enabled && config.channels.signal?.apiUrl && config.channels.signal?.phoneNumber) {
    const result = await connectChannel('signal', () =>
      new SignalChannel({
        apiUrl: config.channels.signal!.apiUrl!,
        phoneNumber: config.channels.signal!.phoneNumber!,
      }),
      onMessage, channelMap,
    );
    if (result) {
      channels.push(result);
      signalConnected = true;
    }
  }

  return { channels, telegramConnected, whatsappConnected, slackConnected, discordConnected, signalConnected };
}
