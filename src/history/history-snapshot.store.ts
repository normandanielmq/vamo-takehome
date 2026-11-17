import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { statSync } from 'node:fs';
import { Subject } from 'rxjs';
import { APP_CONFIG, AppConfig } from '../config/app.config';
import { HistorySnapshot, loadHistorySnapshot } from './history-snapshot';

/**
 * Holds the current {@link HistorySnapshot} and hot-reloads it when the CSV files change.
 *
 * On a failed reload the last good snapshot is kept.
 */
@Injectable()
export class HistorySnapshotStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HistorySnapshotStore.name);
  private snapshot?: HistorySnapshot;
  private statKey = '';
  private timer?: NodeJS.Timeout;
  private readonly changes = new Subject<HistorySnapshot>();
  readonly snapshots$ = this.changes.asObservable();
  lastReloadError: string | null = null;

  /** @param config - Application configuration with file paths and reload settings. */
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Loads the initial snapshot and starts the periodic change check.
   * @throws If the initial load fails, which prevents startup.
   */
  onModuleInit(): void {
    this.snapshot = loadHistorySnapshot(this.config, this.config.invalidRowPolicy);
    this.statKey = this.currentStatKey();
    if (this.config.reloadIntervalMs > 0) {
      this.timer = setInterval(() => this.check(), this.config.reloadIntervalMs);
      this.timer.unref();
    }
  }

  /** Stops the change check and completes the snapshot stream. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.changes.complete();
  }

  /**
   * Returns the current snapshot.
   * @returns The latest successfully loaded snapshot.
   * @throws If no snapshot has been loaded yet.
   */
  current(): HistorySnapshot {
    if (!this.snapshot) throw new Error('History snapshot is not loaded yet');
    return this.snapshot;
  }

  /**
   * Reloads when files changed. Exposed for tests; the timer calls it.
   *
   * A failed reload keeps the last good snapshot and records the error in `lastReloadError`.
   * @returns `true` if a new snapshot was published, otherwise `false`.
   */
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

  /**
   * Records and logs a reload failure without discarding the current snapshot.
   * @param error - The error raised while checking or reloading.
   */
  private fail(error: unknown): void {
    this.lastReloadError = (error as Error).message;
    this.logger.error(`History reload failed, keeping last good snapshot: ${this.lastReloadError}`);
  }

  /**
   * Builds a cheap change-detection key from file modification times and sizes.
   * @returns A string that changes when any data file changes.
   * @throws If a data file cannot be stat'ed.
   */
  private currentStatKey(): string {
    return [this.config.routesFile, this.config.offersFile, this.config.driversFile]
      .map((f) => {
        const s = statSync(f);
        return `${s.mtimeMs}:${s.size}`;
      })
      .join('|');
  }
}
