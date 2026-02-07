import { PathValidator } from './path-validator.js';
import { UrlValidator } from './url-validator.js';

export interface SecurityPolicy {
  trustLevel: 'full' | 'limited' | 'readonly';
  allowedTools: string[];
  allowedPaths: string[];
  blockedPaths: string[];
  allowedCommands: string[];
  maxOutputBytes: number;
  envPassthrough: string[];
  allowPrivateIPs: boolean;
}

const TRUST_LEVEL_TOOLS: Record<string, string[]> = {
  readonly: ['read', 'web_browse'],
  limited: ['read', 'write', 'edit', 'web_browse', 'browser', 'google'],
  full: ['*'],
};

export class ToolGuard {
  private pathValidator: PathValidator;
  private urlValidator: UrlValidator;

  constructor(private policy: SecurityPolicy) {
    this.pathValidator = new PathValidator(policy.allowedPaths, policy.blockedPaths);
    this.urlValidator = new UrlValidator(policy.allowPrivateIPs);
  }

  canUseTool(toolName: string): { allowed: boolean; reason?: string } {
    const trustTools = TRUST_LEVEL_TOOLS[this.policy.trustLevel];
    if (trustTools && !trustTools.includes('*') && !trustTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is not allowed at trust level '${this.policy.trustLevel}'`,
      };
    }

    if (
      this.policy.allowedTools.length > 0 &&
      !this.policy.allowedTools.includes('*') &&
      !this.policy.allowedTools.includes(toolName)
    ) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is not in the allowed tools list`,
      };
    }

    return { allowed: true };
  }

  validatePath(filePath: string): { allowed: boolean; reason?: string } {
    return this.pathValidator.validate(filePath);
  }

  validateUrl(url: string): { allowed: boolean; reason?: string } {
    return this.urlValidator.validate(url);
  }

  validateCommand(command: string): { allowed: boolean; reason?: string } {
    if (this.policy.allowedCommands.includes('*')) {
      return { allowed: true };
    }

    const commands = command
      .split(/[|&;]/)
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => c.split(/\s+/)[0]!)
      .map((c) => c.replace(/^.*\//, ''));

    for (const cmd of commands) {
      if (!this.policy.allowedCommands.includes(cmd)) {
        return {
          allowed: false,
          reason: `Command '${cmd}' is not in the allowed commands list. Allowed: ${this.policy.allowedCommands.join(', ')}`,
        };
      }
    }

    return { allowed: true };
  }

  sanitizeEnvironment(env: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const key of this.policy.envPassthrough) {
      if (env[key] !== undefined) {
        sanitized[key] = env[key];
      }
    }
    return sanitized;
  }

  get maxOutputBytes(): number {
    return this.policy.maxOutputBytes;
  }
}
