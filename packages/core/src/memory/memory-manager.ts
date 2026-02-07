import { MemoryError, createLogger } from '@vena/shared';
import { DailyLog } from './daily-log.js';
import { LongTermMemory } from './long-term.js';
import { TranscriptStore } from './transcript.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const logger = createLogger('memory-manager');

export class MemoryManager {
  private dailyLog: DailyLog;
  private longTerm: LongTermMemory;
  private transcripts: TranscriptStore;
  private workspacePath: string;
  private agentId: string;

  constructor(opts: { workspacePath: string; agentId: string }) {
    this.workspacePath = opts.workspacePath;
    this.agentId = opts.agentId;

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

  async getRelevantContext(query: string, maxTokens: number): Promise<string> {
    const maxChars = maxTokens * 4;
    const parts: string[] = [];

    try {
      // Get long-term memory first (highest priority)
      const longTermContent = await this.longTerm.read();
      if (longTermContent) {
        parts.push(`## Long-term Memory\n${longTermContent}`);
      }

      // Get today's log
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
