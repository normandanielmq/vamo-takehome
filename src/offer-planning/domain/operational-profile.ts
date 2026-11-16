import { HistoricalOffer, HistoricalRoute } from '../../history/history.types';

export interface OperationalProfile {
  maxWaves: number;
  driversPerWave: number;
  waveIntervalMinutes: number;
  priceStep: number;
  warnings: string[];
}

export type ProfileOverrides = Partial<Omit<OperationalProfile, 'warnings'>>;

export const PROFILE_FALLBACK = { maxWaves: 4, driversPerWave: 4, waveIntervalMinutes: 30, priceStep: 0.08 };

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Derives wave mechanics from history so nothing about them is hardcoded. */
export function inferOperationalProfile(
  routes: HistoricalRoute[],
  offers: HistoricalOffer[],
  overrides: ProfileOverrides = {},
): OperationalProfile {
  const warnings: string[] = [];
  const fallback = (name: string, value: number, why: string): number => {
    warnings.push(`${name}: ${why}; using default ${value}`);
    return value;
  };

  // route -> wave -> offers
  const byRouteWave = new Map<string, Map<number, HistoricalOffer[]>>();
  for (const o of offers) {
    let waves = byRouteWave.get(o.routeId);
    if (!waves) byRouteWave.set(o.routeId, (waves = new Map()));
    const list = waves.get(o.wave) ?? [];
    list.push(o);
    waves.set(o.wave, list);
  }

  let maxWaves = 0;
  const sizeCounts = new Map<number, number>();
  for (const waves of byRouteWave.values()) {
    for (const [wave, list] of waves) {
      if (wave > maxWaves) maxWaves = wave;
      sizeCounts.set(list.length, (sizeCounts.get(list.length) ?? 0) + 1);
    }
  }
  const inferredMaxWaves = maxWaves > 0 ? maxWaves : fallback('maxWaves', PROFILE_FALLBACK.maxWaves, 'no offers');

  let driversPerWave = 0;
  let best = -1;
  for (const [size, count] of sizeCounts) {
    if (count > best || (count === best && size > driversPerWave)) {
      best = count;
      driversPerWave = size;
    }
  }
  if (driversPerWave === 0) {
    driversPerWave = fallback('driversPerWave', PROFILE_FALLBACK.driversPerWave, 'no offers');
  }

  // interval: median gap between per-wave minimum minutes_to_accept
  const minByWave = new Map<number, { min: number; n: number }>();
  for (const r of routes) {
    if (r.finalWave == null || r.minutesToAccept == null) continue;
    const e = minByWave.get(r.finalWave) ?? { min: Infinity, n: 0 };
    e.min = Math.min(e.min, r.minutesToAccept);
    e.n += 1;
    minByWave.set(r.finalWave, e);
  }
  const waveKeys = [...minByWave.keys()].filter((k) => (minByWave.get(k) as { n: number }).n >= 5).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 0; i + 1 < waveKeys.length; i++) {
    if (waveKeys[i + 1] === waveKeys[i] + 1) {
      gaps.push((minByWave.get(waveKeys[i + 1]) as { min: number }).min - (minByWave.get(waveKeys[i]) as { min: number }).min);
    }
  }
  const interval =
    gaps.length > 0 && median(gaps) > 0
      ? Math.round(median(gaps))
      : fallback('waveIntervalMinutes', PROFILE_FALLBACK.waveIntervalMinutes, 'too few accepted waves to infer');

  // price step: median of next/this price ratio over consecutive waves with price >= 50
  const ratios: number[] = [];
  for (const waves of byRouteWave.values()) {
    for (const [wave, list] of waves) {
      const next = waves.get(wave + 1);
      if (!next) continue;
      const p = list[0].offerPrice;
      if (p >= 50) ratios.push(next[0].offerPrice / p - 1);
    }
  }
  const priceStep =
    ratios.length >= 10
      ? Math.round(median(ratios) * 10000) / 10000
      : fallback('priceStep', PROFILE_FALLBACK.priceStep, 'too few consecutive waves to infer');

  return {
    maxWaves: overrides.maxWaves ?? inferredMaxWaves,
    driversPerWave: overrides.driversPerWave ?? driversPerWave,
    waveIntervalMinutes: overrides.waveIntervalMinutes ?? interval,
    priceStep: overrides.priceStep ?? priceStep,
    warnings,
  };
}
