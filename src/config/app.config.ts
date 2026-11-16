import { Global, Module } from '@nestjs/common';
import * as path from 'node:path';

export const APP_CONFIG = Symbol('APP_CONFIG');

export type InvalidRowPolicy = 'fail' | 'skip';

export interface AppConfig {
  port: number;
  dataDir: string;
  routesFile: string;
  offersFile: string;
  driversFile: string;
  reloadIntervalMs: number;
  invalidRowPolicy: InvalidRowPolicy;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = path.resolve(env.DATA_DIR ?? 'vamo-takehome-data');
  const resolveFile = (value: string | undefined, fallback: string): string => {
    const name = value && value.length > 0 ? value : fallback;
    return path.isAbsolute(name) ? name : path.join(dataDir, name);
  };
  const int = (value: string | undefined, fallback: number, name: string): number => {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${name} must be a non-negative integer, got "${value}"`);
    }
    return parsed;
  };
  const policy = env.DATA_INVALID_ROW_POLICY ?? 'fail';
  if (policy !== 'fail' && policy !== 'skip') {
    throw new Error(`DATA_INVALID_ROW_POLICY must be "fail" or "skip", got "${policy}"`);
  }
  return {
    port: int(env.PORT, 3000, 'PORT'),
    dataDir,
    routesFile: resolveFile(env.ROUTES_FILE, 'routes.csv'),
    offersFile: resolveFile(env.OFFERS_FILE, 'offers.csv'),
    driversFile: resolveFile(env.DRIVERS_FILE, 'drivers.csv'),
    reloadIntervalMs: int(env.DATA_RELOAD_INTERVAL_MS, 5000, 'DATA_RELOAD_INTERVAL_MS'),
    invalidRowPolicy: policy,
  };
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadAppConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
