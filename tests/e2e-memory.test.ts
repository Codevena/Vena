/**
 * E2E Tests: MemoryManager (flat file storage)
 *
 * Tests actual file I/O — log writing, reading, context retrieval.
 * No API keys needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryManager } from '@vena/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let mm: MemoryManager;
let tmpDir: string;

describe('MemoryManager E2E', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vena-mem-test-'));
    mm = new MemoryManager({
      workspacePath: tmpDir,
      agentId: 'test-agent',
    });
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  });

  it('logs entries to daily log', async () => {
    await mm.log('User said hello');
    await mm.log('Agent responded with greeting');

    const context = await mm.getRelevantContext('', 2000);
    expect(context).toContain('User said hello');
    expect(context).toContain('Agent responded with greeting');
  });

  it('retrieves context with query-based search', async () => {
    await mm.log('Discussing TypeScript patterns');
    await mm.log('Talked about database migrations');

    const context = await mm.getRelevantContext('TypeScript', 2000);
    expect(context).toContain('TypeScript');
  });

  it('updates long-term memory', async () => {
    await mm.updateLongTerm('user_name', 'Markus');
    const longTerm = await mm.getLongTermMemory();
    expect(longTerm).toContain('Markus');
  });

  it('returns empty context for fresh agent', async () => {
    const freshMm = new MemoryManager({
      workspacePath: tmpDir,
      agentId: 'fresh-agent',
    });
    const context = await freshMm.getRelevantContext('anything', 2000);
    // Should not throw, returns empty or minimal context
    expect(typeof context).toBe('string');
  });

  it('respects maxTokens limit', async () => {
    // Log a bunch of entries
    for (let i = 0; i < 50; i++) {
      await mm.log(`Entry number ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.`);
    }
    // 100 chars ~ 25 tokens => should truncate
    const context = await mm.getRelevantContext('', 25);
    expect(context.length).toBeLessThanOrEqual(100);
  });

  it('semantic provider is optional (no crash without it)', async () => {
    const noSemantic = new MemoryManager({
      workspacePath: tmpDir,
      agentId: 'no-semantic-agent',
      // no semantic provider
    });
    await noSemantic.log('test entry');
    const context = await noSemantic.getRelevantContext('test', 2000);
    expect(context).toContain('test entry');
  });

  it('ingestMessages is no-op without semantic provider', async () => {
    // Should not throw
    await mm.ingestMessages([
      { id: 'msg1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
    ]);
  });
});
