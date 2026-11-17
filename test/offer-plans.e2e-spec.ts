import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HistorySnapshotStore } from '../src/history/history-snapshot.store';
import { OfferModelRegistry } from '../src/offer-planning/offer-model.registry';
import { generateDataset, writeDatasetCsv } from './support/synthetic-data';

async function createApp(dir: string): Promise<INestApplication> {
  process.env.DATA_DIR = dir;
  process.env.DATA_RELOAD_INTERVAL_MS = '0';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  return app;
}

const route = (market: string) => ({ routeId: 'X1', market, stopCount: 12, totalMiles: 40 });
const drivers = (market: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ driverId: `${market}-D${i}` }));

describe('POST /offer-plans', () => {
  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    dir = writeDatasetCsv(generateDataset({ markets: ['AAA', 'BBB'] }));
    app = await createApp(dir);
  });
  afterAll(async () => app.close());

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/offer-plans')
      .send(body as object);

  it('returns a valid plan within profile limits', async () => {
    const res = await post({ route: route('AAA'), availableDrivers: drivers('AAA', 8) }).expect(
      200,
    );
    const { operationalProfile: prof, waves } = res.body;
    expect(waves.length).toBeGreaterThan(0);
    expect(waves.length).toBeLessThanOrEqual(prof.maxWaves);
    let prev = 0;
    const ranks = new Set<number>();
    for (const w of waves) {
      expect(w.drivers.length).toBeLessThanOrEqual(prof.driversPerWave);
      expect(w.price).toBeGreaterThanOrEqual(prev);
      prev = w.price;
      if (w.wave === 1) w.drivers.forEach((d: { rank: number }) => ranks.add(d.rank));
    }
    expect(ranks.size).toBe(waves[0].drivers.length);
    expect(res.body.startingPrice).toBeGreaterThan(0);
    expect(res.body.assumptions.unfilledPenaltyMultiplier).toBe(2);
    expect(res.body.modelVersion).toMatch(/^[0-9a-f]{12}-/);
  });

  it.each([
    [
      'market missing',
      { route: { stopCount: 3, totalMiles: 10 }, availableDrivers: [{ driverId: 'a' }] },
    ],
    [
      'empty market',
      { route: { ...route(''), market: '' }, availableDrivers: [{ driverId: 'a' }] },
    ],
    ['no drivers', { route: route('AAA'), availableDrivers: [] }],
    [
      'stopCount 0',
      { route: { ...route('AAA'), stopCount: 0 }, availableDrivers: [{ driverId: 'a' }] },
    ],
    [
      'miles not a number',
      { route: { ...route('AAA'), totalMiles: 'abc' }, availableDrivers: [{ driverId: 'a' }] },
    ],
    ['extra driver field', { route: route('AAA'), availableDrivers: [{ driverId: 'a', foo: 1 }] }],
  ])('400: %s', async (_name, body) => {
    await post(body).expect(400);
  });

  it('excludes market mismatches and duplicates', async () => {
    const res = await post({
      route: route('AAA'),
      availableDrivers: [
        { driverId: 'AAA-D1' },
        { driverId: 'AAA-D1' },
        { driverId: 'BBB-D2' },
        { driverId: 'AAA-D3' },
      ],
    }).expect(200);
    expect(res.body.excludedDrivers).toEqual(
      expect.arrayContaining([
        { driverId: 'AAA-D1', reason: 'duplicate' },
        { driverId: 'BBB-D2', reason: 'market_mismatch' },
      ]),
    );
  });

  it('422 for a market not in the data and for all-excluded drivers', async () => {
    const unknown = await post({
      route: route('NOPE'),
      availableDrivers: drivers('AAA', 2),
    }).expect(422);
    expect(unknown.body.message).toMatch(/not in data/);
    await post({ route: route('AAA'), availableDrivers: [{ driverId: 'BBB-D1' }] }).expect(422);
  });

  it('cold-starts unknown drivers', async () => {
    const res = await post({
      route: route('AAA'),
      availableDrivers: [
        { driverId: 'ghost1' },
        { driverId: 'ghost2', rating: 4.8, routesCompleted90d: 30 },
      ],
    }).expect(200);
    const all = res.body.waves.flatMap(
      (w: { drivers: { driverId: string; coldStart: string }[] }) => w.drivers,
    );
    expect(all.find((d: { driverId: string }) => d.driverId === 'ghost1').coldStart).toBe('market');
    expect(all.find((d: { driverId: string }) => d.driverId === 'ghost2').coldStart).toBe(
      'attributes',
    );
  });

  it('accepts a request without routeId and scheduledStart', async () => {
    await post({
      route: { market: 'AAA', stopCount: 5, totalMiles: 20 },
      availableDrivers: drivers('AAA', 3),
    }).expect(200);
  });
});

describe('data-driven behavior', () => {
  it('serves a dataset with a new market, 5 waves and a different price step', async () => {
    const dir = writeDatasetCsv(
      generateDataset({
        markets: ['SEA'],
        waves: 5,
        driversPerWave: 3,
        priceStep: 0.05,
        routesPerMarket: 800,
        alpha: -3.2,
      }),
    );
    const app = await createApp(dir);
    const res = await request(app.getHttpServer())
      .post('/offer-plans')
      .send({ route: route('SEA'), availableDrivers: drivers('SEA', 12) })
      .expect(200);
    expect(res.body.operationalProfile).toMatchObject({ maxWaves: 5, driversPerWave: 3 });
    expect(res.body.operationalProfile.priceStep).toBeCloseTo(0.05, 2);
    expect(res.body.waves.length).toBe(5);
    await app.close();
  });

  it('picks up file changes and keeps the old model when a file is corrupt', async () => {
    const dir = writeDatasetCsv(generateDataset({ markets: ['AAA'] }));
    const app = await createApp(dir);
    const server = app.getHttpServer();
    const post = (m: string) =>
      request(server)
        .post('/offer-plans')
        .send({ route: route(m), availableDrivers: drivers(m, 6) });

    const first = await post('AAA').expect(200);
    await post('SEA').expect(422);

    writeDatasetCsv(generateDataset({ markets: ['AAA', 'SEA'], seed: 11 }), dir);
    expect(app.get(HistorySnapshotStore).check()).toBe(true);
    await app.get(OfferModelRegistry).whenIdle();
    const second = await post('SEA').expect(200);
    expect(second.body.modelVersion).not.toBe(first.body.modelVersion);

    fs.writeFileSync(path.join(dir, 'routes.csv'), 'garbage\n1\n');
    expect(app.get(HistorySnapshotStore).check()).toBe(false);
    const third = await post('SEA').expect(200);
    expect(third.body.modelVersion).toBe(second.body.modelVersion);
    await app.close();
  });
});
