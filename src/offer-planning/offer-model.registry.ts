import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { HistorySnapshot } from '../history/history-snapshot';
import { HistorySnapshotStore } from '../history/history-snapshot.store';
import { ModelOfferPolicy } from './domain/model-offer.policy';
import { OfferPlanningConfig } from './domain/offer-planning.config';
import { OfferModelTrainer, TrainedOfferModels } from './offer-model.trainer';

export const PLANNING_CONFIG = Symbol('PLANNING_CONFIG');

export interface CurrentModels {
  models: TrainedOfferModels;
  policy: ModelOfferPolicy;
  modelVersion: string;
}

@Injectable()
export class OfferModelRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfferModelRegistry.name);
  private state?: CurrentModels;
  private pending: HistorySnapshot | null = null;
  private running: Promise<void> | null = null;
  private subscription?: Subscription;
  lastReloadError: string | null = null;

  constructor(
    private readonly store: HistorySnapshotStore,
    @Inject(PLANNING_CONFIG) private readonly config: OfferPlanningConfig,
  ) {}

  onModuleInit(): void {
    this.state = this.build(this.store.current());
    this.subscription = this.store.snapshots$.subscribe((s) => this.enqueue(s));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  current(): CurrentModels {
    if (!this.state) throw new Error('Offer models are not trained yet');
    return this.state;
  }

  /** Resolves once no retrain is running or pending. */
  async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  private build(snapshot: HistorySnapshot): CurrentModels {
    const models = OfferModelTrainer.train(snapshot, this.config);
    const trainedAt = new Date().toISOString();
    return {
      models,
      policy: new ModelOfferPolicy(models.reference, models.acceptance, this.config, models.profile),
      modelVersion: `${snapshot.fingerprint}-${trainedAt}`,
    };
  }

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
            this.logger.error(`Retraining failed, keeping previous models: ${this.lastReloadError}`);
          }
        }
        this.running = null;
        resolve();
      });
    });
  }
}
