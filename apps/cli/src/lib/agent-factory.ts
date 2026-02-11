import type { VenaConfig, Message, Session, Tool, AgentConfig } from '@vena/shared';
import { createLogger } from '@vena/shared';
import {
  AgentLoop,
  MemoryManager,
  ConsultTool,
  DelegateTool,
} from '@vena/core';
import type { SemanticMemoryProvider } from '@vena/core';
import type { LLMProvider } from '@vena/providers';
import { AgentRegistry, MessageBus, MeshNetwork, IntentRouter, ConsultationManager, DelegationManager } from '@vena/agents';
import type { AgentDescriptor } from '@vena/agents';
import { buildToolsForTrust } from './tool-builder.js';
import type { ToolBuilderDeps } from './tool-builder.js';

const log = createLogger('cli:agents');

export async function collectStreamText(provider: LLMProvider, prompt: string): Promise<string> {
  let text = '';
  for await (const chunk of provider.chat({
    messages: [{ id: 'q', role: 'user', content: prompt, timestamp: new Date().toISOString() }],
    maxTokens: 2048,
  })) {
    if (chunk.type === 'text' && chunk.text) text += chunk.text;
  }
  return text;
}

export interface AgentFactoryDeps {
  config: VenaConfig;
  dataDir: string;
  defaultProvider: LLMProvider;
  providerName: string;
  modelName: string;
  semanticProvider?: SemanticMemoryProvider;
  skillsContext: string;
  toolBuilderDeps: ToolBuilderDeps;
  createProvider: (
    config: VenaConfig,
    overrideProvider?: string,
    overrideModel?: string,
    agentConfig?: AgentConfig,
  ) => { provider: LLMProvider; model: string; providerName: string };
}

export interface CreatedAgents {
  agentLoops: Map<string, AgentLoop>;
  agentMemory: Map<string, MemoryManager>;
  agentProviderNames: Map<string, string>;
  agentProviders: Map<string, LLMProvider>;
  mesh?: MeshNetwork;
  consultationManager?: ConsultationManager;
  delegationManager?: DelegationManager;
  defaultAgentId: string;
  displayTools: Tool[];
}

export function createAgentLoops(deps: AgentFactoryDeps): CreatedAgents {
  const {
    config,
    dataDir,
    defaultProvider,
    providerName,
    modelName,
    semanticProvider,
    skillsContext,
    toolBuilderDeps,
  } = deps;

  const agentLoops = new Map<string, AgentLoop>();
  const agentMemory = new Map<string, MemoryManager>();
  const agentProviderNames = new Map<string, string>();
  const agentProviders = new Map<string, LLMProvider>();
  const registry = config.agents.registry;

  const agentInfoList = registry.map((a) => ({
    id: a.id,
    name: a.name,
    capabilities: a.capabilities,
  }));

  function buildAgentsContext(selfAgentId: string): string | undefined {
    if (registry.length <= 1) return undefined;
    const peers = registry.filter((a) => a.id !== selfAgentId);
    if (peers.length === 0) return undefined;

    const lines = [
      'You are part of a multi-agent team. You can consult or delegate tasks to peer agents using the consult_agent and delegate_task tools.',
      '',
      'Available peers:',
      ...peers.map(
        (a) => `- ${a.name} (id: ${a.id}): capabilities=[${a.capabilities.join(', ')}]`,
      ),
      '',
      'Use consult_agent to ask a peer a question. Use delegate_task to hand off a task entirely.',
    ];
    return lines.join('\n');
  }

  // Leaf-loop runner: creates a fresh AgentLoop WITHOUT mesh tools (prevents recursion)
  async function runLeafAgent(
    targetAgentId: string,
    prompt: string,
    role: 'consult' | 'delegate',
  ): Promise<string> {
    const targetConfig = registry.find((a) => a.id === targetAgentId);
    if (!targetConfig) return `Agent "${targetAgentId}" not found.`;

    const trustLevel = (targetConfig.trustLevel ?? config.security.defaultTrustLevel ?? 'limited') as
      'full' | 'limited' | 'readonly';
    const { tools: leafTools, guard: leafGuard } = buildToolsForTrust(trustLevel, toolBuilderDeps);

    const provider = agentProviders.get(targetAgentId) ?? defaultProvider;
    const mm = agentMemory.get(targetAgentId);
    const leafMemory = mm ?? new MemoryManager({
      workspacePath: dataDir,
      agentId: targetAgentId,
      semantic: semanticProvider,
    });

    const systemPrefix = role === 'consult'
      ? 'A peer agent is consulting you. Answer their question concisely.'
      : 'A peer agent is delegating a task to you. Complete it and report the result.';

    const leafLoop = new AgentLoop({
      provider,
      tools: leafTools,
      systemPrompt: `${systemPrefix}\n\n${targetConfig.persona ?? 'You are a helpful AI assistant.'}`,
      skillsContext: skillsContext || undefined,
      memoryManager: leafMemory,
      guard: leafGuard,
      workspacePath: dataDir,
      options: {
        maxIterations: 5,
        maxTokens: 2048,
        streamTools: true,
      },
    });

    const ephemeralSession: Session = {
      id: `sess_leaf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channelName: 'mesh',
      sessionKey: `leaf:${targetAgentId}:${Date.now()}`,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        userId: 'mesh',
        agentId: targetAgentId,
        tokenCount: 0,
        compactionCount: 0,
      },
    };

    const userMessage: Message = {
      id: `msg_leaf_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    };

    let responseText = '';
    for await (const event of leafLoop.run(userMessage, ephemeralSession)) {
      if (event.type === 'text') responseText += event.text;
      else if (event.type === 'done') responseText = event.response || responseText;
      else if (event.type === 'error') return `Error: ${event.error.message}`;
    }

    if (mm) {
      try {
        await mm.log(`[${role === 'consult' ? 'consultation' : 'delegation'} from peer] ${prompt.slice(0, 200)}`);
        if (responseText) {
          await mm.log(`[${role} response] ${responseText.slice(0, 500)}`);
        }
      } catch {
        // Non-critical
      }
    }

    return responseText || 'No response from agent.';
  }

  for (const agentConfig of registry) {
    const trustLevel = (agentConfig.trustLevel ?? config.security.defaultTrustLevel ?? 'limited') as
      'full' | 'limited' | 'readonly';

    // Per-agent provider (may differ by provider/model)
    let agentProvider: LLMProvider;
    let agentProviderName = providerName;
    try {
      const result = deps.createProvider(config, agentConfig.provider, agentConfig.model, agentConfig);
      agentProvider = result.provider;
      agentProviderName = result.providerName;
    } catch {
      agentProvider = defaultProvider;
    }
    agentProviderNames.set(agentConfig.id, agentProviderName);
    agentProviders.set(agentConfig.id, agentProvider);

    // Per-agent memory
    const mm = new MemoryManager({
      workspacePath: dataDir,
      agentId: agentConfig.id,
      semantic: semanticProvider,
    });
    agentMemory.set(agentConfig.id, mm);

    // Per-agent tools
    const { tools, guard } = buildToolsForTrust(trustLevel, toolBuilderDeps);

    // Add mesh tools when multi-agent (consult + delegate)
    if (registry.length > 1) {
      tools.push(
        new ConsultTool(
          async (targetId, question, _ctx) => {
            log.debug({ from: agentConfig.id, to: targetId, question: question.slice(0, 100) }, 'Agent consultation');
            return runLeafAgent(targetId, question, 'consult');
          },
          agentInfoList,
          agentConfig.id,
        ),
      );
      tools.push(
        new DelegateTool(
          async (targetId, task, _ctx) => {
            log.debug({ from: agentConfig.id, to: targetId, task: task.slice(0, 100) }, 'Agent delegation');
            return runLeafAgent(targetId, task, 'delegate');
          },
          agentInfoList,
          agentConfig.id,
        ),
      );
    }

    const loop = new AgentLoop({
      provider: agentProvider,
      tools,
      systemPrompt: agentConfig.persona ?? 'You are a helpful AI assistant.',
      skillsContext: skillsContext || undefined,
      agentsContext: buildAgentsContext(agentConfig.id),
      memoryManager: mm,
      guard,
      workspacePath: dataDir,
      thinking: agentConfig.thinking?.enabled ? {
        enabled: true,
        budgetTokens: agentConfig.thinking.budgetTokens ?? 10000,
      } : undefined,
      options: {
        maxIterations: 10,
        maxTokens: 4096,
        streamTools: true,
      },
    });

    agentLoops.set(agentConfig.id, loop);
    log.info({ agent: agentConfig.name, id: agentConfig.id, trustLevel, tools: tools.map(t => t.name) }, 'Agent loop created');
  }

  // Collect display tool names from first agent
  const firstAgentConfig = registry[0];
  const firstTrust = (firstAgentConfig?.trustLevel ?? 'limited') as 'full' | 'limited' | 'readonly';
  const displayTools = buildToolsForTrust(firstTrust, toolBuilderDeps).tools;

  const defaultAgentId = firstAgentConfig?.id ?? 'main';

  // Mesh Network (multi-agent routing)
  let mesh: MeshNetwork | undefined;
  let consultationManager: ConsultationManager | undefined;
  let delegationManager: DelegationManager | undefined;

  if (registry.length > 1) {
    const agentReg = new AgentRegistry();
    const bus = new MessageBus();
    mesh = new MeshNetwork(agentReg, bus);

    for (const agentConfig of registry) {
      mesh.addAgent({
        id: agentConfig.id,
        name: agentConfig.name,
        persona: agentConfig.persona,
        capabilities: agentConfig.capabilities,
        provider: agentConfig.provider,
        model: agentConfig.model ?? modelName,
        status: 'active',
        channels: agentConfig.channels,
        trustLevel: agentConfig.trustLevel,
        memoryNamespace: `agent-${agentConfig.id}`,
      });
    }

    // Wire LLM-based intent router
    const intentRouter = new IntentRouter(
      (prompt: string) => collectStreamText(defaultProvider, prompt),
      defaultAgentId,
    );
    const descriptors: AgentDescriptor[] = registry.map((a) => ({
      id: a.id,
      name: a.name,
      persona: a.persona,
      capabilities: a.capabilities,
    }));
    intentRouter.setAgents(descriptors);
    mesh.setIntentRouter(intentRouter);

    consultationManager = new ConsultationManager(bus, agentReg, 30000);
    delegationManager = new DelegationManager(bus, agentReg);

    log.info({ agents: registry.length }, 'Mesh network + intent routing + collaboration managers initialized');
  }

  return {
    agentLoops,
    agentMemory,
    agentProviderNames,
    agentProviders,
    mesh,
    consultationManager,
    delegationManager,
    defaultAgentId,
    displayTools,
  };
}
