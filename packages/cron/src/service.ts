import type { CronJob, CronJobCreate, CronJobPatch, CronStoreFile } from './types.js';
import { loadCronStore, saveCronStore, resolveCronStorePath } from './store.js';
import { computeNextRunAtMs } from './schedule.js';

type JobCallback = (job: CronJob) => Promise<void>;

export class CronService {
  private storePath: string;
  private store: CronStoreFile = { version: 1, jobs: [] };
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private callback: JobCallback;
  private running = false;

  constructor(opts: { storePath?: string; callback: JobCallback }) {
    this.storePath = resolveCronStorePath(opts.storePath);
    this.callback = opts.callback;
  }

  async start(): Promise<void> {
    this.store = await loadCronStore(this.storePath);
    this.running = true;

    // Catchup: run any missed jobs
    const now = Date.now();
    for (const job of this.store.jobs) {
      if (!job.enabled) continue;
      if (job.state.nextRunAtMs && job.state.nextRunAtMs <= now) {
        await this.executeJob(job);
      }
    }

    // Schedule all enabled jobs
    for (const job of this.store.jobs) {
      if (job.enabled) this.scheduleJob(job);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  async addJob(create: CronJobCreate): Promise<CronJob> {
    const now = Date.now();
    const job: CronJob = {
      ...create,
      id: generateId(),
      createdAtMs: now,
      updatedAtMs: now,
      state: {
        ...create.state,
        nextRunAtMs: computeNextRunAtMs(create.schedule, now),
      },
    };

    this.store.jobs.push(job);
    await saveCronStore(this.storePath, this.store);

    if (job.enabled && this.running) {
      this.scheduleJob(job);
    }

    return job;
  }

  async updateJob(id: string, patch: CronJobPatch): Promise<CronJob | null> {
    const idx = this.store.jobs.findIndex(j => j.id === id);
    if (idx === -1) return null;

    const existing = this.store.jobs[idx]!;
    const updated: CronJob = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAtMs: existing.createdAtMs,
      updatedAtMs: Date.now(),
      payload: patch.payload
        ? { ...existing.payload, ...patch.payload } as CronJob['payload']
        : existing.payload,
      state: patch.state
        ? { ...existing.state, ...patch.state }
        : existing.state,
    };

    this.store.jobs[idx] = updated;
    await saveCronStore(this.storePath, this.store);

    // Reschedule
    this.cancelTimer(id);
    if (updated.enabled && this.running) {
      this.scheduleJob(updated);
    }

    return updated;
  }

  async removeJob(id: string): Promise<boolean> {
    const idx = this.store.jobs.findIndex(j => j.id === id);
    if (idx === -1) return false;

    this.store.jobs.splice(idx, 1);
    this.cancelTimer(id);
    await saveCronStore(this.storePath, this.store);
    return true;
  }

  listJobs(): CronJob[] {
    return [...this.store.jobs];
  }

  getJob(id: string): CronJob | undefined {
    return this.store.jobs.find(j => j.id === id);
  }

  private scheduleJob(job: CronJob): void {
    const now = Date.now();
    const nextMs = job.state.nextRunAtMs ?? computeNextRunAtMs(job.schedule, now);
    if (!nextMs) return;

    const delayMs = Math.max(0, nextMs - now);
    const timer = setTimeout(async () => {
      if (!this.running) return;
      await this.executeJob(job);

      // Reschedule if recurring
      if (!job.deleteAfterRun) {
        const nextRun = computeNextRunAtMs(job.schedule, Date.now());
        if (nextRun) {
          job.state.nextRunAtMs = nextRun;
          await saveCronStore(this.storePath, this.store);
          this.scheduleJob(job);
        }
      }
    }, delayMs);

    this.timers.set(job.id, timer);
  }

  private async executeJob(job: CronJob): Promise<void> {
    const startMs = Date.now();
    job.state.runningAtMs = startMs;

    try {
      await this.callback(job);
      job.state.lastStatus = 'ok';
      job.state.lastError = undefined;
    } catch (err) {
      job.state.lastStatus = 'error';
      job.state.lastError = err instanceof Error ? err.message : String(err);
    }

    job.state.lastRunAtMs = startMs;
    job.state.lastDurationMs = Date.now() - startMs;
    job.state.runningAtMs = undefined;

    if (job.deleteAfterRun) {
      job.enabled = false;
    }

    // Compute next run
    job.state.nextRunAtMs = job.enabled
      ? computeNextRunAtMs(job.schedule, Date.now())
      : undefined;

    await saveCronStore(this.storePath, this.store);
  }

  private cancelTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}

function generateId(): string {
  return `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
