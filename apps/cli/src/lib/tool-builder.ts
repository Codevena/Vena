import type { Tool, VenaConfig, Session } from '@vena/shared';
import {
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  WebBrowseTool,
  BrowserTool,
  GoogleTool,
  ToolGuard,
  CronTool,
  SessionTool,
  MessageTool,
  ImageTool,
} from '@vena/core';
import type { BrowserAdapter, GoogleAdapters, SecurityPolicy } from '@vena/core';
import type { ChatSessionManager } from './session-manager.js';

export interface ToolBuilderDeps {
  config: VenaConfig;
  dataDir: string;
  browserAdapter?: BrowserAdapter;
  googleAdapters?: GoogleAdapters;
  cronService: {
    listJobs: () => Array<{
      id: string;
      name: string;
      schedule: { kind: string; expr?: string; at?: string; everyMs?: number };
      enabled: boolean;
      state: { nextRunAtMs?: number };
    }>;
    addJob: (opts: any) => Promise<{ id: string }>;
    removeJob: (id: string) => Promise<boolean>;
    updateJob: (id: string, update: { enabled: boolean }) => Promise<unknown>;
  };
  sessions: ChatSessionManager;
  connectedChannels: Map<string, { channel: any; connected: boolean }>;
}

export function buildToolsForTrust(
  trustLevel: 'full' | 'limited' | 'readonly',
  deps: ToolBuilderDeps,
): { tools: Tool[]; guard: ToolGuard } {
  const { config, dataDir, browserAdapter, googleAdapters, cronService, sessions, connectedChannels } = deps;

  const securityPolicy: SecurityPolicy = {
    trustLevel,
    allowedTools: ['*'],
    allowedPaths: [dataDir],
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
    const dockerCfg = config.computer.docker;
    tools.push(new BashTool({
      envPassthrough: config.security.shell.envPassthrough,
      docker: dockerCfg?.enabled ? {
        image: dockerCfg.image,
        memoryLimit: dockerCfg.memoryLimit,
        cpuLimit: dockerCfg.cpuLimit,
        network: dockerCfg.network,
        readOnlyRoot: dockerCfg.readOnlyRoot,
      } : undefined,
    }));
  }

  if (trustLevel !== 'readonly' && config.computer.browser.enabled && browserAdapter) {
    tools.push(new BrowserTool(browserAdapter, config.computer.browser.headless));
  }

  if (googleAdapters) {
    tools.push(new GoogleTool(googleAdapters));
  }

  // Cron tool (full trust only)
  if (trustLevel === 'full') {
    tools.push(new CronTool({
      list: () => cronService.listJobs().map(j => ({
        id: j.id,
        name: j.name,
        schedule: j.schedule.kind === 'cron' ? j.schedule.expr! : j.schedule.kind === 'at' ? `at ${j.schedule.at}` : `every ${j.schedule.everyMs}ms`,
        enabled: j.enabled,
        nextRun: j.state.nextRunAtMs ? new Date(j.state.nextRunAtMs).toISOString() : undefined,
      })),
      add: async (name, schedule, message, agentId) => {
        const job = await cronService.addJob({
          name,
          schedule: { kind: 'cron', expr: schedule },
          payload: { kind: 'agentTurn', message },
          agentId,
          enabled: true,
          sessionTarget: 'main',
          wakeMode: 'now',
        });
        return job.id;
      },
      remove: async (jobId) => cronService.removeJob(jobId),
      enable: async (jobId) => {
        const result = await cronService.updateJob(jobId, { enabled: true });
        return !!result;
      },
      disable: async (jobId) => {
        const result = await cronService.updateJob(jobId, { enabled: false });
        return !!result;
      },
    }));
  }

  // Session tool
  tools.push(new SessionTool({
    list: () => sessions.list().map(([key, s]) => ({
      sessionKey: key,
      channelName: s.channelName,
      agentId: s.metadata.agentId,
      messageCount: s.messages.length,
      updatedAt: s.updatedAt,
    })),
    get: (key) => sessions.get(key),
    clear: (key) => sessions.delete(key),
  }));

  // Message tool (for proactive outbound messages)
  if (trustLevel !== 'readonly') {
    tools.push(new MessageTool({
      listChannels: () => Array.from(connectedChannels.entries()).map(([name, c]) => ({
        name,
        connected: c.connected,
      })),
      send: async (channelName, sessionKey, content) => {
        const entry = connectedChannels.get(channelName);
        if (!entry || !entry.connected) {
          throw new Error(`Channel "${channelName}" not connected`);
        }
        await entry.channel.send(sessionKey, content);
      },
    }));
  }

  // Image tool
  if (config.image?.apiKey) {
    tools.push(new ImageTool({
      provider: config.image.provider ?? 'openai',
      model: config.image.model ?? 'dall-e-3',
      apiKey: config.image.apiKey,
    }));
  }

  return { tools, guard };
}
