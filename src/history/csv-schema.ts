import { Driver, HistoricalOffer, HistoricalRoute, OfferResponse, asMarket } from './history.types';

/** A CSV record keyed by normalized header name. */
export type RawRow = Record<string, string>;

/** Describes how one CSV column is parsed. */
export interface ColumnSpec<T> {
  /** Header name, matched case-insensitively after trimming. */
  name: string;
  required?: boolean;
  parse: (raw: string) => T;
}

/** Describes a CSV file: its columns and how to build a typed row from parsed values. */
export interface CsvSchema<Row> {
  file: string;
  columns: ColumnSpec<unknown>[];
  build: (values: Record<string, unknown>) => Row;
}

/**
 * Tells whether a raw cell is empty or whitespace.
 * @param raw - Raw cell text.
 * @returns `true` when blank.
 */
const isBlank = (raw: string): boolean => raw.trim() === '';

/**
 * Parses a required, non-empty string.
 * @param raw - Raw cell text.
 * @returns The trimmed string.
 * @throws If the value is empty.
 */
export const str = (raw: string): string => {
  const v = raw.trim();
  if (v === '') throw new Error('empty value');
  return v;
};

/**
 * Wraps a parser so blank cells become `null`.
 * @param parse - Parser used for non-blank cells.
 * @returns A parser returning `null` for blank input.
 */
export const nullable =
  <T>(parse: (raw: string) => T) =>
  (raw: string): T | null =>
    isBlank(raw) ? null : parse(raw);

/**
 * Parses a finite number.
 * @param raw - Raw cell text.
 * @returns The number.
 * @throws If the value is blank or not a finite number.
 */
export const num = (raw: string): number => {
  const v = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(v)) throw new Error(`"${raw}" is not a number`);
  return v;
};

/**
 * Parses an integer.
 * @param raw - Raw cell text.
 * @returns The integer.
 * @throws If the value is not a number or not an integer.
 */
export const int = (raw: string): number => {
  const v = num(raw);
  if (!Number.isInteger(v)) throw new Error(`"${raw}" is not an integer`);
  return v;
};

/**
 * Parses a boolean from `true`/`false` or `1`/`0` (case-insensitive).
 * @param raw - Raw cell text.
 * @returns The boolean.
 * @throws If the value is not a recognized boolean.
 */
export const bool = (raw: string): boolean => {
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw new Error(`"${raw}" is not a boolean`);
};

/**
 * Parses an ISO 8601 date; a timestamp without an offset is read as UTC.
 * @param raw - Raw cell text.
 * @returns The date.
 * @throws If the value is not a valid ISO date.
 */
export const isoDate = (raw: string): Date => {
  const v = raw.trim();
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(v);
  const date = new Date(hasZone ? v : `${v}Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`"${raw}" is not an ISO date`);
  return date;
};

/**
 * Parses an {@link OfferResponse} (case-insensitive).
 * @param raw - Raw cell text.
 * @returns The response.
 * @throws If the value is not a known response.
 */
export const offerResponse = (raw: string): OfferResponse => {
  const v = raw.trim().toLowerCase();
  if (v === 'accepted' || v === 'declined' || v === 'no_response') return v;
  throw new Error(`"${raw}" is not a valid response`);
};

/**
 * Creates a column spec.
 * @param name - Normalized header name.
 * @param parse - Cell parser.
 * @param required - Whether the column must be present; defaults to `true`.
 * @returns The column spec.
 */
const col = <T>(name: string, parse: (raw: string) => T, required = true): ColumnSpec<unknown> => ({
  name,
  parse,
  required,
});

/** Schema for the routes CSV file. */
export const routesSchema: CsvSchema<HistoricalRoute> = {
  file: 'routes',
  columns: [
    col('route_id', str),
    col('market', str),
    col('scheduled_start', isoDate),
    col('stop_count', int),
    col('total_miles', num),
    col('wave1_price', num),
    col('final_wave', nullable(int)),
    col('final_price', nullable(num)),
    col('accepted', bool),
    col('accepted_driver_id', nullable(str)),
    col('minutes_to_accept', nullable(num)),
    col('completed_on_time', nullable(bool)),
  ],
  build: (v) => ({
    routeId: v.route_id as string,
    market: asMarket(v.market as string),
    scheduledStart: v.scheduled_start as Date,
    stopCount: v.stop_count as number,
    totalMiles: v.total_miles as number,
    wave1Price: v.wave1_price as number,
    finalWave: v.final_wave as number | null,
    finalPrice: v.final_price as number | null,
    accepted: v.accepted as boolean,
    acceptedDriverId: v.accepted_driver_id as string | null,
    minutesToAccept: v.minutes_to_accept as number | null,
    completedOnTime: v.completed_on_time as boolean | null,
  }),
};

/** Schema for the offers CSV file. */
export const offersSchema: CsvSchema<HistoricalOffer> = {
  file: 'offers',
  columns: [
    col('route_id', str),
    col('wave', int),
    col('offer_price', num),
    col('driver_id', str),
    col('response', offerResponse),
  ],
  build: (v) => ({
    routeId: v.route_id as string,
    wave: v.wave as number,
    offerPrice: v.offer_price as number,
    driverId: v.driver_id as string,
    response: v.response as OfferResponse,
  }),
};

/** Schema for the drivers CSV file; rating and activity columns are optional. */
export const driversSchema: CsvSchema<Driver> = {
  file: 'drivers',
  columns: [
    col('driver_id', str),
    col('market', str),
    col('rating', nullable(num), false),
    col('routes_completed_90d', nullable(int), false),
  ],
  build: (v) => ({
    driverId: v.driver_id as string,
    market: asMarket(v.market as string),
    rating: (v.rating as number | null | undefined) ?? null,
    routesCompleted90d: (v.routes_completed_90d as number | null | undefined) ?? null,
  }),
};
