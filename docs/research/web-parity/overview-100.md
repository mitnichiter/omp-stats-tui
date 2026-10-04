# Overview — 100 columns (800px viewport)

**Web route:** `routes/OverviewRoute.tsx` · **IR citation:** `src/layout/spec.ts:346-351`
**Capture:** `screens/overview-100.png` — live, `#/overview?range=24h`, 800px, dark, fullPage. Page height **2000px**.
Full structure is in **`overview-150.md`**; this document records the same facts plus what the width changes.

## What 800px actually changes — all measured live

| Property | At 1200px | **At 800px** | Why |
|---|---|---|---|
| `--gutter` | `22px` | **`16px`** | `styles.css:620-623` — 800 ≤ 900 |
| `.shell-content` width | `942px` | **`782px`** | measured |
| `.sidebar` | `204px`, docked | **`260px`, `translateX(-265.2px, 0)` — off-canvas overlay** | `styles.css:633-644` — 800 ≤ 900 |
| `.topbar-menu` | `display: none` | **`display: flex`** | `styles.css:629-631` |
| `.topbar-hide-narrow` (LiveChip) | visible | **`display: none`** | `styles.css:655-657` |
| **`.grid-main-side`** | `617.328px 308.656px` | **`750px` — ONE column** | `styles.css:716-722` — 800 ≤ 1100 |
| StatGrid A (`min 190`) | `235px ×4` (5 tiles → 4+1) | **`249.328px ×3`** (5 tiles → 3+2) | measured |
| StatGrid B (`min 140`) | 6 columns | **`149.594px ×5`** (8 tiles → 5+3) | measured |
| Activity chart width | `583px` | **`716px`** | measured |
| `.table-wrap` | `940px` scroll = `940px` client | **`748px` scroll = `748px` client — no overflow** | measured |
| `th` padding | `8px 12px 8px 16px` | `8px 12px 8px 16px` — **unchanged** | measured |

**The two things that matter most at this width:**

1. **Activity and Token mix are STACKED, not side by side.** Card tops measured `613px` and `977px` — Activity
   first, Token mix second, each **750px** wide. The `.grid-main-side` 2:1 split **does not exist below 1100px**.
2. **StatGrid A drops to 3 columns.** 5 tiles → rows of 3 + 2. The **last row has 2 tiles that stretch to the full
   750px** (`1fr` with `auto-fit`), so tile 5 is left-aligned and the right half of the row is empty.

## Page header

```
h1.page-title   "Overview"                                                   OverviewRoute.tsx:98
p.page-description "Everything omp did across your sessions in the last 24 hours."
(no .page-actions)
```
`.page-header` is `flex-wrap: wrap` (`styles.css:674`), but at 782px there are no actions to wrap.

## Top-level order (unchanged by width — the web never reorders content)

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `:98` |
| 2 | StatGrid A — 5 `md` tiles, `min={190}` | `div.stack[gap:16]` | `:103-142` |
| 3 | StatGrid B — 8 `sm` tiles, `min={140}` | same stack | `:143-156` |
| 4 | Activity (full width) then Token mix (full width) | `div.grid .grid-main-side` **collapsed** | `:161-246` |
| 5 | Card "Latest requests" — `flush` | full width | `:248-274` |

## Card-by-card

### Card 1 — "Activity" (full width at 800px)

- Title `"Activity"` `:164`; description `"Per hour"` `:165` (from `meta.bucketMs`, `range.ts:27`); actions =
  `Segmented[sm]` Requests/Tokens/Cost `:166`.
- Body: `TimeChart height={260}` `:176` → **716px wide** here, so `slotW = (716 - padLeft - 8) / slots`.
  `padLeft = max(28, labelWidth + 12)` (`Chart.tsx:114`); with `formatCompact` labels ~4 chars, `labelWidth ≈ 25.2`,
  so `padLeft = 37.2`. `barW = min(56, slotW × 0.72)`.
- Series: `ok` = Succeeded / `var(--chart-primary)`, `err` = Failed / `var(--bad)` — **stacked** (`Chart.tsx:60`).
- **No legend on this card** (`:169-179`).

### Card 2 — "Token mix" (full width at 800px)

- Title `:182`, description `"Where conversation tokens went"` `:182`. **No `actions`.**
- Body `div.stack[gap:18]` `:194` → block 1 `div.stack[gap:10]` `:195` (ShareBar + Legend) → block 2
  `div.stack[gap:10]` `:213` (`section-label "By agent"` + ShareBar + 2 agent rows).
- `TOKEN_MIX` colours: input `#5b8cff`, cacheRead `var(--chart-primary)`, cacheWrite `#f5b54a`,
  output `var(--chart-secondary)` — `OverviewRoute.tsx:57-62`.
- ShareBar is `8px` tall, `2px` gap, `min-width: 2px` per segment (`styles.css:1767-1781`).
- Legend: 4 items, `value = formatPercent(mix/total, 0)` — **whole percents** `:209`.

### Card 3 — "Latest requests" (`flush`, full width)

- Title carries `<Dot tone="live" pulse />` `:250-254`; description `:255`; action is a ghost `a.btn` "All requests"
  `:257`.
- `dense` table, no `limit` → no `.table-more`. 12 rows from `getRecentRequests(12)` `:66`.
- Columns — `REQUEST_COLUMNS` `:279-315`:

| # | header | align | cell | formatter, verbatim |
|---|---|---|---|---|
| 1 | `Model` | left | **LabelCell** `primary={row.model} secondary={row.provider}` `:283` | none (strings) |
| 2 | `When` | left | `span.muted` | `formatRelativeTime(row.timestamp)` `:288` |
| 3 | `Tokens` | **right** | `span.num` | `formatInteger(row.usage.totalTokens)` `:294` |
| 4 | `Cost` | **right** | `span.num` | `formatMessageCost(row, 4)` `:300` |
| 5 | `Duration` | **right** | `span.num` | `formatDurationMs(row.duration)` `:306` |
| 6 | `Status` | **right** | **Badge** `tone="bad"` "Failed" / `tone="ok"` "OK" `:313` | none |

**All numeric columns are `formatInteger` here — no `formatCompact` in this table at all.** Contrast with the
Requests route, where Input/Cache read/Output are `formatCompact` (`RequestsRoute.tsx:250`, `260`, `269`).

**At 800px the table still does not overflow** (scroll 748 = client 748) — 6 columns fit. The web's response at
narrower widths is `overflow-x: auto` and a **horizontal scrollbar**, never a dropped column
(`styles.css:1259-1262`; the IR says the same at `spec.ts:236-243`).

## Stat rows — formatCompact vs formatInteger

**StatGrid A** (`min 190`, 3 columns at this width):

| Tile | value formatter | hint formatter |
|---|---|---|
| API-equivalent cost | `formatEstimatedCost` `:107` | `formatInteger` `:110` |
| Requests | **`formatInteger`** `:118` | `formatInteger` `:119` |
| Conversation tokens | **`formatCompact`** `:125` | **`formatCompact`** `:126` |
| Cache rate | `formatPercent` `:132` | `formatPercent` `:133` |
| Error rate | `formatErrorRate` `:137` | `formatInteger` `:138` |

**StatGrid B** (`min 140`, 5 columns at this width) — tiles 1–4 **`formatCompact`** `:144-147`; tile 5
**`formatInteger`** on a 2-dp-rounded value `:151`; tiles 6–8 `formatTokensPerSecond` `:153` and
`formatDurationMs` `:154-155`. No tile has a hint, so no foot line.

## Notable formatter calls, verbatim

```
formatEstimatedCost(overall.totalCost, overall.unpricedRequests)     OverviewRoute.tsx:107
formatCompact(sumConversationTokens(overall))                        OverviewRoute.tsx:125
formatPercent(overall.cacheRate)                                    OverviewRoute.tsx:132
formatErrorRate(overall.errorRate)                                   OverviewRoute.tsx:137
formatMessageCost(row, 4)                                            OverviewRoute.tsx:300
formatPercent(mix[t.key] / total, 0)                                 OverviewRoute.tsx:209
formatInteger(Math.round(overall.totalPremiumRequests * 100) / 100) OverviewRoute.tsx:151
```

## Terminal shape at 100 columns

```
Overview
Everything omp did across your sessions in the last 24 hours.

  API-equivalent cost   $4.12     ▁▂▃▅▇▅▃
  Requests             3,977          ▁▂▄▆▅
  Conversation tokens  967M          ▁▁▂▄▆
  Cache rate           98.1%
  Error rate           1.4%          ▁▁▁▁
                                     ← row of 2, left aligned

  Uncached input 18M  Cache read 944M  Cache write 0  Output 5.5M  Premium requests 0
  Tokens/s 69.9  Avg latency 14.0s  Avg TTFT 3.2s
                                     ← row of 3

─ Activity ──────────────────────────── Per hour ──────────────────────
  Succeeded / Failed stacked, full width (716px in the web)
─ Token mix ────────────────────────── Where conversation tokens went ──
  ██████▓▒░░░  8px share bar
  ▪ legend, 4 items, whole percents
  By agent
  ██████▒░░░  8px share bar
  ● Main agent      967M   98.1%

─ Latest requests ─────────── Most recent model calls … [All requests]
  Model / When / Tokens / Cost / Duration / Status
```

- **No side-by-side anything.** Both stat rows are wrapped, and both charts are full width.
- The web's response to narrowness is *wrapping and horizontal scrolling*, never column dropping and never
  reordering. A terminal that drops a column at 100 has invented a policy; `spec.ts:236-243` records the terminal's
  `priority` as its own decision, and this document does not contradict that — it just states that the web has no
  such behaviour to copy.
