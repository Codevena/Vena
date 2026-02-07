import type { AgentProfile } from '@vena/shared';
import { AgentError } from '@vena/shared';

export class AgentRegistry {
  private agents = new Map<string, AgentProfile>();

  register(profile: AgentProfile): void {
    if (this.agents.has(profile.id)) {
      throw new AgentError(`Agent already registered: ${profile.id}`, profile.id);
    }
    this.agents.set(profile.id, profile);
  }

  unregister(id: string): void {
    if (!this.agents.has(id)) {
      throw new AgentError(`Agent not found: ${id}`, id);
    }
    this.agents.delete(id);
  }

  get(id: string): AgentProfile | undefined {
    return this.agents.get(id);
  }

  getAll(): AgentProfile[] {
    return Array.from(this.agents.values());
  }

  getByCapability(capability: string): AgentProfile[] {
    return this.getAll().filter((agent) =>
      agent.capabilities.includes(capability),
    );
  }

  getByStatus(status: string): AgentProfile[] {
    return this.getAll().filter((agent) => agent.status === status);
  }

  updateStatus(id: string, status: AgentProfile['status']): void {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentError(`Agent not found: ${id}`, id);
    }
    agent.status = status;
    this.agents.set(id, agent);
  }

  findBestMatch(capabilities: string[]): AgentProfile | undefined {
    let bestAgent: AgentProfile | undefined;
    let bestScore = 0;

    for (const agent of this.agents.values()) {
      if (agent.status === 'offline') continue;

      const score = capabilities.filter((cap) =>
        agent.capabilities.includes(cap),
      ).length;

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestAgent;
  }
}
