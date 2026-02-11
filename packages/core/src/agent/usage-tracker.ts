import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@vena/shared';

const logger = createLogger('usage-tracker');

export interface UsageRecord {
  timestamp: string;
  agentId: string;
  sessionKey: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  recordCount: number;
  byAgent: Record<string, { inputTokens: number; outputTokens: number; estimatedCost: number; count: number }>;
  byModel: Record<string, { inputTokens: number; outputTokens: number; estimatedCost: number; count: number }>;
}

// Cost per 1M tokens (input / output) in USD
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  // Google
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  // Default fallback
  'default': { input: 1.0, output: 3.0 },
};

export class UsageTracker {
  private records: UsageRecord[] = [];
  private filePath: string;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'usage.json');
    this.load();

    // Auto-flush every 30s
    this.flushTimer = setInterval(() => this.save(), 30000);
  }

  record(params: {
    agentId: string;
    sessionKey: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
  }): void {
    const cost = this.estimateCost(params.model, params.inputTokens, params.outputTokens);

    const record: UsageRecord = {
      timestamp: new Date().toISOString(),
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      model: params.model,
      provider: params.provider,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      estimatedCost: cost,
    };

    this.records.push(record);
    this.dirty = true;

    logger.debug({
      agent: params.agentId,
      model: params.model,
      input: params.inputTokens,
      output: params.outputTokens,
      cost: `$${cost.toFixed(6)}`,
    }, 'Usage recorded');
  }

  getSummary(): UsageSummary {
    const summary: UsageSummary = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalEstimatedCost: 0,
      recordCount: this.records.length,
      byAgent: {},
      byModel: {},
    };

    for (const r of this.records) {
      summary.totalInputTokens += r.inputTokens;
      summary.totalOutputTokens += r.outputTokens;
      summary.totalEstimatedCost += r.estimatedCost;

      // By agent
      if (!summary.byAgent[r.agentId]) {
        summary.byAgent[r.agentId] = { inputTokens: 0, outputTokens: 0, estimatedCost: 0, count: 0 };
      }
      const agentEntry = summary.byAgent[r.agentId]!;
      agentEntry.inputTokens += r.inputTokens;
      agentEntry.outputTokens += r.outputTokens;
      agentEntry.estimatedCost += r.estimatedCost;
      agentEntry.count++;

      // By model
      if (!summary.byModel[r.model]) {
        summary.byModel[r.model] = { inputTokens: 0, outputTokens: 0, estimatedCost: 0, count: 0 };
      }
      const modelEntry = summary.byModel[r.model]!;
      modelEntry.inputTokens += r.inputTokens;
      modelEntry.outputTokens += r.outputTokens;
      modelEntry.estimatedCost += r.estimatedCost;
      modelEntry.count++;
    }

    return summary;
  }

  getAgentUsage(agentId: string): UsageRecord[] {
    return this.records.filter((r) => r.agentId === agentId);
  }

  private estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = PRICING[model] ?? PRICING['default']!;
    return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          this.records = data;
        }
      }
    } catch (err) {
      logger.warn({ error: err }, 'Failed to load usage data, starting fresh');
    }
  }

  save(): void {
    if (!this.dirty) return;

    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2));
      this.dirty = false;
    } catch (err) {
      logger.error({ error: err }, 'Failed to save usage data');
    }
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.save();
  }
}
