import { OfferPlan, PlanningInput } from './offer-plan';

/**
 * Strategy that turns a planning input into an offer plan.
 */
export interface OfferPolicy {
  /**
   * Plans offers for a route.
   *
   * @param input - Route and candidate drivers.
   * @returns The offer plan.
   */
  plan(input: PlanningInput): OfferPlan;
}
