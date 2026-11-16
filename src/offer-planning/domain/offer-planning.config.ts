import { ProfileOverrides } from './operational-profile';

export interface OfferPlanningConfig {
  profileOverrides: ProfileOverrides;
  startMultipliers: number[];
  unfilledPenaltyMultiplier: number;
  delayCostPerWaveMultiplier: number;
  allowReoffer: boolean;
}

const grid = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let i = 0; from + i * step <= to + 1e-9; i++) out.push(Math.round((from + i * step) * 1e6) / 1e6);
  return out;
};

export const DEFAULT_PLANNING_CONFIG: OfferPlanningConfig = {
  profileOverrides: {},
  startMultipliers: grid(0.7, 1.4, 0.05),
  unfilledPenaltyMultiplier: 2.0,
  delayCostPerWaveMultiplier: 0.03,
  allowReoffer: true,
};
