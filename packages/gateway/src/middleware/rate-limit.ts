export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private windows = new Map<string, WindowEntry>();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  checkHttp(ip: string): { allowed: boolean; retryAfter?: number } {
    if (!this.config.enabled) return { allowed: true };
    return this.check(ip);
  }

  checkWs(connectionId: string): { allowed: boolean } {
    if (!this.config.enabled) return { allowed: true };
    const result = this.check(`ws:${connectionId}`);
    return { allowed: result.allowed };
  }

  private check(key: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || now >= entry.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.config.windowMs });
      return { allowed: true };
    }

    entry.count++;
    if (entry.count > this.config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, retryAfter };
    }

    return { allowed: true };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) {
        this.windows.delete(key);
      }
    }
  }
}
