import { parse } from 'csv-parse/sync';
import { InvalidRowPolicy } from '../config/app.config';
import { CsvSchema } from './csv-schema';

export class CsvDataError extends Error {}

export interface CsvReadResult<Row> {
  rows: Row[];
  dropped: number;
  problems: string[];
}

const MAX_LISTED = 20;

export class CsvFileReader {
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
            throw new Error(`column ${column.name}: ${(error as Error).message}`);
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

function headerOf(content: string): string[] {
  const first = content.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  return first.split(',').map((h) => h.trim().toLowerCase());
}
