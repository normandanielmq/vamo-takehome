export type Market = string & { readonly __brand: 'Market' };
export const asMarket = (value: string): Market => value as Market;

export type OfferResponse = 'accepted' | 'declined' | 'no_response';

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

export interface HistoricalOffer {
  routeId: string;
  wave: number;
  driverId: string;
  offerPrice: number;
  response: OfferResponse;
}

export interface Driver {
  driverId: string;
  market: Market;
  rating: number | null;
  routesCompleted90d: number | null;
}

export interface DataQualityReport {
  droppedRows: number;
  offersOnUnknownRoutes: number;
  offersToUnknownDrivers: number;
  offersMarketMismatch: number;
  acceptedWithoutOffer: number;
  problems: string[];
}
