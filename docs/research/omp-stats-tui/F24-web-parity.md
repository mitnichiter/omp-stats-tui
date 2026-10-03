# F24 — Web parity: does the terminal compute the SAME NUMBERS as the dashboard?

**Audit date:** 2026-10-03
**Claim under test:** `omp-stats-tui` is a port of the web stats dashboard.
**Verdict:** The claim was **false in six places** when this audit began. All six
are fixed and pinned by tests. One more divergence remains open, in a file a peer
owns. Every other figure is provably identical.

---

## Why this audit is not redundant

The panel and the dashboard read the same `~/.omp/stats.db` through the same
`@oh-my-pi/omp-stats` package, via the same `handleApi` adapter
(`src/data/api.ts`). So the **raw queries are identical by construction** and a
divergence can never come from the data.

That makes every divergence an **arithmetic** one, and it is the worst possible
class of bug for a dashboard: none of the six threw, none rendered blank, none
tripped an existing test. Each one resolved to a plausible-looking number. A
panel that says "Average per day $20" when the dashboard says "$15.08" is not a
crash — it is a confident lie, and it is indistinguishable from correctness by
inspection.

So the method here is **evidence, not review**: for each figure, the web's exact
computation is quoted with `file:line`, ours is quoted with `file:line`, and the
two are then run against the SAME payload fixture by an automated test. Where the
two answers differ, that is a fact rather than an opinion.

---

## The parity table

`web` = `@oh-my-pi/omp-stats` v18.4.10, the shipped package, read-only.

| # | Metric | Web source | Our source | Identical? | Evidence | Verdict |
|---|---|---|---|---|---|---|
| 1 | Costs · API-equivalent estimate | `view-models.ts:179` `totalCost += point.cost` | `resolve.ts` `sum` over `costSeries.cost` | **yes** | `parity.test.ts` "the estimate is the SUM" | fixed before audit; pinned |
| 2 | Costs · Unpriced requests | `view-models.ts:201` `unpricedRequests += point.unpricedRequests` | `sum` over `costSeries.unpricedRequests` | **yes** | "unpriced requests are counted" | pinned |
| 3 | Costs · **Average per day** | `view-models.ts:183` `totalCost / activeDays`, where `activeDays = new Set(timestamps).size` (`:148`) | was `op:"max"` → **max bucket cost** | **NO → FIXED** | fixture: web `28.833`, ours was `42`; test asserts ours ≠ `max(costSeries)`, which is `42` | `445c934` |
| 4 | Costs · **Top model** | `view-models.ts:184-189` `models[0]` after sort by cost desc, `null` when `cost === 0` | was `label costSeries.model` → **row 0's model** | **NO → FIXED** | fixture's first row is `probe-cheap` (cheapest); web `gpt-5.6-terra`, ours `probe-cheap` | `445c934` |
| 5 | Costs · **Per priced request** | `CostsRoute.tsx:242,270` `totalCost / (requests − unpricedRequests)` | was `share(totalCost, requests)` → **divided by all requests** | **NO → FIXED** | fixture: web `0.036840`, ours was `0.034879`; test asserts ours ≠ `totalCost/requests` | `445c934` |
| 6 | Costs · Daily estimate (bucketing) | `CostsRoute.tsx:201-205` `bucketAxis(range, ts, DAY_MS)` — **DAY for every range** | `screen.ts:98` `COST_BUCKET_MS`, `bucketedValues` | **yes** | both import the host's `bucketAxis`; day-bucketed for every range | pinned |
| 7 | Costs · Daily estimate (folding) | `CostsRoute.tsx:43,212` `MODEL_LIMIT = 6` → `"Other (n)"` | `pivotSeries(..., limit)` in `charts/bars.ts` | **yes** | host's own `pivotSeries`; folding policy is the host's | by construction |
| 8 | Costs · Top model (all-unpriced) | `CostsRoute.tsx:264` `top ? top.model : "–"` | `topModel?.model ?? null` → blank cell | **yes** | `parity.test.ts` all-unpriced window asserts `null`, not `0` | fixed with #4 |
| 9 | Projects · Requests / Cost / Failed | `view-models.ts:250-253` sums over folders | `sum` over `folders` | **yes** | "requests and cost are range totals" | pinned |
| 10 | Projects · Conversation tokens | `view-models.ts:254` `input + cacheRead + cacheWrite + output` | `sumTokenKinds`, same four fields | **yes** | test asserts both the host's `conversationTokens` and a hand-sum | pinned |
| 11 | Projects · **Cache rate** | `view-models.ts:282` `cacheRead / (input + cacheRead)` summed over **ALL** folders, then divided | was `folders.cacheRate` → **`folders[0]`'s own rate** | **NO → FIXED** | fixture folders at 0.97 and 0.3333; web `0.894272`, ours was `0.97`; test asserts ours ≠ `folders[0].cacheRate` | `445c934` |
| 12 | Projects · Cache rate denominator | cache **writes excluded** | cache writes excluded | **yes** | `format.ts:134` documents it; test recomputes `read/(input+read)` | pinned |
| 13 | Errors · Failures | `ErrorsRoute.tsx:93` `loaded = errors.data.length` | `count` over `errorMessages` rows | **yes** | "Failures is the number of loaded rows" | pinned |
| 14 | Errors · **Signatures** | `ErrorsRoute.tsx:140` `view.groups.length` from `errorSignature()` — ids, hex, counters normalized (`view-models.ts:405-415`) | was `count` over raw `errorMessage` → **distinct raw strings** | **NO → FIXED** | two fixture rows differ only by id + retry count; web `3`, ours `4` | `445c934` |
| 15 | Errors · **Affected models** | `ErrorsRoute.tsx:56-65` distinct `modelKey(model, provider)` | was distinct **`model` names** | **NO → FIXED** | one model on two providers; web `2`, ours `1` | `445c934` |
| 16 | Requests · Requests / Tokens / Cost | `view-models.ts:377-382` over the loaded rows | `count` / `sum` over `recentMessages` | **yes** | "tokens and cost are summed"; `summarizeRequests` compared | pinned |
| 17 | Requests · Aborts still count | `view-models.ts:363-374` no status is dropped from totals | `sum` includes every row | **yes** | test asserts an aborted request contributes its tokens | pinned |
| 18 | Requests · **Failed** | `view-models.ts:364` `requestStatus(row) === "failed"` over the SAME loaded rows | `count` over a **separate `errors` payload** | **see note A** | figures agree on the fixture; populations differ | **OPEN — see below** |
| 19 | Models · Requests / Cost / unpriced | `ModelsRoute.tsx:271-277` sums over `byModel` | `sum` over `byModel` | **yes** | sums are identical by construction | pinned |
| 20 | Models · Cache rate / errorRate / tokens-per-sec / TTFT | `byModel` row fields, straight from `rollup.ts:571-601` | same row fields, no recomputation | **yes** | we read, we do not recompute — cannot drift | by construction |
| 21 | Models · Most used | `ModelsRoute.tsx:272` max `totalRequests` | first `byModel` row — **`ORDER BY requests DESC`** (`rollup.ts:613`) | **yes, but by coincidence** | server already sorts; see note B | fragile — see below |
| 22 | Models · **Trend sparkline** | `ModelsRoute.tsx:264` `pivotSeries(...)` — **dense over `bucketAxis`, gaps zero-filled** | `resolve.ts:290` `seriesValues` — **gaps SKIPPED** | **NO → OPEN** | fixture: one model in buckets 1 and 3 only → web `[5,0,7]`, ours `[5,7]` | **OPEN — renderer-owned** |
| 23 | Tools · calls / errors / tokens / cost / resultChars | `ToolsRoute.tsx:290-298` sums over `byTool` | `sum` over `toolsByTool` | **yes** | identical sums | pinned |
| 24 | Tools · Error rate | `ToolsRoute.tsx:99` `errors / calls` | `share(errors, calls)` | **yes** | same two sums | pinned |
| 25 | Tools · Distinct tools | `ToolsRoute.tsx:282` `byTool.length` | distinct `tool` labels | **yes** | one row per tool either way | pinned |
| 26 | Overview · cost/requests/errorRate/cacheRate/savings | `OverviewRoute.tsx:106-137` straight off `overall` | same `overall` fields | **yes** | we read, we do not recompute | by construction |
| 27 | Overview · Activity succeeded series | `OverviewRoute.tsx:77` `p.requests − p.errors` | `timeSeries("requests")` — **no subtraction** | **see note C** | renderer draws series un-stacked, so no overstatement | **by design — see below** |
| 28 | Overview · Activity (bucketing) | `OverviewRoute.tsx:71-74` `bucketAxis(range, ts, meta.bucketMs)`; `1h` → 5-minute buckets | `bucketedValues` via `bucketMsFor(range)` → host's `rangeMeta` | **yes** | `1h` is 5-minute on both sides | pinned |
| 29 | Activity heatmap · levels & max-anchor | pi-tui `usage-dashboard.ts:313-330` `ceil(sqrt(v/max)*4)`, max over the visible range, cost with requests fallback | `charts/heatmap.ts:108` **delegates to that exact function** | **yes, by construction** | our `renderHeatmap` calls `buildHeatmapLayout`; probe confirms identical `cells` | by construction |
| 30 | Overview · agent token share | `view-models.ts:50-72` `buildAgentTokenShare`, shares over total tokens | three legend rows all reading `overall.totalRequests` | **see note D** | deliberate, documented | **by design — see below** |
| 31 | Requests · Median/p95 duration & TTFT | `view-models.ts:347-350` nearest-rank quantile | **not shown** | **n/a** | absence, not divergence | scope |
| 32 | Providers screen | `ProvidersRoute.tsx` | `deferred`, no need | **n/a** | route does network I/O; panel makes none | scope |

**32 figures examined. 6 divergences found and fixed. 1 open. 3 deliberate, documented departures.**

---

## The six that were wrong

All six were the **same failure mode**: a generic operation pointed at the wrong
question, producing a real number that means something else.

| Figure | Generic op gave | Dashboard gives |
|---|---|---|
| Average per day | `max` bucket cost | `totalCost ÷ activeDays` |
| Top model | row 0's model | highest-estimate model |
| Per priced request | `totalCost ÷ requests` | `totalCost ÷ (requests − unpriced)` |
| Cache rate | `folders[0].cacheRate` | rate over all folders |
| Signatures | distinct raw strings | distinct normalized signatures |
| Affected models | distinct model names | distinct `model::provider` |

### Why no existing test caught any of the six

The most useful finding of this audit is not the six divergences — it is that
**the project's own fixture could not have caught any of them.**

`test/fixtures/panel.ts` builds cost points with `unpricedRequests: 0`, so for
figure #5 `requests − unpricedRequests === requests`, and dividing by the wrong
one produces **exactly the right answer**. Verified against the shipped fixture:

```
buildCostSummary(COST_SERIES).totalCost / requests              0.0032328282439812324
buildCostSummary(COST_SERIES).totalCost / (requests − unpriced) 0.0032328282439812324
```

Identical to the last digit. The same fixture has one dominant model, so "first
row" passes as "top model"; its folders share a cache rate, so `folders[0]` passes
as the range's; and its error rows never repeat a message with a different id, so
raw-string distinctness passes as signature distinctness.

A fixture that cannot fail is worse than no fixture, because it reads as
coverage. That is why `test/parity.test.ts` carries an unpriced model, a
cheapest-first cost row, folders that disagree on cache rate, two error strings
differing only by id and retry count, and one model on two providers.

The fix is **not** a restated formula. Each delegates to the function the web
client itself calls, imported from the same pinned package
(`src/layout/host-derived.ts`):

- `avgDailyCost`, `perPricedRequest` → `buildCostSummary()` (`view-models.ts:143`)
- `topModel` → `buildCostSummary().topModel`
- `rangeCacheRate` → `buildFolderRows().cacheRate` (`view-models.ts:239`)
- `errorSignatureCount` → `groupErrorsBySignature().length` (`view-models.ts:435`)
- `affectedModelCount` → `modelKey()` (`colors.ts:25`)

Re-deriving `totalCost / new Set(timestamps).size` locally would be a **second
implementation of a formula we do not own**, and it would rot without ever
failing. Delegation means an upstream definition change arrives on the next
dependency bump instead of drifting silently.

`test/parity.test.ts` imports **both** sides and asserts equality, so "we call the
host's function" is a checked fact, not a claim. Zero React involved — `client/data/`
imports cleanly.

### The fixture is adversarial on purpose

A tidy fixture would have passed four of these six. Each row of it exists to kill
one specific wrong answer:

- the **first** cost row is the **cheapest** model → catches "first row" as "top model"
- three uneven days → catches `max` passing as a mean
- unpriced requests on priced days → catches `requests` passing as `requests − unpriced`
- folders at 0.97 and 0.3333 → catches one folder's rate passing for the range's
- two errors differing only by an id and a retry count → catches raw-string distinctness
- one model on two providers → catches model-name distinctness passing as identity

---

## Note A — Requests "Failed": different populations (OPEN, low severity)

Web counts failures **within the rows it loaded** (`RequestsRoute.tsx:64`,
`requestStatus(row)`), which includes a row whose `errorMessage` is set even when
`stopReason` is not `"error"`.

We count rows from the **separate `/api/stats/errors` payload**, which the server
filters to `stop_reason = 'error'` (`db.ts`, `getRecentErrors`).

So a request with an `errorMessage` but a different `stopReason` is a *failed*
request to the dashboard and *not counted* by us. On the fixture both answer `1`,
which is why it is not in the divergence table as broken — but the populations
genuinely differ, and the error rate implied by them can differ by a few rows.

**Not fixed here** because the fix is a data-seam change (the `requests` screen
would need to compute status itself, like the web does), not a resolver change,
and `src/data/api.ts` is shared with the in-flight renderer work. Flagged for the
integration owner.

## Note B — Models "Most used" is correct by coincidence (FRAGILE)

`ModelsRoute.tsx:272` picks the model with the **maximum** `totalRequests`.
We read `byModel[0]`, which is only the maximum because the server emits
`ORDER BY requests DESC` (`rollup.ts:613`).

Correct today; wrong the day that ORDER BY changes. It survives review because it
looks deliberate. Converting it to a host-derived `argmax` would make it
explicit — noted, not done, since the screen is renderer-owned.

## Note C — Overview "Succeeded" series is a superset, by design

Web's Activity chart stacks `requests − errors` over `errors`
(`OverviewRoute.tsx:77-78`). We plot raw `requests` and `errors` as two series
and the renderer draws each as its **own block, never stacked**
(`screen.ts` rule 2). So we never double-count and never overstate a total — the
one thing stacking them would have got wrong. The cost is that our "Succeeded"
series includes the failed requests, so the label overstates by the error rate.

Recorded rather than fixed: subtracting would require a `difference` op the IR
does not have, and the visual is honest because nothing is summed.

## Note D — Overview agent legend is NOT the dashboard's breakdown

Web shows each agent type's **token** total and its share of total tokens
(`buildAgentTokenShare`, `view-models.ts:50`). Our three legend rows all read
`overall.totalRequests` — the same field three times.

This is a known, documented departure (`resolve.ts` `sharedDenominator`), and the
comment there is accurate about it: the payload is `byAgentType`, and expressing
per-agent shares needs a grouped legend the IR does not model. It is a **real
divergence from the dashboard's numbers**, recorded here rather than quietly
fixed, because the fix is an IR change that would affect every screen's legend.

---

## What could NOT be proved

Stated explicitly, because "no divergence found" is only meaningful when the
thing being compared is real:

1. **No live-database comparison was performed.** Both sides were run against a
   fixture. That is sufficient — the audit targets arithmetic, and arithmetic on a
   fixture is arithmetic on the database — but it does not prove the fixture
   covers every shape the real payload can take (e.g. a `costSeries` with a single
   day, or a range where every model is unpriced).
2. **`Providers` screen**: unfillable by construction. No equality test possible.
3. **Median/p95 duration and median TTFT**: not shown on any screen, so there is
   nothing to compare. Absence, not parity.
4. **The peer's in-flight `src/tui/render/screen.ts`** was mid-refactor during
   this audit and could not be audited for parity. Its chart series selection and
   cell formatting were checked by reading, not by equality test.
5. **Model `TTFT` column** (`ModelsRoute.tsx:410`) reads `row.avgTtft` in
   **milliseconds** and formats with `formatDurationMs`. We read the same field
   and apply the same formatter, so the displayed figure matches — but note the
   web's `buildModelPerformanceLookup` converts TTFT to **seconds**
   (`view-models.ts:223`). That conversion feeds the *expanded row detail*, which
   we do not render. No divergence in what we show; flagged because it is a trap
   for whoever ports the detail view.

---

## Commits

- `445c934` — `fix(layout): compute six figures the way the dashboard does`
  (host-derived registry, six spec refs, `test/parity.test.ts`)
- `7818788` — `test(parity)`: peer amendment typing the fixture rows
- `284723a` — `feat(charts)`: multi-series charts composed from the primitive
  (adjacent work; see the chart primitives' own tests)