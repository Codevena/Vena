/**
 * E2E Tests: Multi-Agent Mesh Network
 *
 * Tests actual agent routing, message bus, consultation, delegation.
 * No API keys needed.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentRegistry,
  MessageBus,
  MeshNetwork,
  DelegationManager,
  SharedMemoryManager,
} from '@vena/agents';
import type { AgentProfile } from '@vena/shared';

function makeAgent(overrides: Partial<AgentProfile> & { id: string; name: string }): AgentProfile {
  return {
    persona: 'Test agent',
    capabilities: [],
    provider: 'openai',
    model: 'gpt-4',
    status: 'active',
    channels: ['api'],
    trustLevel: 'limited',
    memoryNamespace: `agent-${overrides.id}`,
    ...overrides,
  };
}

describe('MeshNetwork E2E', () => {
  it('routes messages to agent with matching capabilities', () => {
    const registry = new AgentRegistry();
    const bus = new MessageBus();
    const mesh = new MeshNetwork(registry, bus);

    mesh.addAgent(makeAgent({
      id: 'coder',
      name: 'Coder',
      capabilities: ['coding', 'typescript', 'debugging'],
    }));
    mesh.addAgent(makeAgent({
      id: 'writer',
      name: 'Writer',
      capabilities: ['writing', 'editing', 'content', 'article'],
    }));

    // "Write an article" — keywords match writer's capabilities (writing, article)
    const target = mesh.routeMessage('please writing an article', 'coder');
    expect(target).toBe('writer');
  });

  it('routes coding requests to coder agent', () => {
    const registry = new AgentRegistry();
    const bus = new MessageBus();
    const mesh = new MeshNetwork(registry, bus);

    mesh.addAgent(makeAgent({
      id: 'coder',
      name: 'Coder',
      capabilities: ['coding', 'typescript', 'debugging'],
    }));
    mesh.addAgent(makeAgent({
      id: 'writer',
      name: 'Writer',
      capabilities: ['writing', 'editing', 'content'],
    }));

    const target = mesh.routeMessage('fix this typescript debugging issue', 'writer');
    expect(target).toBe('coder');
  });

  it('throws when no capability match', () => {
    const registry = new AgentRegistry();
    const bus = new MessageBus();
    const mesh = new MeshNetwork(registry, bus);

    mesh.addAgent(makeAgent({
      id: 'default',
      name: 'Default',
      capabilities: ['general'],
    }));
    mesh.addAgent(makeAgent({
      id: 'specialist',
      name: 'Specialist',
      capabilities: ['quantum-physics'],
    }));

    // "hello" doesn't match any capability
    expect(() => mesh.routeMessage('hello world how are you', 'default')).toThrow();
  });

  it('creates fully connected mesh topology', () => {
    const registry = new AgentRegistry();
    const bus = new MessageBus();
    const mesh = new MeshNetwork(registry, bus);

    mesh.addAgent(makeAgent({ id: 'a', name: 'A', capabilities: ['x'] }));
    mesh.addAgent(makeAgent({ id: 'b', name: 'B', capabilities: ['y'] }));
    mesh.addAgent(makeAgent({ id: 'c', name: 'C', capabilities: ['z'] }));

    const topo = mesh.getTopology();
    // 3 agents → 6 edges (bidirectional: a↔b, a↔c, b↔c)
    expect(topo.edges.length).toBe(6);
    expect(topo.nodes.length).toBe(3);
  });
});

describe('MessageBus E2E', () => {
  it('publishes and receives messages', () => {
    const bus = new MessageBus();
    const received: unknown[] = [];

    bus.subscribe('test-channel', (msg) => {
      received.push(msg);
    });

    bus.publish('test-channel', {
      type: 'broadcast',
      fromAgentId: 'agent-1',
      payload: { message: 'hello' },
      priority: 'normal',
    });

    expect(received.length).toBe(1);
  });

  it('handles multiple subscribers', () => {
    const bus = new MessageBus();
    let count = 0;

    bus.subscribe('multi', () => { count++; });
    bus.subscribe('multi', () => { count++; });

    bus.publish('multi', {
      type: 'broadcast',
      fromAgentId: 'a',
      payload: {},
      priority: 'normal',
    });

    expect(count).toBe(2);
  });
});

describe('SharedMemoryManager E2E', () => {
  it('shares and retrieves data between agents', () => {
    const shared = new SharedMemoryManager('test-ns');

    shared.share('favorite_color', 'orange', 'agent-1');
    const value = shared.get('favorite_color');
    expect(value?.value).toBe('orange');
    expect(value?.fromAgentId).toBe('agent-1');
  });

  it('searches shared memory', () => {
    const shared = new SharedMemoryManager('search-ns');

    shared.share('project_name', 'Vena', 'agent-1');
    shared.share('project_lang', 'TypeScript', 'agent-1');
    shared.share('unrelated', 'data', 'agent-2');

    const results = shared.search('project');
    expect(results.length).toBe(2);
  });

  it('enforces access rules', () => {
    const shared = new SharedMemoryManager('acl-ns');

    shared.share('secret', 'classified', 'agent-1');
    shared.setAccessRule('secret', ['agent-1']);

    expect(shared.isAccessible('agent-1', 'secret')).toBe(true);
    expect(shared.isAccessible('agent-2', 'secret')).toBe(false);
  });
});

describe('DelegationManager E2E', () => {
  it('creates and tracks delegation tasks', async () => {
    const bus = new MessageBus();
    const registry = new AgentRegistry();
    registry.register(makeAgent({ id: 'agent-2', name: 'Agent2', capabilities: ['review'] }));

    const delegation = new DelegationManager(bus, registry);

    const task = await delegation.delegate({
      fromAgentId: 'agent-1',
      toAgentId: 'agent-2',
      task: 'Review this code',
      priority: 'normal',
    });

    expect(task).toBeDefined();
    expect(task.id).toBeTruthy();
    expect(task.status).toBe('pending');
    expect(task.task).toBe('Review this code');

    // Can retrieve status
    const status = delegation.getStatus(task.id);
    expect(status).toBeDefined();
    expect(status!.toAgentId).toBe('agent-2');
  });

  it('rejects delegation to unknown agent', async () => {
    const bus = new MessageBus();
    const registry = new AgentRegistry();
    const delegation = new DelegationManager(bus, registry);

    await expect(delegation.delegate({
      fromAgentId: 'agent-1',
      toAgentId: 'unknown-agent',
      task: 'Do something',
      priority: 'normal',
    })).rejects.toThrow();
  });
});
