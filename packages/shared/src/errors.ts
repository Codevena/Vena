export class VenaError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'VenaError';
    this.code = code;
    this.details = details;
  }
}

export class ProviderError extends VenaError {
  public readonly provider: string;
  public readonly statusCode?: number;

  constructor(message: string, provider: string, statusCode?: number, details?: Record<string, unknown>) {
    super(message, 'PROVIDER_ERROR', details);
    this.name = 'ProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

export class ChannelError extends VenaError {
  public readonly channel: string;

  constructor(message: string, channel: string, details?: Record<string, unknown>) {
    super(message, 'CHANNEL_ERROR', details);
    this.name = 'ChannelError';
    this.channel = channel;
  }
}

export class SkillError extends VenaError {
  public readonly skill: string;

  constructor(message: string, skill: string, details?: Record<string, unknown>) {
    super(message, 'SKILL_ERROR', details);
    this.name = 'SkillError';
    this.skill = skill;
  }
}

export class MemoryError extends VenaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'MEMORY_ERROR', details);
    this.name = 'MemoryError';
  }
}

export class AgentError extends VenaError {
  public readonly agentId: string;

  constructor(message: string, agentId: string, details?: Record<string, unknown>) {
    super(message, 'AGENT_ERROR', details);
    this.name = 'AgentError';
    this.agentId = agentId;
  }
}

export class ComputerError extends VenaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'COMPUTER_ERROR', details);
    this.name = 'ComputerError';
  }
}

export class VoiceError extends VenaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VOICE_ERROR', details);
    this.name = 'VoiceError';
  }
}

export class IntegrationError extends VenaError {
  public readonly service: string;

  constructor(message: string, service: string, details?: Record<string, unknown>) {
    super(message, 'INTEGRATION_ERROR', details);
    this.name = 'IntegrationError';
    this.service = service;
  }
}
