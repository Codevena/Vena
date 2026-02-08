import { describe, it, expect } from 'vitest';
import { authMiddleware } from '../auth.js';
import type { AuthConfig } from '../auth.js';

describe('authMiddleware', () => {
  it('exports a function', () => {
    expect(typeof authMiddleware).toBe('function');
  });

  it('returns a Fastify plugin function when called with config', () => {
    const config: AuthConfig = {
      enabled: true,
      apiKeys: ['test-key'],
      excludePaths: ['/health'],
    };
    const plugin = authMiddleware(config);
    expect(typeof plugin).toBe('function');
  });

  it('AuthConfig interface allows disabled auth', () => {
    const config: AuthConfig = {
      enabled: false,
      apiKeys: [],
      excludePaths: [],
    };
    const plugin = authMiddleware(config);
    expect(typeof plugin).toBe('function');
  });
});
