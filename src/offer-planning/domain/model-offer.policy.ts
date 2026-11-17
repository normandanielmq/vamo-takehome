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

/**
 * Model-driven policy: ranks drivers, builds waves, and picks the starting price minimizing expected cost.
 */
export class ModelOfferPolicy implements OfferPolicy {
  private readonly ranker: DriverRanker;
  private readonly builder = new WaveBuilder();
  private readonly pricer: StartingPricePolicy;

  /**
   * Creates the policy and wires the ranker and pricer.
   *
   * @param reference - Reference price model.
   * @param acceptance - Trained acceptance model.
   * @param config - Planning configuration.
   * @param profile - Operational wave mechanics.
   */
  constructor(
    private readonly reference: ReferencePriceModel,
    private readonly acceptance: AcceptanceModel,
    private readonly config: OfferPlanningConfig,
    private readonly profile: OperationalProfile,
  ) {
    this.ranker = new DriverRanker(acceptance);
    this.pricer = new StartingPricePolicy(acceptance, new OutcomeEstimator(), config, profile);
  }

  /**
   * Plans offers for a route using the reference price, ranking, wave building and cost-optimal pricing.
   *
   * @param input - Route and candidate drivers.
   * @returns The offer plan with expected outcome and assumptions.
   * @throws UnsupportedMarketError If the route market has no reference price.
   * @throws NoEligibleDriversError If there are no candidates.
   */
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
