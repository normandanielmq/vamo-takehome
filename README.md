# Vamo Route Offer Ranking

A small TypeScript/Node service that decides which drivers to offer a new route to, in what order, and at what starting price — so routes fill quickly without overpaying.

Every posted route needs a driver. Offers go out in waves: start too low and the route sits while the price climbs; start too high and you overpay. This project uses past route, offer, and driver data to recommend a ranked offer list and a starting price, then replays that approach on held-out routes against the baseline of starting low and raising about 8% each wave.

## Documentation index

| Document | Purpose |
| --- | --- |
| [`docs/WRITEUP.md`](docs/WRITEUP.md) | The one-page write-up: approach, trade-offs (price vs. speed vs. on-time), replay results, production metrics, real improvement vs. noise, and next steps. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | How the system is designed and why: architecture, request flow, policy and acceptance model, data reload, and how the replay evaluates it, with diagrams. |
| [`docs/API-EXAMPLES.md`](docs/API-EXAMPLES.md) | Ready-to-use request bodies for `POST /offer-plans`: successful, 422 and 400 cases. Use them with Swagger UI at `/docs` or `curl`. |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | The implementation plan written before the build: ticket assessment, data findings, steps, validation gates and risks. |
| [`docs/diagrams/`](docs/diagrams/) | Mermaid sources for the diagrams in `DESIGN.md`. |
| [`docs/images/`](docs/images/) | Rendered PNGs of those diagrams (regenerate with `npm run docs:diagrams`). |

## Technologies

- **Language:** TypeScript
- **Runtime:** Node.js 20+ / NestJS 11
- **Data:** CSV files under `vamo-takehome-data/` (synthetic)

## Agent guidance

All AI rules and skills live under [`ai/`](ai/) (one copy). Root `AGENTS.md` / `CLAUDE.md` only point there.

| Path | Role |
| --- | --- |
| `ai/AGENTS.md` | Shared agent rules |
| `ai/CLAUDE.md` | Claude Code rules |
| `ai/skills/` | NestJS Agent Skills ([source](https://github.com/amirtaherkhani/nestjs-skills), MIT) |

## Data

| File | What it contains |
|------|------------------|
| `routes.csv` | ~2,000 past routes: market, start time, stops, miles, wave 1 price, final wave/price, who accepted, minutes to accept, on-time completion |
| `offers.csv` | Every offer: wave, price, driver, response (accepted / declined / no response) |
| `drivers.csv` | Driver id, market, rating, routes completed in the last 90 days |

## End-user manual

### Prerequisites

- Node.js 20+ (or current LTS)
- npm

### Setup

```bash
npm install
```

### Run the service

```bash
npm run start          # http://localhost:3000
npm test               # unit tests (fixtures and synthetic data only)
npm run test:e2e       # API tests
npm run test:cov       # unit + API tests with merged coverage
npm run test:snapshot  # opt-in: pins the provided CSVs' counts and logged metrics
```

> **Try it in the browser:** with the service running, open **Swagger UI at [http://localhost:3000/docs](http://localhost:3000/docs)** and use "Try it out" on `POST /offer-plans`. Paste any ready-made request body from [`docs/API-EXAMPLES.md`](docs/API-EXAMPLES.md) (successful, 422 and 400 cases, with real driver IDs from the provided data).

**Endpoint:** `POST /offer-plans`. Given a new route and the drivers available in that market, it returns which drivers to offer to, in what order (waves), and at what starting price.

```bash
curl -s -X POST localhost:3000/offer-plans -H 'content-type: application/json' -d '{
  "route": { "market": "NYC", "stopCount": 10, "totalMiles": 50 },
  "availableDrivers": [
    { "driverId": "D0006" }, { "driverId": "D0002" }, { "driverId": "D0012" },
    { "driverId": "D0031" }, { "driverId": "D0009" }, { "driverId": "D0007" }
  ]
}'
```

Trimmed response:

```json
{
  "market": "NYC",
  "referencePrice": 83.24,
  "startingPrice": 87,
  "startMultiplier": 1.05,
  "waves": [
    { "wave": 1, "price": 87, "offerAtMinute": 0, "drivers": [{ "driverId": "D0006", "rank": 1, "acceptProbability": 0.104, "coldStart": "none", "isReoffer": false }] },
    { "wave": 2, "price": 94, "offerAtMinute": 30, "drivers": ["..."] }
  ],
  "expected": { "fillProbability": 0.0, "expectedCost": 0.0 },
  "excludedDrivers": [],
  "modelVersion": "db5e0bb600a9-2026-11-16T21:40:00.000Z"
}
```

Request rules: `market`, `stopCount`, `totalMiles` and `availableDrivers` (1 to 200) are required. Drivers may carry optional `rating` and `routesCompleted90d`, used only for drivers with no history. Unknown markets or routes whose drivers are all excluded return 422; invalid bodies return 400. Probabilities and expected values are model estimates, not calibrated guarantees.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `vamo-takehome-data` | Directory with the CSV files |
| `ROUTES_FILE`, `OFFERS_FILE`, `DRIVERS_FILE` | `routes.csv`, `offers.csv`, `drivers.csv` | File names (absolute paths allowed) |
| `DATA_RELOAD_INTERVAL_MS` | `5000` | How often to check the files for changes (`0` disables) |
| `DATA_INVALID_ROW_POLICY` | `fail` | `fail` rejects a file with bad rows; `skip` drops them and reports |

### Data contract

The CSVs are an input format, not a fixed dataset. Columns are matched by header name (case-insensitive), order does not matter and extra columns are ignored. Markets, the number of waves, drivers per wave, wave interval and price step are all inferred from the data. The service checks the files every few seconds; when they change it validates the new data, retrains in the background and swaps models in one step. If new files are invalid it keeps serving the last good model.

Required columns: `routes` (`route_id, market, scheduled_start, stop_count, total_miles, wave1_price, final_wave, final_price, accepted, accepted_driver_id, minutes_to_accept, completed_on_time`), `offers` (`route_id, wave, offer_price, driver_id, response`), `drivers` (`driver_id, market`; optional `rating, routes_completed_90d`).

### Replay script

Compare the approach to the baseline (start low, raise about 8% each wave) on held-out routes:

```bash
npm run replay                      # headline window, 200 draws
npm run replay -- --window both     # also the 14 days before it
npm run replay -- --draws 20 --seed 7 --holdout-days 30 --early-days 14 --cutoff 2026-10-01 --data-dir path/to/csvs
```

The holdout is the last 30 days of the data unless `--cutoff` is given. It prints the logged baseline, a simulated baseline and the model policy, bootstrap intervals, offline AUC and calibration tables, and PASS/FAIL gates. It also writes `reports/replay-latest.json`.

On the provided data (headline window) the logged baseline costs 130.77 per posted route (fill 0.876, mean paid 114.23); the model policy costs 115.67, a difference of -14.33 (95% interval -15.01 to -13.65). The calibration gate fails, so read the exact figure with care. See [`docs/WRITEUP.md`](docs/WRITEUP.md).

## What this repo is meant to include

1. The offer-ranking service (one endpoint)
2. The held-out replay script vs. baseline
3. This README (how to run)
4. A one-page write-up: approach, tradeoffs (price vs. speed vs. on-time), production metrics, how to separate real gains from noise, and what a next week of work would cover

## Notes

- Time-boxed take-home (~3 hours). Incomplete work is expected; next steps belong in the write-up.
- AI tools are welcome; the focus is how the problem is reasoned through.

## Contributing

This is a take-home exercise, not an open contribution project. Feedback and questions go to the reviewer who assigned it (Scott). If you fork it for your own experiments, keep changes small and document how to run them in this README.

## Design

[`docs/DESIGN.md`](docs/DESIGN.md) explains the architecture and the logic, with diagrams (images, sources in `docs/diagrams/`). Regenerate them with `npm run docs:diagrams`.

## Docker

```bash
docker compose up --build                 # API on http://localhost:3000, CSVs mounted from ./vamo-takehome-data
docker compose --profile replay run --rm replay   # replay; writes ./reports/replay-latest.json
```

CI (`.github/workflows/ci.yml`) runs typecheck, build, tests with coverage, and the snapshot check on every push and pull request.

## API documentation

With the service running (`npm run start` or Docker), Swagger UI is at `http://localhost:3000/docs` and the raw OpenAPI JSON at `http://localhost:3000/docs/json`. To test the endpoint, use "Try it out" and paste a body from [`docs/API-EXAMPLES.md`](docs/API-EXAMPLES.md), which covers successful requests and the 422 and 400 error cases.
