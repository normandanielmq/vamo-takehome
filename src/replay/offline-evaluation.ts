import { AcceptanceModel, TrainingOffer } from '../offer-planning/domain/acceptance.model';

/**
 * Predicted-probability bucket edges for calibration (last edge is slightly above 1 so 1.0 is included).
 */
export const CALIBRATION_EDGES = [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 1.0000001];

/**
 * Calibration summary for one group of predictions: mean predicted vs observed rate and the gap with a 2-standard-error band.
 */
export interface CalibrationRow {
  label: string;
  count: number;
  meanPrediction: number;
  observedRate: number;
  gap: number;
  twoStandardErrors: number;
}

/**
 * Offline accuracy diagnostics for the model against a price+wave-only baseline.
 */
export interface OfflineEvaluation {
  offers: number;
  model: { auc: number; logLoss: number };
  priceWaveOnly: { auc: number; logLoss: number };
  calibrationByBucket: CalibrationRow[];
  calibrationByWave: CalibrationRow[];
}

/**
 * Area under the ROC curve via the rank-sum statistic, with tied predictions given average ranks.
 *
 * @param pred - Predicted probabilities.
 * @param y - Observed outcomes, aligned with `pred`.
 * @returns The AUC, or NaN if there are no positives or no negatives.
 */
export function auc(pred: number[], y: boolean[]): number {
  const idx = pred.map((_, i) => i).sort((a, b) => pred[a] - pred[b]);
  const ranks = new Array<number>(pred.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && pred[idx[j + 1]] === pred[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = avg;
    i = j + 1;
  }
  let pos = 0;
  let rankSum = 0;
  y.forEach((v, i) => {
    if (v) {
      pos += 1;
      rankSum += ranks[i];
    }
  });
  const neg = y.length - pos;
  return pos === 0 || neg === 0 ? NaN : (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/**
 * Mean negative log-likelihood of predictions, clamped to avoid log(0).
 *
 * @param pred - Predicted probabilities.
 * @param y - Observed outcomes, aligned with `pred`.
 * @returns The log-loss.
 */
export function logLoss(pred: number[], y: boolean[]): number {
  const eps = 1e-12;
  return (
    -pred.reduce(
      (s, p, i) => s + (y[i] ? Math.log(Math.max(p, eps)) : Math.log(Math.max(1 - p, eps))),
      0,
    ) / pred.length
  );
}

/**
 * Summarizes each group as a calibration row.
 *
 * @param groups - Predictions and outcomes keyed by group label.
 * @returns One row per group.
 */
function calibrationRows(groups: Map<string, { p: number; y: boolean }[]>): CalibrationRow[] {
  return [...groups].map(([label, rows]) => {
    const n = rows.length;
    const mean = rows.reduce((s, r) => s + r.p, 0) / n;
    const obs = rows.filter((r) => r.y).length / n;
    return {
      label,
      count: n,
      meanPrediction: mean,
      observedRate: obs,
      gap: mean - obs,
      twoStandardErrors: 2 * Math.sqrt(Math.max(mean * (1 - mean), 1e-9) / n),
    };
  });
}

/**
 * Offline check at the logged prices and waves of the test offers.
 *
 * Compares the full model with a price+wave-only model on AUC and log-loss and reports calibration by probability bucket and by wave, on markets both models support.
 *
 * @param model - The full acceptance model under test.
 * @param priceWaveOnly - Heavily regularized comparison model.
 * @param testRows - Test-window offers with outcomes.
 * @returns AUC, log-loss and calibration tables.
 */
export function evaluateOffline(
  model: AcceptanceModel,
  priceWaveOnly: AcceptanceModel,
  testRows: TrainingOffer[],
): OfflineEvaluation {
  const rows = testRows.filter(
    (r) => model.isSupported(r.market) && priceWaveOnly.isSupported(r.market),
  );
  const predict = (m: AcceptanceModel) =>
    rows.map(
      (r) =>
        m.probability({
          driverId: r.driverId,
          market: r.market,
          price: r.price,
          referencePrice: r.referencePrice,
          wave: r.wave,
        }).p,
    );
  const pm = predict(model);
  const pb = predict(priceWaveOnly);
  const y = rows.map((r) => r.accepted);

  const buckets = new Map<string, { p: number; y: boolean }[]>();
  for (let b = 0; b + 1 < CALIBRATION_EDGES.length; b++) {
    buckets.set(`[${CALIBRATION_EDGES[b]}, ${Math.min(1, CALIBRATION_EDGES[b + 1])})`, []);
  }
  const labels = [...buckets.keys()];
  const waves = new Map<string, { p: number; y: boolean }[]>();
  pm.forEach((p, i) => {
    let b = 0;
    while (b + 2 < CALIBRATION_EDGES.length && p >= CALIBRATION_EDGES[b + 1]) b++;
    (buckets.get(labels[b]) as { p: number; y: boolean }[]).push({ p, y: y[i] });
    const wl = `wave ${rows[i].wave}`;
    waves.set(wl, [...(waves.get(wl) ?? []), { p, y: y[i] }]);
  });
  for (const [k, v] of buckets) if (v.length === 0) buckets.delete(k);
  return {
    offers: rows.length,
    model: { auc: auc(pm, y), logLoss: logLoss(pm, y) },
    priceWaveOnly: { auc: auc(pb, y), logLoss: logLoss(pb, y) },
    calibrationByBucket: calibrationRows(buckets),
    calibrationByWave: calibrationRows(new Map([...waves].sort(([a], [b]) => a.localeCompare(b)))),
  };
}
