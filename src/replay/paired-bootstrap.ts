import { mulberry } from './prng';
import {
  addSums,
  emptySums,
  METRIC_KEYS,
  MetricSet,
  metricsFromSums,
  RouteSums,
} from './replay-metrics';

/**
 * A point estimate with a 95% percentile interval.
 */
export interface Interval {
  estimate: number;
  low: number;
  high: number;
}

/**
 * Interval for each metric in {@link MetricSet}.
 */
export type DifferenceIntervals = Record<keyof MetricSet, Interval>;

/**
 * Aggregates route sums by cluster.
 *
 * @param sums - Per-route sums.
 * @returns Summed values keyed by cluster.
 */
function groupByCluster(sums: RouteSums[]): Map<string, RouteSums> {
  const out = new Map<string, RouteSums>();
  for (const s of sums) out.set(s.cluster, addSums(out.get(s.cluster) ?? emptySums(s.cluster), s));
  return out;
}

/**
 * Cluster bootstrap over market-days of the model-minus-baseline difference.
 *
 * Clusters are resampled with replacement and the same clusters are used for both arms, preserving the pairing.
 *
 * @param model - Model policy sums per route.
 * @param baseline - Baseline policy sums per route.
 * @param resamples - Number of bootstrap resamples.
 * @param seed - Seed for the resampling stream.
 * @returns Point estimate and 2.5%/97.5% bounds per metric.
 */
export function pairedClusterBootstrap(
  model: RouteSums[],
  baseline: RouteSums[],
  resamples: number,
  seed: number,
): DifferenceIntervals {
  const m = groupByCluster(model);
  const b = groupByCluster(baseline);
  const clusters = [...m.keys()].filter((c) => b.has(c)).sort();
  const rnd = mulberry(seed);
  const point = diff(metricsFromSums([...m.values()]), metricsFromSums([...b.values()]));
  const draws: Record<string, number[]> = Object.fromEntries(
    METRIC_KEYS.map((k) => [k, [] as number[]]),
  );
  for (let r = 0; r < resamples; r++) {
    const ms: RouteSums[] = [];
    const bs: RouteSums[] = [];
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[Math.floor(rnd() * clusters.length)];
      ms.push(m.get(c) as RouteSums);
      bs.push(b.get(c) as RouteSums);
    }
    const d = diff(metricsFromSums(ms), metricsFromSums(bs));
    for (const k of METRIC_KEYS) draws[k].push(d[k]);
  }
  const out = {} as DifferenceIntervals;
  for (const k of METRIC_KEYS) {
    const sorted = draws[k].sort((x, y) => x - y);
    out[k] = {
      estimate: point[k],
      low: sorted[Math.floor(0.025 * (sorted.length - 1))] ?? point[k],
      high: sorted[Math.ceil(0.975 * (sorted.length - 1))] ?? point[k],
    };
  }
  return out;
}

/**
 * Computes the metric-wise difference a - b.
 *
 * @param a - Minuend metrics.
 * @param b - Subtrahend metrics.
 * @returns The difference.
 */
function diff(a: MetricSet, b: MetricSet): MetricSet {
  const out = {} as MetricSet;
  for (const k of METRIC_KEYS) out[k] = a[k] - b[k];
  return out;
}
