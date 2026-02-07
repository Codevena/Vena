import { watch, readFileSync, type FSWatcher } from 'node:fs';
import { createLogger, venaConfigSchema, type VenaConfig } from '@vena/shared';

const log = createLogger('gateway:config-watcher');

export class ConfigWatcher {
  private configPath: string;
  private watcher: FSWatcher | null = null;
  private handlers: Array<(config: VenaConfig) => void> = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 500;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  watch(): void {
    if (this.watcher) return;

    log.info({ configPath: this.configPath }, 'Starting config watcher');

    this.watcher = watch(this.configPath, (eventType) => {
      if (eventType === 'change') {
        this.scheduleReload();
      }
    });

    this.watcher.on('error', (err) => {
      log.error({ err }, 'Config watcher error');
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    log.info('Config watcher stopped');
  }

  onChange(handler: (config: VenaConfig) => void): void {
    this.handlers.push(handler);
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.reload();
    }, this.debounceMs);
  }

  private reload(): void {
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const config = venaConfigSchema.parse(parsed);
      log.info('Config reloaded successfully');
      for (const handler of this.handlers) {
        try {
          handler(config);
        } catch (err) {
          log.error({ err }, 'Error in config change handler');
        }
      }
    } catch (err) {
      log.error({ err }, 'Failed to reload config');
    }
  }
}
