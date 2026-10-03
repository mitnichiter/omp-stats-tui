# HANDOFF — the IR-to-terminal renderer

Reader: a competent agent with NO prior context who must finish this workstream.
Read this file, then `git log --oneline -12`, then the files in §1. Do NOT ask
for context; everything below is the context.

---

## 1. Where the work stands

EVERYTHING below is DONE, committed, and green (`bun test`: 545 pass / 0 fail /
32 files; `bunx tsc --noEmit` clean; `omp models -e src/index.ts` zero bytes on
stderr).

| Unit | File(s) | Commit | State |
|---|---|---|---|
| Pin bump | `src/index.ts` (one line: `PINNED = "18.5.0"`) | `1428150` | DONE |
| A. resolve | `src/layout/resolve.ts`, `test/resolve.test.ts` (29 tests), `test/fixtures/panel.ts` | `aeda01e` | DONE |
| B. render | `src/tui/render/screen.ts`, `test/render-screen.test.ts` (19 tests) | `e6cf838` | DONE |
| D1–D4 defects | `src/tui/band.ts` (stacked tiles, 1-glyph swatch), `src/tui/render/screen.ts` (chartShares publish/adopt, `renderSeriesChart`, widened axes), `test/stat-tile.test.ts` (13 tests) | `ce8faec` | DONE |
| Parity (host functions) | `src/layout/resolve.ts` (`count` via `groupErrorsBySignature` / `modelKey`), `test/parity.test.ts` fixture typing | `7818788` + `445c934` (peer) | DONE |
| C. tab strip | `src/tui/frame.ts`, `src/tui/panel-constants.ts`, panel-side wiring; `src/tui/tabs.ts` EXISTED at `18b75d6` and was imported, NOT rewritten | `454bc3c` | DONE |
| D. footer | `src/tui/footer.ts` (`hintsFor`, `footerHints`); contracts pinned in `test/tab-strip.test.ts` | `454bc3c` | DONE |
| E. panel rewire | `src/tui/panel.ts`: `LOCAL_BODIES` and `LOCAL_NEEDS` DELETED; body via `renderScreen`; `SELECTABLE_SCREENS` spec-driven | `454bc3c` | DONE |
| Sparkline densification | `src/layout/resolve.ts` axis param (peer, commit `06faba6`); screen-side axis helper + wiring (`bucketAxisFor`, `axisFor`) | `9e6de73` | DONE |
| probe-render | `scripts/probe-render.ts` drives `renderScreen` over every non-deferred spec; RENDER-OUTPUT section 9 at widths 100 + 60 | `8488a59` + `9e6de73` | DONE |

**The remaining work is SMALL and is itemised in §7.** It is polish, not
architecture: one contested keymap rule, one dead helper candidate, and cosmetic
cleanup other agents flagged. Nothing in §7 changes the design.

Two files arrived from sibling agents WHILE this landed and are already
integrated: `src/tui/charts/compose.ts` (commit `284723a`, the multi-series
compositor — `renderSeriesChart` calls `renderDailyBars` once per series and
`test/chart-primitives.test.ts` asserts byte-equality against the primitive) and
`docs/research/omp-stats-tui/F24-web-parity.md` (commit `6f43fef`).

---

## 2. Defect ledger: D1–D4 and the two later findings

All four were found by LOOKING at rendered output and are pinned in
`test/stat-tile.test.ts`:

- **D1 (stat tiles jammed: `API-equivalent cost$112.36`) — FIXED.** F23's
  `label.padEnd(LABEL_WIDTH) + value` fails when the label (18 chars) exceeds the
  pad (12). Tiles are now STACKED, the web's `Stat.tsx` shape: label row, value
  row, hint row, sparkline row. Same fix also implemented the long-declared but
  never-drawn `spark`, via `BandRenderOptions.sparkline` injected (NOT imported)
  so the band layer never depends on the chart layer.
- **D2 (two values in one cell: `Requests 65,460 1,315`) — FIXED.** It was the
  `hint` running inline beside the value. It has its own row now, and the test
  asserts one figure per cell.
- **D3 (identical unlabelled chart blocks) — FIXED.** Each series is rendered by
  `renderSeriesChart` (see `compose.ts` note below), labelled and tinted from its
  own `seriesColorFor` hue.
- **D4 (legend 94.5% vs share bar 94.6% for one quantity) — FIXED.** Two
  denominators: the bar summed its plotted entries, the legend divided by every
  item on its band, and Overview's legend names four token kinds PLUS three
  agent rows the IR points at the same `overall.totalRequests`, so 196,380
  requests leaked into a token denominator. A `shareBar` chart now PUBLISHES its
  shares by metric identity (`chartShares`) as `screenBands` walks the bands in
  order, and the legend ADOPTS them (`publishedShares`); only an item no chart
  published falls back to its own metric group. The swatch is also one glyph
  (`band.ts`), not two.
- **X-axis was an array index — FIXED.** `bucketedValues` built its axis from
  `bucketAxis(range, …)` (31 buckets for `30d`) and `renderDailyBars` stretched
  them to the panel width by re-bucketing on array index: a wall of identical
  full-height bars. The axis is now EXACTLY `innerWidth` buckets, same host
  alignment rule, widened rather than stretched; a gap bucket is a real zero.
- **Sparkline skipped idle buckets (`[5, 7]` vs the web's `[5, 0, 7]`) — FIXED.**
  `resolveSeriesValues` takes an optional axis (`SeriesAxisOptions`, peer commit
  `06faba6`) and densifies against it; `screen.ts` threads one axis into every
  sparkline. No-axis callers keep the old sparse behaviour.

---

## 3. The resolver semantics the tests forced out

In `src/layout/resolve.ts`, pinned by `test/resolve.test.ts`:

1. **`AggregateRef` does not insist on a number.** The IR names text fields
   with it (`recentMessages.model`) while `label` names the same idea elsewhere;
   answering `null` for a field that holds a model name painted a blank cell for
   a value it had. Only `resolveNumber` narrows to numbers.
2. **`sum` sums ACROSS rows.** Its base is an `AggregateRef` that reads only the
   FIRST row — resolving the base directly answered "total cost across every
   model" with the first model's cost.
3. **`sum`, `count` and `max` over an UNFETCHED source are ABSENT (`null`), not
   zero.** "Models used 0" and "Average per day $0" are claims about a database
   nobody queried; only `isFetched` tells that apart from a measured empty.
   `count` answering zero is how you say a measured empty. ("Fetched but empty"
   is guarded separately by the fixture split in `test/fixtures/panel.ts`:
   `emptyData()` = nothing fetched, `blankData()` = fetched, came back empty.)
4. **`count` uses the HOST's notion of distinctness.** `errorMessages.errorMessage`
   counts via `groupErrorsBySignature` (two failures differing only by request id
   are one failure); `errorMessages.model` counts `model::provider` via `modelKey`.
   A numeric base counts ROWS (a total is not a distinctness question).
5. **`conversationTokens` is named, not derived.** Its `of`/`against` name two
   token fields but the fixture's database is 95.5% cache reads, so the name
   resolves to input + cacheRead + cacheWrite + output per the IR's own header
   comment.
6. **`sharedDenominator(source, items, data)` sums only items that READ `source`.**
   A legend mixing sources contributes nothing from the foreign one rather than
   dragging an unrelated total into the denominator.

`metricNeed` delegates to `NEED_BY_SOURCE` (the IR's table, never restated); `null`
is `providerStats`, which is why that screen is `deferred` and the deferred
screen always states its reason rather than rendering "No usage recorded".

---

## 4. The two host-facts, and the test-first rule

1. **Cost series is day-bucketed for EVERY range** (`CostsRoute.tsx:201`, where the
   dashboard passes `DAY_MS` explicitly). `bucketedValues` uses `COST_BUCKET_MS`
   for `costSeries` and never derives a bucket width from `rangeMeta` for it.
   Deriving from the range puts hourly buckets under midnight-aligned rows for
   `24h` and the chart is silently empty.
2. **Every renderer fix in this workstream was written tests-first in
   `test/stat-tile.test.ts` and watched fail.** The next defect class is named
   there by pattern: `██` doubled swatches, `/\d+\.\d+%/` parity between a bar and
   its legend, one `/\d[$%MB]/` figure per tile cell. Use `src/tui/charts/compose.ts`
   for multi-series composition — it exists now and is asserted byte-equal
   against the primitive. Do NOT write another multi-series path.

---

## 5. What NOT to do

- **No new multi-series geometry.** `compose.ts` exists. A second encoding is how
  this chart broke four times in one session.
- **No hex literals, no colour names as strings outside `PALETTE`,
  no glyph literals outside `glyphs.ts`/`STATS_ICONS`/`TAB_SHORT`.**
  `test/render-screen.test.ts` asserts all three against the source.
- **No dynamic `import()` of ANY `@oh-me-pi/*`.** The extension loader's resolve
  hook rewrites STATIC specifiers only; a dynamic import fails at extension load.
  Asserted structurally against the renderer's source.
- **Never `git checkout -- src test` across the tree.** Other agents are live in
  it. Scope every revert to the file the tool actually touched. This cost the
  workstream a morning once already.
- **Do NOT touch `src/layout/spec.ts` without asking.** A sibling workstream owns
  the IR. `src/layout/resolve.ts` is the renderer's seam and is safe to touch.
- **Do NOT rewrite `src/tui/tabs.ts`.** It was committed by another agent at
  `18b75d6` and is imported as-is. The panel consumes `buildTabs`,
  `tabBarTheme`, `TAB_SHORT`, `TAB_BAR_INDENT` from it.
- **The old registry (`src/tui/screens/*`) is DEAD to the panel but NOT deleted.**
  The panel renders exclusively through the IR now. Deleting twelve modules plus
  their tests is a separate, destructive change — do it as its own commit with the
  sibling agents' agreement, not as a drive-by.

---

## 6. Verification recipe

```sh
bun test                      # full green: currently 545 pass / 0 fail / 32 files
bunx tsc --noEmit             # clean: zero errors (includes probe + fixtures)
omp models -e src/index.ts    # zero bytes on stderr; a version-pin warning means PINNED drifted
```

Plus, after any renderer change:

```sh
bun scripts/probe-render.ts all --width 100 --width 60 --range 30d 2>&1 \
  | sed -e 's/\x1b\[[0-9;]*m//g'
```

Judge it by: zero `OVER WIDE` lines; stat grids read label / value / hint /
sparkline stacked with no jammed pairs; every multi-series chart has one label
per block; every legend percentage matches the bar directly above it; "No usage
recorded in this range." is the only thing an empty payload says. Append a NEW
numbered section to `docs/research/omp-stats-tui/RENDER-OUTPUT.txt` (current
tail is section 9) rather than editing the old captures — they are history.

---

## 7. What is actually left (small, itemised, in priority order)

1. **Decide `tab`'s fate (keymap, one focused choice).** The brief said `tab`
   falls through to next-screen only when `bands ≤ 1`, mirroring `/settings`.
   Implemented literally, `tab` is UNOWNED on all eight current specs because
   every one has ≥ 2 bands — no landmarks exist to jump between, no jump is
   implemented, and panel.ts currently has no `landmark` action at all. Three
   honest options: (a) wire `tab` to scroll to the next band heading (the
   `bandLandmarks` arithmetic is recoverable from `screenBands` single-band
   renders); (b) keep `tab` switching screens everywhere (F23's own key table, §1.4,
   lists that) and close the brief's rule as contradicted by its own table;
   (c) keep it unowned. Whatever is chosen, encode it in `panelAction`'s second
   parameter and its tests — do NOT leave it ambiguous.
2. **`isFetched` for `count` on a ROW-sliced aggregate.** `test/resolve.test.ts`
   line ~89 notes it: a `count` where `row !== undefined` short-circuits to 1.
   That is correct for every table in the IR today and the test pins it; only
   revisit if a table ever needs a count column against a row slice.
3. **Cosmetic cleanup other agents flagged (take or explicitly decline):**
   - `test-audit` wants the dead `src/tui/screens/*` registry deleted as its own
     commit (§5). Say when and they will coordinate.
   - `test-audit`'s G5/G6 tests (`test/panel.test.ts`) iterate every selectable
     screen counting `├───┤` dividers and `[─━═]{3,}` runs — they pass now and
     are the tripwire against any reintroduced rule.
   - `parity-audit`'s F24 (`docs/research/omp-stats-tui/F24-web-parity.md`) lists
     the one remaining open divergence; `Max`/`avgDailyCost` (resolve.ts) reads
     "average per day" but computes a peak — the IR's `against: dirtyHours`
     cannot mean what it says, and someone has to decide whether the tile or the
     ref is wrong.
   - `compose.ts`'s axis is derived from the DATA while `screen.ts` builds a
     width-aligned axis for the same series; the two agree today only because
     `renderSeriesChart` re-buckets what it is given. If silences diverge, the
     axis builder in `screen.ts` (`bucketAxisFor`) is the one to move into
     `resolve.ts` so both call sites share it.
   - `row-scoped` `MAX`/`count` divergences in resolve.ts's `RowSource` helper
     and `test/resolve.test.ts`'s `rows` noise are pre-existing rough edges, not
     regressions; leave them unless a table demands a count column.
