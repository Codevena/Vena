// ── Hook Event Types ────────────────────────────────────────────────

export type HookEventType =
  | 'command'
  | 'session'
  | 'agent'
  | 'tool'
  | 'provider'
  | 'gateway';

export interface HookEvent {
  /** Event category (command, session, agent, tool, provider, gateway) */
  type: HookEventType;
  /** Specific action within the type (e.g., 'new', 'start', 'before', 'after') */
  action: string;
  /** Session key this event relates to */
  sessionKey: string;
  /** Agent ID this event relates to */
  agentId?: string;
  /** Additional context specific to the event */
  context: Record<string, unknown>;
  /** Timestamp when the event occurred */
  timestamp: Date;
  /** Messages hooks can push to inject into conversation */
  messages: string[];
}

export type HookHandler = (event: HookEvent) => Promise<void> | void;

// ── Hook Metadata (HOOK.md frontmatter) ─────────────────────────────

export type HookInstallSpec = {
  id?: string;
  kind: 'bundled' | 'npm' | 'brew' | 'uv';
  label?: string;
  package?: string;
  bins?: string[];
};

export type HookMetadata = {
  /** Always load this hook regardless of eligibility checks */
  always?: boolean;
  /** Unique key to prevent duplicate registration */
  hookKey?: string;
  /** Display emoji */
  emoji?: string;
  /** Homepage URL */
  homepage?: string;
  /** Events this hook handles (e.g., ["command:new", "session:start"]) */
  events: string[];
  /** Named export to call (default: "default") */
  export?: string;
  /** Platform filter (e.g., ["darwin", "linux"]) */
  os?: string[];
  /** Eligibility requirements */
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  /** Installer specs for auto-install */
  install?: HookInstallSpec[];
};

// ── Hook Entry ──────────────────────────────────────────────────────

export type HookSource = 'vena-bundled' | 'vena-managed' | 'vena-workspace';

export type Hook = {
  name: string;
  description: string;
  source: HookSource;
  filePath: string;
  baseDir: string;
  handlerPath?: string;
};

export type HookEntry = {
  hook: Hook;
  metadata?: HookMetadata;
  enabled: boolean;
};

// ── Specific Event Subtypes ─────────────────────────────────────────

export type ToolHookContext = {
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  blocked?: boolean;
  blockReason?: string;
};

export type SessionHookContext = {
  userId?: string;
  channel?: string;
  accountId?: string;
};

export type AgentBootstrapContext = {
  workspaceDir?: string;
  agentId: string;
  provider: string;
  model: string;
};
