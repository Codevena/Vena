export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentBlock[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | AudioBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    mediaType: string;
    data: string;
  };
}

export interface AudioBlock {
  type: 'audio';
  source: {
    type: 'base64' | 'url';
    mediaType: string;
    data: string;
  };
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface Session {
  id: string;
  channelName: string;
  sessionKey: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  userId?: string;
  userName?: string;
  agentId: string;
  tokenCount: number;
  compactionCount: number;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
  /** Optional streaming execute for long-running tools (shell, browser). */
  executeStream?: (input: Record<string, unknown>, context: ToolContext) => AsyncIterable<ToolProgress>;
}

export interface ToolContext {
  sessionId: string;
  workspacePath: string;
  agentId: string;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolProgress {
  type: 'output' | 'status' | 'error' | 'complete';
  content: string;
  /** Milliseconds elapsed since tool execution started. */
  elapsed?: number;
}

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'tool_use_input' | 'stop' | 'error';
  text?: string;
  toolUse?: {
    id: string;
    name: string;
  };
  toolInput?: string;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
  error?: string;
}

export interface ChatParams {
  messages: Message[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMResponse {
  id: string;
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface InboundMessage {
  channelName: string;
  sessionKey: string;
  userId: string;
  userName?: string;
  content: string;
  media?: MediaAttachment[];
  replyToMessageId?: string;
  raw?: unknown;
}

export interface MediaAttachment {
  type: 'photo' | 'audio' | 'voice' | 'video' | 'document';
  url?: string;
  buffer?: Buffer;
  mimeType: string;
  fileName?: string;
  caption?: string;
}

export interface OutboundMessage {
  text?: string;
  media?: MediaAttachment[];
  replyToMessageId?: string;
  parseMode?: 'markdown' | 'html';
}

export interface SkillRequirements {
  /** Required binaries (all must exist) */
  bins?: string[];
  /** At least one of these binaries must exist */
  anyBins?: string[];
  /** Required environment variables */
  env?: string[];
  /** Required config paths (dot notation) */
  config?: string[];
}

export interface Skill {
  name: string;
  description: string;
  version: string;
  triggers: string[];
  systemPrompt: string;
  tools?: ToolDefinition[];
  enabled: boolean;
  source: 'bundled' | 'managed' | 'workspace';
  path: string;
  /** Slash command name for direct invocation (e.g., "/summarize") */
  command?: string;
  /** Allow users to invoke this skill directly */
  userInvocable?: boolean;
  /** Prevent the model from auto-invoking this skill */
  disableModelInvocation?: boolean;
  /** Platform filter (e.g., ["darwin", "linux"]) */
  os?: string[];
  /** Eligibility requirements */
  requires?: SkillRequirements;
}

export interface AgentProfile {
  id: string;
  name: string;
  persona: string;
  capabilities: string[];
  provider: string;
  model: string;
  status: 'active' | 'idle' | 'busy' | 'offline';
  channels: string[];
  trustLevel: 'full' | 'limited' | 'readonly';
  memoryNamespace: string;
}

export interface Entity {
  id: string;
  type: 'person' | 'project' | 'concept' | 'place' | 'file' | 'event' | 'custom';
  name: string;
  attributes: Record<string, unknown>;
  embedding?: Float32Array;
  firstSeen: string;
  lastSeen: string;
  mentionCount: number;
  confidence: number;
}

export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  weight: number;
  context: string;
  timestamp: string;
}

export interface VoiceConfig {
  ttsProvider: 'elevenlabs' | 'openai-tts';
  voiceId: string;
  model: string;
  stability: number;
  similarityBoost: number;
  outputFormat: 'mp3' | 'ogg_opus' | 'pcm';
}

export interface ConsultationRequest {
  id: string;
  fromAgentId: string;
  toAgentId: string | 'broadcast';
  question: string;
  context?: string;
  priority: 'urgent' | 'normal' | 'low';
  timeout: number;
}

export interface ConsultationResponse {
  requestId: string;
  agentId: string;
  answer: string;
  confidence: number;
  sources?: string[];
}

export interface DelegationTask {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  task: string;
  context?: string;
  priority: 'urgent' | 'normal' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
}

// ── User Profile ──
export interface UserProfile {
  name: string;
  preferredName?: string;
  language: string;
  timezone?: string;
  notes?: string;
}

// ── Character System ──
export interface CharacterTrait {
  dimension: string;
  value: number;
  label: string;
}

export interface CharacterVoice {
  tone: string;
  style: string;
  avoids: string;
}

export interface Character {
  id: string;
  name: string;
  tagline: string;
  traits: CharacterTrait[];
  voice: CharacterVoice;
  coreValues: string[];
  boundaries: string[];
  greeting: string;
  ttsVoiceId?: string;
  soulPrompt: string;
}

export interface AgentSoul {
  character: Character;
  userProfile?: UserProfile;
  compiledPrompt: string;
}
