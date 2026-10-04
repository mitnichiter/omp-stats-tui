# Overview — 60 columns (480px viewport)

**Web route:** `routes/OverviewRoute.tsx` · **IR citation:** `src/layout/spec.ts:346-351`
**Capture:** `screens/overview-60.png` — live, `#/overview?range=24h`, 480px, dark, fullPage. Page height **2232px**.
Structure: see **`overview-150.md`**; width deltas below are all measured live.

## What 480px changes — measured

| Property | At 1200px | **At 480px** |
|---|---|---|
| `.shell-content` width | `942px` | **`462px`** |
| `--gutter` | `22px` | **`16px`** (unchanged from 800) |
| `.sidebar` | 204px docked | `260px` off-canvas, `translateX(-265.2px, 0)` |
| StatGrid A (`min 190`) | `235px ×4` | **`214px ×2`** — 5 tiles → **2 + 2 + 1** |
| StatGrid B (`min 140`) | 6 cols | **`142.656px ×3`** — 8 tiles → **3 + 3 + 2** |
| `.grid-main-side` | 2 cols | **`430px` — ONE column** |
| Activity chart width | `583px` | **`396px`** |
| `.table-wrap` | no overflow | **`scrollWidth 513px` vs `clientWidth 428px` → HORIZONTAL SCROLL APPEARS** |
| `th` padding | `8px 12px 8px 16px` | `8px 12px 8px 16px` — unchanged |
| Card order | Activity (top 613) then Token mix (top 977) at 800 | **Activity top `823`, Token mix top `1187`** — same order |

**The load-bearing event at 480px is the table's horizontal scroll.** `scrollWidth 513px > clientWidth 428px`:
the 6-column Latest-requests table **does not fit and the web scrolls it**, dropping nothing
(`styles.css:1259-1262`). The `.table-wrap` keeps all 6 columns; the reader swipes.

**`--stat-min: 140px` still yields 3 columns at 430px**, because `auto-fit minmax(140px, 1fr)` fits
`floor((430 + 0) / 140) = 3`. And `min: 190px` yields **2** columns, since `floor(430/190) = 2`.

## Page header

```
h1.page-title        "Overview"                                                        OverviewRoute.tsx:98
p.page-description   "Everything omp did across your sessions in the last 24 hours."
(no .page-actions)
```
`.page-header` `flex-wrap: wrap` (`:674`); at 430px the description wraps to 2–3 lines because
`max-width: 72ch` (`styles.css:688`) exceeds the column. Title is still `22px @ 600`.

## Top-level order

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `:98` |
| 2 | StatGrid A — 5 `md` tiles, `min={190}` → **2 cols** | `div.stack[gap:16]` | `:103-142` |
| 3 | StatGrid B — 8 `sm` tiles, `min={140}` → **3 cols** | same stack | `:143-156` |
| 4 | Activity (430px) → Token mix (430px), stacked | `div.grid .grid-main-side` **collapsed** | `:161-246` |
| 5 | "Latest requests" — `flush`, **scrolls horizontally** | full width | `:248-274` |

## Card-by-card

### Card 1 — "Activity"

- Title `:164`, description `"Per hour"` `:165`, `Segmented[sm]` Requests/Tokens/Cost `:166`.
- `TimeChart height={260}` `:176`, **396px wide**. `padLeft = max(28, labelWidth+12)` ≈ 37; `padRight = 8`;
  plot width `396 - 37 - 8 = 351px`. At `24h` there are 24 hourly buckets, so `slotW ≈ 14.6px`,
  `barW = min(56, 14.6 × 0.72) = 10.5px`. **Both bars are ~10px wide with a 2px grouped gap** — at this width the
  web's own bar chart degrades to slivers and still does not change its structure.
- Series: `ok`/`var(--chart-primary)`, `err`/`var(--bad)`, **stacked** (`Chart.tsx:60`). **No legend.**

### Card 2 — "Token mix"

- Title `:182`, description `:182`, **no actions**.
- `div.stack[gap:18]` `:194`; block 1 `stack[gap:10]` `:195` = ShareBar (8px) + Legend (4 items);
  block 2 `stack[gap:10]` `:213` = `section-label "By agent"` + ShareBar (8px) + 2 agent rows.
- ShareBar segments `min-width: 2px`, `gap: 2px` (`styles.css:1777-1781`) — at 390px wide, the cache-read segment
  (~98% of tokens) is ~380px and the three small ones are pinned at their 2px minimum.
- Legend wraps: `.legend { flex-wrap: wrap; gap: 4px 14px }` (`styles.css:1732-1738`) → **2 rows of 2 items**
  at this width, not one row of 4.

### Card 3 — "Latest requests" (`flush`, scrolls)

- Title has `<Dot tone="live" pulse />` `:250-254`; description `:255`; action `a.btn` "All requests" `:257`.
- `dense`, no `limit` → no `.table-more`. 12 rows from `getRecentRequests(12)` `:66`.
- **The table overflows its 428px wrapper and scrolls.** Columns and formatters, unchanged:

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Model` | left | **LabelCell** `primary={row.model} secondary={row.provider}` | — | `:283` |
| 2 | `When` | left | `span.muted` | `formatRelativeTime(row.timestamp)` | `:288` |
| 3 | `Tokens` | **right** | `span.num` | `formatInteger(row.usage.totalTokens)` | `:294` |
| 4 | `Cost` | **right** | `span.num` | `formatMessageCost(row, 4)` | `:300` |
| 5 | `Duration` | **right** | `span.num` | `formatDurationMs(row.duration)` | `:306` |
| 6 | `Status` | **right** | **Badge** `tone="bad"` "Failed" / `tone="ok"` "OK" | — | `:313` |

**Every numeric column is `formatInteger`. No `formatCompact` anywhere in this table.** That is a property of this
route's `REQUEST_COLUMNS`, not a width behaviour.

## Stat rows — formatCompact vs formatInteger

**StatGrid A** (2 columns):

| Tile | value | hint |
|---|---|---|
| API-equivalent cost | `formatEstimatedCost` `:107` | `formatInteger` `:110` |
| Requests | **`formatInteger`** `:118` | `formatInteger` `:119` |
| Conversation tokens | **`formatCompact`** `:125` | **`formatCompact`** `:126` |
| Cache rate | `formatPercent` `:132` | `formatPercent` `:133` |
| Error rate | `formatErrorRate` `:137` | `formatInteger` `:138` |

**StatGrid B** (3 columns) — 1–4 **`formatCompact`** `:144-147`; 5 **`formatInteger`** on 2-dp-rounded `:151`;
6–8 `formatTokensPerSecond` / `formatDurationMs` `:153-155`. No hints → no foot lines.

Sparkline width follows the tile: at 214px tiles with 16px padding, the spark is ~182px — the same 28px height.

## Notable formatter calls, verbatim

```
formatEstimatedCost(overall.totalCost, overall.unpricedRequests)     OverviewRoute.tsx:107
formatCompact(sumConversationTokens(overall))                        OverviewRoute.tsx:125
formatPercent(overall.cacheRate)                                    OverviewRoute.tsx:132
formatErrorRate(overall.errorRate)                                   OverviewRoute.tsx:137
formatMessageCost(row, 4)                                            OverviewRoute.tsx:300
```

## Terminal shape at 60 columns

```
Overview
Everything omp did across your
sessions in the last 24 hours.

  API-equivalent cost  $4.12  ▁▂▃▅▇▅▃
  Requests            3,977     ▁▂▄▆▅
  Conversation tokens 967M      ▁▁▂▄▆
  Cache rate          98.1%
  Error rate          1.4%      ▁▁▁▁

  Uncached input 18M  Cache read 944M  Cache write 0
  Output 5.5M  Premium requests 0  Tokens/s 69.9
  Avg latency 14.0s  Avg TTFT 3.2s

─ Activity ──────────────── Per hour ────────────────
  Succeeded / Failed stacked (the web's bars are ~10px here)
─ Token mix ───────── Where conversation tokens went ──
  ██████▓▒░░░
  ▪ Uncached input 18M  ▪ Cache read 98%
  ▪ Cache write 0%     ▪ Output 1%
  By agent
  ██████▒░░░
  ● Main agent     967M  98.1%

─ Latest requests ──────── Most recent model calls … ──
  Model / When / Tokens / Cost / Duration / Status
     ← all 6 columns kept; the WEB scrolls, it does not drop
```

- At 60 columns the primary stat row is naturally **2 wide**, which is exactly what the web's `min: 190px` produces
  at 430px of content. The primary/secondary split (md vs sm values) is what makes that legible.
- The 8 secondary tiles become **3 + 3 + 2**. Because `auto-fit` stretches the last row's `1fr`, a terminal should
  left-align the short final row rather than distributing the tiles evenly.
