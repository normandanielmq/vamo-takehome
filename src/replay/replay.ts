import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadAppConfig } from './../config/app.config';
import { loadHistorySnapshot } from '../history/history-snapshot';
import { WindowName } from './evaluation-windows';
import { DEFAULT_REPLAY_OPTIONS, ReplayOptions, ReplayReport, runReplay, WindowReport } from './replay-runner';

function parseArgs(argv: string[]): { options: Partial<ReplayOptions>; dataDir?: string } {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (name: string): number | undefined => {
    const v = get(name);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
    return n;
  };
  const w = get('window') ?? 'headline';
  if (!['headline', 'early', 'both'].includes(w)) throw new Error('--window must be headline, early or both');
  const cutoff = get('cutoff');
  const windows: WindowName[] = w === 'both' ? ['headline', 'early'] : [w as WindowName];
  return {
    dataDir: get('data-dir'),
    options: {
      draws: num('draws') ?? DEFAULT_REPLAY_OPTIONS.draws,
      seed: num('seed') ?? DEFAULT_REPLAY_OPTIONS.seed,
      windows,
      window: {
        ...(num('holdout-days') !== undefined ? { holdoutDays: num('holdout-days') } : {}),
        ...(num('early-days') !== undefined ? { earlyDays: num('early-days') } : {}),
        ...(cutoff ? { cutoff: new Date(cutoff) } : {}),
      } as ReplayOptions['window'],
    },
  };
}

const f = (x: number, d = 2) => x.toFixed(d);
const row = (label: string, m: WindowReport['loggedBaseline']) =>
  `${label.padEnd(20)} ${f(m.costPerPostedRoute).padStart(8)} ${f(m.fillRate, 3).padStart(8)} ${f(m.wave1FillRate, 3).padStart(8)} ${f(m.meanMinutesToAccept, 1).padStart(8)} ${f(m.meanPaid).padStart(9)} ${f(m.meanPaidOverReference, 3).padStart(9)} ${f(m.expectedOnTimeRate, 3).padStart(8)}`;

function print(report: ReplayReport): void {
  console.log(`Data fingerprint ${report.fingerprint}; draws ${report.options.draws}, seed ${report.options.seed}`);
  console.log(`Costs: unfilled ${report.options.costs.unfilledPenaltyMultiplier}x reference, extra wave ${report.options.costs.delayCostPerWaveMultiplier}x reference`);
  for (const w of report.windows) {
    console.log(`\n=== ${w.window} window: train < ${w.trainBefore.slice(0, 10)}, test from ${w.testFrom.slice(0, 10)}${w.testBefore ? ` to ${w.testBefore.slice(0, 10)}` : ''} ===`);
    console.log(`routes: ${w.trainRoutes} train / ${w.testRoutes} test (${w.evaluatedRoutes} evaluated); same-slot overlap ${f(w.slotOverlapRate * 100, 1)}%`);
    if (Object.keys(w.skippedMarkets).length) console.log('skipped markets:', w.skippedMarkets);
    console.log(`${'policy'.padEnd(20)} ${'cost/rt'.padStart(8)} ${'fill'.padStart(8)} ${'wave1'.padStart(8)} ${'minutes'.padStart(8)} ${'paid'.padStart(9)} ${'paid/ref'.padStart(9)} ${'on-time'.padStart(8)}`);
    console.log(row('logged baseline', w.loggedBaseline));
    console.log(row('simulated baseline', w.simulatedBaseline));
    console.log(row('model policy', w.modelPolicy));
    console.log('\nmodel minus baseline (95% cluster bootstrap over market-days):');
    for (const [k, v] of Object.entries(w.difference)) console.log(`  ${k.padEnd(24)} ${f(v.estimate, 3).padStart(8)}  [${f(v.low, 3)}, ${f(v.high, 3)}]`);
    console.log(`\noffline (${w.offline.offers} test offers): model AUC ${f(w.offline.model.auc, 3)} log-loss ${f(w.offline.model.logLoss, 4)}; price+wave only AUC ${f(w.offline.priceWaveOnly.auc, 3)} log-loss ${f(w.offline.priceWaveOnly.logLoss, 4)}`);
    console.log('calibration by predicted-probability bucket:');
    for (const c of w.offline.calibrationByBucket) console.log(`  ${c.label.padEnd(14)} n=${String(c.count).padStart(5)} pred ${f(c.meanPrediction, 3)} obs ${f(c.observedRate, 3)} gap ${f(c.gap, 3)} (2SE ${f(c.twoStandardErrors, 3)})`);
    console.log('calibration by wave:');
    for (const c of w.offline.calibrationByWave) console.log(`  ${c.label.padEnd(14)} n=${String(c.count).padStart(5)} pred ${f(c.meanPrediction, 3)} obs ${f(c.observedRate, 3)} gap ${f(c.gap, 3)} (2SE ${f(c.twoStandardErrors, 3)})`);
    console.log('chosen start multipliers:', w.pricing.multiplierHistogram);
    console.log('\ngates:');
    for (const g of w.gates) console.log(`  ${g.pass ? 'PASS' : 'FAIL'}  ${g.name}: ${g.detail}`);
    if (w.gates.some((g) => !g.pass)) console.log('  -> at least one gate failed: treat this result as inconclusive.');
  }
}

function main(): void {
  const { options, dataDir } = parseArgs(process.argv.slice(2));
  if (dataDir) process.env.DATA_DIR = dataDir;
  const config = loadAppConfig();
  const snapshot = loadHistorySnapshot(config, config.invalidRowPolicy);
  const report = runReplay(snapshot, options);
  print(report);
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'replay-latest.json'), JSON.stringify(report, null, 2));
  console.log('\nWrote reports/replay-latest.json');
}

main();
