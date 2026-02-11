import type { Tool, ToolContext, ToolResult, Session } from '@vena/shared';
import { createLogger } from '@vena/shared';

const logger = createLogger('session-tool');

export interface SessionCallbacks {
  list: () => Array<{ sessionKey: string; channelName: string; agentId: string; messageCount: number; updatedAt: string }>;
  get: (sessionKey: string) => Session | undefined;
  clear: (sessionKey: string) => boolean;
}

export class SessionTool implements Tool {
  name = 'session';
  description = 'Manage chat sessions. Actions: list (show active sessions), get (inspect a session), clear (remove a session).';
  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'clear'],
        description: 'The action to perform',
      },
      session_key: {
        type: 'string',
        description: 'Session key (required for get/clear)',
      },
    },
    required: ['action'],
  };

  constructor(private callbacks: SessionCallbacks) {}

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = String(input['action'] ?? '');

    switch (action) {
      case 'list': {
        const sessions = this.callbacks.list();
        if (sessions.length === 0) {
          return { content: 'No active sessions.' };
        }
        const lines = sessions.map(
          (s) => `- ${s.sessionKey} [${s.channelName}] agent=${s.agentId} messages=${s.messageCount} updated=${s.updatedAt}`,
        );
        return { content: `Active sessions (${sessions.length}):\n${lines.join('\n')}` };
      }

      case 'get': {
        const key = String(input['session_key'] ?? '');
        if (!key) return { content: 'session_key is required for get.', isError: true };

        const session = this.callbacks.get(key);
        if (!session) return { content: `Session "${key}" not found.`, isError: true };

        const summary = [
          `Session: ${session.sessionKey}`,
          `Channel: ${session.channelName}`,
          `Agent: ${session.metadata.agentId}`,
          `Messages: ${session.messages.length}`,
          `Created: ${session.createdAt}`,
          `Updated: ${session.updatedAt}`,
          `Tokens: ${session.metadata.tokenCount}`,
          `Compactions: ${session.metadata.compactionCount}`,
        ];

        // Show last 5 messages summary
        const recent = session.messages.slice(-5);
        if (recent.length > 0) {
          summary.push('', 'Recent messages:');
          for (const msg of recent) {
            const content = typeof msg.content === 'string' ? msg.content.slice(0, 100) : '[blocks]';
            summary.push(`  [${msg.role}] ${content}`);
          }
        }

        return { content: summary.join('\n') };
      }

      case 'clear': {
        const key = String(input['session_key'] ?? '');
        if (!key) return { content: 'session_key is required for clear.', isError: true };
        const ok = this.callbacks.clear(key);
        return { content: ok ? `Cleared session "${key}".` : `Session "${key}" not found.` };
      }

      default:
        return { content: `Unknown action: ${action}. Use list, get, or clear.`, isError: true };
    }
  }
}
