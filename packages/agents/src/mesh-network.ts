import type { AgentProfile } from '@vena/shared';
import { AgentError } from '@vena/shared';
import type { AgentRegistry } from './agent-registry.js';
import type { MessageBus } from './message-bus.js';

interface Edge {
  from: string;
  to: string;
}

export class MeshNetwork {
  private edges: Edge[] = [];

  constructor(
    private registry: AgentRegistry,
    private bus: MessageBus,
  ) {}

  addAgent(profile: AgentProfile): void {
    this.registry.register(profile);

    // Connect new agent to all existing agents
    for (const existing of this.registry.getAll()) {
      if (existing.id !== profile.id) {
        this.edges.push({ from: profile.id, to: existing.id });
        this.edges.push({ from: existing.id, to: profile.id });
      }
    }
  }

  removeAgent(id: string): void {
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    this.registry.unregister(id);
  }

  getTopology(): { nodes: AgentProfile[]; edges: Edge[] } {
    return {
      nodes: this.registry.getAll(),
      edges: [...this.edges],
    };
  }

  routeMessage(message: string, fromAgentId: string): string {
    const keywords = message.toLowerCase().split(/\s+/);
    const connectedIds = this.edges
      .filter((e) => e.from === fromAgentId)
      .map((e) => e.to);

    let bestAgentId: string | undefined;
    let bestScore = 0;

    for (const agentId of connectedIds) {
      const agent = this.registry.get(agentId);
      if (!agent || agent.status === 'offline') continue;

      const score = agent.capabilities.filter((cap) =>
        keywords.some((kw) => cap.includes(kw) || kw.includes(cap)),
      ).length;

      if (score > bestScore) {
        bestScore = score;
        bestAgentId = agentId;
      }
    }

    if (!bestAgentId) {
      throw new AgentError(
        'No suitable agent found for message routing',
        fromAgentId,
      );
    }

    return bestAgentId;
  }

  broadcast(fromAgentId: string, message: string): void {
    const connectedIds = this.edges
      .filter((e) => e.from === fromAgentId)
      .map((e) => e.to);

    for (const toAgentId of connectedIds) {
      this.bus.publish(`agent:${toAgentId}`, {
        type: 'broadcast',
        fromAgentId,
        toAgentId,
        payload: { message },
        priority: 'normal',
      });
    }
  }
}
