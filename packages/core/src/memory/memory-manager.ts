import type { Message } from '@vena/shared';
import { MemoryError, createLogger } from '@vena/shared';
import { DailyLog } from './daily-log.js';
import { LongTermMemory } from './long-term.js';
import { TranscriptStore } from './transcript.js';
import * as path from 'node:path';

const logger = createLogger('memory-manager');

export interface SemanticMemoryProvider {
  recall(query: string, maxTokens: number): Promise<string>;
  ingest(messages: Message[], agentId: string): Promise<void>;
}

export interface MemoryManagerOptions {
  workspacePath: string;
  agentId: string;
  semantic?: SemanticMemoryProvider;
}

export class MemoryManager {
  private dailyLog: DailyLog;
  private longTerm: LongTermMemory;
  private transcripts: TranscriptStore;
  private workspacePath: string;
  private agentId: string;
  private semantic?: SemanticMemoryProvider;

  constructor(opts: MemoryManagerOptions) {
    this.workspacePath = opts.workspacePath;
    this.agentId = opts.agentId;
    this.semantic = opts.semantic;

    const memoryDir = path.join(opts.workspacePath, 'memory', opts.agentId);
    this.dailyLog = new DailyLog(path.join(memoryDir, 'daily'));
    this.longTerm = new LongTermMemory(path.join(memoryDir, 'MEMORY.md'));
    this.transcripts = new TranscriptStore(path.join(memoryDir, 'transcripts'));
  }

  async log(entry: string): Promise<void> {
    try {
      await this.dailyLog.append(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MemoryError(`Failed to log entry: ${message}`);
    }
  }

  async ingestMessages(messages: Message[]): Promise<void> {
    if (!this.semantic) return;
    try {
      await this.semantic.ingest(messages, this.agentId);
    } catch (err) {
      logger.warn({ error: err }, 'Semantic ingest failed (non-critical)');
    }
  }

  async getRelevantContext(query: string, maxTokens: number): Promise<string> {
    const maxChars = maxTokens * 4;
    const parts: string[] = [];

    // Semantic memory first (richest context)
    if (this.semantic && query) {
      try {
        const semanticContext = await this.semantic.recall(query, Math.floor(maxTokens / 2));
        if (semanticContext) {
          parts.push(semanticContext);
        }
      } catch (err) {
        logger.warn({ error: err }, 'Semantic recall failed, falling back to flat memory');
      }
    }

    try {
      // Long-term memory
      const longTermContent = await this.longTerm.read();
      if (longTermContent) {
        parts.push(`## Long-term Memory\n${longTermContent}`);
      }

      // Today's log
      const todayLog = await this.dailyLog.read();
      if (todayLog) {
        parts.push(`## Today's Log\n${todayLog}`);
      }

      // Search daily logs for relevant content
      if (query) {
        const searchResults = await this.dailyLog.search(query);
        if (searchResults.length > 0) {
          parts.push(`## Relevant Logs\n${searchResults.slice(0, 5).join('\n')}`);
        }
      }
    } catch (err) {
      logger.warn({ error: err }, 'Error gathering memory context');
    }

    let context = parts.join('\n\n');
    if (context.length > maxChars) {
      context = context.slice(0, maxChars);
    }
    return context;
  }

  async updateLongTerm(key: string, value: string): Promise<void> {
    try {
      await this.longTerm.update(key, value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MemoryError(`Failed to update long-term memory: ${message}`);
    }
  }

  async getLongTermMemory(): Promise<string> {
    return this.longTerm.read();
  }

  get dailyLogStore(): DailyLog {
    return this.dailyLog;
  }

  get transcriptStore(): TranscriptStore {
    return this.transcripts;
  }
}
