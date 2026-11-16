import { HistoricalOffer, HistoricalRoute } from '../history/history.types';
import { InsufficientDataError } from '../offer-planning/domain/errors';

export interface WindowOptions {
  holdoutDays: number;
  earlyDays: number;
  cutoff?: Date;
  minTrainRoutes: number;
  minTestRoutes: number;
}

export const DEFAULT_WINDOW_OPTIONS: WindowOptions = {
  holdoutDays: 30,
  earlyDays: 14,
  minTrainRoutes: 200,
  minTestRoutes: 50,
};

export type WindowName = 'headline' | 'early';

export interface EvaluationWindow {
  name: WindowName;
  trainBefore: Date;
  testFrom: Date;
  testBefore: Date | null;
}

const DAY = 86_400_000;
const startOfUtcDay = (d: Date) => new Date(Math.floor(d.getTime() / DAY) * DAY);

export function deriveWindows(range: { min: Date; max: Date }, options: WindowOptions): Record<WindowName, EvaluationWindow> {
  const headlineCutoff =
    options.cutoff ?? new Date(startOfUtcDay(range.max).getTime() - (options.holdoutDays - 1) * DAY);
  const earlyCutoff = new Date(headlineCutoff.getTime() - options.earlyDays * DAY);
  return {
    headline: { name: 'headline', trainBefore: headlineCutoff, testFrom: headlineCutoff, testBefore: null },
    early: { name: 'early', trainBefore: earlyCutoff, testFrom: earlyCutoff, testBefore: headlineCutoff },
  };
}

export interface WindowSplit {
  trainRoutes: HistoricalRoute[];
  trainOffers: HistoricalOffer[];
  testRoutes: HistoricalRoute[];
  testOffers: HistoricalOffer[];
}

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
