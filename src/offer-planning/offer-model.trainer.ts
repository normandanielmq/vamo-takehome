import { Driver, HistoricalOffer, HistoricalRoute } from '../history/history.types';
import { AcceptanceModel, TrainingOffer } from './domain/acceptance.model';
import { ColdStartModel } from './domain/cold-start.model';
import { ModelTrainingError } from './domain/errors';
import { OfferPlanningConfig } from './domain/offer-planning.config';
import { inferOperationalProfile, OperationalProfile } from './domain/operational-profile';
import { ReferencePriceModel } from './domain/reference-price.model';

/** Historical data the models are trained on. */
export interface TrainingData {
  routes: HistoricalRoute[];
  offers: HistoricalOffer[];
  drivers: Driver[];
}

/** Models and metadata produced by training, including which markets can be served. */
export interface TrainedOfferModels {
  profile: OperationalProfile;
  reference: ReferencePriceModel;
  acceptance: AcceptanceModel;
  supportedMarkets: string[];
  unsupportedMarkets: Map<string, string>;
}

/**
 * Trains all offer models from in-memory data.
 *
 * Pure function over arrays: no I/O, so the replay can train on any slice.
 */
export class OfferModelTrainer {
  /**
   * Trains the reference price and acceptance models, including cold-start handling for unseen drivers.
   * @param data - Routes, offers and drivers to train on.
   * @param config - Planning configuration (profile overrides).
   * @returns The trained models, inferred profile and market support.
   * @throws {@link ModelTrainingError} If no market has enough data.
   */
  static train(data: TrainingData, config: OfferPlanningConfig): TrainedOfferModels {
    const reference = ReferencePriceModel.fit(data.routes);
    const routeById = new Map(data.routes.map((r) => [r.routeId, r]));
    const rows: TrainingOffer[] = [];
    for (const o of data.offers) {
      const route = routeById.get(o.routeId);
      if (!route || !reference.isSupported(route.market)) continue;
      rows.push({
        driverId: o.driverId,
        market: route.market,
        wave: o.wave,
        price: o.offerPrice,
        referencePrice: reference.priceFor(route),
        accepted: o.response === 'accepted',
      });
    }
    const acceptance = AcceptanceModel.train(rows);
    const coldStart = ColdStartModel.fit(
      data.drivers
        .filter((d) => acceptance.knowsDriver(d.driverId))
        .map((d) => ({
          rating: d.rating,
          routesCompleted90d: d.routesCompleted90d,
          delta: acceptance.driverEffect(d.driverId) as number,
        })),
    );
    acceptance.attachColdStart(coldStart);

    const unsupportedMarkets = new Map<string, string>(reference.unsupported);
    for (const [market, reason] of acceptance.unsupported) unsupportedMarkets.set(market, reason);
    const supportedMarkets = reference.supportedMarkets().filter((m) => acceptance.isSupported(m));
    if (supportedMarkets.length === 0) {
      throw new ModelTrainingError(
        `no market has enough data to train on (${[...unsupportedMarkets].map(([m, r]) => `${m}: ${r}`).join('; ') || 'no routes'})`,
      );
    }
    return {
      profile: inferOperationalProfile(data.routes, data.offers, config.profileOverrides),
      reference,
      acceptance,
      supportedMarkets,
      unsupportedMarkets,
    };
  }
}
