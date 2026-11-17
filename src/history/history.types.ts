/** Branded string identifying a delivery market, to avoid mixing it with other strings. */
export type Market = string & { readonly __brand: 'Market' };
/**
 * Brands a plain string as a {@link Market} without validation.
 * @param value - Market name.
 * @returns The same value typed as a {@link Market}.
 */
export const asMarket = (value: string): Market => value as Market;

/** How a driver responded to an offer. */
export type OfferResponse = 'accepted' | 'declined' | 'no_response';

/** A past route with its pricing and outcome. */
export interface HistoricalRoute {
  routeId: string;
  market: Market;
  scheduledStart: Date;
  stopCount: number;
  totalMiles: number;
  wave1Price: number;
  finalWave: number | null;
  finalPrice: number | null;
  accepted: boolean;
  acceptedDriverId: string | null;
  minutesToAccept: number | null;
  completedOnTime: boolean | null;
}

/** A past offer of a route to one driver in a given wave. */
export interface HistoricalOffer {
  routeId: string;
  wave: number;
  driverId: string;
  offerPrice: number;
  response: OfferResponse;
}

/** A driver and the attributes known about them; rating and activity may be missing. */
export interface Driver {
  driverId: string;
  market: Market;
  rating: number | null;
  routesCompleted90d: number | null;
}

/** Counts and messages describing data issues found while loading history. */
export interface DataQualityReport {
  droppedRows: number;
  offersOnUnknownRoutes: number;
  offersToUnknownDrivers: number;
  offersMarketMismatch: number;
  acceptedWithoutOffer: number;
  problems: string[];
}
