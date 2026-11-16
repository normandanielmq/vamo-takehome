import { RankedCandidate } from './driver-ranker';

export interface WaveSlot {
  ranked: RankedCandidate;
  isReoffer: boolean;
}

export class WaveBuilder {
  /** Fills waves in rank order; cycles back to the top when the list runs out and re-offers are allowed. */
  build(ranked: RankedCandidate[], maxWaves: number, driversPerWave: number, allowReoffer: boolean): WaveSlot[][] {
    if (ranked.length === 0) return [];
    const perWave = Math.min(driversPerWave, ranked.length);
    const waves: WaveSlot[][] = [];
    const seen = new Set<string>();
    let cursor = 0;
    for (let w = 0; w < maxWaves; w++) {
      if (!allowReoffer && cursor >= ranked.length) break;
      const slots: WaveSlot[] = [];
      const inWave = new Set<string>();
      let guard = 0;
      while (slots.length < perWave && guard++ < ranked.length * 2) {
        if (!allowReoffer && cursor >= ranked.length) break;
        const item = ranked[cursor % ranked.length];
        cursor += 1;
        const id = item.candidate.driverId;
        if (inWave.has(id)) continue;
        inWave.add(id);
        slots.push({ ranked: item, isReoffer: seen.has(id) });
      }
      slots.forEach((s) => seen.add(s.ranked.candidate.driverId));
      if (slots.length === 0) break;
      waves.push(slots);
    }
    return waves;
  }
}
