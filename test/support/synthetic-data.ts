import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  Driver,
  HistoricalOffer,
  HistoricalRoute,
  asMarket,
} from '../../src/history/history.types';

export interface SyntheticOptions {
  markets: string[];
  driversPerMarket: number;
  routesPerMarket: number;
  waves: number;
  driversPerWave: number;
  priceStep: number;
  waveIntervalMinutes: number;
  alpha: number;
  beta: number;
  waveGamma: number;
  driverSd: number;
  days: number;
  seed: number;
  startDate: string;
}

export const DEFAULT_SYNTHETIC: SyntheticOptions = {
  markets: ['AAA', 'BBB'],
  driversPerMarket: 30,
  routesPerMarket: 400,
  waves: 4,
  driversPerWave: 4,
  priceStep: 0.08,
  waveIntervalMinutes: 30,
  alpha: -2.6,
  beta: 3.5,
  waveGamma: 0.3,
  driverSd: 0.8,
  days: 60,
  seed: 7,
  startDate: '2026-03-01T00:00:00Z',
};

export interface SyntheticDataset {
  routes: HistoricalRoute[];
  offers: HistoricalOffer[];
  drivers: Driver[];
  truth: { alpha: number; beta: number; waveGamma: number; delta: Map<string, number> };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleDistinct<T>(items: T[], k: number, rnd: () => number): T[] {
  const picked = new Set<number>();
  const out: T[] = [];
  while (out.length < Math.min(k, items.length)) {
    const i = Math.floor(rnd() * items.length);
    if (!picked.has(i)) {
      picked.add(i);
      out.push(items[i]);
    }
  }
  return out;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function generateDataset(overrides: Partial<SyntheticOptions> = {}): SyntheticDataset {
  const o = { ...DEFAULT_SYNTHETIC, ...overrides };
  const rnd = mulberry32(o.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const drivers: Driver[] = [];
  const delta = new Map<string, number>();
  for (const m of o.markets) {
    for (let i = 0; i < o.driversPerMarket; i++) {
      const id = `${m}-D${i}`;
      const d = gauss() * o.driverSd;
      delta.set(id, d);
      drivers.push({
        driverId: id,
        market: asMarket(m),
        rating: Math.round((4.2 + 0.3 * (d / o.driverSd) + 0.1 * gauss()) * 100) / 100,
        routesCompleted90d: Math.max(0, Math.round(20 + 10 * (d / o.driverSd) + 3 * gauss())),
      });
    }
  }
  const start = new Date(o.startDate).getTime();
  const routes: HistoricalRoute[] = [];
  const offers: HistoricalOffer[] = [];
  let n = 0;
  for (const m of o.markets) {
    const marketFactor = 1 + 0.1 * o.markets.indexOf(m);
    const pool = drivers.filter((d) => d.market === m);
    for (let r = 0; r < o.routesPerMarket; r++) {
      n += 1;
      const routeId = `R${n}`;
      const miles = 10 + Math.floor(rnd() * 700) / 10;
      const stops = 5 + Math.floor(rnd() * 25);
      const ref = (20 + 1.2 * miles + 2 * stops) * marketFactor;
      const day = Math.floor(rnd() * o.days);
      const hour = 6 + Math.floor(rnd() * 12);
      const scheduledStart = new Date(start + day * 86400000 + hour * 3600000);
      const wave1Price = Math.round(ref * Math.exp(0.08 * gauss()));
      let price = wave1Price;
      let accepted: string | null = null;
      let finalWave: number | null = null;
      let finalPrice: number | null = null;
      let minutes: number | null = null;
      for (let w = 1; w <= o.waves && accepted === null; w++) {
        if (w > 1) price = Math.round(price * (1 + o.priceStep));
        const shuffled = sampleDistinct(pool, o.driversPerWave, rnd);
        const winners: string[] = [];
        const waveOffers: HistoricalOffer[] = [];
        for (const d of shuffled) {
          const z =
            o.alpha +
            (delta.get(d.driverId) as number) +
            o.beta * Math.log(price / ref) +
            o.waveGamma * (w - 1);
          const ok = rnd() < sigmoid(z);
          const offer: HistoricalOffer = {
            routeId,
            wave: w,
            driverId: d.driverId,
            offerPrice: price,
            response: ok ? 'accepted' : rnd() < 0.5 ? 'declined' : 'no_response',
          };
          offers.push(offer);
          waveOffers.push(offer);
          if (ok) winners.push(d.driverId);
        }
        if (winners.length > 0) {
          // keep exactly one accepted offer per route
          const keep = winners[0];
          for (const off of waveOffers) {
            if (off.response === 'accepted' && off.driverId !== keep) off.response = 'declined';
          }
          accepted = keep;
          finalWave = w;
          finalPrice = price;
          minutes = (w - 1) * o.waveIntervalMinutes + 1 + Math.floor(rnd() * o.waveIntervalMinutes);
        }
      }
      routes.push({
        routeId,
        market: asMarket(m),
        scheduledStart,
        stopCount: stops,
        totalMiles: miles,
        wave1Price,
        finalWave,
        finalPrice,
        accepted: accepted !== null,
        acceptedDriverId: accepted,
        minutesToAccept: minutes,
        completedOnTime: accepted !== null ? rnd() < 0.8 : null,
      });
    }
  }
  return {
    routes,
    offers,
    drivers,
    truth: { alpha: o.alpha, beta: o.beta, waveGamma: o.waveGamma, delta },
  };
}

const iso = (d: Date) => d.toISOString().replace('.000Z', '');

export function writeDatasetCsv(
  ds: Pick<SyntheticDataset, 'routes' | 'offers' | 'drivers'>,
  dir?: string,
): string {
  const target = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'synth-'));
  fs.mkdirSync(target, { recursive: true });
  const b = (v: boolean | null) => (v === null ? '' : v ? 'True' : 'False');
  const nv = (v: string | number | null | undefined) =>
    v === null || v === undefined ? '' : String(v);
  fs.writeFileSync(
    path.join(target, 'routes.csv'),
    [
      'route_id,market,scheduled_start,weekday,stop_count,total_miles,wave1_price,final_wave,final_price,accepted,accepted_driver_id,minutes_to_accept,completed_on_time',
      ...ds.routes.map((r) =>
        [
          r.routeId,
          r.market,
          iso(r.scheduledStart),
          'Mon',
          r.stopCount,
          r.totalMiles,
          r.wave1Price,
          nv(r.finalWave),
          nv(r.finalPrice),
          b(r.accepted),
          nv(r.acceptedDriverId),
          nv(r.minutesToAccept),
          b(r.completedOnTime),
        ].join(','),
      ),
    ].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(target, 'offers.csv'),
    [
      'route_id,wave,offer_price,driver_id,response',
      ...ds.offers.map((x) => [x.routeId, x.wave, x.offerPrice, x.driverId, x.response].join(',')),
    ].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(target, 'drivers.csv'),
    [
      'driver_id,market,rating,routes_completed_90d',
      ...ds.drivers.map((d) =>
        [d.driverId, d.market, nv(d.rating), nv(d.routesCompleted90d)].join(','),
      ),
    ].join('\n') + '\n',
  );
  return target;
}
