import { spawn } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { ChatParams, Message, StreamChunk } from '@vena/shared';
import { ProviderError } from '@vena/shared';
import type { LLMProvider } from './provider.js';

export interface GeminiCliProviderOptions {
  model?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
}

export class GeminiCliProvider implements LLMProvider {
  readonly name = 'gemini-cli';
  readonly supportsTools = false;
  readonly maxContextWindow = 1_000_000;

  private model: string;
  private command: string;
  private baseArgs: string[];
  private timeoutMs: number;

  constructor(options: GeminiCliProviderOptions = {}) {
    this.model = options.model ?? 'gemini-3-flash-preview';
    this.command = options.command ?? 'gemini';
    this.baseArgs = options.args ?? ['--output-format', 'json'];
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const prompt = this.buildPrompt(params);
    try {
      const text = await this.runGemini(prompt);
      if (text) {
        yield { type: 'text', text };
      }
      yield { type: 'stop', stopReason: 'end_turn' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: message };
      throw new ProviderError(message, 'gemini-cli');
    }
  }

  async countTokens(messages: Message[]): Promise<number> {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') totalChars += block.text.length;
          else if (block.type === 'tool_use') totalChars += JSON.stringify(block.input).length;
          else if (block.type === 'tool_result') totalChars += block.content.length;
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  private buildPrompt(params: ChatParams): string {
    const parts: string[] = [];
    if (params.systemPrompt) {
      parts.push(`System: ${params.systemPrompt.trim()}`);
    }

    for (const message of params.messages) {
      const content = this.messageToText(message);
      if (!content) continue;
      switch (message.role) {
        case 'system':
          parts.push(`System: ${content}`);
          break;
        case 'assistant':
          parts.push(`Assistant: ${content}`);
          break;
        case 'tool':
          parts.push(`Tool: ${content}`);
          break;
        default:
          parts.push(`User: ${content}`);
          break;
      }
    }

    return parts.join('\n\n').trim();
  }

  private messageToText(message: Message): string {
    if (typeof message.content === 'string') {
      return message.content.trim();
    }
    const chunks: string[] = [];
    for (const block of message.content) {
      switch (block.type) {
        case 'text':
          chunks.push(block.text);
          break;
        case 'tool_use':
          chunks.push(`[Tool Call] ${block.name} ${JSON.stringify(block.input)}`);
          break;
        case 'tool_result':
          chunks.push(`[Tool Result] ${block.content}`);
          break;
        case 'image':
          chunks.push(`[Image: ${block.source.mediaType}]`);
          break;
        case 'audio':
          chunks.push(`[Audio: ${block.source.mediaType}]`);
          break;
        default:
          break;
      }
    }
    return chunks.join('\n').trim();
  }

  private async runGemini(prompt: string): Promise<string> {
    const resolved = findInPath(this.command);
    if (!resolved) {
      throw new ProviderError(
        'Gemini CLI not found. Install it first: brew install gemini-cli (or npm install -g @google/gemini-cli).',
        'gemini-cli',
      );
    }

    const args = [...this.baseArgs];
    if (this.model) {
      args.push('--model', this.model);
    }
    args.push(prompt);

    const { stdout, stderr, code } = await runCommand(resolved, args, this.timeoutMs);
    if (code !== 0) {
      const detail = stderr.trim() || stdout.trim();
      throw new ProviderError(
        `Gemini CLI failed with exit code ${code}${detail ? `: ${detail}` : ''}`,
        'gemini-cli',
      );
    }

    const response = extractGeminiResponse(stdout) ?? extractGeminiResponse(stderr) ?? stdout.trim();
    if (!response) {
      throw new ProviderError('Gemini CLI returned an empty response.', 'gemini-cli');
    }
    return response;
  }
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new ProviderError('Gemini CLI timed out.', 'gemini-cli'));
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
  });
}

function findInPath(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.bat', '.exe', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p)) {
        return p;
      }
    }
  }
  return null;
}

function extractLastJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }

  const lastLine = trimmed.split('\n').reverse().find((line) => line.trim().startsWith('{'));
  if (lastLine) {
    try {
      return JSON.parse(lastLine);
    } catch {
      // fall through
    }
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;
  let last: string | null = null;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i] as string;
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === '\\') {
        escaping = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          last = trimmed.slice(start, i + 1);
          start = -1;
        }
      }
    }
  }

  if (!last) return null;
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

function extractGeminiResponse(raw: string): string | null {
  const payload = extractLastJsonObject(raw);
  if (!payload || typeof payload !== 'object') return null;
  const response = (payload as { response?: unknown }).response;
  if (typeof response !== 'string') return null;
  const trimmed = response.trim();
  return trimmed || null;
}
