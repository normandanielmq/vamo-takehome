import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppConfig } from '../config/app.config';
import { HistorySnapshotStore } from './history-snapshot.store';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const src = path.join(__dirname, '../../test/fixtures/baseline');
  for (const f of ['routes.csv', 'offers.csv', 'drivers.csv'])
    fs.copyFileSync(path.join(src, f), path.join(dir, f));
  const config: AppConfig = {
    port: 0,
    dataDir: dir,
    routesFile: path.join(dir, 'routes.csv'),
    offersFile: path.join(dir, 'offers.csv'),
    driversFile: path.join(dir, 'drivers.csv'),
    reloadIntervalMs: 0,
    invalidRowPolicy: 'fail',
  };
  const store = new HistorySnapshotStore(config);
  store.onModuleInit();
  return { dir, config, store };
}

const bump = (file: string) => {
  const t = new Date(Date.now() + 5000 * Math.random() + 1000);
  fs.utimesSync(file, t, t);
};

describe('HistorySnapshotStore', () => {
  it('publishes a new snapshot when content changes', () => {
    const { config, store } = setup();
    const seen: string[] = [];
    store.snapshots$.subscribe((s) => seen.push(s.fingerprint));
    const before = store.current().fingerprint;
    fs.appendFileSync(config.driversFile, 'D4,BBB,4.0,2\n');
    expect(store.check()).toBe(true);
    expect(store.current().fingerprint).not.toBe(before);
    expect(store.current().drivers).toHaveLength(4);
    expect(seen).toHaveLength(1);
  });

  it('does not publish for an identical rewrite', () => {
    const { config, store } = setup();
    fs.writeFileSync(config.driversFile, fs.readFileSync(config.driversFile));
    bump(config.driversFile);
    expect(store.check()).toBe(false);
  });

  it('keeps the last good snapshot on invalid data and recovers', () => {
    const { config, store } = setup();
    const good = store.current();
    const original = fs.readFileSync(config.routesFile, 'utf8');
    fs.writeFileSync(config.routesFile, 'route_id,market\nR1,AAA\n');
    expect(store.check()).toBe(false);
    expect(store.current()).toBe(good);
    expect(store.lastReloadError).toMatch(/missing required column/);
    fs.writeFileSync(
      config.routesFile,
      original + 'R4,BBB,2026-08-19T09:00:00,Wed,5,20,60,,,False,,,\n',
    );
    expect(store.check()).toBe(true);
    expect(store.current().routes).toHaveLength(4);
    expect(store.lastReloadError).toBeNull();
  });
});
