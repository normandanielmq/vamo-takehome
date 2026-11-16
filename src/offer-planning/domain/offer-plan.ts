import { RouteShape } from './reference-price.model';
import { DriverAttributes } from './cold-start.model';
import { ColdStartKind } from './acceptance.model';

export interface PlanningRoute extends RouteShape {
  routeId?: string;
  scheduledStart?: Date;
}

export interface Candidate {
  driverId: string;
  attributes?: DriverAttributes;
}

export interface PlanningInput {
  route: PlanningRoute;
  candidates: Candidate[];
}

export interface RankedDriver {
  driverId: string;
  rank: number;
  acceptProbability: number;
  coldStart: ColdStartKind;
  isReoffer: boolean;
}

export interface OfferWave {
  wave: number;
  price: number;
  offerAtMinute: number;
  drivers: RankedDriver[];
}

export interface ExpectedOutcome {
  fillProbability: number;
  fillByWave: number[];
  expectedPricePaid: number;
  expectedMinutesToAccept: number;
  expectedCost: number;
}

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
