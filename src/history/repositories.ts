import { Injectable } from '@nestjs/common';
import { HistorySnapshotStore } from './history-snapshot.store';
import { Driver, HistoricalOffer, HistoricalRoute, Market } from './history.types';

/** Read-only access to drivers in the current history snapshot. */
@Injectable()
export class DriverRepository {
  /** @param store - Source of the current history snapshot. */
  constructor(private readonly store: HistorySnapshotStore) {}

  /**
   * Lists all drivers.
   * @returns Every driver in the current snapshot.
   */
  findAll(): Driver[] {
    return this.store.current().drivers;
  }

  /**
   * Finds drivers by id; unknown ids are ignored.
   * @param ids - Driver ids to look up.
   * @returns The matching drivers.
   */
  findByIds(ids: string[]): Driver[] {
    const wanted = new Set(ids);
    return this.findAll().filter((d) => wanted.has(d.driverId));
  }

  /**
   * Finds drivers belonging to a market.
   * @param market - Market to filter by.
   * @returns Drivers in that market.
   */
  findByMarket(market: Market): Driver[] {
    return this.findAll().filter((d) => d.market === market);
  }
}

/** Read-only access to historical routes in the current history snapshot. */
@Injectable()
export class RouteHistoryRepository {
  /** @param store - Source of the current history snapshot. */
  constructor(private readonly store: HistorySnapshotStore) {}

  /**
   * Lists all historical routes.
   * @returns Every route in the current snapshot.
   */
  findAll(): HistoricalRoute[] {
    return this.store.current().routes;
  }

  /**
   * Finds routes scheduled strictly before a cutoff.
   * @param cutoff - Exclusive upper bound on scheduled start.
   * @returns The matching routes.
   */
  findScheduledBefore(cutoff: Date): HistoricalRoute[] {
    return this.findAll().filter((r) => r.scheduledStart < cutoff);
  }

  /**
   * Finds routes scheduled within a time window.
   * @param from - Inclusive lower bound on scheduled start.
   * @param toExclusive - Exclusive upper bound; when omitted the window is open-ended.
   * @returns The matching routes.
   */
  findScheduledBetween(from: Date, toExclusive?: Date): HistoricalRoute[] {
    return this.findAll().filter(
      (r) => r.scheduledStart >= from && (toExclusive === undefined || r.scheduledStart < toExclusive),
    );
  }

  /**
   * Computes the earliest and latest scheduled start across all routes.
   * @returns The range, or `null` when there are no routes.
   */
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

  /**
   * Lists the distinct markets present in the routes.
   * @returns Sorted markets of the current snapshot.
   */
  markets(): Market[] {
    return this.store.current().markets;
  }
}

/** Read-only access to historical offers in the current history snapshot. */
@Injectable()
export class OfferHistoryRepository {
  /** @param store - Source of the current history snapshot. */
  constructor(private readonly store: HistorySnapshotStore) {}

  /**
   * Lists all historical offers.
   * @returns Every offer in the current snapshot.
   */
  findAll(): HistoricalOffer[] {
    return this.store.current().offers;
  }

  /**
   * Finds offers made on any of the given routes.
   * @param ids - Route ids to look up.
   * @returns The matching offers.
   */
  findByRouteIds(ids: Iterable<string>): HistoricalOffer[] {
    const wanted = new Set(ids);
    return this.findAll().filter((o) => wanted.has(o.routeId));
  }
}
