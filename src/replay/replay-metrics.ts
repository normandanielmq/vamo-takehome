/**
 * Multipliers (of reference price) for the unfilled penalty and per-extra-wave delay cost.
 */
export interface CostSettings {
  unfilledPenaltyMultiplier: number;
  delayCostPerWaveMultiplier: number;
}

/**
 * Realized cost of one posted route: price paid plus delay cost, or the unfilled penalty.
 *
 * @param outcome - Whether the route filled, at what price and wave.
 * @param referencePrice - Reference price used to scale penalties.
 * @param s - Cost settings.
 * @returns The cost.
 */
export function realizedCost(
  outcome: { filled: boolean; price: number; wave: number },
  referencePrice: number,
  s: CostSettings,
): number {
  if (!outcome.filled) return s.unfilledPenaltyMultiplier * referencePrice;
  return outcome.price + s.delayCostPerWaveMultiplier * referencePrice * (outcome.wave - 1);
}

/**
 * Per-route sums over simulation draws (or a single observation for the logged baseline).
 */
export interface RouteSums {
  cluster: string;
  draws: number;
  cost: number;
  filled: number;
  wave1: number;
  minutes: number;
  paid: number;
  paidOverRef: number;
  onTime: number;
}

/**
 * Averaged evaluation metrics for a policy.
 */
export interface MetricSet {
  costPerPostedRoute: number;
  fillRate: number;
  wave1FillRate: number;
  meanMinutesToAccept: number;
  meanPaid: number;
  meanPaidOverReference: number;
  expectedOnTimeRate: number;
}

/**
 * All metric names in {@link MetricSet}, for iteration.
 */
export const METRIC_KEYS: (keyof MetricSet)[] = [
  'costPerPostedRoute', 'fillRate', 'wave1FillRate', 'meanMinutesToAccept', 'meanPaid', 'meanPaidOverReference', 'expectedOnTimeRate',
];

/**
 * Creates a zeroed sums record.
 *
 * @param cluster - Cluster label for the record.
 * @returns Zeroed sums.
 */
export function emptySums(cluster: string): RouteSums {
  return { cluster, draws: 0, cost: 0, filled: 0, wave1: 0, minutes: 0, paid: 0, paidOverRef: 0, onTime: 0 };
}

/**
 * Adds two sums records field by field.
 *
 * @param a - First record; its cluster is kept.
 * @param b - Second record.
 * @returns The combined record.
 */
export function addSums(a: RouteSums, b: RouteSums): RouteSums {
  return {
    cluster: a.cluster,
    draws: a.draws + b.draws,
    cost: a.cost + b.cost,
    filled: a.filled + b.filled,
    wave1: a.wave1 + b.wave1,
    minutes: a.minutes + b.minutes,
    paid: a.paid + b.paid,
    paidOverRef: a.paidOverRef + b.paidOverRef,
    onTime: a.onTime + b.onTime,
  };
}

/**
 * Converts summed counters into averaged metrics.
 *
 * Cost, fill and on-time are per draw; minutes and price metrics are per filled draw.
 *
 * @param sums - Sums to aggregate.
 * @returns The metric set.
 */
export function metricsFromSums(sums: RouteSums[]): MetricSet {
  const t = sums.reduce((acc, s) => addSums(acc, s), emptySums('total'));
  return {
    costPerPostedRoute: t.cost / t.draws,
    fillRate: t.filled / t.draws,
    wave1FillRate: t.wave1 / t.draws,
    meanMinutesToAccept: t.filled > 0 ? t.minutes / t.filled : 0,
    meanPaid: t.filled > 0 ? t.paid / t.filled : 0,
    meanPaidOverReference: t.filled > 0 ? t.paidOverRef / t.filled : 0,
    expectedOnTimeRate: t.onTime / t.draws,
  };
}
