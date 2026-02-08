import { createLogger } from '@vena/shared';

const logger = createLogger('intent-router');

export interface AgentDescriptor {
  id: string;
  name: string;
  persona: string;
  capabilities: string[];
}

export type ClassifyFn = (prompt: string) => Promise<string>;

export class IntentRouter {
  private agents: AgentDescriptor[] = [];
  private defaultAgentId: string;

  constructor(
    private classifyFn: ClassifyFn,
    defaultAgentId: string,
  ) {
    this.defaultAgentId = defaultAgentId;
  }

  setAgents(agents: AgentDescriptor[]): void {
    this.agents = agents;
  }

  async route(message: string, fromAgentId: string): Promise<string> {
    if (this.agents.length <= 1) {
      return this.defaultAgentId;
    }

    const agentList = this.agents
      .map((a) => `- ID: ${a.id} | Name: ${a.name} | Capabilities: ${a.capabilities.join(', ')} | Persona: ${a.persona}`)
      .join('\n');

    const prompt = [
      'You are an intent router. Given a user message and a list of available agents, return ONLY the agent ID that best matches the message intent.',
      '',
      'Agents:',
      agentList,
      '',
      `User message: "${message}"`,
      '',
      'Respond with ONLY the agent ID, nothing else.',
    ].join('\n');

    try {
      const raw = await this.classifyFn(prompt);
      const response = raw.trim();

      // Validate the response is a known agent ID
      const matched = this.agents.find((a) => response.includes(a.id));
      if (matched) {
        logger.debug({ message: message.slice(0, 80), routed: matched.id }, 'Intent routed');
        return matched.id;
      }

      logger.debug({ message: message.slice(0, 80), response }, 'Intent router: no valid agent ID in response, using default');
      return this.defaultAgentId;
    } catch (err) {
      logger.warn({ error: err }, 'Intent classification failed, using default agent');
      return this.defaultAgentId;
    }
  }
}
