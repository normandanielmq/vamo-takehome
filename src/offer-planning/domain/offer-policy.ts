import { OfferPlan, PlanningInput } from './offer-plan';

export interface OfferPolicy {
  plan(input: PlanningInput): OfferPlan;
}
