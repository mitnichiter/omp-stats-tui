# F16 — First-query latency: where the 866 ms goes, and whether it can be warmed away

> Angle: the panel's first data query costs ~866 ms of **synchronous** `bun:sqlite` work on the thread that
> paints it. `initDb()` is `async` but contains no real await before the expensive part, so the event loop is
> blocked for the whole duration. The web dashboard never feels this because it blocks a socket, not a render
> loop. Everything below is measured on this machine (Bun 1.4.2, omp 18.4.10, darwin-arm64) unless stated.

## Measurements

### Reproduction, in a fresh process, against a redirected `HOME`

`HOME` is the DB redirect knob, so the real database can be measured without writing to it.

| Run | `import` | `initDb()` | first read | `handleApi` import | first `/api/stats/overview` |
|---|---|---|---|---|---|
| fresh, no idle | 92.2 ms | **880.0 ms** | 0.381 ms | 7.3 ms | 1.8 ms |
| earlier measurement (AGENTS.md) | — | 866.9 ms | — | — | — |

The 866.9 ms figure reproduces. After `initDb()`, everything downstream is **0.4–1.8 ms**. The cost is
entirely one-time-per-process setup, not query cost.

### Where the 866 ms goes

The DDL block is a **no-op on a steady-state database**. Replaying `initDb()`'s schema phase
(`CREATE TABLE IF NOT EXISTS` × many, `PRAGMA table_info` × 3, the backfill sentinel reads,
`ensureRollupSchema`) against a copy totals **3.4 ms** end to end:

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

`ensureRollupSchema` (`rollup.ts:180`) returns immediately when `ROLLUP_VERSION` and `TRIGGER_VERSION` both
match — its own comment says so: *"Steady state touches no schema: DDL on every open would contend with
other omp processes writing the same database."* So **the schema is not what is worth optimising.**

The cost is in the two backfills that have **no sentinel guard**, measured directly:

| Statement (db.ts) | Cost | Rows |
|---|---|---|
| `backfillMissingCatalogCosts` — `SELECT … WHERE cost_total = 0 AND total_tokens > 0` | **837.0 ms** | 69,614 |
| `backfillNoCacheInputCosts` — `SELECT … WHERE cost_no_cache_input IS NULL` | 17.1 ms | 0 |
| `backfillAgentType` — `SELECT DISTINCT session_file FROM messages` | 194.9 ms | 4,212 |
| db.ts:260 unconditional `UPDATE … WHERE premium_requests IS NULL` (scan+count) | 0.1 ms | 0 |

**837 ms of the ~860 ms is one function.** `backfillMissingCatalogCosts` (`db.ts:493`) is the only one of
the ten that neither checks a `meta` sentinel nor short-circuits: it unconditionally scans, then runs an
`UPDATE … WHERE id = ?` per qualifying row inside a transaction. It is 97% of the cost.

This is a latent upstream bug, not an inherent property of the database:

- The rows it finds are the **unpriced requests** — the ones CONTEXT.md defines as *unknown spend, not
  free*. They have `cost_total = 0` because the price could not be determined. Repricing cannot fix them,
  so **they satisfy the predicate forever and the scan re-runs on every single `initDb()`, in every
  process, forever.**
- `WHERE cost_total = 0 AND total_tokens > 0` is unindexed. There is no index on `cost_total`.
- Proof of the index remedy, measured on a copy:

```
BEFORE any index:
  scan: 838.0 ms (69614 rows)
  CREATE INDEX: 71.0 ms
  indexed scan: 2.7 ms (69614 rows)
```

**An index turns 838 ms into 2.7 ms.** That is a one-line upstream fix worth reporting, but it does not
help *this* project, because it requires writing DDL to the user's database — see Options.

### The cost is per-PROCESS, not per-database

```
run 1: initDb = 846.6 ms
run 2: initDb = 0.0 ms
run 3: initDb = 0.0 ms
```

Runs 2 and 3 hit the `if (db) return db` guard at `db.ts:116`, where `db` is a **module-level singleton**.
So the 846 ms is paid **once per omp process**, by whichever code path happens to call `initDb()` first —
and never again in that session. This is what makes the problem tractable: the panel is not paying 846 ms
per query, it is paying it once, at the worst possible moment.

### Read-only handle

```
readonly cold open:        1.185 ms
first read (rollup):       6.323 ms
COUNT(*) messages:         1.113 ms  (185,565 rows)
the killer scan, read-only: 25.8 ms  (69,614 rows)
```

A read-only open is **1.2 ms** and the first read is single-digit ms. This confirms ADR 0001's measured
0.1 ms claim on the same order of magnitude, and it is ~700× cheaper than the read-write path. Note the
same scan is 25.8 ms read-only versus 838 ms read-write — the difference is the 69,614 `UPDATE` statements,
which a read-only handle cannot perform at all.

## Read-only handle: what it costs us

The blocker is not cost, it is that **the rollup query layer has no seam to inject a handle**:

- `rollup.ts` obtains its database exclusively from `currentDb()` (imported from `db.ts`) — five call
  sites at `rollup.ts:307, 322, 507, 515, 855`. There is no parameter, no setter, no override.
- `currentDb()` returns `null` until `initDb()` has run, and `getRollupStatus()` returns
  `{dirtyHours: 0, dirtySessions: 0}` in that state — the exact silent-empty trap our `DbReadiness` union
  exists to catch.
- Every aggregate we use (`getDashboardStats`, `getOverviewStats`, `getModelDashboardStats`,
  `getRollupStatus`, the range queries) is backed by that layer.

So a read-only handle is only reachable by **writing our own SQL** — precisely Option 2 in ADR 0001, which
that ADR rejected on grounds of owning the rollup union, the >96-dirty-hour staleness rule, the ~20-column
aggregate list mixing `SUM()` for counts with `TOTAL()` for money, and a mandatory schema-version
assertion.

What a read-only handle genuinely **cannot** do, and would cost us:

1. **The unpriced backfill** — 69,614 `UPDATE`s. This is exactly the work we do *not* want: it is the
   write-intent ADR 0001 was chosen to avoid. A read-only panel skips it, which is a feature, not a bug.
2. **`ensureRollupSchema` on a `ROLLUP_VERSION` bump** — `rollup.ts:190-194` `DROP TABLE`s and rebuilds
   all five rollup tables. A read-only handle cannot do this. It is safe *only* because the version is
   unchanged; after a host upgrade the panel must detect the bump and refuse rather than read stale rows.
   That is the schema-version assertion ADR 0001 already called mandatory.
3. **The db.ts:260 unconditional `UPDATE`** — also a write (measured cheap at 0.1 ms, but still a write).

In exchange: we would own the rollup union, the staleness rule, and the aggregate column list forever.

## Out-of-band warming: does it work, and in which process

**It only works in the same process, and only if it actually runs to completion.**

The `db` handle is a module-level singleton (`db.ts:80`), so a warm must land in the **same module
instance** — i.e. the same process, same thread. Measured both ways:

```
worker initDb: 941.8 ms
MAIN thread initDb AFTER a 3s worker warm: 53.6 ms
```

The worker paid its **own** 941.8 ms. The main thread then paid 53.6 ms — but that is *not* the warm being
shared. The idle-only control shows the same thing:

| idle before first query | `initDb()` |
|---|---|
| 0 ms | 880.0 ms |
| 2,000 ms | 54.0 ms |
| 10,000 ms | 112.8 ms |

**53.6 ms vs 54.0 ms — the worker's warm contributed nothing.** The main thread's 53 ms is entirely the
idle/page-cache effect, not a shared handle. A Worker has its own module registry, so warming there is
useless for our purposes. Warm-up must be in-process.

The idle effect itself is real but small and unreliable: 880 → 54 ms after 2 s, but **112 ms** after 10 s.
It is page-cache warming plus variance, not a steady state, and it does not reach zero. So "just wait a
bit" reduces but does not solve the freeze.

Timing at extension load is therefore attractive: if we `await initDb()` in a deferred callback during
startup, the 880 ms lands while the user is still typing their prompt, and the later query is ~1 ms. The
risks are bounded and measurable:

- **stdout is never touched** (stderr only), so it cannot corrupt the TUI.
- A `setTimeout(0)` at load yields first, so it does not extend load latency.
- The cost is 880 ms of a blocked event loop at startup — but startup is *already* blocked by omp's own
  92 ms module import and whatever else it does, and the user cannot interact with the TUI yet.
- The cost is **per omp process**, not per query, so a session that never opens `/stats-tui` pays it for
  nothing. That is the real price of the warm-at-load option.

## What first-party does

**`grep -rn "initDb" pi-coding-agent/src` returns zero results.** pi-coding-agent never calls `initDb()` —
not on any thread.

How it reaches this data instead:

- `/usage`'s daily-activity heatmap runs `syncAllSessions` + `getDailyActivity` in a **subprocess**
  (`src/stats/activity-worker.ts` imports both from `@oh-my-pi/omp-stats`), spawned via
  `src/stats/activity-client.ts`'s `createStatsActivitySubprocess`, streamed as NDJSON, and `SIGKILL`ed
  on close. Its doc comment states the reason plainly: per-file writes are transactional and the OS-owned
  sync lock is released with the process.
- The stats **dashboard** path imports `startServer` (`slash-commands/builtin-collaboration.ts:215`,
  `command-controller.ts:194`) — i.e. first-party's own answer to the same problem is to **bind a socket**,
  where a 866 ms block costs nothing, exactly as the problem statement says.

So first-party has two answers, and **neither is "call `initDb()` on the TUI thread"**. That is a strong
signal. The panel is the first thing in this codebase that would want to do it, and doing so would be the
novel choice, not the safe one.

## Options

### Option A — warm at extension load, in-process (recommended)

Kick off `initDb()` from a deferred callback at extension load; the 880 ms lands during startup, the
first user query is ~1 ms.

- **Costs:** 880 ms of blocked event loop per omp process, including sessions that never open `/stats-tui`.
  One `console.error` warning if it fails.
- **Breaks:** nothing. No ADR change, no plan change beyond a Task 11 note. `fetchRollupStatus()` and the
  `DbReadiness` union become *correct as written* rather than merely defensive, because the DB is open.
- **Also fixes:** the silent-empty trap becomes structurally impossible rather than detected.

### Option B — warm in a Worker / subprocess

**Measured not to work** for the first query (53.6 ms vs a 54.0 ms idle control — no shared handle).
Useless here; would only make sense if the child also served the data, which is Option D.

### Option C — read-only handle, own the SQL (reverses ADR 0001)

1.2 ms open, and skips the 837 ms backfill entirely.

- **Costs:** the rollup union, the >96-dirty-hour staleness rule, the ~20-column aggregate list mixing
  `SUM()`/`TOTAL()`, and a mandatory schema-version assertion — all owned forever. ~150–250 lines.
- **Breaks:** ADR 0001 outright. Also cannot survive a `ROLLUP_VERSION` bump without new detection code,
  and the panel would need to re-derive the unpriced-request rules CONTEXT.md depends on.
- **Verdict:** the 880 ms is a **worthless** thing to reverse a settled ADR for. The freeze is
  cosmetic-severity (a quarter-second on first open, once per session); the cost of owning SQL is
  permanent and correctness-bearing. Rejected.

### Option D — serve data from a subprocess (first-party's pattern)

Correct and precedented, but it only pays if the child holds the DB *and* answers queries — which means
Task 12's ingest subprocess grows a query protocol. It moves the freeze off the TUI thread entirely at the
cost of an IPC hop per screen load.

- **Costs:** a persistent child process, a request/response protocol, `SIGKILL` lifecycle handling.
- **Verdict:** strictly better on latency, much worse on complexity. Premature while Option A makes the
  query ~1 ms anyway.

### Option E — report the missing index upstream

One line, upstream: `CREATE INDEX ... ON messages(cost_total, total_tokens)`. Measured **838 ms → 2.7 ms**.

- **Costs:** nothing locally. Fixes the cost for every omp user and for first-party, permanently.
- **Breaks:** nothing. Strictly additive; we do not depend on it.
- **Verdict:** do this regardless of which option we pick. It does not remove the need for Option A on
  unfixed hosts, but it is the correct thing to hand upstream.

## Recommendation

**Option A — warm at extension load, in-process — plus Option E — report the index upstream.**

Option A costs one 880 ms block per omp process, at a moment when the TUI is not yet interactive, and
makes the first user query ~1 ms. It requires no ADR change and no plan change, and it converts our
`DbReadiness` detect-and-throw from a load-bearing correctness mechanism into a cheap assertion.

Pair it with **keeping** the `DbReadiness` union and the `fetchRollupStatus()` throw. If the warm fails —
a locked database, a read-only filesystem, a `ROLLUP_VERSION` bump mid-startup — the panel must still
refuse to claim freshness it cannot verify, rather than rendering zeros. That is the one failure mode the
warm cannot cover, and it is the failure that lies to the user about money.

Two things the plan should record:

1. **Task 11 must call the warm at load, not at first query.** The measured 880 ms is per-process, so a
   deferred load-time call spends it once and invisibly; anything lazy spends it at the worst moment.
2. **The 837 ms is an upstream bug, not an inherent cost.** `backfillMissingCatalogCosts` re-scans and
   re-writes the same 69,614 permanently-unpriceable rows on every `initDb()` in every process. It is the
   single most valuable thing found in this investigation, and it is worth a report with the numbers above.

## Gaps

- **Not established:** whether an omp extension's load phase is *reliably* long enough to hide 880 ms
  without the user noticing. Measured here only as "it works if you do it"; the perceived cost on a real
  cold start was not measured on a real terminal.
- **Not established:** whether a concurrent writer changes the 880 ms. All numbers are warm-page-cache on
  an otherwise idle database. AGENTS.md notes a read-only reader is safe against a concurrent
  `BEGIN IMMEDIATE`, but the write-heavy backfill under contention was not measured.
- **Not established:** what the cost is on a *small* database. 69,614 rows is this machine's history; a
  fresh install would see far less, and the freeze may be much smaller or absent. The panel's behaviour
  should not assume the large case.
- **Not established:** whether `omp` itself ever calls `initDb()` in some path outside
  pi-coding-agent (e.g. inside omp-stats' own server startup when the user opens the dashboard). If it
  does, our warm may find the DB already open — harmless, but it would mean the freeze sometimes does not
  occur at all.
- **Not measured:** the 194.9 ms `backfillAgentType` scan in the same process. It is sentinel-guarded and
  did not appear in the 880 ms total, so it is evidently already settled on this database — but on a
  database whose `agent_type_v1` sentinel is still `PENDING` it would add ~195 ms to the same freeze.
- **Not established:** whether the reported upstream fix would actually be accepted, or whether
  `backfillMissingCatalogCosts` is deliberate. The comment at `db.ts:513-517` explains the
  `timeBased` skip in detail, so the author reasoned about these rows — but not about the cost of
  re-reading them on every process start.
- **Verification caveat:** the real `~/.omp/stats.db` grew during this session
  (322,715,648 → 322,981,888 bytes). That was **not** this investigation: `lsof` attributes the open
  handle to PID 83263, `bun …/bin/omp`, the live host session, running since Oct 2. Every write-capable
  command here targeted `/tmp/f16/*.db` copies, and the only access to the real file was `cp` (read) and
  `{ readonly: true }` handles. All `/tmp` scratch has been deleted.