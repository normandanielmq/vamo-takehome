import { AcceptanceModel } from './acceptance.model';
import { NoEligibleDriversError } from './errors';
import { OfferPlanningConfig } from './offer-planning.config';
import { OperationalProfile } from './operational-profile';
import { OutcomeEstimator, WaveEstimate } from './outcome-estimator';
import { Candidate, ExpectedOutcome } from './offer-plan';
import { WaveSlot } from './wave-builder';

export interface PricedPlan {
  startMultiplier: number;
  startingPrice: number;
  prices: number[];
  waveProbabilities: number[][];
  expected: ExpectedOutcome;
}

export const wavePrices = (start: number, waves: number, step: number): number[] => {
  const prices = [start];
  for (let k = 1; k < waves; k++) prices.push(Math.round(prices[k - 1] * (1 + step)));
  return prices;
};

export class StartingPricePolicy {
  constructor(
    private readonly model: Pick<AcceptanceModel, 'probability'>,
    private readonly estimator: OutcomeEstimator,
    private readonly config: OfferPlanningConfig,
    private readonly profile: OperationalProfile,
  ) {}

  choose(market: string, referencePrice: number, waves: WaveSlot[][]): PricedPlan {
    if (waves.length === 0) throw new NoEligibleDriversError();
    let best: PricedPlan | undefined;
    for (const multiplier of [...this.config.startMultipliers].sort((a, b) => a - b)) {
      const start = Math.max(1, Math.round(referencePrice * multiplier));
      const prices = wavePrices(start, waves.length, this.profile.priceStep);
      const probabilities = waves.map((slots, k) =>
        slots.map((slot) => this.probability(slot.ranked.candidate, market, referencePrice, prices[k], k + 1)),
      );
      const estimates: WaveEstimate[] = waves.map((_, k) => ({ price: prices[k], probabilities: probabilities[k] }));
      const expected = this.estimator.estimate(estimates, {
        referencePrice,
        unfilledPenaltyMultiplier: this.config.unfilledPenaltyMultiplier,
        delayCostPerWaveMultiplier: this.config.delayCostPerWaveMultiplier,
        waveIntervalMinutes: this.profile.waveIntervalMinutes,
      });
      // strict < keeps the lower start on ties
      if (!best || expected.expectedCost < best.expected.expectedCost - 1e-12) {
        best = { startMultiplier: multiplier, startingPrice: start, prices, waveProbabilities: probabilities, expected };
      }
    }
    return best as PricedPlan;
  }

  probability(candidate: Candidate, market: string, referencePrice: number, price: number, wave: number): number {
    return this.model.probability({
      driverId: candidate.driverId,
      market,
      price,
      referencePrice,
      wave,
      attributes: candidate.attributes,
    }).p;
  }
}
