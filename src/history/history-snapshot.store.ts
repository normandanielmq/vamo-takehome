import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { statSync } from 'node:fs';
import { Subject } from 'rxjs';
import { APP_CONFIG, AppConfig } from '../config/app.config';
import { HistorySnapshot, loadHistorySnapshot } from './history-snapshot';

@Injectable()
export class HistorySnapshotStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HistorySnapshotStore.name);
  private snapshot?: HistorySnapshot;
  private statKey = '';
  private timer?: NodeJS.Timeout;
  private readonly changes = new Subject<HistorySnapshot>();
  readonly snapshots$ = this.changes.asObservable();
  lastReloadError: string | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit(): void {
    this.snapshot = loadHistorySnapshot(this.config, this.config.invalidRowPolicy);
    this.statKey = this.currentStatKey();
    if (this.config.reloadIntervalMs > 0) {
      this.timer = setInterval(() => this.check(), this.config.reloadIntervalMs);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.changes.complete();
  }

  current(): HistorySnapshot {
    if (!this.snapshot) throw new Error('History snapshot is not loaded yet');
    return this.snapshot;
  }

  /** Reloads when files changed. Exposed for tests; the timer calls it. */
  check(): boolean {
    let key: string;
    try {
      key = this.currentStatKey();
    } catch (error) {
      this.fail(error);
      return false;
    }
    if (key === this.statKey) return false;
    try {
      const next = loadHistorySnapshot(this.config, this.config.invalidRowPolicy);
      this.statKey = key;
      this.lastReloadError = null;
      if (next.fingerprint === this.snapshot?.fingerprint) return false;
      this.snapshot = next;
      this.logger.log(`Loaded new history snapshot ${next.fingerprint}`);
      this.changes.next(next);
      return true;
    } catch (error) {
      // Keep the last good snapshot; retry on the next tick (statKey unchanged only if still mid-write).
      this.statKey = key;
      this.fail(error);
      return false;
    }
  }

  private fail(error: unknown): void {
    this.lastReloadError = (error as Error).message;
    this.logger.error(`History reload failed, keeping last good snapshot: ${this.lastReloadError}`);
  }

  private currentStatKey(): string {
    return [this.config.routesFile, this.config.offersFile, this.config.driversFile]
      .map((f) => {
        const s = statSync(f);
        return `${s.mtimeMs}:${s.size}`;
      })
      .join('|');
  }
}
