import { loadAppConfig } from '../src/config/app.config';
import { loadHistorySnapshot } from '../src/history/history-snapshot';
import { ReferencePriceModel } from '../src/offer-planning/domain/reference-price.model';
import { runReplay } from '../src/replay/replay-runner';

// Opt-in: pins the provided dataset (vamo-takehome-data). Not part of `npm test`.
describe('provided dataset snapshot', () => {
  const config = loadAppConfig({ ...process.env, DATA_DIR: process.env.DATA_DIR ?? 'vamo-takehome-data' });
  const snapshot = loadHistorySnapshot(config, 'fail');

  it('has the expected counts', () => {
    expect(snapshot.routes).toHaveLength(2000);
    expect(snapshot.offers).toHaveLength(18712);
    expect(snapshot.drivers).toHaveLength(180);
    expect(snapshot.markets).toHaveLength(5);
  });

  it('prices a 50-mile 10-stop NYC route near 83.8 (+-3%)', () => {
    const train = snapshot.routes.filter((r) => r.scheduledStart < new Date('2026-10-01T00:00:00Z'));
    const price = ReferencePriceModel.fit(train).priceFor({ market: 'NYC', totalMiles: 50, stopCount: 10 });
    expect(Math.abs(price / 83.8 - 1)).toBeLessThan(0.03);
  });

  it('derives the 2026-10-01 cutoff and reproduces the logged holdout metrics', () => {
    const report = runReplay(snapshot, { draws: 3, bootstrapResamples: 20, windows: ['headline', 'early'] });
    const [headline, early] = report.windows;
    expect(headline.testFrom).toBe('2026-10-01T00:00:00.000Z');
    expect(headline.loggedBaseline.fillRate).toBeCloseTo(0.876, 3);
    expect(headline.loggedBaseline.meanPaid).toBeCloseTo(114.23, 2);
    expect(early.loggedBaseline.fillRate).toBeCloseTo(0.866, 3);
    expect(early.loggedBaseline.meanPaid).toBeCloseTo(116.22, 2);
  });
});
