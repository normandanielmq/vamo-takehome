import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { HistorySnapshot } from '../history/history-snapshot';
import { HistorySnapshotStore } from '../history/history-snapshot.store';
import { ModelOfferPolicy } from './domain/model-offer.policy';
import { OfferPlanningConfig } from './domain/offer-planning.config';
import { OfferModelTrainer, TrainedOfferModels } from './offer-model.trainer';

/** Injection token for the {@link OfferPlanningConfig}. */
export const PLANNING_CONFIG = Symbol('PLANNING_CONFIG');

/** Trained models, the policy built from them, and a version identifier. */
export interface CurrentModels {
  models: TrainedOfferModels;
  policy: ModelOfferPolicy;
  modelVersion: string;
}

/**
 * Holds the current trained models and retrains them when a new history snapshot arrives.
 *
 * On a failed retrain the previous models are kept.
 */
@Injectable()
export class OfferModelRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfferModelRegistry.name);
  private state?: CurrentModels;
  private pending: HistorySnapshot | null = null;
  private running: Promise<void> | null = null;
  private subscription?: Subscription;
  lastReloadError: string | null = null;

  /**
   * @param store - Source of history snapshots and change notifications.
   * @param config - Planning configuration used for training and policy.
   */
  constructor(
    private readonly store: HistorySnapshotStore,
    @Inject(PLANNING_CONFIG) private readonly config: OfferPlanningConfig,
  ) {}

  /**
   * Trains the initial models and subscribes to snapshot changes.
   * @throws If initial training fails, which prevents startup.
   */
  onModuleInit(): void {
    this.state = this.build(this.store.current());
    this.subscription = this.store.snapshots$.subscribe((s) => this.enqueue(s));
  }

  /** Stops listening for snapshot changes. */
  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * Returns the current models.
   * @returns The latest successfully trained models.
   * @throws If no models have been trained yet.
   */
  current(): CurrentModels {
    if (!this.state) throw new Error('Offer models are not trained yet');
    return this.state;
  }

  /**
   * Resolves once no retrain is running or pending.
   * @returns A promise that settles when the registry is idle.
   */
  async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  /**
   * Trains models and builds the offer policy for a snapshot.
   * @param snapshot - History to train on.
   * @returns The models, policy and a version combining fingerprint and training time.
   * @throws If training fails.
   */
  private build(snapshot: HistorySnapshot): CurrentModels {
    const models = OfferModelTrainer.train(snapshot, this.config);
    const trainedAt = new Date().toISOString();
    return {
      models,
      policy: new ModelOfferPolicy(
        models.reference,
        models.acceptance,
        this.config,
        models.profile,
      ),
      modelVersion: `${snapshot.fingerprint}-${trainedAt}`,
    };
  }

  /**
   * Schedules a retrain, coalescing bursts so only the latest snapshot is trained.
   * @param snapshot - Newly loaded snapshot.
   */
  private enqueue(snapshot: HistorySnapshot): void {
    this.pending = snapshot; // only the latest pending snapshot is kept
    if (this.running) return;
    this.running = new Promise<void>((resolve) => {
      setImmediate(() => {
        while (this.pending) {
          const next = this.pending;
          this.pending = null;
          try {
            this.state = this.build(next);
            this.lastReloadError = null;
            this.logger.log(`Retrained models, version ${this.state.modelVersion}`);
          } catch (error) {
            this.lastReloadError = (error as Error).message;
            this.logger.error(
              `Retraining failed, keeping previous models: ${this.lastReloadError}`,
            );
          }
        }
        this.running = null;
        resolve();
      });
    });
  }
}
