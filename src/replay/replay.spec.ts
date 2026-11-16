import { generateDataset, writeDatasetCsv } from '../../test/support/synthetic-data';
import { loadHistorySnapshot } from '../history/history-snapshot';
import { asMarket, Driver, HistoricalRoute } from '../history/history.types';
import { InsufficientDataError } from '../offer-planning/domain/errors';
import { OfferPlan } from '../offer-planning/domain/offer-plan';
import { DEFAULT_WINDOW_OPTIONS, deriveWindows, splitWindow } from './evaluation-windows';
import { uniformFromKey } from './hash-random';
import { OfferSimulator } from './offer-simulator';
import { pairedClusterBootstrap } from './paired-bootstrap';
import { metricsFromSums, realizedCost, RouteSums } from './replay-metrics';
import { runReplay } from './replay-runner';

const route = (id: string, start: string, market = 'AAA'): HistoricalRoute => ({
  routeId: id, market: asMarket(market), scheduledStart: new Date(start), stopCount: 5, totalMiles: 20, wave1Price: 100,
  finalWave: null, finalPrice: null, accepted: false, acceptedDriverId: null, minutesToAccept: null, completedOnTime: null,
});

describe('realizedCost and metrics', () => {
  const costs = { unfilledPenaltyMultiplier: 2, delayCostPerWaveMultiplier: 0.03 };
  it('charges the unfilled penalty and delay cost', () => {
    expect(realizedCost({ filled: false, price: 0, wave: 0 }, 100, costs)).toBe(200);
    expect(realizedCost({ filled: true, price: 108, wave: 3 }, 100, costs)).toBeCloseTo(108 + 0.03 * 100 * 2, 9);
  });
  it('aggregates sums into rates', () => {
    const s: RouteSums = { cluster: 'c', draws: 4, cost: 400, filled: 2, wave1: 1, minutes: 60, paid: 200, paidOverRef: 2, onTime: 1 };
    const m = metricsFromSums([s]);
    expect(m).toMatchObject({ costPerPostedRoute: 100, fillRate: 0.5, wave1FillRate: 0.25, meanMinutesToAccept: 30, meanPaid: 100 });
  });
});

describe('evaluation windows', () => {
  const range = { min: new Date('2026-08-01T05:00:00Z'), max: new Date('2026-10-30T16:00:00Z') };
  it('derives the cutoffs by rule', () => {
    const w = deriveWindows(range, DEFAULT_WINDOW_OPTIONS);
    expect(w.headline.testFrom.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(w.early.testFrom.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(w.early.testBefore?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('lets --cutoff override and refuses tiny slices', () => {
    const w = deriveWindows(range, { ...DEFAULT_WINDOW_OPTIONS, cutoff: new Date('2026-09-01T00:00:00Z') });
    expect(w.headline.testFrom.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(() => splitWindow(w.headline, [route('a', '2026-08-15T00:00:00Z')], [], DEFAULT_WINDOW_OPTIONS)).toThrow(InsufficientDataError);
  });
});

describe('pairedClusterBootstrap', () => {
  const sums = (cluster: string, cost: number): RouteSums => ({ cluster, draws: 1, cost, filled: 1, wave1: 0, minutes: 10, paid: cost, paidOverRef: 1, onTime: 0 });
  it('resamples whole clusters: one cluster gives a zero-width interval', () => {
    const d = pairedClusterBootstrap([sums('a', 90), sums('a', 90)], [sums('a', 100), sums('a', 100)], 50, 1);
    expect(d.costPerPostedRoute).toEqual({ estimate: -10, low: -10, high: -10 });
  });
  it('is paired: a constant per-cluster difference has no spread across many clusters', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const d = pairedClusterBootstrap(ids.map((c, i) => sums(c, 80 + i)), ids.map((c, i) => sums(c, 90 + i)), 200, 3);
    expect(d.costPerPostedRoute.low).toBeCloseTo(-10, 9);
    expect(d.costPerPostedRoute.high).toBeCloseTo(-10, 9);
  });
});

describe('OfferSimulator', () => {
  const driver: Driver = { driverId: 'only', market: asMarket('AAA'), rating: null, routesCompleted90d: null };
  const environment = { probability: () => ({ p: 0.999, coldStart: 'none' }) } as never;
  const reference = { priceFor: () => 100 } as never;
  const plan: OfferPlan = {
    referencePrice: 100, startingPrice: 100, startMultiplier: 1, assumptions: { unfilledPenaltyMultiplier: 2, delayCostPerWaveMultiplier: 0.03, priceStep: 0.08, extrapolatedWaves: [] },
    waves: [{ wave: 1, price: 100, offerAtMinute: 0, drivers: [{ driverId: 'only', rank: 1, acceptProbability: 1, coldStart: 'none', isReoffer: false }] }],
  };
  const sim = new OfferSimulator(environment, reference, new Map([['AAA', [driver]]]), 30, 5, { unfilledPenaltyMultiplier: 2, delayCostPerWaveMultiplier: 0.03 }, new Map());

  it('does not let one driver accept two routes in the same market and slot within a draw', () => {
    const same = [route('r1', '2026-10-01T10:00:00Z'), route('r2', '2026-10-01T10:00:00Z')];
    const out = sim.run(same, () => ({ plan: () => plan }), 1);
    expect(out.reduce((s, r) => s + r.filled, 0)).toBe(1);
    const apart = [route('r1', '2026-10-01T10:00:00Z'), route('r2', '2026-10-01T11:00:00Z')];
    expect(sim.run(apart, () => ({ plan: () => plan }), 1).reduce((s, r) => s + r.filled, 0)).toBe(2);
  });

  it('gives identical results for identical keys', () => {
    expect(uniformFromKey('a|b|0|0', 1)).toBe(uniformFromKey('a|b|0|0', 1));
    expect(uniformFromKey('a|b|0|0', 1)).not.toBe(uniformFromKey('a|b|0|1', 1));
    const rs = [route('r1', '2026-10-01T10:00:00Z')];
    expect(sim.run(rs, () => ({ plan: () => plan }), 5)).toEqual(sim.run(rs, () => ({ plan: () => plan }), 5));
  });
});

describe('runReplay on a synthetic dataset with arbitrary markets', () => {
  it('runs end to end and reports every gate (smoke test; synthetic data does not promise a win)', () => {
    const dir = writeDatasetCsv(generateDataset({ markets: ['QQQ', 'RRR'], routesPerMarket: 500, days: 60, seed: 21 }));
    const snapshot = loadHistorySnapshot({ routesFile: `${dir}/routes.csv`, offersFile: `${dir}/offers.csv`, driversFile: `${dir}/drivers.csv` }, 'fail');
    const report = runReplay(snapshot, { draws: 5, bootstrapResamples: 50, windows: ['headline', 'early'] });
    expect(report.windows).toHaveLength(2);
    const head = report.windows[0];
    expect(head.evaluatedRoutes).toBeGreaterThan(50);
    expect(head.consistency.mismatches).toBe(0);
    expect(head.gates.length).toBeGreaterThanOrEqual(8);
    expect(Number.isFinite(head.difference.costPerPostedRoute.estimate)).toBe(true);
  });
});
