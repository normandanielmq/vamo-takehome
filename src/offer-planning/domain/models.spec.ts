import { generateDataset } from '../../../test/support/synthetic-data';
import { AcceptanceModel, TrainingOffer } from './acceptance.model';
import { ColdStartModel } from './cold-start.model';
import { ModelTrainingError, UnsupportedMarketError } from './errors';
import { fitLeastSquares } from './linear-algebra';
import { ReferencePriceModel } from './reference-price.model';

function trainingOffers(ds: ReturnType<typeof generateDataset>, ref: ReferencePriceModel): TrainingOffer[] {
  const routeById = new Map(ds.routes.map((r) => [r.routeId, r]));
  return ds.offers.map((o) => {
    const r = routeById.get(o.routeId)!;
    return {
      driverId: o.driverId,
      market: r.market,
      wave: o.wave,
      price: o.offerPrice,
      referencePrice: ref.priceFor(r),
      accepted: o.response === 'accepted',
    };
  });
}

describe('fitLeastSquares', () => {
  it('recovers exact coefficients', () => {
    const rows = [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 2, 3]];
    const y = rows.map((r) => 5 + 2 * r[1] - 3 * r[2]);
    const b = fitLeastSquares(rows, y);
    expect(b[0]).toBeCloseTo(5, 8);
    expect(b[1]).toBeCloseTo(2, 8);
    expect(b[2]).toBeCloseTo(-3, 8);
  });
});

describe('ReferencePriceModel', () => {
  it('recovers a noiseless linear price for an arbitrary market code', () => {
    const routes = Array.from({ length: 30 }, (_, i) => ({
      routeId: `r${i}`, market: 'ZZ9' as never, scheduledStart: new Date(), stopCount: 3 + (i % 7),
      totalMiles: 10 + i * 2.5, wave1Price: 10 + 1.5 * (10 + i * 2.5) + 4 * (3 + (i % 7)), finalWave: null,
      finalPrice: null, accepted: false, acceptedDriverId: null, minutesToAccept: null, completedOnTime: null,
    }));
    const model = ReferencePriceModel.fit(routes);
    expect(model.priceFor({ market: 'ZZ9', totalMiles: 50, stopCount: 10 })).toBeCloseTo(10 + 75 + 40, 6);
  });

  it('reports too-small and singular markets as unsupported with a reason', () => {
    const base = { scheduledStart: new Date(), totalMiles: 10, wave1Price: 50, finalWave: null, finalPrice: null,
      accepted: false, acceptedDriverId: null, minutesToAccept: null, completedOnTime: null };
    const small = Array.from({ length: 5 }, (_, i) => ({ ...base, routeId: `s${i}`, market: 'SML' as never, stopCount: i }));
    const constant = Array.from({ length: 30 }, (_, i) => ({ ...base, routeId: `c${i}`, market: 'CON' as never, stopCount: 7, totalMiles: 10 + i }));
    const model = ReferencePriceModel.fit([...small, ...constant]);
    expect(() => model.priceFor({ market: 'SML', totalMiles: 1, stopCount: 1 })).toThrow(UnsupportedMarketError);
    expect(() => model.priceFor({ market: 'CON', totalMiles: 1, stopCount: 1 })).toThrow(/singular/);
    expect(() => model.priceFor({ market: 'NOPE', totalMiles: 1, stopCount: 1 })).toThrow(/not in training data/);
  });
});

describe('AcceptanceModel', () => {
  const ds = generateDataset({ waves: 5, markets: ['AAA', 'SEA'], routesPerMarket: 600, priceStep: 0.05 });
  const ref = ReferencePriceModel.fit(ds.routes);
  const offers = trainingOffers(ds, ref);
  const model = AcceptanceModel.train(offers);

  it('converges and recovers beta and wave terms within tolerance', () => {
    expect(model.beta).toBeGreaterThan(2);
    expect(model.beta).toBeLessThan(5);
    expect(model.maxTrainedWave).toBe(5);
    expect(model.gamma[3]).toBeGreaterThan(model.gamma[0]);
  });

  it('probability increases strictly with price', () => {
    const input = { driverId: 'AAA-D1', market: 'AAA', referencePrice: 100, wave: 1 };
    const lo = model.probability({ ...input, price: 90 }).p;
    const hi = model.probability({ ...input, price: 110 }).p;
    expect(hi).toBeGreaterThan(lo);
  });

  it('gives the stronger driver the larger effect', () => {
    const entries = [...ds.truth.delta].filter(([id]) => model.knowsDriver(id));
    const strongest = entries.sort((a, b) => b[1] - a[1])[0][0];
    const weakest = entries.sort((a, b) => a[1] - b[1])[0][0];
    expect(model.driverEffect(strongest)!).toBeGreaterThan(model.driverEffect(weakest)!);
  });

  it('unknown driver without attributes equals the market average (delta 0)', () => {
    const a = model.probability({ driverId: 'ghost', market: 'AAA', price: 100, referencePrice: 100, wave: 1 });
    expect(a.coldStart).toBe('market');
    const b = model.probability({ driverId: 'ghost2', market: 'AAA', price: 100, referencePrice: 100, wave: 1 });
    expect(a.p).toBe(b.p);
  });

  it('cold start with attributes ranks a high-rated unknown driver higher', () => {
    const cs = ColdStartModel.fit(
      ds.drivers.map((d) => ({ rating: d.rating, routesCompleted90d: d.routesCompleted90d, delta: model.driverEffect(d.driverId) ?? 0 })),
    );
    expect(cs.enabled).toBe(true);
    model.attachColdStart(cs);
    const hi = model.probability({ driverId: 'g1', market: 'AAA', price: 100, referencePrice: 100, wave: 1, attributes: { rating: 4.9, routesCompleted90d: 40 } });
    const lo = model.probability({ driverId: 'g2', market: 'AAA', price: 100, referencePrice: 100, wave: 1, attributes: { rating: 3.5, routesCompleted90d: 5 } });
    expect(hi.coldStart).toBe('attributes');
    expect(hi.p).toBeGreaterThan(lo.p);
  });

  it('reports a market with no acceptances as unsupported instead of diverging', () => {
    const rows: TrainingOffer[] = [
      ...offers,
      ...Array.from({ length: 300 }, (_, i) => ({ driverId: `x${i % 10}`, market: 'DEAD', wave: 1, price: 100, referencePrice: 100, accepted: false })),
    ];
    const m = AcceptanceModel.train(rows);
    expect(m.isSupported('DEAD')).toBe(false);
    expect(m.unsupported.get('DEAD')).toMatch(/acceptances/);
    expect(m.isSupported('AAA')).toBe(true);
  });

  it('throws ModelTrainingError when it cannot converge', () => {
    expect(() => AcceptanceModel.train(offers, { maxPasses: 1 })).toThrow(ModelTrainingError);
  });

  it('scales: 50k offers and 2k drivers train in under 5 seconds', () => {
    const big = generateDataset({ markets: ['AAA'], driversPerMarket: 2000, routesPerMarket: 12000, driversPerWave: 4, seed: 3 });
    const bigRef = ReferencePriceModel.fit(big.routes);
    const rows = trainingOffers(big, bigRef);
    expect(rows.length).toBeGreaterThan(40000);
    const t = Date.now();
    AcceptanceModel.train(rows);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});
