import { HistoricalOffer, HistoricalRoute } from '../history/history.types';
import { InsufficientDataError } from '../offer-planning/domain/errors';

/**
 * Options controlling window boundaries and minimum data requirements.
 */
export interface WindowOptions {
  holdoutDays: number;
  earlyDays: number;
  cutoff?: Date;
  minTrainRoutes: number;
  minTestRoutes: number;
}

/**
 * Default window options (30-day holdout, 14-day early shift, minimum 200 train / 50 test routes).
 */
export const DEFAULT_WINDOW_OPTIONS: WindowOptions = {
  holdoutDays: 30,
  earlyDays: 14,
  minTrainRoutes: 200,
  minTestRoutes: 50,
};

/**
 * Name of an evaluation window.
 */
export type WindowName = 'headline' | 'early';

/**
 * Train/test boundaries for a window; `testBefore` of null means test runs to the end of the data.
 */
export interface EvaluationWindow {
  name: WindowName;
  trainBefore: Date;
  testFrom: Date;
  testBefore: Date | null;
}

const DAY = 86_400_000;
/**
 * Truncates a date to midnight UTC.
 *
 * @param d - Date to truncate.
 * @returns Start of that UTC day.
 */
const startOfUtcDay = (d: Date) => new Date(Math.floor(d.getTime() / DAY) * DAY);

/**
 * Derives the headline and early windows from the data range.
 *
 * The headline test period is the last `holdoutDays` days (or begins at an explicit cutoff); the early window ends there and starts `earlyDays` before it.
 *
 * @param range - Earliest and latest route start dates.
 * @param options - Window options.
 * @returns Window definitions keyed by name.
 */
export function deriveWindows(range: { min: Date; max: Date }, options: WindowOptions): Record<WindowName, EvaluationWindow> {
  const headlineCutoff =
    options.cutoff ?? new Date(startOfUtcDay(range.max).getTime() - (options.holdoutDays - 1) * DAY);
  const earlyCutoff = new Date(headlineCutoff.getTime() - options.earlyDays * DAY);
  return {
    headline: { name: 'headline', trainBefore: headlineCutoff, testFrom: headlineCutoff, testBefore: null },
    early: { name: 'early', trainBefore: earlyCutoff, testFrom: earlyCutoff, testBefore: headlineCutoff },
  };
}

/**
 * Routes and offers divided into training and test sets for a window.
 */
export interface WindowSplit {
  trainRoutes: HistoricalRoute[];
  trainOffers: HistoricalOffer[];
  testRoutes: HistoricalRoute[];
  testOffers: HistoricalOffer[];
}

/**
 * Splits routes and their offers into train and test sets for a window.
 *
 * @param window - The window boundaries.
 * @param routes - All routes.
 * @param offers - All offers.
 * @param options - Minimum train and test route counts.
 * @returns The train/test routes and offers.
 * @throws InsufficientDataError If either side has too few routes.
 */
export function splitWindow(
  window: EvaluationWindow,
  routes: HistoricalRoute[],
  offers: HistoricalOffer[],
  options: Pick<WindowOptions, 'minTrainRoutes' | 'minTestRoutes'>,
): WindowSplit {
  const trainRoutes = routes.filter((r) => r.scheduledStart < window.trainBefore);
  const testRoutes = routes.filter(
    (r) => r.scheduledStart >= window.testFrom && (window.testBefore === null || r.scheduledStart < window.testBefore),
  );
  if (trainRoutes.length < options.minTrainRoutes || testRoutes.length < options.minTestRoutes) {
    throw new InsufficientDataError(
      `${window.name} window has ${trainRoutes.length} train / ${testRoutes.length} test routes; need at least ${options.minTrainRoutes} / ${options.minTestRoutes}`,
    );
  }
  const trainIds = new Set(trainRoutes.map((r) => r.routeId));
  const testIds = new Set(testRoutes.map((r) => r.routeId));
  return {
    trainRoutes,
    testRoutes,
    trainOffers: offers.filter((o) => trainIds.has(o.routeId)),
    testOffers: offers.filter((o) => testIds.has(o.routeId)),
  };
}
