# Route offer ranking: write-up

> **Status:** numbers below come from `npm run replay -- --window both` (200 draws, seed 42) on the provided CSVs.

## Approach

Two decisions per route: who to offer to, and at what starting price.

- **Who.** Today the order is effectively random. I fit one acceptance model, `logit P(accept) = market + driver + β·ln(price / reference) + wave`. The driver term is shrunk toward the market mean, because most drivers have few offers. Drivers are ranked by that term and offered in waves of the size seen in the history. Drivers with no history use rating and 90-day volume if the caller sends them, otherwise the market average.
- **At what price.** A per-market regression of `wave1_price` on miles and stops gives a reference price (it models the baseline's own start rule). For each candidate start between 0.85× and 1.40× the reference, I compute the expected cost of the whole wave sequence under the model and pick the cheapest. Expected cost is price paid, plus a penalty for an unfilled route, plus a small cost per extra wave.
- **Data.** Markets, wave mechanics and evaluation windows come from the CSVs, and the service reloads them when they change.

What the data showed:

- Driver propensity is stable: the correlation between two halves of the history is about 0.85.
- Time of day and weekday effects are negligible.
- On-time is not predictable per driver: the correlation across halves is about -0.06.
- Re-offers to the same driver accept more often (13.7%) than first offers (8.8%).

## Trade-offs

Price, speed and on-time pull against each other.

- **Price vs. speed.** A lower start saves money only if the route fills before the wave-by-wave raises catch up. Two explicit settings make the trade visible: an unfilled route costs `2.0×` the reference price, and each extra wave costs `0.03×` the reference price. These are my assumptions, not Vamo's numbers. I have not yet run a sensitivity check on them (it is first on the next-steps list); they live in `OfferPlanningConfig`.
- **On-time.** I report it but do not optimize it. At about five routes per driver there is no stable signal, so putting it in the ranking would add noise. If on-time matters more than price, it needs its own data (see next steps).
- **What the replay shows.** The model starts at about 0.85 to 1.00 times the reference price instead of the baseline's own start and relies on better driver order to fill early. Price fell and speed improved together here, so the trade-off was not binding on this data. The cost settings still decide how far to push the start down.
- **Ranking concentrates offers.** Ranking by propensity sends more offers to the strongest drivers. That helps fill rate, but it risks fatigue and unfair distribution. I don't address it in v1.

## Replay result

Held-out routes: the last 30 days of the data (638 routes from 2026-10-01). Models are trained on earlier routes only. The simulator is fitted on the held-out window's own offers.

| Policy | Cost per posted route | Fill rate | Wave-1 fill | Minutes to accept | Paid / reference |
| --- | --- | --- | --- | --- | --- |
| Logged baseline | 130.77 | 0.876 | 0.132 | 62.5 | 1.118 |
| Simulated baseline | 130.00 | 0.877 | 0.132 | 62.7 | 1.119 |
| Model policy | 115.67 | 0.905 | 0.245 | 51.4 | 1.001 |

Model minus baseline in cost per posted route: **-14.33** (95% interval -15.01 to -13.65, bootstrap over market-days). The model fills more routes (+2.8 points), faster (-11 minutes), at a lower price (-11.88 per filled route). Expected on-time rate is about the same (+2.1 points, interval 1.5 to 2.7). The earlier window (14 days before) has the same sign: -13.19 (-14.17 to -12.26).

How much to trust it:

- The simulated baseline matches the logged baseline on fill, wave-1 fill and minutes, so the simulator reproduces the current process.
- The acceptance model beats a price-and-wave-only model on held-out offers (AUC 0.856 vs 0.694).
- **Calibration gate fails.** The model over-predicts for drivers who almost never accept (predicted 3.3%, observed 1.4% in one bucket) and under-predicts for the best (0.40 predicted vs 0.44 observed). This is the shrinkage on driver effects. The absolute gain is probably overstated. I treat the direction and rough size as credible and the exact figure as not.
- **I tuned after seeing a result.** My first run (ridge 5, start grid 0.85 to 1.40) gave -9.98 and put 16.5% of routes at the grid floor. I then lowered the ridge to 2 and widened the grid down to 0.70. The early window was not held out from that decision.

## What I would measure in production

- **Primary:** cost per posted route, so a policy can't look good by leaving routes unfilled.
- **Speed and fill:** fill rate, wave-1 fill rate, minutes to accept.
- **Price:** paid / reference price, and where the chosen start sits in the grid (many picks at an edge means the model or grid is wrong).
- **Quality:** on-time rate, decline vs. no-response rate.
- **Health:** offers per driver per week, and predicted vs. observed acceptance by probability bucket.

## Real improvement or noise

Offline, I try to make the comparison fair:

- A time-based holdout and a primary metric fixed before running.
- Both policies see the same random draws, so the difference isn't luck.
- A bootstrap over whole market-days, so the interval isn't too narrow.
- Gates before I trust the result: the simulated baseline must match the logged baseline, and the model must be calibrated and beat a price-and-wave-only model on AUC and log-loss.
- A check that the sign holds in an earlier window.

None of this proves the model is right, because the simulator uses the same model family as the policy. The real test is online: a randomized route-level A/B test, or a market-by-market switchback, with a sample-size estimate first. Drivers are shared between arms, so a route-level split has interference, and the effect is probably understated.

## Limitations

- Pricing gains depend on the acceptance model being right outside the logged price range.
- Capacity is approximated by shared time slot.
- Repeat offers to a driver are treated as independent.
- Retraining happens on all history, with no recency weighting.

## With another week

1. Run a shadow mode: log the model's plan next to the real one, and compare predicted and actual acceptance before any traffic.
2. Launch a small randomized test in one market, with a guardrail on cost per posted route.
3. Randomize the starting price a little on live routes, so the price effect can be estimated instead of inferred from the old rule.
4. Model driver availability and capacity directly, and add fairness limits on offers per driver.
5. Add recency weighting, plus a second on-time model if there is enough data.
