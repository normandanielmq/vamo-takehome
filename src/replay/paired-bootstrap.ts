import { mulberry } from './prng';
import { addSums, emptySums, METRIC_KEYS, MetricSet, metricsFromSums, RouteSums } from './replay-metrics';

export interface Interval {
  estimate: number;
  low: number;
  high: number;
}

export type DifferenceIntervals = Record<keyof MetricSet, Interval>;

function groupByCluster(sums: RouteSums[]): Map<string, RouteSums> {
  const out = new Map<string, RouteSums>();
  for (const s of sums) out.set(s.cluster, addSums(out.get(s.cluster) ?? emptySums(s.cluster), s));
  return out;
}

/** Cluster bootstrap over market-days of the model-minus-baseline difference. */
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
  const draws: Record<string, number[]> = Object.fromEntries(METRIC_KEYS.map((k) => [k, [] as number[]]));
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

function diff(a: MetricSet, b: MetricSet): MetricSet {
  const out = {} as MetricSet;
  for (const k of METRIC_KEYS) out[k] = a[k] - b[k];
  return out;
}
