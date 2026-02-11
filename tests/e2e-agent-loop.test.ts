/**
 * E2E Tests: Agent Loop
 *
 * Tests the complete agent loop cycle with a mock LLM provider.
 * Covers: text response, tool calls, multi-turn chains, error handling,
 * max iterations, thinking events, usage events, and budget guards.
 * No API keys needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentLoop, MemoryManager, ReadTool, WriteTool, UsageTracker } from '@vena/core';
import type { AgentEvent } from '@vena/core';
import type { LLMProvider } from '@vena/providers';
import type { ChatParams, Message, StreamChunk, Session } from '@vena/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Mock Provider ──────────────────────────────────────────────────

type ScenarioChunks = StreamChunk[];

class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly supportsTools = true;
  readonly maxContextWindow = 128_000;

  private scenarios: ScenarioChunks[] = [];
  private callIndex = 0;
  public callCount = 0;
  public lastParams: ChatParams | null = null;

  /** Queue a scenario of chunks for the next chat() call */
  addScenario(chunks: ScenarioChunks): void {
    this.scenarios.push(chunks);
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    this.callCount++;
    this.lastParams = params;
    const scenario = this.scenarios[this.callIndex];
    if (!scenario) {
      yield { type: 'error', error: 'No more scenarios queued' };
      return;
    }
    this.callIndex++;
    for (const chunk of scenario) {
      yield chunk;
    }
  }

  async countTokens(_messages: Message[]): Promise<number> {
    return 100;
  }

  reset(): void {
    this.scenarios = [];
    this.callIndex = 0;
    this.callCount = 0;
    this.lastParams = null;
  }
}

// ── Test Helpers ───────────────────────────────────────────────────

let tmpDir: string;
let memoryManager: MemoryManager;
let mockProvider: MockProvider;

function createSession(agentId = 'test-agent'): Session {
  return {
    id: `sess_test_${Date.now()}`,
    channelName: 'test',
    sessionKey: `test:${Date.now()}`,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      userId: 'test-user',
      agentId,
      tokenCount: 0,
      compactionCount: 0,
    },
  };
}

function createUserMessage(content: string): Message {
  return {
    id: `msg_test_${Date.now()}`,
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  };
}

async function collectEvents(loop: AgentLoop, message: Message, session: Session): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of loop.run(message, session)) {
    events.push(event);
  }
  return events;
}

// ── Setup ──────────────────────────────────────────────────────────

describe('Agent Loop E2E', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vena-agent-loop-test-'));
    memoryManager = new MemoryManager({
      workspacePath: tmpDir,
      agentId: 'test-agent',
    });
    mockProvider = new MockProvider();
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  });

  // ── 1. Simple text response ──────────────────────────────────────

  it('handles simple text response without tools', async () => {
    mockProvider.reset();
    mockProvider.addScenario([
      { type: 'text', text: 'Hello, ' },
      { type: 'text', text: 'world!' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
    });

    const session = createSession();
    const events = await collectEvents(loop, createUserMessage('Hi'), session);

    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents).toHaveLength(2);
    expect((textEvents[0] as any).text).toBe('Hello, ');
    expect((textEvents[1] as any).text).toBe('world!');

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect((doneEvent as any).response).toBe('Hello, world!');
  });

  // ── 2. Tool call + follow-up text ────────────────────────────────

  it('handles tool call followed by text response', async () => {
    mockProvider.reset();

    // Turn 1: LLM requests a tool call (read file)
    mockProvider.addScenario([
      { type: 'tool_use', toolUse: { id: 'call_1', name: 'read' } },
      { type: 'tool_use_input', toolInput: JSON.stringify({ path: path.join(tmpDir, 'test-read.txt') }) },
      { type: 'stop', stopReason: 'tool_use' },
    ]);

    // Turn 2: After tool result, LLM responds with text
    mockProvider.addScenario([
      { type: 'text', text: 'The file contains: test content' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);

    // Create the file so read tool works
    const testFile = path.join(tmpDir, 'test-read.txt');
    fs.writeFileSync(testFile, 'test content');

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [new ReadTool()],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
    });

    const session = createSession();
    const events = await collectEvents(loop, createUserMessage('Read the test file'), session);

    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents).toHaveLength(1);
    expect((toolCallEvents[0] as any).tool).toBe('read');

    const toolResultEvents = events.filter((e) => e.type === 'tool_result');
    expect(toolResultEvents).toHaveLength(1);
    expect((toolResultEvents[0] as any).result.isError).toBeFalsy();

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect((doneEvent as any).response).toContain('The file contains');

    // Provider was called twice (tool call + follow-up)
    expect(mockProvider.callCount).toBe(2);
  });

  // ── 3. Multi-turn tool chain ─────────────────────────────────────

  it('handles multi-turn tool chain (write then read)', async () => {
    mockProvider.reset();

    const writeFile = path.join(tmpDir, 'chain-test.txt');

    // Turn 1: Write a file
    mockProvider.addScenario([
      { type: 'tool_use', toolUse: { id: 'call_w', name: 'write' } },
      { type: 'tool_use_input', toolInput: JSON.stringify({ path: writeFile, content: 'chain data' }) },
      { type: 'stop', stopReason: 'tool_use' },
    ]);

    // Turn 2: Read the file
    mockProvider.addScenario([
      { type: 'tool_use', toolUse: { id: 'call_r', name: 'read' } },
      { type: 'tool_use_input', toolInput: JSON.stringify({ path: writeFile }) },
      { type: 'stop', stopReason: 'tool_use' },
    ]);

    // Turn 3: Final text response
    mockProvider.addScenario([
      { type: 'text', text: 'I wrote and read the file successfully.' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [new WriteTool(), new ReadTool()],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
    });

    const session = createSession();
    const events = await collectEvents(loop, createUserMessage('Write and read a file'), session);

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(2);
    expect((toolCalls[0] as any).tool).toBe('write');
    expect((toolCalls[1] as any).tool).toBe('read');

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults).toHaveLength(2);

    expect(mockProvider.callCount).toBe(3);

    // Verify the file was actually written
    expect(fs.existsSync(writeFile)).toBe(true);
    expect(fs.readFileSync(writeFile, 'utf-8')).toBe('chain data');
  });

  // ── 4. Provider error handling ───────────────────────────────────

  it('handles provider errors gracefully', async () => {
    mockProvider.reset();
    mockProvider.addScenario([
      { type: 'error', error: 'Simulated API failure' },
    ]);

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
    });

    const session = createSession();
    const events = await collectEvents(loop, createUserMessage('Hello'), session);

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0] as any).error.message).toContain('Simulated API failure');
  });

  // ── 5. Max iterations guard ──────────────────────────────────────

  it('stops after max iterations', async () => {
    mockProvider.reset();

    // Queue scenarios that always request tool calls (never end_turn)
    for (let i = 0; i < 5; i++) {
      const readFile = path.join(tmpDir, `iter-test-${i}.txt`);
      fs.writeFileSync(readFile, `content-${i}`);
      mockProvider.addScenario([
        { type: 'tool_use', toolUse: { id: `call_${i}`, name: 'read' } },
        { type: 'tool_use_input', toolInput: JSON.stringify({ path: readFile }) },
        { type: 'stop', stopReason: 'tool_use' },
      ]);
    }

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [new ReadTool()],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
      options: { maxIterations: 3 },
    });

    const session = createSession();
    const events = await collectEvents(loop, createUserMessage('Keep reading files'), session);

    // Should have stopped at 3 iterations
    expect(mockProvider.callCount).toBe(3);

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
  });

  // ── 6. Thinking events ───────────────────────────────────────────

  it('yields thinking events from extended thinking', async () => {
    mockProvider.reset();
    mockProvider.addScenario([
      { type: 'thinking', thinking: 'Let me think about this carefully...' },
      { type: 'thinking', thinking: 'The answer involves a simple greeting.' },
      { type: 'text', text: 'Hi there!' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
      thinking: { enabled: true, budgetTokens: 5000 },
    });

    const session = createSession();
    const events = await collectEvents(loop, createUserMessage('Hello'), session);

    const thinkingEvents = events.filter((e) => e.type === 'thinking');
    expect(thinkingEvents).toHaveLength(2);
    expect((thinkingEvents[0] as any).thinking).toContain('think about this carefully');
    expect((thinkingEvents[1] as any).thinking).toContain('simple greeting');

    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents).toHaveLength(1);
    expect((textEvents[0] as any).text).toBe('Hi there!');
  });

  // ── 7. Usage events ──────────────────────────────────────────────

  it('yields usage events when provider reports token counts', async () => {
    mockProvider.reset();
    mockProvider.addScenario([
      { type: 'text', text: 'Response text' },
      { type: 'stop', stopReason: 'end_turn', usage: { inputTokens: 150, outputTokens: 50 } },
    ]);

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
    });

    const session = createSession();
    const events = await collectEvents(loop, createUserMessage('Hello'), session);

    const usageEvents = events.filter((e) => e.type === 'usage');
    expect(usageEvents).toHaveLength(1);
    expect((usageEvents[0] as any).inputTokens).toBe(150);
    expect((usageEvents[0] as any).outputTokens).toBe(50);
  });

  // ── 8. Budget guard enforcement ──────────────────────────────────

  it('enforces budget limits via UsageTracker', async () => {
    const usageTracker = new UsageTracker(tmpDir);

    // Set a very low budget
    usageTracker.setBudget('budget-agent', {
      maxCostPerSession: 0.001,  // $0.001
      warnAt: 0.5,
    });

    // Record some usage that exceeds the budget
    usageTracker.record({
      agentId: 'budget-agent',
      sessionKey: 'budget-session',
      model: 'gpt-4o-mini',
      provider: 'openai',
      inputTokens: 100000,
      outputTokens: 50000,
    });

    mockProvider.reset();
    mockProvider.addScenario([
      { type: 'text', text: 'This should not appear' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
      usageTracker,
      agentId: 'budget-agent',
    });

    const session = createSession('budget-agent');
    session.sessionKey = 'budget-session';
    const events = await collectEvents(loop, createUserMessage('Hello'), session);

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0] as any).error.message).toContain('Budget exceeded');

    // The provider should NOT have been called
    expect(mockProvider.callCount).toBe(0);

    usageTracker.stop();
  });

  // ── 9. Session messages accumulation ─────────────────────────────

  it('accumulates messages correctly in session', async () => {
    mockProvider.reset();
    mockProvider.addScenario([
      { type: 'text', text: 'I understand.' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
    });

    const session = createSession();
    expect(session.messages).toHaveLength(0);

    await collectEvents(loop, createUserMessage('Tell me something'), session);

    // Should have user message + assistant message
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]!.role).toBe('user');
    expect(session.messages[1]!.role).toBe('assistant');
    // Content may be stored as ContentBlock[] or string depending on whether blocks were collected
    const content = session.messages[1]!.content;
    if (typeof content === 'string') {
      expect(content).toBe('I understand.');
    } else {
      // ContentBlock array with a single text block
      expect(content).toHaveLength(1);
      expect((content[0] as any).type).toBe('text');
      expect((content[0] as any).text).toBe('I understand.');
    }
  });

  // ── 10. Tool with error result ───────────────────────────────────

  it('handles tool execution errors and continues', async () => {
    mockProvider.reset();

    // Turn 1: Try to read a non-existent file
    mockProvider.addScenario([
      { type: 'tool_use', toolUse: { id: 'call_bad', name: 'read' } },
      { type: 'tool_use_input', toolInput: JSON.stringify({ path: '/nonexistent/file.txt' }) },
      { type: 'stop', stopReason: 'tool_use' },
    ]);

    // Turn 2: LLM handles the error
    mockProvider.addScenario([
      { type: 'text', text: 'The file does not exist.' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: [new ReadTool()],
      systemPrompt: 'You are helpful.',
      memoryManager,
      workspacePath: tmpDir,
    });

    const session = createSession();
    const events = await collectEvents(loop, createUserMessage('Read a missing file'), session);

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0] as any).result.isError).toBe(true);

    // LLM should still respond
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect((doneEvent as any).response).toContain('does not exist');
  });
});
