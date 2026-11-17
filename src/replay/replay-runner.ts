import { HistorySnapshot } from '../history/history-snapshot';
import { Driver, HistoricalRoute } from '../history/history.types';
import { AcceptanceModel, TrainingOffer } from '../offer-planning/domain/acceptance.model';
import { BaselineOfferPolicy } from '../offer-planning/domain/baseline-offer.policy';
import { ModelOfferPolicy } from '../offer-planning/domain/model-offer.policy';
import { DEFAULT_PLANNING_CONFIG, OfferPlanningConfig } from '../offer-planning/domain/offer-planning.config';
import { OfferModelTrainer } from '../offer-planning/offer-model.trainer';
import {
  DEFAULT_WINDOW_OPTIONS, deriveWindows, EvaluationWindow, splitWindow, WindowName, WindowOptions,
} from './evaluation-windows';
import { streamFromKey } from './hash-random';
import { checkConsistency, ConsistencyReport } from './logged-baseline';
import { evaluateOffline, OfflineEvaluation } from './offline-evaluation';
import { OfferSimulator, clusterKey, slotKey } from './offer-simulator';
import { DifferenceIntervals, pairedClusterBootstrap } from './paired-bootstrap';
import { MetricSet, metricsFromSums, realizedCost, RouteSums } from './replay-metrics';

/**
 * Tunable settings for a replay run.
 *
 * Fields cover Monte Carlo draws, seed, which windows to run, window overrides, bootstrap size and the planning config.
 */
export interface ReplayOptions {
  draws: number;
  seed: number;
  windows: WindowName[];
  window: Partial<WindowOptions>;
  bootstrapResamples: number;
  planning: OfferPlanningConfig;
}

/**
 * Default replay options, used for any field the caller does not override.
 */
export const DEFAULT_REPLAY_OPTIONS: ReplayOptions = {
  draws: 200,
  seed: 42,
  windows: ['headline'],
  window: {},
  bootstrapResamples: 1000,
  planning: DEFAULT_PLANNING_CONFIG,
};

/**
 * A single pass/fail validity check on a window result, with a human-readable detail string.
 */
export interface Gate {
  name: string;
  pass: boolean;
  detail: string;
}

/**
 * Full results for one evaluation window: split sizes, metrics for logged/simulated/model policies, paired differences, offline diagnostics and validity gates.
 */
export interface WindowReport {
  window: WindowName;
  trainBefore: string;
  testFrom: string;
  testBefore: string | null;
  trainRoutes: number;
  testRoutes: number;
  evaluatedRoutes: number;
  skippedMarkets: Record<string, string>;
  slotOverlapRate: number;
  loggedBaseline: MetricSet;
  simulatedBaseline: MetricSet;
  modelPolicy: MetricSet;
  difference: DifferenceIntervals;
  offline: OfflineEvaluation;
  pricing: { multiplierHistogram: Record<string, number>; shareAtGridEdge: number };
  consistency: ConsistencyReport;
  gates: Gate[];
}

/**
 * Top-level replay output: data fingerprint and quality, the run options and one report per window.
 */
export interface ReplayReport {
  fingerprint: string;
  dataQuality: HistorySnapshot['quality'];
  options: { draws: number; seed: number; costs: { unfilledPenaltyMultiplier: number; delayCostPerWaveMultiplier: number } };
  windows: WindowReport[];
}

/**
 * Arithmetic mean of a list.
 *
 * @param xs - Values to average.
 * @returns The mean, or 0 for an empty list.
 */
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/**
 * Population standard deviation of a list.
 *
 * @param xs - Values to measure.
 * @returns The standard deviation, or 0 for an empty list.
 */
const sd = (xs: number[]) => {
  const m = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - m) ** 2)));
};

/**
 * Runs the offline replay for the requested windows and assembles the report.
 *
 * Also adds a cross-window gate when both headline and early windows ran, since the effect should have the same sign in both.
 *
 * @param snapshot - Loaded history (routes, offers, drivers, quality) to replay.
 * @param partial - Overrides merged over {@link DEFAULT_REPLAY_OPTIONS}.
 * @returns The combined replay report.
 * @throws Error If a window has no evaluable test routes; InsufficientDataError if a window split is too small.
 */
export function runReplay(snapshot: HistorySnapshot, partial: Partial<ReplayOptions> = {}): ReplayReport {
  const options = { ...DEFAULT_REPLAY_OPTIONS, ...partial };
  const windowOptions: WindowOptions = { ...DEFAULT_WINDOW_OPTIONS, ...options.window };
  const dates = snapshot.routes.map((r) => r.scheduledStart.getTime());
  const range = { min: new Date(Math.min(...dates)), max: new Date(Math.max(...dates)) };
  const defs = deriveWindows(range, windowOptions);
  const windows = options.windows.map((name) => runWindow(defs[name], snapshot, options, windowOptions));
  // significance gate: early window must share the headline's sign when both ran
  const headline = windows.find((w) => w.window === 'headline');
  const early = windows.find((w) => w.window === 'early');
  if (headline && early) {
    const same = Math.sign(headline.difference.costPerPostedRoute.estimate) === Math.sign(early.difference.costPerPostedRoute.estimate);
    headline.gates.push({ name: 'Early window agrees in sign', pass: same, detail: `headline ${headline.difference.costPerPostedRoute.estimate.toFixed(2)}, early ${early.difference.costPerPostedRoute.estimate.toFixed(2)}` });
  }
  return {
    fingerprint: snapshot.fingerprint,
    dataQuality: snapshot.quality,
    options: { draws: options.draws, seed: options.seed, costs: { unfilledPenaltyMultiplier: options.planning.unfilledPenaltyMultiplier, delayCostPerWaveMultiplier: options.planning.delayCostPerWaveMultiplier } },
    windows,
  };
}

/**
 * Evaluates one window: trains models on the training split, simulates baseline and model policies on the test routes, and computes metrics, bootstrap differences, offline diagnostics and gates.
 *
 * The simulator environment is fitted on test data only, so it is independent of the policy under test.
 *
 * @param window - The window definition (train/test boundaries).
 * @param snapshot - Full history snapshot.
 * @param options - Resolved replay options.
 * @param wo - Resolved window options (minimum route counts).
 * @returns The report for this window.
 * @throws Error If no test routes remain after dropping unsupported markets.
 */
function runWindow(window: EvaluationWindow, snapshot: HistorySnapshot, options: ReplayOptions, wo: WindowOptions): WindowReport {
  const split = splitWindow(window, snapshot.routes, snapshot.offers, wo);
  const models = OfferModelTrainer.train({ routes: split.trainRoutes, offers: split.trainOffers, drivers: snapshot.drivers }, options.planning);
  const costs = { unfilledPenaltyMultiplier: options.planning.unfilledPenaltyMultiplier, delayCostPerWaveMultiplier: options.planning.delayCostPerWaveMultiplier };

  const toRows = (routes: HistoricalRoute[], offers: typeof split.testOffers): TrainingOffer[] => {
    const byId = new Map(routes.map((r) => [r.routeId, r]));
    const rows: TrainingOffer[] = [];
    for (const o of offers) {
      const r = byId.get(o.routeId);
      if (!r || !models.reference.isSupported(r.market)) continue;
      rows.push({ driverId: o.driverId, market: r.market, wave: o.wave, price: o.offerPrice, referencePrice: models.reference.priceFor(r), accepted: o.response === 'accepted' });
    }
    return rows;
  };
  const testRows = toRows(split.testRoutes, split.testOffers);
  const environment = AcceptanceModel.train(testRows);

  const skipped: Record<string, string> = {};
  const evaluated = new Set<string>();
  for (const m of new Set(split.testRoutes.map((r) => r.market))) {
    if (models.supportedMarkets.includes(m) && environment.isSupported(m)) evaluated.add(m);
    else skipped[m] = models.unsupportedMarkets.get(m) ?? environment.unsupported.get(m) ?? 'unsupported';
  }
  const routes = split.testRoutes.filter((r) => evaluated.has(r.market));
  if (routes.length === 0) throw new Error(`${window.name}: no evaluable test routes`);

  const driversByMarket = new Map<string, Driver[]>();
  for (const d of snapshot.drivers) driversByMarket.set(d.market, [...(driversByMarket.get(d.market) ?? []), d]);
  const onTimeRates = new Map<string, number>();
  for (const m of evaluated) {
    const filled = routes.filter((r) => r.market === m && r.accepted && r.completedOnTime !== null);
    onTimeRates.set(m, filled.length ? filled.filter((r) => r.completedOnTime).length / filled.length : 0);
  }

  const sim = new OfferSimulator(environment, models.reference, driversByMarket, models.profile.waveIntervalMinutes, options.seed, costs, onTimeRates);
  const modelPolicy = new ModelOfferPolicy(models.reference, models.acceptance, options.planning, models.profile);
  const histogram = new Map<number, number>();
  const modelSums = sim.run(routes, (route, draw) => {
    return draw === 0
      ? { plan: (input) => { const p = modelPolicy.plan(input); histogram.set(p.startMultiplier, (histogram.get(p.startMultiplier) ?? 0) + 1); return p; } }
      : modelPolicy;
  }, options.draws);
  const baselineSums = sim.run(
    routes,
    (route, draw) => new BaselineOfferPolicy(() => route.wave1Price, streamFromKey(`${route.routeId}|${draw}|baseline`, options.seed), models.profile),
    options.draws,
  );

  const loggedSums: RouteSums[] = routes.map((r) => {
    const ref = models.reference.priceFor(r);
    const filled = r.accepted && r.finalPrice !== null && r.finalWave !== null;
    const outcome = { filled, price: r.finalPrice ?? 0, wave: r.finalWave ?? 0 };
    return {
      cluster: clusterKey(r), draws: 1, cost: realizedCost(outcome, ref, costs),
      filled: filled ? 1 : 0, wave1: filled && r.finalWave === 1 ? 1 : 0, minutes: filled ? r.minutesToAccept ?? 0 : 0,
      paid: filled ? (r.finalPrice as number) : 0, paidOverRef: filled ? (r.finalPrice as number) / ref : 0,
      onTime: filled ? (onTimeRates.get(r.market) ?? 0) : 0,
    };
  });

  const logged = metricsFromSums(loggedSums);
  const simulated = metricsFromSums(baselineSums);
  const model = metricsFromSums(modelSums);
  const difference = pairedClusterBootstrap(modelSums, baselineSums, options.bootstrapResamples, options.seed);

  const priceWaveOnly = AcceptanceModel.train(toRows(split.trainRoutes, split.trainOffers), { ridge: 1e6 });
  const offline = evaluateOffline(models.acceptance, priceWaveOnly, testRows);

  const slotCounts = new Map<string, number>();
  routes.forEach((r) => slotCounts.set(slotKey(r), (slotCounts.get(slotKey(r)) ?? 0) + 1));
  const slotOverlapRate = routes.filter((r) => (slotCounts.get(slotKey(r)) as number) > 1).length / routes.length;

  const grid = [...options.planning.startMultipliers].sort((a, b) => a - b);
  const edge = ((histogram.get(grid[0]) ?? 0) + (histogram.get(grid[grid.length - 1]) ?? 0)) / routes.length;
  const consistency = checkConsistency(split.testRoutes, split.testOffers);

  const n = routes.length;
  const filledRoutes = routes.filter((r) => r.accepted && r.minutesToAccept !== null);
  const se = {
    fill: Math.sqrt((logged.fillRate * (1 - logged.fillRate)) / n),
    wave1: Math.sqrt((logged.wave1FillRate * (1 - logged.wave1FillRate)) / n),
    minutes: sd(filledRoutes.map((r) => r.minutesToAccept as number)) / Math.sqrt(Math.max(1, filledRoutes.length)),
  };
  const within = (a: number, b: number, s: number) => Math.abs(a - b) <= 2 * s;
  const bigBuckets = offline.calibrationByBucket.filter((b) => b.count >= 200);
  const gates: Gate[] = [
    { name: '1 Data consistency', pass: consistency.mismatches === 0 && snapshot.quality.droppedRows === 0, detail: `${consistency.mismatches} cross-file mismatches, ${snapshot.quality.droppedRows} dropped rows` },
    { name: '2a Simulator fill rate vs logged', pass: within(simulated.fillRate, logged.fillRate, se.fill), detail: `sim ${simulated.fillRate.toFixed(3)} vs logged ${logged.fillRate.toFixed(3)} (2SE ${(2 * se.fill).toFixed(3)})` },
    { name: '2b Simulator wave-1 fill vs logged', pass: within(simulated.wave1FillRate, logged.wave1FillRate, se.wave1), detail: `sim ${simulated.wave1FillRate.toFixed(3)} vs logged ${logged.wave1FillRate.toFixed(3)} (2SE ${(2 * se.wave1).toFixed(3)})` },
    { name: '2c Simulator minutes vs logged', pass: within(simulated.meanMinutesToAccept, logged.meanMinutesToAccept, se.minutes), detail: `sim ${simulated.meanMinutesToAccept.toFixed(1)} vs logged ${logged.meanMinutesToAccept.toFixed(1)} (2SE ${(2 * se.minutes).toFixed(1)})` },
    { name: '3 Model beats price+wave-only (AUC, log-loss)', pass: offline.model.auc > offline.priceWaveOnly.auc && offline.model.logLoss < offline.priceWaveOnly.logLoss, detail: `AUC ${offline.model.auc.toFixed(3)} vs ${offline.priceWaveOnly.auc.toFixed(3)}; log-loss ${offline.model.logLoss.toFixed(4)} vs ${offline.priceWaveOnly.logLoss.toFixed(4)}` },
    { name: '4 Calibration within 2SE (buckets with >= 200 offers)', pass: bigBuckets.every((b) => Math.abs(b.gap) <= b.twoStandardErrors), detail: `${bigBuckets.filter((b) => Math.abs(b.gap) > b.twoStandardErrors).length} of ${bigBuckets.length} buckets outside` },
    { name: '5 Pricing at grid edge <= 10%', pass: edge <= 0.1, detail: `${(edge * 100).toFixed(1)}% of routes at either grid end` },
    { name: '6 Cost difference interval excludes 0', pass: difference.costPerPostedRoute.high < 0 || difference.costPerPostedRoute.low > 0, detail: `${difference.costPerPostedRoute.estimate.toFixed(2)} [${difference.costPerPostedRoute.low.toFixed(2)}, ${difference.costPerPostedRoute.high.toFixed(2)}]` },
  ];

  return {
    window: window.name,
    trainBefore: window.trainBefore.toISOString(),
    testFrom: window.testFrom.toISOString(),
    testBefore: window.testBefore ? window.testBefore.toISOString() : null,
    trainRoutes: split.trainRoutes.length,
    testRoutes: split.testRoutes.length,
    evaluatedRoutes: routes.length,
    skippedMarkets: skipped,
    slotOverlapRate,
    loggedBaseline: logged,
    simulatedBaseline: simulated,
    modelPolicy: model,
    difference,
    offline,
    pricing: {
      multiplierHistogram: Object.fromEntries([...histogram].sort(([a], [b]) => a - b).map(([k, v]) => [k.toFixed(2), v])),
      shareAtGridEdge: edge,
    },
    consistency,
    gates,
  };
}
