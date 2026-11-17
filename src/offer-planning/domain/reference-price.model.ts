import { HistoricalRoute, Market } from '../../history/history.types';
import { UnsupportedMarketError } from './errors';
import { fitLeastSquares } from './linear-algebra';

/**
 * Route characteristics that drive the reference price.
 */
export interface RouteShape {
  market: string;
  totalMiles: number;
  stopCount: number;
}

/**
 * Per-market OLS of wave1Price on miles and stops: a model of the baseline's own starting rule.
 */
export class ReferencePriceModel {
  /**
   * Creates a model from fitted coefficients; use {@link ReferencePriceModel.fit}.
   *
   * @param coefficients - Per-market regression coefficients.
   * @param unsupported - Markets that could not be fitted, mapped to the reason.
   */
  private constructor(
    private readonly coefficients: Map<string, number[]>,
    readonly unsupported: Map<string, string>,
  ) {}

  /**
   * Fits a regression per market, marking markets with too few or degenerate routes as unsupported.
   *
   * @param routes - Historical routes.
   * @param minRoutes - Minimum routes needed per market.
   * @returns The fitted model.
   */
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
        unsupported.set(
          market,
          `only ${list.length} routes, need at least ${minRoutes} for a reference price`,
        );
        continue;
      }
      try {
        const beta = fitLeastSquares(
          list.map((r) => [1, r.totalMiles, r.stopCount]),
          list.map((r) => r.wave1Price),
        );
        coefficients.set(market, beta);
      } catch {
        unsupported.set(
          market,
          'reference price regression is singular (miles/stops do not vary enough)',
        );
      }
    }
    return new ReferencePriceModel(coefficients, unsupported);
  }

  /**
   * Lists fitted markets in sorted order.
   *
   * @returns Supported market identifiers.
   */
  supportedMarkets(): string[] {
    return [...this.coefficients.keys()].sort();
  }

  /**
   * Checks whether a market has a fitted model.
   *
   * @param market - Market identifier.
   * @returns True if supported.
   */
  isSupported(market: string): boolean {
    return this.coefficients.has(market);
  }

  /**
   * Predicts the reference price for a route, floored at 1.
   *
   * @param route - Route shape.
   * @returns The reference price.
   * @throws UnsupportedMarketError If the market has no fitted model.
   */
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
