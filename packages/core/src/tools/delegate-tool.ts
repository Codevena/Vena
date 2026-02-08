import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import { createLogger } from '@vena/shared';

const logger = createLogger('delegate-tool');

export interface AgentInfo {
  id: string;
  name: string;
  capabilities: string[];
}

export type DelegateFn = (targetAgentId: string, task: string, context: ToolContext) => Promise<string>;

export class DelegateTool implements Tool {
  name = 'delegate_task';
  description: string;
  inputSchema: Record<string, unknown>;

  constructor(
    private delegateFn: DelegateFn,
    private agents: AgentInfo[],
    private selfAgentId: string,
  ) {
    const peers = agents.filter((a) => a.id !== selfAgentId);
    const peerList = peers
      .map((a) => `  - "${a.id}" (${a.name}): ${a.capabilities.join(', ')}`)
      .join('\n');

    this.description = [
      'Delegate a task to another agent and get their result. Use this to hand off work to a specialist agent.',
      'Available peers:',
      peerList,
    ].join('\n');

    this.inputSchema = {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The ID of the agent to delegate to',
        },
        task: {
          type: 'string',
          description: 'The task to delegate',
        },
      },
      required: ['agent_id', 'task'],
    };
  }

  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const agentId = String(input['agent_id'] ?? '');
    const task = String(input['task'] ?? '');

    if (!agentId || !task) {
      return { content: 'Both agent_id and task are required.', isError: true };
    }

    if (agentId === this.selfAgentId) {
      return { content: 'Cannot delegate to yourself. Choose a different agent.', isError: true };
    }

    const peer = this.agents.find((a) => a.id === agentId);
    if (!peer) {
      const available = this.agents
        .filter((a) => a.id !== this.selfAgentId)
        .map((a) => a.id)
        .join(', ');
      return { content: `Agent "${agentId}" not found. Available: ${available}`, isError: true };
    }

    try {
      logger.info({ from: this.selfAgentId, to: agentId, task: task.slice(0, 100) }, 'Delegating task');
      const response = await this.delegateFn(agentId, task, context);
      return { content: response };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ error: err, agentId }, 'Delegation failed');
      return { content: `Delegation to "${agentId}" failed: ${msg}`, isError: true };
    }
  }
}
