import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../rate-limit.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within limit', () => {
    const limiter = new RateLimiter({ enabled: true, windowMs: 60000, maxRequests: 5 });
    for (let i = 0; i < 5; i++) {
      expect(limiter.checkHttp('1.2.3.4').allowed).toBe(true);
    }
  });

  it('blocks requests exceeding limit', () => {
    const limiter = new RateLimiter({ enabled: true, windowMs: 60000, maxRequests: 3 });
    limiter.checkHttp('1.2.3.4');
    limiter.checkHttp('1.2.3.4');
    limiter.checkHttp('1.2.3.4');
    const result = limiter.checkHttp('1.2.3.4');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('resets after window expires', () => {
    const limiter = new RateLimiter({ enabled: true, windowMs: 60000, maxRequests: 2 });
    limiter.checkHttp('1.2.3.4');
    limiter.checkHttp('1.2.3.4');
    expect(limiter.checkHttp('1.2.3.4').allowed).toBe(false);

    vi.advanceTimersByTime(60001);

    expect(limiter.checkHttp('1.2.3.4').allowed).toBe(true);
  });

  it('returns retryAfter value when blocked', () => {
    const limiter = new RateLimiter({ enabled: true, windowMs: 30000, maxRequests: 1 });
    limiter.checkHttp('1.2.3.4');
    const result = limiter.checkHttp('1.2.3.4');
    expect(result.allowed).toBe(false);
    expect(typeof result.retryAfter).toBe('number');
    expect(result.retryAfter).toBeLessThanOrEqual(30);
  });

  it('disabled rate limiter allows all requests', () => {
    const limiter = new RateLimiter({ enabled: false, windowMs: 1000, maxRequests: 1 });
    for (let i = 0; i < 100; i++) {
      expect(limiter.checkHttp('1.2.3.4').allowed).toBe(true);
    }
  });

  it('WebSocket rate limiting works', () => {
    const limiter = new RateLimiter({ enabled: true, windowMs: 60000, maxRequests: 2 });
    expect(limiter.checkWs('conn-1').allowed).toBe(true);
    expect(limiter.checkWs('conn-1').allowed).toBe(true);
    expect(limiter.checkWs('conn-1').allowed).toBe(false);
  });

  it('cleanup removes expired entries', () => {
    const limiter = new RateLimiter({ enabled: true, windowMs: 1000, maxRequests: 5 });
    limiter.checkHttp('1.1.1.1');
    limiter.checkHttp('2.2.2.2');

    vi.advanceTimersByTime(2000);
    limiter.cleanup();

    // After cleanup + window expiry, new requests should be allowed
    expect(limiter.checkHttp('1.1.1.1').allowed).toBe(true);
    expect(limiter.checkHttp('2.2.2.2').allowed).toBe(true);
  });
});
