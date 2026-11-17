import { RouteShape } from './reference-price.model';
import { DriverAttributes } from './cold-start.model';
import { ColdStartKind } from './acceptance.model';

/**
 * A route to plan offers for, with optional identity and schedule.
 */
export interface PlanningRoute extends RouteShape {
  routeId?: string;
  scheduledStart?: Date;
}

/**
 * A driver eligible to receive an offer.
 */
export interface Candidate {
  driverId: string;
  attributes?: DriverAttributes;
}

/**
 * Input to an offer policy: a route and its candidate drivers.
 */
export interface PlanningInput {
  route: PlanningRoute;
  candidates: Candidate[];
}

/**
 * A driver in a wave with rank, acceptance probability, and re-offer flag.
 */
export interface RankedDriver {
  driverId: string;
  rank: number;
  acceptProbability: number;
  coldStart: ColdStartKind;
  isReoffer: boolean;
}

/**
 * One wave of offers sent at a common price and time.
 */
export interface OfferWave {
  wave: number;
  price: number;
  offerAtMinute: number;
  drivers: RankedDriver[];
}

/**
 * Expected result of a plan: fill probability, price, timing, and cost.
 */
export interface ExpectedOutcome {
  fillProbability: number;
  fillByWave: number[];
  expectedPricePaid: number;
  expectedMinutesToAccept: number;
  expectedCost: number;
}

/**
 * A complete offer plan: pricing, waves, expected outcome, and assumptions.
 */
export interface OfferPlan {
  referencePrice: number;
  startingPrice: number;
  startMultiplier: number;
  waves: OfferWave[];
  expected?: ExpectedOutcome;
  assumptions: {
    unfilledPenaltyMultiplier: number;
    delayCostPerWaveMultiplier: number;
    priceStep: number;
    extrapolatedWaves: number[];
  };
}
