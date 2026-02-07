import type { AgentProfile, Character } from '@vena/shared';
import { CHARACTERS } from '@vena/shared';
import { nanoid } from 'nanoid';

export type AgentTemplate = 'coder' | 'researcher' | 'writer' | 'reviewer' | 'devops';

interface AgentConfig {
  name: string;
  persona: string;
  capabilities: string[];
  provider?: string;
  model?: string;
  trustLevel?: AgentProfile['trustLevel'];
  characterId?: string;
}

const TEMPLATES: Record<AgentTemplate, Omit<AgentConfig, 'name'>> = {
  coder: {
    persona: 'Expert software engineer specializing in writing clean, efficient code.',
    capabilities: ['coding', 'typescript', 'javascript', 'debugging'],
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    trustLevel: 'full',
    characterId: 'ghost',
  },
  researcher: {
    persona: 'Thorough research analyst skilled at finding and synthesizing information.',
    capabilities: ['research', 'analysis', 'web-search'],
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    trustLevel: 'limited',
    characterId: 'sage',
  },
  writer: {
    persona: 'Creative writer and editor producing clear, engaging content.',
    capabilities: ['writing', 'editing', 'content'],
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    trustLevel: 'limited',
    characterId: 'spark',
  },
  reviewer: {
    persona: 'Meticulous code reviewer focused on quality, correctness, and best practices.',
    capabilities: ['code-review', 'testing', 'quality'],
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    trustLevel: 'limited',
    characterId: 'atlas',
  },
  devops: {
    persona: 'Infrastructure and deployment specialist ensuring reliable, scalable systems.',
    capabilities: ['docker', 'deployment', 'ci-cd', 'monitoring'],
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    trustLevel: 'full',
    characterId: 'nova',
  },
};

export class AgentFactory {
  create(config: AgentConfig): AgentProfile {
    return {
      id: nanoid(),
      name: config.name,
      persona: config.persona,
      capabilities: config.capabilities,
      provider: config.provider ?? 'anthropic',
      model: config.model ?? 'claude-sonnet-4-5-20250929',
      status: 'idle',
      channels: [],
      trustLevel: config.trustLevel ?? 'limited',
      memoryNamespace: `agent-${config.name.toLowerCase().replace(/\s+/g, '-')}`,
    };
  }

  createFromTemplate(template: AgentTemplate): AgentProfile {
    const tmpl = TEMPLATES[template];
    return this.create({
      name: template.charAt(0).toUpperCase() + template.slice(1),
      persona: tmpl.persona,
      capabilities: tmpl.capabilities,
      provider: tmpl.provider,
      model: tmpl.model,
      trustLevel: tmpl.trustLevel,
    });
  }
}
