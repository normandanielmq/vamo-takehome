import { generateDataset } from '../../../test/support/synthetic-data';
import { DriverRanker, RankedCandidate } from './driver-ranker';
import { NoEligibleDriversError } from './errors';
import { DEFAULT_PLANNING_CONFIG } from './offer-planning.config';
import { inferOperationalProfile, OperationalProfile } from './operational-profile';
import { OutcomeEstimator } from './outcome-estimator';
import { StartingPricePolicy } from './starting-price.policy';
import { WaveBuilder } from './wave-builder';

const stubModel = (table: Record<string, number>) => ({
  probability: ({ driverId }: { driverId: string }) => ({
    p: table[driverId] ?? 0.05,
    coldStart: 'none' as const,
  }),
});

const ranked = (ids: string[]): RankedCandidate[] =>
  ids.map((id, i) => ({
    candidate: { driverId: id },
    rank: i + 1,
    probability: 0.1,
    coldStart: 'none' as const,
  }));

describe('DriverRanker', () => {
  it('orders by probability with driverId as tie-break', () => {
    const ranker = new DriverRanker(stubModel({ a: 0.2, b: 0.5, c: 0.2, d: 0.9 }));
    const out = ranker.rank(
      [{ driverId: 'c' }, { driverId: 'a' }, { driverId: 'd' }, { driverId: 'b' }],
      'X',
      100,
    );
    expect(out.map((r) => r.candidate.driverId)).toEqual(['d', 'b', 'a', 'c']);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe('OutcomeEstimator', () => {
  it('matches a hand-computed two-wave example', () => {
    const out = new OutcomeEstimator().estimate(
      [
        { price: 100, probabilities: [0.1, 0.2] },
        { price: 108, probabilities: [0.3] },
      ],
      {
        referencePrice: 100,
        unfilledPenaltyMultiplier: 2,
        delayCostPerWaveMultiplier: 0.03,
        waveIntervalMinutes: 30,
      },
    );
    expect(out.fillByWave[0]).toBeCloseTo(0.28, 9);
    expect(out.fillByWave[1]).toBeCloseTo(0.216, 9);
    expect(out.fillProbability).toBeCloseTo(0.496, 9);
    expect(out.expectedCost).toBeCloseTo(152.776, 9);
    expect(out.expectedMinutesToAccept).toBeCloseTo(13.92 / 0.496, 9);
  });
});

describe('WaveBuilder', () => {
  const builder = new WaveBuilder();
  it('re-offers by cycling a small pool without repeating a driver inside a wave', () => {
    const waves = builder.build(ranked(['a', 'b', 'c']), 4, 4, true);
    expect(waves).toHaveLength(4);
    for (const w of waves)
      expect(new Set(w.map((s) => s.ranked.candidate.driverId)).size).toBe(w.length);
    expect(waves[1].every((s) => s.isReoffer)).toBe(true);
  });

  it('stops when the list runs out without re-offers', () => {
    const waves = builder.build(ranked(['a', 'b', 'c', 'd', 'e']), 4, 2, false);
    expect(waves.map((w) => w.length)).toEqual([2, 2, 1]);
  });

  it('fills in rank order', () => {
    const waves = builder.build(ranked(['a', 'b', 'c', 'd', 'e']), 2, 2, true);
    expect(waves[0].map((s) => s.ranked.candidate.driverId)).toEqual(['a', 'b']);
    expect(waves[1].map((s) => s.ranked.candidate.driverId)).toEqual(['c', 'd']);
  });
});

describe('StartingPricePolicy', () => {
  const profile: OperationalProfile = {
    maxWaves: 4,
    driversPerWave: 4,
    waveIntervalMinutes: 30,
    priceStep: 0.08,
    warnings: [],
  };
  const priceAware = {
    probability: ({ price, referencePrice }: { price: number; referencePrice: number }) => ({
      p: 1 / (1 + Math.exp(-(3.5 * Math.log(price / referencePrice) - 2.5))),
      coldStart: 'none' as const,
    }),
  };
  const waves = new WaveBuilder().build(
    ranked(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
    4,
    4,
    true,
  );

  it('raising the unfilled penalty never lowers the chosen start', () => {
    let last = 0;
    for (const u of [0.5, 1, 2, 4, 8]) {
      const policy = new StartingPricePolicy(
        priceAware,
        new OutcomeEstimator(),
        { ...DEFAULT_PLANNING_CONFIG, unfilledPenaltyMultiplier: u },
        profile,
      );
      const chosen = policy.choose('X', 100, waves).startMultiplier;
      expect(chosen).toBeGreaterThanOrEqual(last);
      last = chosen;
    }
  });

  it('chooses an interior start for a typical model', () => {
    const policy = new StartingPricePolicy(
      priceAware,
      new OutcomeEstimator(),
      DEFAULT_PLANNING_CONFIG,
      profile,
    );
    const chosen = policy.choose('X', 100, waves);
    expect(chosen.startMultiplier).toBeGreaterThan(0.85);
    expect(chosen.startMultiplier).toBeLessThan(1.4);
    expect(chosen.prices[1]).toBe(Math.round(chosen.prices[0] * 1.08));
  });

  it('throws NoEligibleDriversError with no waves', () => {
    const policy = new StartingPricePolicy(
      priceAware,
      new OutcomeEstimator(),
      DEFAULT_PLANNING_CONFIG,
      profile,
    );
    expect(() => policy.choose('X', 100, [])).toThrow(NoEligibleDriversError);
  });
});

describe('inferOperationalProfile', () => {
  it('infers waves, size, interval and step from a 5-wave 3-driver 5% dataset', () => {
    const ds = generateDataset({
      waves: 5,
      driversPerWave: 3,
      priceStep: 0.05,
      waveIntervalMinutes: 20,
      routesPerMarket: 600,
      alpha: -3.2,
    });
    const p = inferOperationalProfile(ds.routes, ds.offers);
    expect(p.maxWaves).toBe(5);
    expect(p.driversPerWave).toBe(3);
    expect(p.waveIntervalMinutes).toBe(20);
    expect(p.priceStep).toBeGreaterThan(0.045);
    expect(p.priceStep).toBeLessThan(0.055);
    expect(p.warnings).toEqual([]);
  });

  it('falls back with warnings on tiny data', () => {
    const p = inferOperationalProfile([], []);
    expect(p).toMatchObject({
      maxWaves: 4,
      driversPerWave: 4,
      waveIntervalMinutes: 30,
      priceStep: 0.08,
    });
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it('overrides win', () => {
    const ds = generateDataset({});
    expect(
      inferOperationalProfile(ds.routes, ds.offers, { maxWaves: 9, priceStep: 0.1 }),
    ).toMatchObject({ maxWaves: 9, priceStep: 0.1 });
  });
});
