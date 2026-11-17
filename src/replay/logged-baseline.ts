import { HistoricalOffer, HistoricalRoute } from '../history/history.types';

/**
 * Counts of disagreements between route outcomes and logged offers.
 */
export interface ConsistencyReport {
  routesChecked: number;
  filledWithoutAcceptedOffer: number;
  acceptedOfferWithoutFilledRoute: number;
  priceMismatches: number;
  waveMismatches: number;
  mismatches: number;
}

/**
 * Cross-file checks: accepted offers must agree with the route's recorded outcome.
 *
 * Flags filled routes with no matching accepted offer, accepted offers on unfilled routes, and price or wave mismatches.
 *
 * @param routes - Routes to check.
 * @param offers - Logged offers.
 * @returns Mismatch counts, with `mismatches` as their total.
 */
export function checkConsistency(
  routes: HistoricalRoute[],
  offers: HistoricalOffer[],
): ConsistencyReport {
  const accepted = new Map<string, HistoricalOffer[]>();
  for (const o of offers) {
    if (o.response !== 'accepted') continue;
    const list = accepted.get(o.routeId) ?? [];
    list.push(o);
    accepted.set(o.routeId, list);
  }
  const report: ConsistencyReport = {
    routesChecked: routes.length,
    filledWithoutAcceptedOffer: 0,
    acceptedOfferWithoutFilledRoute: 0,
    priceMismatches: 0,
    waveMismatches: 0,
    mismatches: 0,
  };
  for (const r of routes) {
    const acc = accepted.get(r.routeId) ?? [];
    if (r.accepted) {
      const match =
        acc.find((o) => o.driverId === r.acceptedDriverId) ??
        (acc.length === 1 ? acc[0] : undefined);
      if (!match) report.filledWithoutAcceptedOffer += 1;
      else {
        if (r.finalPrice !== null && Math.abs(match.offerPrice - r.finalPrice) > 1e-9)
          report.priceMismatches += 1;
        if (r.finalWave !== null && match.wave !== r.finalWave) report.waveMismatches += 1;
      }
    } else if (acc.length > 0) report.acceptedOfferWithoutFilledRoute += 1;
  }
  report.mismatches =
    report.filledWithoutAcceptedOffer +
    report.acceptedOfferWithoutFilledRoute +
    report.priceMismatches +
    report.waveMismatches;
  return report;
}
