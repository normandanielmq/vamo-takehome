import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { InvalidRowPolicy } from '../config/app.config';
import { CsvDataError, CsvFileReader } from './csv-file.reader';
import { driversSchema, offersSchema, routesSchema } from './csv-schema';
import { DataQualityReport, Driver, HistoricalOffer, HistoricalRoute, Market } from './history.types';

/** Filesystem locations of the three CSV files that make up the history. */
export interface HistoryPaths {
  routesFile: string;
  offersFile: string;
  driversFile: string;
}

/** Immutable, validated view of all historical data at one point in time. */
export interface HistorySnapshot {
  routes: HistoricalRoute[];
  offers: HistoricalOffer[];
  drivers: Driver[];
  markets: Market[];
  fingerprint: string;
  loadedAt: Date;
  quality: DataQualityReport;
}

/**
 * Reads the three CSV files and computes a content fingerprint.
 *
 * The raw buffers are returned so the caller parses exactly the bytes that were hashed.
 * @param paths - Locations of the routes, offers and drivers files.
 * @returns The file buffers (routes, offers, drivers) and a 12-character SHA-256 prefix.
 * @throws If any file cannot be read.
 */
export function readFingerprint(paths: HistoryPaths): { buffers: Buffer[]; fingerprint: string } {
  const buffers = [paths.routesFile, paths.offersFile, paths.driversFile].map((f) => readFileSync(f));
  const hash = createHash('sha256');
  buffers.forEach((b) => hash.update(b));
  return { buffers, fingerprint: hash.digest('hex').slice(0, 12) };
}

/**
 * Asserts that every key in a list occurs only once.
 * @param keys - Keys to check.
 * @param what - Human-readable name of the key, used in the error message.
 * @throws {@link CsvDataError} On the first duplicate key found.
 */
function assertUnique(keys: string[], what: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new CsvDataError(`duplicate ${what}: ${key}`);
    seen.add(key);
  }
}

/**
 * Loads, parses and cross-checks the CSV files into a {@link HistorySnapshot}.
 *
 * Enforces unique ids, drops offers on unknown routes, and counts (but keeps) offers to unknown drivers or in a different market than the route, so the quality report reflects data issues.
 * @param paths - Locations of the routes, offers and drivers files.
 * @param policy - Whether invalid rows abort the load (`fail`) or are dropped (`skip`).
 * @returns The snapshot, including its fingerprint and data quality report.
 * @throws {@link CsvDataError} On unparseable files, missing columns, duplicate ids, or invalid rows under the `fail` policy.
 */
export function loadHistorySnapshot(paths: HistoryPaths, policy: InvalidRowPolicy): HistorySnapshot {
  const { buffers, fingerprint } = readFingerprint(paths);
  const [routesBuf, offersBuf, driversBuf] = buffers.map((b) => b.toString('utf8'));
  const routesRead = CsvFileReader.parse(routesBuf, routesSchema, policy);
  const offersRead = CsvFileReader.parse(offersBuf, offersSchema, policy);
  const driversRead = CsvFileReader.parse(driversBuf, driversSchema, policy);

  assertUnique(routesRead.rows.map((r) => r.routeId), 'route_id');
  assertUnique(driversRead.rows.map((d) => d.driverId), 'driver_id');
  assertUnique(offersRead.rows.map((o) => `${o.routeId}/${o.wave}/${o.driverId}`), 'offer (route/wave/driver)');

  const routeById = new Map(routesRead.rows.map((r) => [r.routeId, r]));
  const driverById = new Map(driversRead.rows.map((d) => [d.driverId, d]));

  const offers: HistoricalOffer[] = [];
  let offersOnUnknownRoutes = 0;
  let offersToUnknownDrivers = 0;
  let offersMarketMismatch = 0;
  for (const offer of offersRead.rows) {
    const route = routeById.get(offer.routeId);
    if (!route) {
      offersOnUnknownRoutes += 1;
      continue;
    }
    const driver = driverById.get(offer.driverId);
    if (!driver) offersToUnknownDrivers += 1;
    else if (driver.market !== route.market) offersMarketMismatch += 1;
    offers.push(offer);
  }

  const acceptedOffers = new Set(
    offers.filter((o) => o.response === 'accepted').map((o) => `${o.routeId}/${o.driverId}`),
  );
  const acceptedWithoutOffer = routesRead.rows.filter(
    (r) => r.acceptedDriverId !== null && !acceptedOffers.has(`${r.routeId}/${r.acceptedDriverId}`),
  ).length;

  const problems = [...routesRead.problems, ...offersRead.problems, ...driversRead.problems];
  if (offersOnUnknownRoutes > 0) problems.push(`${offersOnUnknownRoutes} offer(s) on unknown routes dropped`);

  return {
    routes: routesRead.rows,
    offers,
    drivers: driversRead.rows,
    markets: [...new Set(routesRead.rows.map((r) => r.market))].sort() as Market[],
    fingerprint,
    loadedAt: new Date(),
    quality: {
      droppedRows: routesRead.dropped + offersRead.dropped + driversRead.dropped,
      offersOnUnknownRoutes,
      offersToUnknownDrivers,
      offersMarketMismatch,
      acceptedWithoutOffer,
      problems,
    },
  };
}
