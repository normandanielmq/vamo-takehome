import { parse } from 'csv-parse/sync';
import { InvalidRowPolicy } from '../config/app.config';
import { CsvSchema } from './csv-schema';

/** Raised when CSV content cannot be parsed or fails validation. */
export class CsvDataError extends Error {}

/** Outcome of parsing one CSV file. */
export interface CsvReadResult<Row> {
  rows: Row[];
  dropped: number;
  problems: string[];
}

const MAX_LISTED = 20;

/** Parses CSV text into typed rows according to a {@link CsvSchema}. */
export class CsvFileReader {
  /**
   * Parses CSV content, validating headers and each row.
   *
   * Header names are trimmed and lower-cased. Rows that fail column parsing are dropped and reported, or abort the read when the policy is `fail`.
   * @param content - Raw CSV text (a BOM is tolerated).
   * @param schema - Column definitions and row builder.
   * @param policy - Whether invalid rows abort the read (`fail`) or are dropped (`skip`).
   * @returns The valid rows, the number dropped and descriptions of the problems.
   * @throws {@link CsvDataError} On malformed CSV, missing required columns, or invalid rows under the `fail` policy.
   */
  static parse<Row>(
    content: string,
    schema: CsvSchema<Row>,
    policy: InvalidRowPolicy,
  ): CsvReadResult<Row> {
    let records: Record<string, string>[];
    try {
      records = parse(content, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false,
      });
    } catch (error) {
      throw new CsvDataError(`${schema.file}: cannot parse CSV: ${(error as Error).message}`);
    }

    const present = new Set(records.length > 0 ? Object.keys(records[0]) : headerOf(content));
    const missing = schema.columns
      .filter((c) => c.required !== false && !present.has(c.name))
      .map((c) => c.name);
    if (missing.length > 0) {
      throw new CsvDataError(`${schema.file}: missing required column(s): ${missing.join(', ')}`);
    }

    const rows: Row[] = [];
    const problems: string[] = [];
    let dropped = 0;
    records.forEach((record, index) => {
      const line = index + 2;
      const values: Record<string, unknown> = {};
      try {
        for (const column of schema.columns) {
          if (!present.has(column.name)) continue;
          try {
            values[column.name] = column.parse(record[column.name] ?? '');
          } catch (error) {
            throw new Error(`column ${column.name}: ${(error as Error).message}`, { cause: error });
          }
        }
        rows.push(schema.build(values));
      } catch (error) {
        dropped += 1;
        problems.push(`${schema.file}:${line}: ${(error as Error).message}`);
      }
    });

    if (policy === 'fail' && problems.length > 0) {
      const listed = problems.slice(0, MAX_LISTED).join('\n  ');
      throw new CsvDataError(
        `${schema.file}: ${problems.length} invalid row(s):\n  ${listed}` +
          (problems.length > MAX_LISTED ? `\n  ... and ${problems.length - MAX_LISTED} more` : ''),
      );
    }
    return { rows, dropped, problems };
  }
}

/**
 * Extracts normalized header names from the first line of CSV text.
 *
 * Used when a file has no data rows, so headers can still be validated.
 * @param content - Raw CSV text.
 * @returns Trimmed, lower-cased header names.
 */
function headerOf(content: string): string[] {
  const first = content.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  return first.split(',').map((h) => h.trim().toLowerCase());
}
