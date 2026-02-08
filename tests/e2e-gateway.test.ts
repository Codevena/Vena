/**
 * E2E Tests: Gateway HTTP + WebSocket
 *
 * These tests start an actual GatewayServer, send real HTTP/WS requests,
 * and verify responses. No API keys needed — uses a mock message handler.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GatewayServer } from '@vena/gateway';

const PORT = 19876;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

let gateway: GatewayServer;

// Mock message handler — echoes back the message content
const mockHandler = async (msg: { content: string; channelName: string; sessionKey: string; userId: string }) => {
  return { text: `echo: ${msg.content}` };
};

describe('Gateway E2E', () => {
  beforeAll(async () => {
    gateway = new GatewayServer({
      port: PORT,
      host: HOST,
      auth: { enabled: false, apiKeys: [] },
      rateLimit: { enabled: true, windowMs: 60000, maxRequests: 1000 },
    });
    gateway.onMessage(mockHandler);
    gateway.onAgents(() => [
      { id: 'test-agent', name: 'TestAgent', status: 'active' },
    ]);
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
  });

  // ── Health Check ───────────────────────────────────────────────
  it('GET /health returns ok', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  // ── Status Endpoint ────────────────────────────────────────────
  it('GET /api/status returns server status', async () => {
    const res = await fetch(`${BASE}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.memory).toBeDefined();
    expect(typeof body.memory.rss).toBe('number');
  });

  // ── Agents Endpoint ────────────────────────────────────────────
  it('GET /api/agents returns registered agents', async () => {
    const res = await fetch(`${BASE}/api/agents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].name).toBe('TestAgent');
    expect(body.agents[0].status).toBe('active');
  });

  // ── Sessions Endpoint ──────────────────────────────────────────
  it('GET /api/sessions returns session list', async () => {
    const res = await fetch(`${BASE}/api/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBeDefined();
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  // ── Message Endpoint ───────────────────────────────────────────
  it('POST /api/message sends message and receives response', async () => {
    const res = await fetch(`${BASE}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello Vena' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response.text).toBe('echo: Hello Vena');
  });

  it('POST /api/message with custom sessionKey', async () => {
    const res = await fetch(`${BASE}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Test with session',
        sessionKey: 'custom-session-1',
        userId: 'user-42',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response.text).toBe('echo: Test with session');
  });

  it('POST /api/message rejects empty content', async () => {
    const res = await fetch(`${BASE}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/message rejects missing content', async () => {
    const res = await fetch(`${BASE}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  // ── WebSocket ──────────────────────────────────────────────────
  it('WebSocket connects and receives response', async () => {
    // Use native WebSocket (available in Node 22+)
    const ws = new globalThis.WebSocket(`ws://${HOST}:${PORT}`);

    const response = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS timeout')), 5000);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'message', content: 'Hello via WS' }));
      });

      ws.addEventListener('message', (event) => {
        clearTimeout(timeout);
        const msg = JSON.parse(String(event.data));
        resolve(msg.content);
        ws.close();
      });

      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      });
    });

    expect(response).toBe('echo: Hello via WS');
  });
});
