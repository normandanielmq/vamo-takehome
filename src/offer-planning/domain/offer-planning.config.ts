import { ProfileOverrides } from './operational-profile';

/**
 * Configuration for offer planning: profile overrides, price search grid, cost weights, and re-offer behavior.
 */
export interface OfferPlanningConfig {
  profileOverrides: ProfileOverrides;
  startMultipliers: number[];
  unfilledPenaltyMultiplier: number;
  delayCostPerWaveMultiplier: number;
  allowReoffer: boolean;
}

/**
 * Builds an inclusive evenly spaced list of numbers, rounded to avoid float drift.
 *
 * @param from - First value.
 * @param to - Last value (inclusive).
 * @param step - Increment.
 * @returns The generated values.
 */
const grid = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let i = 0; from + i * step <= to + 1e-9; i++) out.push(Math.round((from + i * step) * 1e6) / 1e6);
  return out;
};

/**
 * Default planning configuration.
 */
export const DEFAULT_PLANNING_CONFIG: OfferPlanningConfig = {
  profileOverrides: {},
  startMultipliers: grid(0.7, 1.4, 0.05),
  unfilledPenaltyMultiplier: 2.0,
  delayCostPerWaveMultiplier: 0.03,
  allowReoffer: true,
};
