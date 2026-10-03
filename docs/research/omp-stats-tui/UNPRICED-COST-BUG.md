# The unpriced-cost bug: a model with no price card reports `$0`, not `N/A`

**Status:** open, upstream in `@oh-my-pi/omp-stats`. The panel renders it faithfully; the
package classifies it wrongly.
**Found:** 2026-10-03, by A/B-ing `scripts/probe-data.ts` against the panel's own read path.
**Database:** `~/.omp/stats.db`, opened read-only. 186,561 requests. `rollup_dirty = 0`,
`session_dirty = 0` — the rollup is fresh, so none of this is staleness.

## The question

`scripts/probe-data.ts`, run earlier today, reported for `space-bunny-free`:
`34973 requests, 4.30B cache-read, $0.00 with 34870 unpriced`.
The panel reported **zero** unpriced requests in the whole database. Both read the same
database. Which is right?

## Answer: they are both reading correctly, from different definitions

`scripts/probe-data.ts` DERIVES the count:

```sql
SUM(CASE WHEN cost_total = 0
  AND (input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) > 0
  THEN 1 ELSE 0 END)
```

The panel reads the package's field, `unpricedRequestSql` (`db.ts:54`):

```sql
CASE WHEN total_tokens > 0 AND cost_total = 0
  AND (provider = 'xai-oauth' OR cost_unpriced = 1) THEN 1 ELSE 0 END
```

Measured, right now:

| query | result |
|---|---|
| `SELECT COUNT(*) FROM messages WHERE cost_total = 0 AND total_tokens > 0` | **70,727** |
| `SELECT SUM(unpriced) FROM message_rollup` | **0** |
| package predicate, over `messages` | **0** |

So the two SQL shapes genuinely disagree — 70,727 vs 0 — and neither is lying about what it
computed. `probe-data.ts` simply omits the `cost_unpriced = 1 OR provider = 'xai-oauth'`
gate.

## For `space-bunny-free` specifically, the panel is right

`space-bunny-free` has an explicit catalog entry:

```
provider=opencode-zen  cost={"input":0,"output":0,"cacheRead":0,"cacheWrite":0}
```

A zero price card is a real price. Its `$0` is correct, and `probe-data.ts` is wrong to call
it unknown spend.

## But the panel IS wrong about two other models — this is the real bug

The package's policy, stated at `db.ts:49-51`:

> *"Nothing else sets the marker: an explicit recorded zero, a free flat card, and **a model
> with no catalog card at all** keep `cost_unpriced = 0` … because their zero is a real price."*

The first two clauses are right. The third is wrong: a model with **no price card** has no
price, so its zero is **unknown**, not real. The package never sets `cost_unpriced` for that
case, so those requests are invisible to `unpricedRequests`.

Splitting every zero-cost model with tokens by whether a catalog card exists:

| | requests | tokens | model |
|---|---|---|---|
| priced $0 (correct) | 36,305 | 4,675,523,109 | space-bunny-free |
| priced $0 (correct) | 7,212 | 573,386,939 | muse-spark-1.2-contributor-free |
| priced $0 (correct) | 6,213 | 574,786,453 | muse-spark-1.3-contributor-free |
| priced $0 (correct) | 4,263 | 333,032,502 | deepseek-v4-flash-free |
| **NO PRICE CARD** | **4,197** | **571,773,459** | **gemini-3.7-flash-high** |
| priced $0 (correct) | 3,114 | 439,811,836 | poolside/laguna-s-2.1:free |
| priced $0 (correct) | 3,087 | 191,253,475 | big-pickle |
| priced $0 (correct) | 2,563 | 274,714,869 | stealth/ox-alpha |
| priced $0 (correct) | 1,164 | 110,955,677 | x-preview-f-free |
| priced $0 (correct) | 980 | 124,755,992 | longcat-2.0-free |
| priced $0 (correct) | 865 | 179,652,157 | ox-alpha-free |
| priced $0 (correct) | 391 | 64,286,676 | stealth/ox-alpha |
| priced $0 (correct) | 201 | 13,160,451 | longcat-2.5-preview-free |
| **NO PRICE CARD** | **162** | **38,344,238** | **agnes-2.5-flash** |
| priced $0 (correct) | 10 | 5,423,011 | cline-free/muse-spark-1.3-contributor |

- `cost = 0` and the spend is **really** free: **66,368 requests**
- `cost = 0` and the spend is **genuinely unknown**: **4,359 requests** (`gemini-3.7-flash-high`
  4,197 + `agnes-2.5-flash` 162)

`unpricedRequests` reports 0 for both populations.

## Consequence

A user running the panel today sees `$0` beside `gemini-3.7-flash-high`, whose 4,197 requests
and 572M tokens were never priced. That is exactly what CONTEXT.md forbids:

> **Unpriced request:** *A request whose recorded cost is zero because the price could not be
> determined — not because nothing was spent. … **Not to be confused with:** free request.
> Nothing here is free; some of it is merely unmeasured.*

The panel is faithful to its payload; the payload is wrong. `costWithUnpriced` is implemented
correctly and would print `N/A` if `unpricedRequests` were non-zero.

## Why the ADR-0006 footer does not cover this

The dirty-hour count is **0** — the rollup is fresh. Fresh-but-wrong is not staleness, so the
staleness footer correctly stays silent. There is currently **no** signal on screen that would
tell the user 4,359 requests went unpriced.

## The fix (upstream — cannot be applied from here)

`~/.bun/install/global/node_modules/@oh-my-pi/` is read-only for this project, so the fix
belongs in the package. Two lines:

1. **`db.ts` ingest** — set `cost_unpriced = 1` when `getCatalogCost()` returns `null` *and*
   the request carries tokens. The current code deliberately does not.
2. **`db.ts:54 unpricedRequestSql`** — add the no-card case to the predicate, so rows written
   before the backfill are counted too.

A backfill for existing rows is needed, in the same spirit as the existing
`messages_cost_unpriced_v1` meta key (`value: complete`).

Verification once fixed: the package predicate must return **4,359**, and the panel must render
`N/A · 4,359 unpriced` beside `gemini-3.7-flash-high` while continuing to render `$0` beside
`space-bunny-free`.

## Interim mitigation available to the panel

If the package cannot be changed now, the panel can compute the honest count itself at the data
seam (`src/data/api.ts`), where `@oh-my-pi/pi-catalog`'s `models.json` is reachable: a model
with tokens and `cost_total = 0` and **no catalog card** is unpriced, regardless of
`cost_unpriced`. That keeps the distinction CONTEXT.md requires, at the seam that owns data
truth, rather than in a screen. It is a workaround for an upstream bug and should be removed
when the package is fixed.

Note `getCatalogCost` is **not exported** from the package, so this mitigation reads
`@oh-my-pi/pi-catalog`'s `models.json` directly rather than reusing the package's own lookup —
which is itself a reason to fix upstream instead.