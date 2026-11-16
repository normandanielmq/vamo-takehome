import { AcceptanceModel } from './acceptance.model';
import { DriverRanker } from './driver-ranker';
import { OfferPlan, OfferWave, PlanningInput } from './offer-plan';
import { OfferPlanningConfig } from './offer-planning.config';
import { OfferPolicy } from './offer-policy';
import { OperationalProfile } from './operational-profile';
import { OutcomeEstimator } from './outcome-estimator';
import { ReferencePriceModel } from './reference-price.model';
import { StartingPricePolicy } from './starting-price.policy';
import { WaveBuilder } from './wave-builder';

export class ModelOfferPolicy implements OfferPolicy {
  private readonly ranker: DriverRanker;
  private readonly builder = new WaveBuilder();
  private readonly pricer: StartingPricePolicy;

  constructor(
    private readonly reference: ReferencePriceModel,
    private readonly acceptance: AcceptanceModel,
    private readonly config: OfferPlanningConfig,
    private readonly profile: OperationalProfile,
  ) {
    this.ranker = new DriverRanker(acceptance);
    this.pricer = new StartingPricePolicy(acceptance, new OutcomeEstimator(), config, profile);
  }

  plan(input: PlanningInput): OfferPlan {
    const referencePrice = this.reference.priceFor(input.route);
    const market = input.route.market;
    const ranked = this.ranker.rank(input.candidates, market, referencePrice);
    const slots = this.builder.build(ranked, this.profile.maxWaves, this.profile.driversPerWave, this.config.allowReoffer);
    const priced = this.pricer.choose(market, referencePrice, slots);
    const waves: OfferWave[] = slots.map((wave, k) => ({
      wave: k + 1,
      price: priced.prices[k],
      offerAtMinute: k * this.profile.waveIntervalMinutes,
      drivers: wave.map((slot, i) => ({
        driverId: slot.ranked.candidate.driverId,
        rank: slot.ranked.rank,
        acceptProbability: priced.waveProbabilities[k][i],
        coldStart: slot.ranked.coldStart,
        isReoffer: slot.isReoffer,
      })),
    }));
    return {
      referencePrice,
      startingPrice: priced.startingPrice,
      startMultiplier: priced.startMultiplier,
      waves,
      expected: priced.expected,
      assumptions: {
        unfilledPenaltyMultiplier: this.config.unfilledPenaltyMultiplier,
        delayCostPerWaveMultiplier: this.config.delayCostPerWaveMultiplier,
        priceStep: this.profile.priceStep,
        extrapolatedWaves: waves.filter((w) => this.acceptance.isExtrapolated(w.wave)).map((w) => w.wave),
      },
    };
  }
}
