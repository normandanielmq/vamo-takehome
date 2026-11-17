import { ExpectedOutcome } from './offer-plan';

/**
 * Price and per-driver acceptance probabilities for one wave.
 */
export interface WaveEstimate {
  price: number;
  probabilities: number[];
}

/**
 * Cost parameters for evaluating a plan.
 */
export interface CostSettings {
  referencePrice: number;
  unfilledPenaltyMultiplier: number;
  delayCostPerWaveMultiplier: number;
  waveIntervalMinutes: number;
}

/**
 * Computes expected fill, price, timing, and cost for a sequence of waves.
 */
export class OutcomeEstimator {
  /**
   * Estimates the outcome assuming independent acceptances and that a filled route stops further waves.
   *
   * @param waves - Wave prices and acceptance probabilities, in order.
   * @param s - Cost settings.
   * @returns Expected outcome including expected cost with unfilled and delay penalties.
   */
  estimate(waves: WaveEstimate[], s: CostSettings): ExpectedOutcome {
    let surviving = 1;
    const fillByWave: number[] = [];
    for (const wave of waves) {
      const noneAccept = wave.probabilities.reduce((acc, p) => acc * (1 - p), 1);
      fillByWave.push(surviving * (1 - noneAccept));
      surviving *= noneAccept;
    }
    const filled = fillByWave.reduce((a, b) => a + b, 0);
    const unfilled = Math.max(0, 1 - filled);
    let priceSum = 0;
    let delay = 0;
    let minutes = 0;
    fillByWave.forEach((pk, k) => {
      priceSum += pk * waves[k].price;
      delay += pk * k;
      minutes += pk * (k * s.waveIntervalMinutes + s.waveIntervalMinutes / 2);
    });
    const expectedCost =
      priceSum +
      unfilled * s.unfilledPenaltyMultiplier * s.referencePrice +
      s.delayCostPerWaveMultiplier * s.referencePrice * delay;
    return {
      fillProbability: filled,
      fillByWave,
      expectedPricePaid: filled > 0 ? priceSum / filled : 0,
      expectedMinutesToAccept: filled > 0 ? minutes / filled : 0,
      expectedCost,
    };
  }
}
