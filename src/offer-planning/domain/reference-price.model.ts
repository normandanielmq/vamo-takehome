import { HistoricalRoute, Market } from '../../history/history.types';
import { UnsupportedMarketError } from './errors';
import { fitLeastSquares } from './linear-algebra';

export interface RouteShape {
  market: string;
  totalMiles: number;
  stopCount: number;
}

/** Per-market OLS of wave1Price on miles and stops: a model of the baseline's own starting rule. */
export class ReferencePriceModel {
  private constructor(
    private readonly coefficients: Map<string, number[]>,
    readonly unsupported: Map<string, string>,
  ) {}

  static fit(routes: HistoricalRoute[], minRoutes = 20): ReferencePriceModel {
    const byMarket = new Map<Market, HistoricalRoute[]>();
    for (const r of routes) {
      const list = byMarket.get(r.market) ?? [];
      list.push(r);
      byMarket.set(r.market, list);
    }
    const coefficients = new Map<string, number[]>();
    const unsupported = new Map<string, string>();
    for (const [market, list] of byMarket) {
      if (list.length < minRoutes) {
        unsupported.set(market, `only ${list.length} routes, need at least ${minRoutes} for a reference price`);
        continue;
      }
      try {
        const beta = fitLeastSquares(
          list.map((r) => [1, r.totalMiles, r.stopCount]),
          list.map((r) => r.wave1Price),
        );
        coefficients.set(market, beta);
      } catch {
        unsupported.set(market, 'reference price regression is singular (miles/stops do not vary enough)');
      }
    }
    return new ReferencePriceModel(coefficients, unsupported);
  }

  supportedMarkets(): string[] {
    return [...this.coefficients.keys()].sort();
  }

  isSupported(market: string): boolean {
    return this.coefficients.has(market);
  }

  priceFor(route: RouteShape): number {
    const beta = this.coefficients.get(route.market);
    if (!beta) {
      throw new UnsupportedMarketError(
        route.market,
        this.unsupported.get(route.market) ?? 'not in training data',
      );
    }
    return Math.max(1, beta[0] + beta[1] * route.totalMiles + beta[2] * route.stopCount);
  }
}
