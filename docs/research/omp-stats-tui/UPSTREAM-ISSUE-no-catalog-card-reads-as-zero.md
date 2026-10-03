# A model with no catalog card reports `$0`, not "unpriced" — 4,359 requests are silently reported as free spend

**Not filed — draft for human review.** See "Notes for the submitter" at the bottom.

## Summary

`unpricedRequestSql` (`omp-stats/src/db.ts:54`) counts a request as unpriced only when
`cost_total = 0 AND total_tokens > 0 AND (provider = 'xai-oauth' OR cost_unpriced = 1)`. The
`cost_unpriced` marker is set by `insertMessageStats` only when `resolveStoredCost` refuses to
price a **time-based** card whose entry carried no recoverable timestamp. A model with **no
catalog card at all** is never marked.

The behaviour is documented at `db.ts:49-51`:

> *"Nothing else sets the marker: an explicit recorded zero, a free flat card, and a model with
> no catalog card at all keep `cost_unpriced = 0` even at the parser's timestamp sentinel,
> because their zero is a real price."*

The first two clauses are correct. **The third does not follow.** A model with no card does not
have a price of zero; it has *no price*. Its recorded zero is the absence of a measurement, and
the aggregates report it as a measured zero. Any consumer that trusts `unpricedRequests` to
decide between "free" and "unknown" will display free-tier spend as known-and-nil.

This is the difference between a cost of `$0` and a cost that was never determined, which is
exactly the distinction a usage report exists to preserve.

## Evidence

Measured 2026-10-03 against a real `~/.omp/stats.db` (186,561 requests in `messages`; 1,924 rows
in `message_rollup`; `rollup_dirty` = 0 rows, so nothing below is a staleness artefact).

The raw zero-cost population:

```sql
SELECT COUNT(*) FROM messages WHERE cost_total = 0 AND total_tokens > 0;
-- 70,727
```

The package's own classification of the same rows:

```sql
SELECT SUM(CASE WHEN total_tokens > 0 AND cost_total = 0
  AND (provider = 'xai-oauth' OR cost_unpriced = 1) THEN 1 ELSE 0 END) FROM messages;
-- 0

SELECT SUM(unpriced) FROM message_rollup;
-- 0
```

Splitting the 70,727 by whether `@oh-my-pi/pi-catalog` actually carries a price card for the model:

| | requests | tokens | model |
|---|---|---|---|
| priced $0 — **correct** | 36,305 | 4,675,523,109 | `space-bunny-free` |
| priced $0 — **correct** | 7,212 | 573,386,939 | `muse-spark-1.2-contributor-free` |
| priced $0 — **correct** | 6,213 | 574,786,453 | `muse-spark-1.3-contributor-free` |
| priced $0 — **correct** | 4,263 | 333,032,502 | `deepseek-v4-flash-free` |
| **NO CARD — misreported** | **4,197** | **571,773,459** | **`gemini-3.7-flash-high`** |
| priced $0 — **correct** | 3,114 | 439,811,836 | `poolside/laguna-s-2.1:free` |
| priced $0 — **correct** | 3,087 | 191,253,475 | `big-pickle` |
| priced $0 — **correct** | 2,563 | 274,714,869 | `stealth/ox-alpha` |
| priced $0 — **correct** | 1,164 | 110,955,677 | `x-preview-f-free` |
| priced $0 — **correct** | 980 | 124,755,992 | `longcat-2.0-free` |
| priced $0 — **correct** | 865 | 179,652,157 | `ox-alpha-free` |
| priced $0 — **correct** | 391 | 64,286,676 | `stealth/ox-alpha` |
| priced $0 — **correct** | 201 | 13,160,451 | `longcat-2.5-preview-free` |
| **NO CARD — misreported** | **162** | **38,344,238** | **`agnes-2.5-flash`** |
| priced $0 — **correct** | 10 | 5,423,011 | `cline-free/muse-spark-1.3-contributor` |

- whose `$0` is a **real recorded price**: **66,368 requests**
- whose `$0` is **genuinely unknown**: **4,359 requests**

Catalog state for the two populations:

```
space-bunny-free               provider=opencode-zen  cost={"input":0,"output":0,"cacheRead":0,"cacheWrite":0}
big-pickle                    provider=opencode-zen  cost={"input":0,"output":0,"cacheRead":0,"cacheWrite":0}
gemini-3.7-flash-high         *** no catalog entry ***
agnes-2.5-flash               *** no catalog entry ***
```

The affected models are not exotic: `gemini-3.7-flash-high` is the fifth most-used
zero-cost model in the database and has 571M tokens behind it.

## Why "no card" is not "price of zero"

The three cases are distinct and all three currently collapse to `$0`:

1. **Explicit zero card** — the rate card exists and says zero. The price was determined. Free
   tier, promotional credit, or a genuinely free endpoint. `$0` is a fact.
2. **No card** — the model is not in the catalog. Nothing was determined. `$0` is a placeholder
   for an unmeasured quantity, and any total containing it is a floor rather than a figure.
3. **`xai-oauth`** — priced through a subscription, deliberately recorded with no per-request
   price. Already handled by the existing predicate.

Case 1 and case 2 are separated by exactly one question: *did anyone decide this costs zero?*
Only one of them did. A consumer cannot tell them apart from `cost_total` alone, because both are
zero — which is why the `cost_unpriced` marker exists, and why it must be set in case 2.

The practical consequence is that a total over a mixed window under-reports silently. With
4,359 unknown requests in the window, a headline total is not a total; it is a lower bound, and
nothing in the payload says so.

## Proposed change

**1. Ingest — mark rows the catalog cannot price.** In `insertMessageStats` (`db.ts:852`), set
`cost_unpriced = 1` when `getCatalogCost()` returns `null` and the request carries tokens.
Today the no-card case returns early and leaves the marker at its `DEFAULT 0`.

**2. Predicate — count the no-card case.** Extend `unpricedRequestSql` (`db.ts:54`) so existing
rows, written before any backfill, are counted too. Something equivalent to adding
`getCatalogCost(provider, model) IS NULL` to the predicate; since the SQL is built per-query and
the catalog is available in-process, a model-list subquery or a pre-resolved id set both work.
The `xai-oauth` and `cost_unpriced = 1` branches stay exactly as they are.

**3. Backfill — existing rows.** Reuse the established pattern: a `meta` sentinel such as
`messages_cost_unpriced_nocard_v1`, with the scan guarded by it, alongside the existing
`messages_cost_unpriced_v1` (currently `complete`).

### Verification

- `SELECT SUM(unpriced) FROM message_rollup` returns **4,359** on the database above.
- `gemini-3.7-flash-high` reports `unpricedRequests: 4,197` and `agnes-2.5-flash` reports `162`.
- `space-bunny-free`, `big-pickle` and `muse-spark-1.3-contributor-free` continue to report
  `unpricedRequests: 0`. **This is the regression that matters most**: the change must not mark
  explicit zero cards as unknown, or every free-tier model becomes a false positive.
- `initDb()` timing does not regress. Note the interaction with
  `backfillMissingCatalogCosts` (see the separate missing-index report): that scan already
  visits every `cost_total = 0 AND total_tokens > 0` row on each start, so it is the natural
  place to set the marker, provided the sentinel guard is added at the same time.

## The counter-argument

A maintainer would reasonably object on three grounds, and each deserves an answer:

**"A missing card is rare and self-correcting."** New models are added to the catalog
continuously, so a model's card usually appears within days and a later re-parse prices it. The
argument holds for freshness but not for reporting: until the card lands, the row reads `$0`,
and any total rendered in that window is wrong in the meantime. A one-day-old model is exactly
when a user is least able to explain the gap and most likely to believe the number.

**"Treating every unknown model as unpriced would flood the metric."** This is the strongest
objection and it is why the fix must be gated on `total_tokens > 0`. A model that was probed,
failed to price, and produced no usage is not unknown spend — there is nothing to have spent.
Gating on tokens keeps the population at the true 4,359 rather than at the full set of unpriced
model ids, which is far larger.

**"`getCatalogCost` deliberately conflates these to keep cost resolution total."** If the design
intent is that cost resolution never fails and a missing rate degrades to zero, then the
consequence has to be that `unpricedRequests` is not the flag a consumer should use to
distinguish free from unknown. In that case the correct change is not to the marker but to the
aggregation: publish a second, honest count — `unknownCostRequests` — carrying exactly the
population described above, and document that `cost_total` is a floor whenever it is non-zero.
Either resolution is a genuine improvement; leaving both fields as they are is not.

## Notes for the submitter

- Not filed. This is a draft for human review; do not post without reading the counter-argument
  section above and deciding which of the three resolutions to propose.
- Reproduce with `SELECT COUNT(*) FROM messages WHERE cost_total = 0 AND total_tokens > 0;`
  then cross-reference `@oh-my-pi/pi-catalog`'s `models.json` for each `model` in the result.
- The database used is the reporter's own; no attachments are required or desirable.
- Cross-reference the separate `initDb()` / `backfillMissingCatalogCosts` report: the two fixes
  touch the same scan and should be sequenced together to avoid two full-table passes per start.
- A downstream consumer currently carries a workaround for this bug, because this package is
  consumed read-only. It will be deleted when this is fixed, and it should be deleted rather
  than kept: if this lands, the workaround's own predicate becomes dead code.