import { Injectable } from '@nestjs/common';
import { HistorySnapshotStore } from './history-snapshot.store';
import { Driver, HistoricalOffer, HistoricalRoute, Market } from './history.types';

@Injectable()
export class DriverRepository {
  constructor(private readonly store: HistorySnapshotStore) {}

  findAll(): Driver[] {
    return this.store.current().drivers;
  }

  findByIds(ids: string[]): Driver[] {
    const wanted = new Set(ids);
    return this.findAll().filter((d) => wanted.has(d.driverId));
  }

  findByMarket(market: Market): Driver[] {
    return this.findAll().filter((d) => d.market === market);
  }
}

@Injectable()
export class RouteHistoryRepository {
  constructor(private readonly store: HistorySnapshotStore) {}

  findAll(): HistoricalRoute[] {
    return this.store.current().routes;
  }

  findScheduledBefore(cutoff: Date): HistoricalRoute[] {
    return this.findAll().filter((r) => r.scheduledStart < cutoff);
  }

  findScheduledBetween(from: Date, toExclusive?: Date): HistoricalRoute[] {
    return this.findAll().filter(
      (r) => r.scheduledStart >= from && (toExclusive === undefined || r.scheduledStart < toExclusive),
    );
  }

  scheduledRange(): { min: Date; max: Date } | null {
    const routes = this.findAll();
    if (routes.length === 0) return null;
    let min = routes[0].scheduledStart;
    let max = min;
    for (const r of routes) {
      if (r.scheduledStart < min) min = r.scheduledStart;
      if (r.scheduledStart > max) max = r.scheduledStart;
    }
    return { min, max };
  }

  markets(): Market[] {
    return this.store.current().markets;
  }
}

@Injectable()
export class OfferHistoryRepository {
  constructor(private readonly store: HistorySnapshotStore) {}

  findAll(): HistoricalOffer[] {
    return this.store.current().offers;
  }

  findByRouteIds(ids: Iterable<string>): HistoricalOffer[] {
    const wanted = new Set(ids);
    return this.findAll().filter((o) => wanted.has(o.routeId));
  }
}
