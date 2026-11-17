import { AcceptanceModel, ColdStartKind } from './acceptance.model';
import { Candidate } from './offer-plan';

/**
 * A candidate driver with rank, predicted acceptance probability, and cold-start source.
 */
export interface RankedCandidate {
  candidate: Candidate;
  rank: number;
  probability: number;
  coldStart: ColdStartKind;
}

/**
 * Ranks by P(accept) at the reference price in wave 1; equivalent to driver-effect order.
 */
export class DriverRanker {
  /**
   * Creates a ranker.
   *
   * @param model - Model providing acceptance probabilities.
   */
  constructor(private readonly model: Pick<AcceptanceModel, 'probability'>) {}

  /**
   * Ranks candidates from most to least likely to accept, breaking ties by driver id.
   *
   * @param candidates - Candidate drivers.
   * @param market - Market of the route.
   * @param referencePrice - Reference price for the route.
   * @returns Candidates with 1-based ranks.
   */
  rank(candidates: Candidate[], market: string, referencePrice: number): RankedCandidate[] {
    return candidates
      .map((candidate) => {
        const { p, coldStart } = this.model.probability({
          driverId: candidate.driverId,
          market,
          price: referencePrice,
          referencePrice,
          wave: 1,
          attributes: candidate.attributes,
        });
        return { candidate, probability: p, coldStart };
      })
      .sort(
        (a, b) =>
          b.probability - a.probability || a.candidate.driverId.localeCompare(b.candidate.driverId),
      )
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }
}
