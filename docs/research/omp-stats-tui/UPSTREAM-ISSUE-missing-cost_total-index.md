# `initDb()` costs ~850 ms per process on an established database — `backfillMissingCatalogCosts` rescans permanently-unpriceable rows on every start

**Not filed — draft for human review.** See "Notes for the submitter" at the bottom.

## Summary

`initDb()` in `omp-stats/src/db.ts:115` takes ~850 ms on a mature `stats.db` (~305 MB, ~186k rows in
`messages`). 97% of that is a single function, `backfillMissingCatalogCosts` (`db.ts:493`), which
unconditionally scans `messages` for `cost_total = 0 AND total_tokens > 0` and then issues one
`UPDATE` per matching row inside a transaction. It has no `meta` sentinel and no short-circuit, unlike the
nine other backfills in the same block, so it re-runs the scan and the writes **on every process start,
forever**. Because `bun:sqlite` is synchronous, this blocks the calling thread for the full duration —
which matters for any consumer that would run it on a UI thread. The rows it can match are precisely the
ones that can never be priced, so the predicate is permanently true and the set never shrinks.

## Measurements

Measured with Bun 1.4.2 on macOS darwin-arm64 against a copy of a real `~/.omp/stats.db`, so nothing below
touches a live database.

**Per-statement breakdown of `initDb()` (one fresh process):**

| Statement | Cost |
|---|---|
| `backfillMissingCatalogCosts` — `SELECT … WHERE cost_total = 0 AND total_tokens > 0` | **837.0 ms** |
| `backfillNoCacheInputCosts` — `SELECT … WHERE cost_no_cache_input IS NULL` | 17.1 ms |
| `backfillAgentType` — `SELECT DISTINCT session_file FROM messages` (sentinel-guarded, so not in the total below) | 194.9 ms |
| db.ts:260 unconditional `UPDATE … WHERE premium_requests IS NULL` | 0.1 ms |

**The schema is not the cause.** Replaying the whole schema phase — the `CREATE TABLE IF NOT EXISTS`
block, three `PRAGMA table_info` calls, the backfill sentinel reads, and `ensureRollupSchema` — against a
copy totals **3.4 ms**:

```
       1.4 ms  new Database()
       0.8 ms  PRAGMA journal_mode=WAL
       0.0 ms  CREATE TABLE IF NOT EXISTS block
       0.0 ms  PRAGMA table_info x2
       0.0 ms  UPDATE messages SET premium_requests=0 WHERE IS NULL
       0.2 ms  INSERT OR IGNORE meta sentinel
       0.0 ms  backfill sentinel reads (12 rows)
       0.0 ms  ensureRollupSchema CREATE TABLEs
       0.9 ms  first COUNT(*) read on message_rollup
       3.4 ms  TOTAL
```

`ensureRollupSchema` (`rollup.ts:180`) correctly returns early when `ROLLUP_VERSION` and `TRIGGER_VERSION`
both match, so steady-state DDL is already a no-op.

**The scan is unindexed, and an index fixes it:**

```
scan:          838.0 ms (69,614 rows)
CREATE INDEX:   71.0 ms
indexed scan:    2.7 ms (69,614 rows)
```

**The cost is per-process, not per-database.** `db` is a module-level singleton and `initDb()` short-circuits
on `if (db) return db` (`db.ts:116`):

```
run 1: initDb = 846.6 ms
run 2: initDb = 0.0 ms
run 3: initDb = 0.0 ms
```

So a single process pays it once — but every new process pays it again, on every launch.

## Why the rows can never be fixed

This is the part that makes it a bug rather than an unlucky dataset.

The matched rows are **unpriced requests**: requests whose recorded `cost_total` is `0` because the price
could not be determined, not because nothing was spent. In the measured database, `messages` held ~186k
rows, of which **~70k matched the predicate across 15 distinct provider/model pairs** (the count drifts
upward as the database is used — it was 69,614 when first measured and 69,788 later in the same
session).

The backfill can only fix a row by looking up its price in the model catalogue via `getCatalogCost` /
`calculateCatalogCost`. For a request that was ingested without a resolvable price — no catalogue entry, or
a scheduled/time-based model the code deliberately skips (`db.ts:513-517`, the `timeBased` early-continue)
— the lookup returns nothing, `cost` is `null` or `total === 0`, and the loop `continue`s **without
updating the row** (`db.ts:531-532`). The row therefore keeps `cost_total = 0`, keeps matching the
predicate, and is re-fetched and re-priced on the next process start. This is true indefinitely: nothing
in `initDb()` can move these rows out of the result set.

The contrast with the other backfills is the point. `backfillUserMessages`, `backfillToolCalls`,
`backfillReingestCosts`, `backfillUnpricedCosts`, `repairUserMessageLinks`, `backfillPriorityPremiumRequests`,
`backfillAgentType` and `backfillForkDuplicates` all begin with a `meta` sentinel check
(`shouldResetBackfill(...)` / `if (row?.value !== BACKFILL_PENDING) return;`) and settle the sentinel when
done, so they cost one indexed lookup on subsequent runs. `backfillMissingCatalogCosts` has no sentinel,
and `backfillNoCacheInputCosts` (`db.ts:540`) has none either — but the latter's predicate
(`cost_no_cache_input IS NULL`) is satisfied by everything on the first run, so it self-resolves after one
pass and costs 17 ms. Only the `cost_total = 0` predicate is permanently true, and it is the only one of
the two without a sentinel.

The practical consequence: the ~70k rows are also *unknown spend*, not free spend. Re-reading and
re-attempting to price them on every launch buys nothing, and a consumer rendering those zeros has to
carry the "unpriced" count separately to avoid presenting unknown spend as free.

## Proposed fix

Two changes; the first is the performance fix, the second stops the repeated work entirely.

**1. Index the predicate** (in the `CREATE TABLE IF NOT EXISTS` block at `db.ts:133-242`, alongside the
other `idx_messages_*` definitions):

```sql
CREATE INDEX IF NOT EXISTS idx_messages_cost_total ON messages(cost_total, total_tokens);
```

Measured: **838.0 ms → 2.7 ms** for the scan, plus ~71 ms once to build the index.

**2. Guard the backfill with a sentinel**, matching the pattern already used by the eight other backfills,
so the scan stops being repeated once it has run:

```ts
// db.ts:493
function backfillMissingCatalogCosts(database: Database): void {
    const row = database
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get(MISSING_CATALOG_COSTS_BACKFILL_KEY) as { value: string } | undefined;
    if (row?.value === BACKFILL_COMPLETE) return;

    const rows = database.prepare(`... WHERE cost_total = 0 AND total_tokens > 0`).all() as CostBackfillRow[];
    if (rows.length === 0) {
        database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
            .run(MISSING_CATALOG_COSTS_BACKFILL_KEY, BACKFILL_COMPLETE);
        return;
    }
    // ... existing pricing loop, then settle the sentinel ...
}
```

Caveats worth weighing on the maintainer's side, since I cannot see the intended behaviour:

- If new unpriced rows are expected to arrive over time from catalogue gaps, a one-shot `COMPLETE`
  sentinel would stop them being re-priced on later starts. `BACKFILL_PENDING` +
  `shouldResetBackfill` semantics, or a versioned key alongside the existing `*_v1` / `*_v2` sentinels,
  would preserve a re-parse path. Either way the index alone already removes the wall-clock cost.
- The index adds write overhead on `messages` ingest and some space on a 305 MB database. The
  alternative of not indexing and only guarding with a sentinel leaves the first, and every subsequent
  fresh-DB, run slow.

## Environment

| | |
|---|---|
| omp | 18.4.10 |
| Bun | 1.4.2 |
| OS | macOS, darwin-arm64 |
| `stats.db` | ~305 MB, ~186k rows in `messages` |
| rows matching the predicate | ~70k across 15 provider/model pairs |
| `initDb()` cold, fresh process | 846.6 ms (860.1 ms on a second measurement) |
| DDL/schema phase alone | 3.4 ms |
| scan after `CREATE INDEX` | 2.7 ms |

Reference: the `busy_timeout` comment at `db.ts:122-123` cites issue #2421, a prior issue about write
contention in this same area — so there is precedent for this kind of report.

## Notes for the submitter

- Not posted anywhere. Review before filing.
- All numbers came from `/tmp` copies opened read-only; the live database was never written to.
- Re-measure before filing if convenient — the matching row count grows with ordinary use, so cite a
  range rather than an exact figure.
- The row counts here are from one personal database. The 850 ms is specific to a database with ~70k
  unpriced rows; a smaller or fully-priced database would show much less.