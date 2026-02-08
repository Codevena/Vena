import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import { createLogger } from '@vena/shared';

const logger = createLogger('consult-tool');

export interface AgentInfo {
  id: string;
  name: string;
  capabilities: string[];
}

export type ConsultFn = (targetAgentId: string, question: string, context: ToolContext) => Promise<string>;

export class ConsultTool implements Tool {
  name = 'consult_agent';
  description: string;
  inputSchema: Record<string, unknown>;

  constructor(
    private consultFn: ConsultFn,
    private agents: AgentInfo[],
    private selfAgentId: string,
  ) {
    const peers = agents.filter((a) => a.id !== selfAgentId);
    const peerList = peers
      .map((a) => `  - "${a.id}" (${a.name}): ${a.capabilities.join(', ')}`)
      .join('\n');

    this.description = [
      'Ask another agent a question and get their response. Use this when a peer agent has expertise you need.',
      'Available peers:',
      peerList,
    ].join('\n');

    this.inputSchema = {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The ID of the agent to consult',
        },
        question: {
          type: 'string',
          description: 'The question to ask the agent',
        },
      },
      required: ['agent_id', 'question'],
    };
  }

  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const agentId = String(input['agent_id'] ?? '');
    const question = String(input['question'] ?? '');

    if (!agentId || !question) {
      return { content: 'Both agent_id and question are required.', isError: true };
    }

    if (agentId === this.selfAgentId) {
      return { content: 'Cannot consult yourself. Choose a different agent.', isError: true };
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
      logger.info({ from: this.selfAgentId, to: agentId, question: question.slice(0, 100) }, 'Consulting agent');
      const response = await this.consultFn(agentId, question, context);
      return { content: response };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ error: err, agentId }, 'Consultation failed');
      return { content: `Consultation with "${agentId}" failed: ${msg}`, isError: true };
    }
  }
}
