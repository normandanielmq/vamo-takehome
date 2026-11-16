import { AcceptanceModel, ColdStartKind } from './acceptance.model';
import { Candidate } from './offer-plan';

export interface RankedCandidate {
  candidate: Candidate;
  rank: number;
  probability: number;
  coldStart: ColdStartKind;
}

/** Ranks by P(accept) at the reference price in wave 1; equivalent to driver-effect order. */
export class DriverRanker {
  constructor(private readonly model: Pick<AcceptanceModel, 'probability'>) {}

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
      .sort((a, b) => b.probability - a.probability || a.candidate.driverId.localeCompare(b.candidate.driverId))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }
}
