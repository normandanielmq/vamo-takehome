import { ColdStartModel, DriverAttributes } from './cold-start.model';
import { ModelTrainingError } from './errors';
import { solveLinearSystem } from './linear-algebra';

export interface TrainingOffer {
  driverId: string;
  market: string;
  wave: number;
  price: number;
  referencePrice: number;
  accepted: boolean;
}

export interface AcceptanceTrainingOptions {
  ridge: number;
  globalRidge: number;
  minOffersPerMarket: number;
  minAcceptancesPerMarket: number;
  maxPasses: number;
  tolerance: number;
}

export const DEFAULT_ACCEPTANCE_OPTIONS: AcceptanceTrainingOptions = {
  ridge: 2,
  globalRidge: 1e-4,
  minOffersPerMarket: 200,
  minAcceptancesPerMarket: 5,
  maxPasses: 200,
  tolerance: 1e-6,
};

export type ColdStartKind = 'none' | 'attributes' | 'market';

export interface ProbabilityInput {
  driverId: string;
  market: string;
  price: number;
  referencePrice: number;
  wave: number;
  attributes?: DriverAttributes;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/**
 * logit p = alpha_market + delta_driver + beta * ln(price / reference) + gamma_wave
 * Trained by block-coordinate Newton: a dense step on the global parameters, then an
 * independent 1-D step per driver.
 */
export class AcceptanceModel {
  private coldStart = ColdStartModel.disabled();

  private constructor(
    private readonly alpha: Map<string, number>,
    readonly beta: number,
    /** gamma[k] is the wave-(k+2) term relative to wave 1. */
    readonly gamma: number[],
    private readonly delta: Map<string, number>,
    readonly unsupported: Map<string, string>,
    readonly passes: number,
  ) {}

  static train(
    offers: TrainingOffer[],
    options: Partial<AcceptanceTrainingOptions> = {},
  ): AcceptanceModel {
    const opt = { ...DEFAULT_ACCEPTANCE_OPTIONS, ...options };

    const stats = new Map<string, { offers: number; accepted: number }>();
    for (const o of offers) {
      const s = stats.get(o.market) ?? { offers: 0, accepted: 0 };
      s.offers += 1;
      if (o.accepted) s.accepted += 1;
      stats.set(o.market, s);
    }
    const unsupported = new Map<string, string>();
    const markets: string[] = [];
    for (const [market, s] of [...stats].sort(([a], [b]) => a.localeCompare(b))) {
      if (s.offers < opt.minOffersPerMarket || s.accepted < opt.minAcceptancesPerMarket) {
        unsupported.set(
          market,
          `${s.offers} offers / ${s.accepted} acceptances, need ${opt.minOffersPerMarket} / ${opt.minAcceptancesPerMarket}`,
        );
      } else markets.push(market);
    }
    const used = offers.filter((o) => !unsupported.has(o.market) && o.price > 0 && o.referencePrice > 0);
    if (markets.length === 0 || used.length === 0) {
      return new AcceptanceModel(new Map(), 0, [], new Map(), unsupported, 0);
    }

    const marketIdx = new Map(markets.map((m, i) => [m, i]));
    const driverIds = [...new Set(used.map((o) => o.driverId))];
    const driverIdx = new Map(driverIds.map((d, i) => [d, i]));
    let maxWave = 1;
    for (const o of used) if (o.wave > maxWave) maxWave = o.wave;
    const nM = markets.length;
    const nW = maxWave - 1;
    const betaPos = nM;
    const G = nM + 1 + nW;

    const n = used.length;
    const mi = new Int32Array(n);
    const di = new Int32Array(n);
    const gi = new Int32Array(n); // global index of gamma column, or -1
    const lr = new Float64Array(n);
    const y = new Float64Array(n);
    used.forEach((o, i) => {
      mi[i] = marketIdx.get(o.market) as number;
      di[i] = driverIdx.get(o.driverId) as number;
      gi[i] = o.wave >= 2 ? nM + 1 + (o.wave - 2) : -1;
      lr[i] = Math.log(o.price / o.referencePrice);
      y[i] = o.accepted ? 1 : 0;
    });

    const g = new Float64Array(G);
    const d = new Float64Array(driverIds.length);
    const p = new Float64Array(n);
    const refreshP = () => {
      for (let i = 0; i < n; i++) {
        const z = g[mi[i]] + d[di[i]] + g[betaPos] * lr[i] + (gi[i] >= 0 ? g[gi[i]] : 0);
        p[i] = sigmoid(z);
      }
    };

    let converged = false;
    let passes = 0;
    while (passes < opt.maxPasses) {
      passes += 1;
      refreshP();
      // Dense Newton step on global parameters.
      const grad = new Array<number>(G).fill(0);
      const hess = Array.from({ length: G }, () => new Array<number>(G).fill(0));
      for (let i = 0; i < n; i++) {
        const r = y[i] - p[i];
        const w = p[i] * (1 - p[i]);
        const idx = gi[i] >= 0 ? [mi[i], betaPos, gi[i]] : [mi[i], betaPos];
        const val = gi[i] >= 0 ? [1, lr[i], 1] : [1, lr[i]];
        for (let a = 0; a < idx.length; a++) {
          grad[idx[a]] += r * val[a];
          for (let b = 0; b < idx.length; b++) hess[idx[a]][idx[b]] += w * val[a] * val[b];
        }
      }
      for (let k = 0; k < G; k++) {
        grad[k] -= opt.globalRidge * g[k];
        hess[k][k] += opt.globalRidge;
      }
      let step: number[];
      try {
        step = solveLinearSystem(hess, grad);
      } catch {
        throw new ModelTrainingError('acceptance model: singular Hessian on global parameters');
      }
      let maxChange = 0;
      for (let k = 0; k < G; k++) {
        const s = clampStep(step[k]);
        g[k] += s;
        maxChange = Math.max(maxChange, Math.abs(s));
      }

      // Per-driver 1-D Newton step.
      refreshP();
      const dg = new Float64Array(driverIds.length);
      const dh = new Float64Array(driverIds.length);
      for (let i = 0; i < n; i++) {
        dg[di[i]] += y[i] - p[i];
        dh[di[i]] += p[i] * (1 - p[i]);
      }
      for (let k = 0; k < driverIds.length; k++) {
        const s = clampStep((dg[k] - opt.ridge * d[k]) / (dh[k] + opt.ridge));
        d[k] += s;
        maxChange = Math.max(maxChange, Math.abs(s));
      }
      if (maxChange < opt.tolerance) {
        converged = true;
        break;
      }
    }
    if (!converged) {
      throw new ModelTrainingError(`acceptance model did not converge in ${opt.maxPasses} passes`);
    }

    return new AcceptanceModel(
      new Map(markets.map((m, i) => [m, g[i]])),
      g[betaPos],
      Array.from(g.slice(nM + 1)),
      new Map(driverIds.map((id, i) => [id, d[i]])),
      unsupported,
      passes,
    );
  }

  attachColdStart(model: ColdStartModel): this {
    this.coldStart = model;
    return this;
  }

  supportedMarkets(): string[] {
    return [...this.alpha.keys()];
  }

  isSupported(market: string): boolean {
    return this.alpha.has(market);
  }

  knowsDriver(driverId: string): boolean {
    return this.delta.has(driverId);
  }

  driverEffect(driverId: string): number | undefined {
    return this.delta.get(driverId);
  }

  driverEffects(): ReadonlyMap<string, number> {
    return this.delta;
  }

  /** Highest wave with its own trained term (1 when the data had a single wave). */
  get maxTrainedWave(): number {
    return this.gamma.length + 1;
  }

  isExtrapolated(wave: number): boolean {
    return wave > this.maxTrainedWave;
  }

  waveTerm(wave: number): number {
    if (wave <= 1 || this.gamma.length === 0) return 0;
    return this.gamma[Math.min(wave - 2, this.gamma.length - 1)];
  }

  probability(input: ProbabilityInput): { p: number; coldStart: ColdStartKind } {
    const alpha = this.alpha.get(input.market);
    if (alpha === undefined) throw new Error(`acceptance model has no market "${input.market}"`);
    let delta = this.delta.get(input.driverId);
    let coldStart: ColdStartKind = 'none';
    if (delta === undefined) {
      const predicted = this.coldStart.predict(input.attributes);
      if (predicted !== null) {
        delta = predicted;
        coldStart = 'attributes';
      } else {
        delta = 0;
        coldStart = 'market';
      }
    }
    const z =
      alpha +
      delta +
      this.beta * Math.log(input.price / input.referencePrice) +
      this.waveTerm(input.wave);
    return { p: sigmoid(z), coldStart };
  }
}

function clampStep(s: number): number {
  return Math.max(-5, Math.min(5, s));
}
