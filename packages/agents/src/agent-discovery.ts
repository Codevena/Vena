import type { AgentProfile } from '@vena/shared';
import type { AgentRegistry } from './agent-registry.js';

export class AgentDiscovery {
  constructor(private registry: AgentRegistry) {}

  discover(): AgentProfile[] {
    return this.registry.getAll();
  }

  findByCapability(capability: string): AgentProfile[] {
    return this.registry.getByCapability(capability);
  }

  matchBest(requirements: string[]): AgentProfile | undefined {
    return this.registry.findBestMatch(requirements);
  }

  async healthCheck(agentId: string): Promise<boolean> {
    const agent = this.registry.get(agentId);
    if (!agent) return false;
    return agent.status !== 'offline';
  }

  getCapabilities(agentId: string): string[] {
    const agent = this.registry.get(agentId);
    return agent?.capabilities ?? [];
  }
}
