/**
 * E2E Tests: Core Tools (read, write, edit, web_browse)
 *
 * Tests actual tool execution — real file I/O, real HTTP fetch.
 * Tools return ToolResult = { content: string; isError?: boolean }
 * Tools use 'path' (not 'file_path') as the input key.
 * No API keys needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ReadTool, WriteTool, EditTool, WebBrowseTool, ToolGuard } from '@vena/core';
import type { SecurityPolicy } from '@vena/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;
const toolContext = { workspacePath: '', agentId: 'test' };

describe('Core Tools E2E', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vena-tools-test-'));
    toolContext.workspacePath = tmpDir;
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  });

  // ── WriteTool ──────────────────────────────────────────────────
  describe('WriteTool', () => {
    it('creates a file on disk', async () => {
      const tool = new WriteTool();
      const filePath = path.join(tmpDir, 'test-write.txt');

      const result = await tool.execute(
        { path: filePath, content: 'Hello from Vena!' },
        toolContext,
      );

      expect(result.isError).toBeFalsy();
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello from Vena!');
    });

    it('creates nested directories', async () => {
      const tool = new WriteTool();
      const filePath = path.join(tmpDir, 'deep', 'nested', 'dir', 'file.txt');

      const result = await tool.execute(
        { path: filePath, content: 'deep content' },
        toolContext,
      );

      expect(result.isError).toBeFalsy();
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('deep content');
    });
  });

  // ── ReadTool ───────────────────────────────────────────────────
  describe('ReadTool', () => {
    it('reads a file from disk', async () => {
      const tool = new ReadTool();
      const filePath = path.join(tmpDir, 'test-read.txt');
      fs.writeFileSync(filePath, 'Line 1\nLine 2\nLine 3\n');

      const result = await tool.execute({ path: filePath }, toolContext);

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Line 1');
      expect(result.content).toContain('Line 2');
    });

    it('handles non-existent file', async () => {
      const tool = new ReadTool();
      const result = await tool.execute(
        { path: path.join(tmpDir, 'does-not-exist.txt') },
        toolContext,
      );

      expect(result.isError).toBe(true);
    });
  });

  // ── EditTool ───────────────────────────────────────────────────
  describe('EditTool', () => {
    it('replaces text in a file', async () => {
      const tool = new EditTool();
      const filePath = path.join(tmpDir, 'test-edit.txt');
      fs.writeFileSync(filePath, 'Hello World\nFoo Bar\n');

      const result = await tool.execute({
        path: filePath,
        old_string: 'Hello World',
        new_string: 'Hello Vena',
      }, toolContext);

      expect(result.isError).toBeFalsy();
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('Hello Vena');
      expect(content).not.toContain('Hello World');
    });

    it('fails when old_string not found', async () => {
      const tool = new EditTool();
      const filePath = path.join(tmpDir, 'test-edit-fail.txt');
      fs.writeFileSync(filePath, 'Original content');

      const result = await tool.execute({
        path: filePath,
        old_string: 'does not exist',
        new_string: 'replacement',
      }, toolContext);

      expect(result.isError).toBe(true);
    });
  });

  // ── WebBrowseTool ──────────────────────────────────────────────
  describe('WebBrowseTool', () => {
    it('fetches a real URL', async () => {
      const tool = new WebBrowseTool({ allowPrivateIPs: false });

      const result = await tool.execute(
        { url: 'https://httpbin.org/get' },
        toolContext,
      );

      expect(result.isError).toBeFalsy();
      expect(result.content).toBeTruthy();
    }, 15000);

    it('blocks private IP URLs', async () => {
      const tool = new WebBrowseTool({ allowPrivateIPs: false });

      const result = await tool.execute(
        { url: 'http://127.0.0.1:8080/secret' },
        toolContext,
      );

      expect(result.isError).toBe(true);
    });
  });

  // ── ToolGuard Integration ──────────────────────────────────────
  describe('ToolGuard', () => {
    it('readonly trust blocks write tools', () => {
      const policy: SecurityPolicy = {
        trustLevel: 'readonly',
        allowedTools: ['*'],
        allowedPaths: [tmpDir],
        blockedPaths: [],
        allowedCommands: [],
        maxOutputBytes: 1024 * 1024,
        envPassthrough: [],
        allowPrivateIPs: false,
      };
      const guard = new ToolGuard(policy);

      expect(guard.canUseTool('read').allowed).toBe(true);
      expect(guard.canUseTool('web_browse').allowed).toBe(true);
      expect(guard.canUseTool('write').allowed).toBe(false);
      expect(guard.canUseTool('bash').allowed).toBe(false);
    });

    it('full trust allows all tools', () => {
      const policy: SecurityPolicy = {
        trustLevel: 'full',
        allowedTools: ['*'],
        allowedPaths: [tmpDir],
        blockedPaths: [],
        allowedCommands: ['ls', 'echo'],
        maxOutputBytes: 1024 * 1024,
        envPassthrough: [],
        allowPrivateIPs: false,
      };
      const guard = new ToolGuard(policy);

      expect(guard.canUseTool('read').allowed).toBe(true);
      expect(guard.canUseTool('write').allowed).toBe(true);
      expect(guard.canUseTool('bash').allowed).toBe(true);
    });
  });
});
