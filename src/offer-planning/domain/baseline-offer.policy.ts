import { OfferPlan, OfferWave, PlanningInput } from './offer-plan';
import { OfferPolicy } from './offer-policy';
import { OperationalProfile } from './operational-profile';
import { wavePrices } from './starting-price.policy';

/**
 * Logged baseline: random drivers per wave (repeats allowed across waves), start low, raise per wave.
 */
export class BaselineOfferPolicy implements OfferPolicy {
  /**
   * Creates the baseline policy.
   *
   * @param startingPrice - Computes the wave-1 price for a planning input.
   * @param random - Random source returning values in [0, 1); injectable for determinism.
   * @param profile - Operational wave mechanics.
   */
  constructor(
    private readonly startingPrice: (input: PlanningInput) => number,
    private readonly random: () => number,
    private readonly profile: OperationalProfile,
  ) {}

  /**
   * Builds a plan by sampling random drivers for each wave at escalating prices.
   *
   * @param input - Route and candidate drivers.
   * @returns The offer plan, with no model-based probabilities or expected outcome.
   */
  plan(input: PlanningInput): OfferPlan {
    const start = this.startingPrice(input);
    const prices = wavePrices(start, this.profile.maxWaves, this.profile.priceStep);
    const seen = new Set<string>();
    const waves: OfferWave[] = prices.map((price, k) => {
      const pool = [...input.candidates];
      const picked = [];
      const n = Math.min(this.profile.driversPerWave, pool.length);
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(this.random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
        picked.push(pool[i]);
      }
      const drivers = picked.map((c, i) => ({
        driverId: c.driverId,
        rank: i + 1,
        acceptProbability: NaN,
        coldStart: 'none' as const,
        isReoffer: seen.has(c.driverId),
      }));
      drivers.forEach((d) => seen.add(d.driverId));
      return { wave: k + 1, price, offerAtMinute: k * this.profile.waveIntervalMinutes, drivers };
    });
    return {
      referencePrice: start,
      startingPrice: start,
      startMultiplier: 1,
      waves,
      assumptions: {
        unfilledPenaltyMultiplier: 0,
        delayCostPerWaveMultiplier: 0,
        priceStep: this.profile.priceStep,
        extrapolatedWaves: [],
      },
    };
  }
}
