import { Module } from '@nestjs/common';
import { HistorySnapshotStore } from './history-snapshot.store';
import { DriverRepository, OfferHistoryRepository, RouteHistoryRepository } from './repositories';

@Module({
  providers: [HistorySnapshotStore, DriverRepository, RouteHistoryRepository, OfferHistoryRepository],
  exports: [HistorySnapshotStore, DriverRepository, RouteHistoryRepository, OfferHistoryRepository],
})
/** Provides the history snapshot store and the repositories built on it. */
export class HistoryModule {}
