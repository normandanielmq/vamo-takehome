import { fitLeastSquares } from './linear-algebra';

/**
 * Driver attributes used to estimate effects for drivers without history.
 */
export interface DriverAttributes {
  rating?: number | null;
  routesCompleted90d?: number | null;
}

/**
 * A fitted driver effect paired with that driver's attributes, used to train the cold-start model.
 */
export interface ColdStartSample extends DriverAttributes {
  delta: number;
}

const MIN_DRIVERS = 20;

/**
 * OLS of fitted driver effects on standardized rating and 90-day volume (no intercept).
 */
export class ColdStartModel {
  /**
   * Creates a model from fitted parameters; use {@link ColdStartModel.fit} or {@link ColdStartModel.disabled}.
   *
   * @param coef - Coefficients for rating and volume, or null when disabled.
   * @param stats - Means and standard deviations used for standardization, or null when disabled.
   */
  private constructor(
    private readonly coef: [number, number] | null,
    private readonly stats: { mean: [number, number]; sd: [number, number] } | null,
  ) {}

  /**
   * Creates a model that never predicts.
   *
   * @returns A disabled model.
   */
  static disabled(): ColdStartModel {
    return new ColdStartModel(null, null);
  }

  /**
   * Fits the model, returning a disabled one if data is insufficient, constant, or singular.
   *
   * @param samples - Driver effects with attributes; samples missing attributes are ignored.
   * @returns The fitted (or disabled) model.
   */
  static fit(samples: ColdStartSample[]): ColdStartModel {
    const usable = samples.filter(
      (s) => s.rating != null && s.routesCompleted90d != null,
    ) as Required<ColdStartSample>[];
    if (usable.length < MIN_DRIVERS) return ColdStartModel.disabled();
    const cols: [number[], number[]] = [
      usable.map((s) => s.rating as number),
      usable.map((s) => s.routesCompleted90d as number),
    ];
    const mean = cols.map((c) => c.reduce((a, b) => a + b, 0) / c.length) as [number, number];
    const sd = cols.map((c, i) =>
      Math.sqrt(c.reduce((a, b) => a + (b - mean[i]) ** 2, 0) / c.length),
    ) as [number, number];
    if (sd[0] === 0 || sd[1] === 0) return ColdStartModel.disabled();
    try {
      const beta = fitLeastSquares(
        usable.map((s, i) => [(cols[0][i] - mean[0]) / sd[0], (cols[1][i] - mean[1]) / sd[1]]),
        usable.map((s) => s.delta),
      );
      return new ColdStartModel([beta[0], beta[1]], { mean, sd });
    } catch {
      return ColdStartModel.disabled();
    }
  }

  /**
   * Whether the model can make predictions.
   *
   * @returns True if coefficients were fitted.
   */
  get enabled(): boolean {
    return this.coef !== null;
  }

  /**
   * Gets the fitted coefficients.
   *
   * @returns Rating and volume coefficients, or null when disabled.
   */
  coefficients(): [number, number] | null {
    return this.coef;
  }

  /**
   * Predicted driver effect, or null when attributes are missing or the model is disabled.
   *
   * @param attributes - The driver's rating and 90-day volume.
   * @returns The predicted effect, or null if unavailable.
   */
  predict(attributes?: DriverAttributes): number | null {
    if (!this.coef || !this.stats) return null;
    const rating = attributes?.rating;
    const volume = attributes?.routesCompleted90d;
    if (rating == null || volume == null) return null;
    return (
      this.coef[0] * ((rating - this.stats.mean[0]) / this.stats.sd[0]) +
      this.coef[1] * ((volume - this.stats.mean[1]) / this.stats.sd[1])
    );
  }
}
