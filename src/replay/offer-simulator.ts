import { Driver, HistoricalRoute } from '../history/history.types';
import { AcceptanceModel } from '../offer-planning/domain/acceptance.model';
import { Candidate, OfferPlan } from '../offer-planning/domain/offer-plan';
import { OfferPolicy } from '../offer-planning/domain/offer-policy';
import { ReferencePriceModel } from '../offer-planning/domain/reference-price.model';
import { uniformFromKey } from './hash-random';
import { realizedCost, CostSettings, RouteSums } from './replay-metrics';

/**
 * Result of simulating one route for one draw.
 */
export interface RouteOutcome {
  filled: boolean;
  wave: number;
  price: number;
  minutes: number;
  driverId: string | null;
}

/**
 * Creates the offer policy to use for a given route and draw.
 */
export type PolicyFactory = (route: HistoricalRoute, draw: number) => OfferPolicy;

/**
 * Key identifying a market and scheduled start time; routes sharing it compete for the same drivers.
 *
 * @param r - The route.
 * @returns The slot key.
 */
export const slotKey = (r: HistoricalRoute): string => `${r.market}|${r.scheduledStart.getTime()}`;
/**
 * Key identifying a market-day, used as the bootstrap resampling cluster.
 *
 * @param r - The route.
 * @returns The cluster key (market and UTC date).
 */
export const clusterKey = (r: HistoricalRoute): string => `${r.market}|${r.scheduledStart.toISOString().slice(0, 10)}`;

/**
 * The simulated environment. Acceptance is an AcceptanceModel fitted on the test window only (never the
 * policy's own model). Randomness is common: a uniform keyed by (route, driver, draw, offer index).
 */
export class OfferSimulator {
  /**
   * Creates a simulator.
   *
   * @param environment - Acceptance model fitted on the test window, defining driver behavior.
   * @param reference - Reference price model used to normalize prices.
   * @param driversByMarket - Available drivers grouped by market.
   * @param waveIntervalMinutes - Minutes between offer waves.
   * @param seed - Seed for the common random numbers.
   * @param costs - Cost settings for realized cost.
   * @param onTimeRateByMarket - Expected on-time rate per market, credited to filled routes.
   */
  constructor(
    private readonly environment: AcceptanceModel,
    private readonly reference: ReferencePriceModel,
    private readonly driversByMarket: Map<string, Driver[]>,
    private readonly waveIntervalMinutes: number,
    private readonly seed: number,
    private readonly costs: CostSettings,
    private readonly onTimeRateByMarket: Map<string, number>,
  ) {}

/**
   * Runs one policy over all routes for `draws` draws and returns per-route sums.
   *
   * Routes are processed in start order; a driver who accepts a route in a slot is unavailable for other routes in that slot within the same draw.
   *
   * @param routes - Routes to simulate.
   * @param factory - Builds the policy for each route and draw.
   * @param draws - Number of Monte Carlo draws.
   * @returns Per-route sums over all draws.
   */
  run(routes: HistoricalRoute[], factory: PolicyFactory, draws: number): RouteSums[] {
    const ordered = [...routes].sort(
      (a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime() || a.routeId.localeCompare(b.routeId),
    );
    const sums = new Map<string, RouteSums>(
      ordered.map((r) => [r.routeId, { cluster: clusterKey(r), draws: 0, cost: 0, filled: 0, wave1: 0, minutes: 0, paid: 0, paidOverRef: 0, onTime: 0 }]),
    );
    for (let draw = 0; draw < draws; draw++) {
      const busy = new Map<string, Set<string>>(); // slot -> drivers who accepted a route in it this draw
      for (const route of ordered) {
        const slot = slotKey(route);
        const taken = busy.get(slot) ?? new Set<string>();
        const pool: Candidate[] = (this.driversByMarket.get(route.market) ?? [])
          .filter((d) => !taken.has(d.driverId))
          .map((d) => ({ driverId: d.driverId, attributes: { rating: d.rating, routesCompleted90d: d.routesCompleted90d } }));
        const ref = this.reference.priceFor(route);
        const outcome = this.simulateRoute(route, pool, factory(route, draw), draw, ref);
        if (outcome.filled && outcome.driverId) {
          taken.add(outcome.driverId);
          busy.set(slot, taken);
        }
        const s = sums.get(route.routeId) as RouteSums;
        s.draws += 1;
        s.cost += realizedCost(outcome, ref, this.costs);
        if (outcome.filled) {
          s.filled += 1;
          if (outcome.wave === 1) s.wave1 += 1;
          s.minutes += outcome.minutes;
          s.paid += outcome.price;
          s.paidOverRef += outcome.price / ref;
          s.onTime += this.onTimeRateByMarket.get(route.market) ?? 0;
        }
      }
    }
    return [...sums.values()];
  }

  /**
   * Simulates offering one route wave by wave until a driver accepts or waves run out.
   *
   * Each offer uses a keyed uniform draw compared with the acceptance probability; the lowest uniform among accepters in a wave wins.
   *
   * @param route - The route to fill.
   * @param pool - Candidate drivers still available.
   * @param policy - Policy that plans the waves.
   * @param draw - Draw index, part of the random key.
   * @param ref - Reference price for the route.
   * @returns The outcome (unfilled if the pool is empty or no one accepts).
   */
  private simulateRoute(route: HistoricalRoute, pool: Candidate[], policy: OfferPolicy, draw: number, ref: number): RouteOutcome {
    if (pool.length === 0) return { filled: false, wave: 0, price: 0, minutes: 0, driverId: null };
    const plan: OfferPlan = policy.plan({
      route: { routeId: route.routeId, market: route.market, totalMiles: route.totalMiles, stopCount: route.stopCount, scheduledStart: route.scheduledStart },
      candidates: pool,
    });
    const offerCount = new Map<string, number>();
    for (const wave of plan.waves) {
      let winner: { driverId: string; u: number } | null = null;
      for (const d of wave.drivers) {
        const idx = offerCount.get(d.driverId) ?? 0;
        offerCount.set(d.driverId, idx + 1);
        const u = uniformFromKey(`${route.routeId}|${d.driverId}|${draw}|${idx}`, this.seed);
        const attrs = pool.find((c) => c.driverId === d.driverId)?.attributes;
        const p = this.environment.probability({
          driverId: d.driverId, market: route.market, price: wave.price, referencePrice: ref, wave: wave.wave, attributes: attrs,
        }).p;
        if (u < p && (winner === null || u < winner.u)) winner = { driverId: d.driverId, u };
      }
      if (winner) {
        const m = uniformFromKey(`${route.routeId}|${winner.driverId}|${draw}|minutes`, this.seed);
        return {
          filled: true,
          wave: wave.wave,
          price: wave.price,
          minutes: (wave.wave - 1) * this.waveIntervalMinutes + 1 + Math.floor(m * this.waveIntervalMinutes),
          driverId: winner.driverId,
        };
      }
    }
    return { filled: false, wave: 0, price: 0, minutes: 0, driverId: null };
  }
}
