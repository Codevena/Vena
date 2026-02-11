import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import { createLogger } from '@vena/shared';

const logger = createLogger('cron-tool');

export interface CronCallbacks {
  list: () => Array<{ id: string; name: string; schedule: string; enabled: boolean; nextRun?: string }>;
  add: (name: string, schedule: string, message: string, agentId?: string) => Promise<string>;
  remove: (jobId: string) => Promise<boolean>;
  enable: (jobId: string) => Promise<boolean>;
  disable: (jobId: string) => Promise<boolean>;
}

export class CronTool implements Tool {
  name = 'cron';
  description = 'Manage scheduled cron jobs. Actions: list (show all jobs), add (create a new job), remove (delete a job), enable/disable (toggle a job).';
  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'remove', 'enable', 'disable'],
        description: 'The action to perform',
      },
      job_id: {
        type: 'string',
        description: 'Job ID (required for remove/enable/disable)',
      },
      name: {
        type: 'string',
        description: 'Job name (required for add)',
      },
      schedule: {
        type: 'string',
        description: 'Cron schedule expression (required for add), e.g. "0 9 * * *" for daily at 9am',
      },
      message: {
        type: 'string',
        description: 'Message/prompt to send when job fires (required for add)',
      },
      agent_id: {
        type: 'string',
        description: 'Target agent ID (optional for add, defaults to self)',
      },
    },
    required: ['action'],
  };

  constructor(private callbacks: CronCallbacks) {}

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = String(input['action'] ?? '');

    switch (action) {
      case 'list': {
        const jobs = this.callbacks.list();
        if (jobs.length === 0) {
          return { content: 'No cron jobs configured.' };
        }
        const lines = jobs.map(
          (j) => `- ${j.name} (${j.id}): ${j.schedule} [${j.enabled ? 'enabled' : 'disabled'}]${j.nextRun ? ` next: ${j.nextRun}` : ''}`,
        );
        return { content: `Cron jobs:\n${lines.join('\n')}` };
      }

      case 'add': {
        const name = String(input['name'] ?? '');
        const schedule = String(input['schedule'] ?? '');
        const message = String(input['message'] ?? '');

        if (!name || !schedule || !message) {
          return { content: 'name, schedule, and message are required for add.', isError: true };
        }

        try {
          const jobId = await this.callbacks.add(name, schedule, message, input['agent_id'] as string | undefined);
          return { content: `Cron job created: ${name} (${jobId}) - schedule: ${schedule}` };
        } catch (err) {
          return { content: `Failed to add cron job: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      }

      case 'remove': {
        const jobId = String(input['job_id'] ?? '');
        if (!jobId) return { content: 'job_id is required for remove.', isError: true };
        const ok = await this.callbacks.remove(jobId);
        return { content: ok ? `Removed cron job ${jobId}.` : `Job ${jobId} not found.` };
      }

      case 'enable': {
        const jobId = String(input['job_id'] ?? '');
        if (!jobId) return { content: 'job_id is required for enable.', isError: true };
        const ok = await this.callbacks.enable(jobId);
        return { content: ok ? `Enabled cron job ${jobId}.` : `Job ${jobId} not found.` };
      }

      case 'disable': {
        const jobId = String(input['job_id'] ?? '');
        if (!jobId) return { content: 'job_id is required for disable.', isError: true };
        const ok = await this.callbacks.disable(jobId);
        return { content: ok ? `Disabled cron job ${jobId}.` : `Job ${jobId} not found.` };
      }

      default:
        return { content: `Unknown action: ${action}. Use list, add, remove, enable, or disable.`, isError: true };
    }
  }
}
