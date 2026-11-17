import { Injectable } from '@nestjs/common';
import { asMarket } from '../history/history.types';
import { DriverRepository } from '../history/repositories';
import { DriverAttributes } from './domain/cold-start.model';
import { NoEligibleDriversError, UnsupportedMarketError } from './domain/errors';
import { Candidate, OfferPlan, PlanningRoute } from './domain/offer-plan';
import { OperationalProfile } from './domain/operational-profile';
import { OfferModelRegistry } from './offer-model.registry';

/** Input to plan creation: the route and candidate drivers. */
export interface PlanCommand {
  route: PlanningRoute;
  drivers: ({ driverId: string } & DriverAttributes)[];
}

/** A requested driver left out of the plan and why. */
export interface ExcludedDriver {
  driverId: string;
  reason: 'duplicate' | 'market_mismatch';
}

/** Outcome of plan creation. */
export interface PlanResult {
  plan: OfferPlan;
  excludedDrivers: ExcludedDriver[];
  modelVersion: string;
  operationalProfile: OperationalProfile;
}

/** Builds offer plans using the current trained models and known driver records. */
@Injectable()
export class OfferPlanningService {
  /**
   * @param registry - Provides the current models and policy.
   * @param drivers - Repository of known drivers.
   */
  constructor(
    private readonly registry: OfferModelRegistry,
    private readonly drivers: DriverRepository,
  ) {}

  /**
   * Creates an offer plan, excluding duplicate and wrong-market drivers.
   *
   * Known drivers use their historical attributes; unknown drivers use the attributes supplied in the request.
   * @param command - Route and candidate drivers.
   * @returns The plan, excluded drivers, model version and operational profile.
   * @throws {@link UnsupportedMarketError} If the route market is not supported.
   * @throws {@link NoEligibleDriversError} If no candidates remain after exclusions.
   */
  createPlan(command: PlanCommand): PlanResult {
    const { models, policy, modelVersion } = this.registry.current();
    const market = command.route.market;
    if (!models.supportedMarkets.includes(market)) {
      throw new UnsupportedMarketError(market, models.unsupportedMarkets.get(market) ?? 'not in data');
    }

    const excluded: ExcludedDriver[] = [];
    const unique = new Map<string, { driverId: string } & DriverAttributes>();
    for (const d of command.drivers) {
      if (unique.has(d.driverId)) excluded.push({ driverId: d.driverId, reason: 'duplicate' });
      else unique.set(d.driverId, d);
    }
    const known = new Map(this.drivers.findByIds([...unique.keys()]).map((d) => [d.driverId, d]));
    const candidates: Candidate[] = [];
    for (const [driverId, requested] of unique) {
      const record = known.get(driverId);
      if (record && record.market !== asMarket(market)) {
        excluded.push({ driverId, reason: 'market_mismatch' });
        continue;
      }
      candidates.push({
        driverId,
        attributes: record
          ? { rating: record.rating, routesCompleted90d: record.routesCompleted90d }
          : { rating: requested.rating, routesCompleted90d: requested.routesCompleted90d },
      });
    }
    if (candidates.length === 0) throw new NoEligibleDriversError('All supplied drivers were excluded');

    const plan = policy.plan({ route: command.route, candidates });
    return { plan, excludedDrivers: excluded, modelVersion, operationalProfile: models.profile };
  }
}
