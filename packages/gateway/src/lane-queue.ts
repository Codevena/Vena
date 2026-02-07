import { createLogger, VenaError } from '@vena/shared';

const log = createLogger('gateway:lane-queue');

interface QueueEntry {
  sessionKey: string;
  task: () => Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
}

interface LaneState {
  concurrency: number;
  activeCount: number;
  queue: QueueEntry[];
  activeSessions: Set<string>;
}

export class LaneQueue {
  private lanes = new Map<string, LaneState>();

  constructor(lanes: Record<string, { concurrency: number }> = {}) {
    const defaults: Record<string, { concurrency: number }> = {
      main: { concurrency: 4 },
      cron: { concurrency: 1 },
      subagent: { concurrency: 8 },
      ...lanes,
    };

    for (const [name, config] of Object.entries(defaults)) {
      this.lanes.set(name, {
        concurrency: config.concurrency,
        activeCount: 0,
        queue: [],
        activeSessions: new Set(),
      });
    }

    log.info({ lanes: Object.keys(defaults) }, 'LaneQueue initialized');
  }

  async enqueue(lane: string, sessionKey: string, task: () => Promise<void>): Promise<void> {
    const state = this.lanes.get(lane);
    if (!state) {
      throw new VenaError(`Unknown lane: ${lane}`, 'LANE_QUEUE_ERROR', { lane });
    }

    return new Promise<void>((resolve, reject) => {
      state.queue.push({ sessionKey, task, resolve, reject });
      this.process(lane);
    });
  }

  private process(lane: string): void {
    const state = this.lanes.get(lane);
    if (!state) return;

    while (state.activeCount < state.concurrency && state.queue.length > 0) {
      // Find next entry whose session is not currently active
      const idx = state.queue.findIndex(e => !state.activeSessions.has(e.sessionKey));
      if (idx === -1) break;

      const entry = state.queue.splice(idx, 1)[0]!;
      state.activeCount++;
      state.activeSessions.add(entry.sessionKey);

      log.debug({ lane, sessionKey: entry.sessionKey, activeCount: state.activeCount }, 'Running task');

      entry.task()
        .then(() => entry.resolve())
        .catch((err: Error) => entry.reject(err))
        .finally(() => {
          state.activeCount--;
          state.activeSessions.delete(entry.sessionKey);
          this.process(lane);
        });
    }
  }

  getStats(): Record<string, { concurrency: number; activeCount: number; queueLength: number }> {
    const stats: Record<string, { concurrency: number; activeCount: number; queueLength: number }> = {};
    for (const [name, state] of this.lanes) {
      stats[name] = {
        concurrency: state.concurrency,
        activeCount: state.activeCount,
        queueLength: state.queue.length,
      };
    }
    return stats;
  }
}
