import type { Tool, ToolContext, ToolResult, OutboundMessage } from '@vena/shared';
import { createLogger } from '@vena/shared';

const logger = createLogger('message-tool');

export interface MessageCallbacks {
  listChannels: () => Array<{ name: string; connected: boolean }>;
  send: (channelName: string, sessionKey: string, content: OutboundMessage) => Promise<void>;
}

export class MessageTool implements Tool {
  name = 'message';
  description = 'Send proactive messages to connected channels. Actions: list_channels (show connected channels), send (send a message to a specific channel/session).';
  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list_channels', 'send'],
        description: 'The action to perform',
      },
      channel: {
        type: 'string',
        description: 'Channel name to send to (required for send)',
      },
      session_key: {
        type: 'string',
        description: 'Session key / recipient identifier (required for send)',
      },
      text: {
        type: 'string',
        description: 'Message text to send (required for send)',
      },
    },
    required: ['action'],
  };

  constructor(private callbacks: MessageCallbacks) {}

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = String(input['action'] ?? '');

    switch (action) {
      case 'list_channels': {
        const channels = this.callbacks.listChannels();
        if (channels.length === 0) {
          return { content: 'No channels connected.' };
        }
        const lines = channels.map(
          (c) => `- ${c.name} [${c.connected ? 'connected' : 'disconnected'}]`,
        );
        return { content: `Connected channels:\n${lines.join('\n')}` };
      }

      case 'send': {
        const channel = String(input['channel'] ?? '');
        const sessionKey = String(input['session_key'] ?? '');
        const text = String(input['text'] ?? '');

        if (!channel || !sessionKey || !text) {
          return { content: 'channel, session_key, and text are required for send.', isError: true };
        }

        try {
          await this.callbacks.send(channel, sessionKey, { text });
          logger.info({ channel, sessionKey, length: text.length }, 'Proactive message sent');
          return { content: `Message sent to ${channel}:${sessionKey} (${text.length} chars).` };
        } catch (err) {
          return { content: `Failed to send: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      }

      default:
        return { content: `Unknown action: ${action}. Use list_channels or send.`, isError: true };
    }
  }
}
