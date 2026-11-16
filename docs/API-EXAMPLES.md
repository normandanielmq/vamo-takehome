# `POST /offer-plans` request examples

Driver IDs below come from the provided `drivers.csv`. If you point the service at other data, use IDs and markets from that data. Start the service with `npm run start` (or `docker compose up`), then run any example:

```bash
curl -s -X POST localhost:3000/offer-plans -H 'content-type: application/json' -d @body.json
```

Or inline:

```bash
curl -s -X POST localhost:3000/offer-plans -H 'content-type: application/json' -d '<body>'
```

## Successful requests (200)

### 1. Minimal

Only the required fields.

```json
{
  "route": { "market": "NYC", "stopCount": 10, "totalMiles": 50 },
  "availableDrivers": [
    { "driverId": "D0002" }, { "driverId": "D0006" }, { "driverId": "D0007" },
    { "driverId": "D0009" }, { "driverId": "D0012" }, { "driverId": "D0013" }
  ]
}
```

### 2. All route fields

`routeId` and `scheduledStart` are optional and only echoed back.

```json
{
  "route": {
    "routeId": "R-TEST-001",
    "market": "CHI",
    "scheduledStart": "2026-11-20T14:00:00Z",
    "stopCount": 18,
    "totalMiles": 62.5
  },
  "availableDrivers": [
    { "driverId": "D0008" }, { "driverId": "D0011" }, { "driverId": "D0015" },
    { "driverId": "D0018" }, { "driverId": "D0028" }, { "driverId": "D0030" }
  ]
}
```

### 3. Short route, small pool

With fewer drivers than `waves x drivers per wave`, the plan offers the same drivers again in later waves (`isReoffer: true`).

```json
{
  "route": { "market": "PHX", "stopCount": 3, "totalMiles": 12 },
  "availableDrivers": [{ "driverId": "D0001" }, { "driverId": "D0014" }, { "driverId": "D0021" }]
}
```

### 4. Long route, large pool

```json
{
  "route": { "market": "MIA", "stopCount": 30, "totalMiles": 140 },
  "availableDrivers": [
    { "driverId": "D0003" }, { "driverId": "D0004" }, { "driverId": "D0010" }, { "driverId": "D0027" },
    { "driverId": "D0035" }, { "driverId": "D0042" }
  ]
}
```

### 5. Unknown drivers (cold start)

`ghost-1` has no history and no attributes, so it gets the market average (`coldStart: "market"`). `ghost-2` carries attributes, so its estimate comes from rating and volume (`coldStart: "attributes"`). Attributes are ignored for drivers who have history.

```json
{
  "route": { "market": "DC", "stopCount": 12, "totalMiles": 40 },
  "availableDrivers": [
    { "driverId": "D0005" },
    { "driverId": "ghost-1" },
    { "driverId": "ghost-2", "rating": 4.9, "routesCompleted90d": 45 },
    { "driverId": "ghost-3", "rating": 3.6, "routesCompleted90d": 4 }
  ]
}
```

### 6. Excluded drivers

`D0001` is a PHX driver on an NYC route, so it appears in `excludedDrivers` as `market_mismatch`. The repeated `D0006` is excluded as `duplicate`. The request still succeeds because other drivers remain.

```json
{
  "route": { "market": "NYC", "stopCount": 10, "totalMiles": 50 },
  "availableDrivers": [
    { "driverId": "D0006" }, { "driverId": "D0006" }, { "driverId": "D0001" }, { "driverId": "D0002" }
  ]
}
```

## Unsupported requests (422)

### 7. Market not in the data

```json
{
  "route": { "market": "SEA", "stopCount": 10, "totalMiles": 50 },
  "availableDrivers": [{ "driverId": "D0006" }]
}
```

Response: `{"statusCode":422,"error":"UnsupportedMarket","message":"Market \"SEA\" is not supported: not in data"}`

### 8. Every driver excluded

```json
{
  "route": { "market": "NYC", "stopCount": 10, "totalMiles": 50 },
  "availableDrivers": [{ "driverId": "D0001" }, { "driverId": "D0014" }]
}
```

Response: `422` with `error: "NoEligibleDrivers"`.

## Invalid requests (400)

Each of these fails validation.

| Case | Body |
| --- | --- |
| Missing market | `{"route":{"stopCount":10,"totalMiles":50},"availableDrivers":[{"driverId":"D0006"}]}` |
| Empty market | `{"route":{"market":"","stopCount":10,"totalMiles":50},"availableDrivers":[{"driverId":"D0006"}]}` |
| No drivers | `{"route":{"market":"NYC","stopCount":10,"totalMiles":50},"availableDrivers":[]}` |
| Zero stops | `{"route":{"market":"NYC","stopCount":0,"totalMiles":50},"availableDrivers":[{"driverId":"D0006"}]}` |
| Miles not a number | `{"route":{"market":"NYC","stopCount":10,"totalMiles":"abc"},"availableDrivers":[{"driverId":"D0006"}]}` |
| Negative miles | `{"route":{"market":"NYC","stopCount":10,"totalMiles":-5},"availableDrivers":[{"driverId":"D0006"}]}` |
| Bad date | `{"route":{"market":"NYC","stopCount":10,"totalMiles":50,"scheduledStart":"tomorrow"},"availableDrivers":[{"driverId":"D0006"}]}` |
| Rating above 5 | `{"route":{"market":"NYC","stopCount":10,"totalMiles":50},"availableDrivers":[{"driverId":"x","rating":7}]}` |
| Unknown field on a driver | `{"route":{"market":"NYC","stopCount":10,"totalMiles":50},"availableDrivers":[{"driverId":"D0006","foo":1}]}` |
| Unknown top-level field | `{"route":{"market":"NYC","stopCount":10,"totalMiles":50},"availableDrivers":[{"driverId":"D0006"}],"extra":true}` |
| More than 200 drivers | `availableDrivers` with 201 entries |

## What to look at in a response

- `startingPrice`, `referencePrice` and `startMultiplier`: the chosen start and the model's reference price for this route.
- `waves[].price`: non-decreasing, raised by the inferred step each wave.
- `waves[].drivers[].acceptProbability`: a model estimate at that wave's price, not a guarantee.
- `expected`: fill probability, fill by wave, expected price paid, minutes and cost.
- `assumptions`: the cost settings used to pick the start.
- `modelVersion`: the data fingerprint plus training time. It changes when the CSVs change.
