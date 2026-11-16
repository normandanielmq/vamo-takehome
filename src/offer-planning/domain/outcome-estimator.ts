import { ExpectedOutcome } from './offer-plan';

export interface WaveEstimate {
  price: number;
  probabilities: number[];
}

export interface CostSettings {
  referencePrice: number;
  unfilledPenaltyMultiplier: number;
  delayCostPerWaveMultiplier: number;
  waveIntervalMinutes: number;
}

export class OutcomeEstimator {
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
