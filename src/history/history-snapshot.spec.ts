import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CsvDataError } from './csv-file.reader';
import { HistoryPaths, loadHistorySnapshot } from './history-snapshot';

export const fixturePaths = (name: string): HistoryPaths => {
  const dir = path.join(__dirname, '../../test/fixtures', name);
  return {
    routesFile: path.join(dir, 'routes.csv'),
    offersFile: path.join(dir, 'offers.csv'),
    driversFile: path.join(dir, 'drivers.csv'),
  };
};

describe('loadHistorySnapshot', () => {
  it('loads the baseline fixture', () => {
    const s = loadHistorySnapshot(fixturePaths('baseline'), 'fail');
    expect(s.routes).toHaveLength(3);
    expect(s.offers).toHaveLength(5);
    expect(s.drivers).toHaveLength(3);
    expect(s.markets).toEqual(['AAA', 'BBB']);
    expect(s.routes[1].finalWave).toBeNull();
    expect(s.drivers[2].rating).toBeNull();
  });

  it('parses reordered/extra/lowercase variant data like canonical data', () => {
    const v = loadHistorySnapshot(fixturePaths('variant'), 'fail');
    expect(v.markets).toEqual(['AAA', 'SEA']);
    expect(v.routes[0].totalMiles).toBe(40.5);
    expect(v.routes[0].accepted).toBe(true);
    expect(v.routes[0].scheduledStart.toISOString()).toBe('2026-08-16T07:00:00.000Z');
    expect(v.offers.map((o) => o.response)).toEqual([
      'declined',
      'no_response',
      'accepted',
      'declined',
      'accepted',
    ]);
    expect(v.drivers[0].routesCompleted90d).toBe(10);
  });

  it('fails on broken data naming the problems (policy fail)', () => {
    expect(() => loadHistorySnapshot(fixturePaths('broken'), 'fail')).toThrow(CsvDataError);
    expect(() => loadHistorySnapshot(fixturePaths('broken'), 'fail')).toThrow(/total_miles/);
  });

  it('names a missing column', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
    const p = fixturePaths('baseline');
    const routes = fs.readFileSync(p.routesFile, 'utf8').replace('total_miles', 'miles');
    fs.writeFileSync(path.join(dir, 'routes.csv'), routes);
    expect(() =>
      loadHistorySnapshot({ ...p, routesFile: path.join(dir, 'routes.csv') }, 'fail'),
    ).toThrow(/missing required column.*total_miles/);
  });

  it('skips bad rows under policy skip and counts them', () => {
    const p = fixturePaths('broken');
    // duplicate route_id is still fatal; remove it by using a copy with unique ids
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
    const routes = fs.readFileSync(p.routesFile, 'utf8').replace('R1,AAA,2026-08-17', 'R2,AAA,2026-08-17');
    fs.writeFileSync(path.join(dir, 'routes.csv'), routes);
    const s = loadHistorySnapshot({ ...p, routesFile: path.join(dir, 'routes.csv') }, 'skip');
    expect(s.routes).toHaveLength(1);
    expect(s.quality.droppedRows).toBe(1);
    expect(s.quality.offersOnUnknownRoutes).toBe(1);
  });

  it('rejects duplicate route ids', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
    const p = fixturePaths('baseline');
    const routes = fs.readFileSync(p.routesFile, 'utf8').replace('R2,AAA', 'R1,AAA');
    fs.writeFileSync(path.join(dir, 'routes.csv'), routes);
    expect(() =>
      loadHistorySnapshot({ ...p, routesFile: path.join(dir, 'routes.csv') }, 'fail'),
    ).toThrow(/duplicate route_id/);
  });

  it('fingerprint tracks content, not mtime', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
    const p = fixturePaths('baseline');
    const copy = (f: string) => {
      fs.copyFileSync(f, path.join(dir, path.basename(f)));
      return path.join(dir, path.basename(f));
    };
    const paths = {
      routesFile: copy(p.routesFile),
      offersFile: copy(p.offersFile),
      driversFile: copy(p.driversFile),
    };
    const a = loadHistorySnapshot(paths, 'fail').fingerprint;
    fs.writeFileSync(paths.driversFile, fs.readFileSync(paths.driversFile));
    expect(loadHistorySnapshot(paths, 'fail').fingerprint).toBe(a);
    fs.appendFileSync(paths.driversFile, 'D4,BBB,4.0,2\n');
    expect(loadHistorySnapshot(paths, 'fail').fingerprint).not.toBe(a);
  });
});
