# Tools — 100 columns (800px viewport)

**Web route:** `routes/ToolsRoute.tsx` · **IR citation:** `src/layout/spec.ts:1016-1020`
**Capture:** `screens/tools-100.png` — live, `#/tools?range=24h`, 800px, dark, fullPage. Page height **2993px**.
Full column/format detail: **`tools-150.md`**. All deltas measured live.

## Measured at 800px

| Property | At 1200px | **At 800px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`782px`** (inner `750px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-*` container | n/a | n/a — Tools never has one |
| StatGrid A (`min 190`) | 4 cols, 5 tiles → 4 + 1 | **3 columns**, 5 tiles → **3 + 2** |
| StatGrid B (`min 150`) | **6 columns**, 4 tiles | **4 columns**, 4 tiles → **exactly 4, flush** |
| By-tool table | 10 cols, `940px` client, `1048px` scroll | 10 cols, **`748px` client**, `1048px` scroll → **+300px** |
| Tool×model table | 8 cols, `940px` = `940px` | 8 cols, **`748px` client**, `935px` scroll → **+187px** |
| `data-dense` | both `true` | both `true` |
| Legend items | 7 | **7** |

**Load-bearing fact: StatGrid B goes from 6 columns for 4 tiles to exactly 4.** At 1200px the `min: 150px` grid
leaves two blank columns on the right; at 800px `floor(750/150) = 5` allows 5 but only 4 tiles exist, so the grid
resolves to 4 equal columns and the row is flush. **StatGrid A wraps 4 + 1 → 3 + 2.**

## Page header

```
h1.page-title        "Tools"                                                   ToolsRoute.tsx:75-78
p.page-description   "Which tools omp called in the last 24 hours, how often they failed, and what they cost."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:75-78` |
| 2 | StatGrid A — 5 `md` tiles, `min={190}` → **3 cols** | `:85-121` |
| 3 | StatGrid B — 4 `sm` tiles, `min={150}` → **4 cols** | `:122-145` |
| 4 | Card "Calls over time" | `:151-183` |
| 5 | Card "By tool" — `flush`, `dense`, `limit={20}` | `:185-206` |
| 6 | Card "By tool and model" — `flush`, `dense` | `:208-249` |

Both StatGrids live in one `div.stack[gap:16px]` (`:84`) — the same structure as Overview's two grids
(`OverviewRoute.tsx:102`).

## StatGrid A — 3 + 2

| # | Tile | value | hint | spark |
|---|---|---|---|---|
| 1 | Tool calls | `formatInteger(t.calls)` `:88` | `formatInteger(t.errors)` + `" failed"` `:89` | `view.totalCalls` `:90` |
| 2 | Distinct tools | `formatInteger(t.tools)` `:94` | `Most used: ${view.rows[0].tool}` `:95` | none |
| 3 | Error rate | `formatErrorRate(t.calls > 0 ? t.errors / t.calls : 0)` `:100` | `formatInteger(t.calls - t.errors)` + `" succeeded"` `:101` | `view.totalErrors`, **`var(--bad)`** `:102-103` |
| 4 | Attributed tokens | **`formatCompact(Math.round(t.tokens))`** `:108` | **`formatCompact(Math.round(t.output))`** `" output"` `:109` | none |
| 5 | Attributed cost | `formatEstimatedCost(t.cost, t.unpriced)` `:114` | `formatInteger(Math.round(t.unpriced))` + `" unpriced requests"` \| `"API-equivalent"` `:115-119` | none |

**`formatCompact` on exactly two figures in this row** — tile 4's value and hint. Everything else is
`formatInteger` or a cost.

## StatGrid B — 4 columns, flush

All four are `size="sm"` (18px), all four are **`formatCompact`**, all four append the literal `" chars"`, and
**none has a hint** — so each is a 2-line tile.

| # | Tile | value formatter | `file:line` |
|---|---|---|---|
| 1 | Result text | `` `${formatCompact(t.resultChars)} chars` `` | `:127` |
| 2 | Call arguments | `` `${formatCompact(t.argsChars)} chars` `` | `:133` |
| 3 | Avg result per call | `` `${formatCompact(t.calls > 0 ? Math.round(t.resultChars / t.calls) : 0)} chars` `` | `:138` |
| 4 | Avg arguments per call | `` `${formatCompact(t.calls > 0 ? Math.round(t.argsChars / t.calls) : 0)} chars` `` | `:143` |

## Card 1 — "Calls over time"

Title `"Calls over time"` / `"Errors over time"` `:153`; description `"Per hour, top 6 tools stacked"` `:154`
(`TOP_TOOLS = 6`, `:52`); `Segmented[sm]` `:155`. Body: `div.stack[gap:12]` → `TimeChart height={260}` `:166`
(stacked) → `Legend` with **7 items** (6 tools + `Other`) `:170-179`, `value = formatCompact(sum)` `:175`,
toggleable. `formatTooltip={formatInteger}` `:167` — **exact counts in the tooltip, compact on the axis.**

The 7 legend items wrap to **2 rows** at 750px (`flex-wrap: wrap; gap: 4px 14px`, `styles.css:1732-1735`).

## Card 2 — "By tool" — `flush`, `dense`, 10 columns, +300px

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Tool` | left | `Swatch` + `span.mono.truncate.tools-name` (`max-width 220px`, `tools.css:5-7`) | — | `:339-351` |
| 2 | `Trend` | left | **`Sparkline 80×20`**, else `span.dim "–"` | — | `:352-364` |
| 3 | `Calls` | **right** | **`MeterCell`**: `formatInteger(row.calls)` + `<span className="dim tools-share">{formatPercent(row.callFraction, 0)}</span>` | `:376-377` | `:365-382` |
| 4 | `Errors` | **right** | `span.num.dim` + **`Badge` mono** (`tone="neutral"` at 0) | `formatInteger(row.errors)` `:391`; `formatErrorRate(row.errorRate)` `:393` | `:383-397` |
| 5 | `Args` | **right** | `span.num` | **`formatCompact(row.argsChars)`** `:404` | `:398-405` |
| 6 | `Result` | **right** | `span.num` | **`formatCompact(row.resultChars)`** `:412` | `:406-413` |
| 7 | `Result / call` | **right** | `span.num.muted` | **`formatCompact(Math.round(row.avgResultChars))`** `:420` | `:414-421` |
| 8 | `Attr. tokens` | **right** | `span.num` = `formatCompact(Math.round(totalTokensShare))` + `dim formatPercent(tokenFraction, 0)` | `:430-431` | `:422-434` |
| 9 | `Attr. cost` | **right** | `span.num` = `formatEstimatedCost(costShare, unpricedRequestsShare)` + `dim formatPercent(costFraction, 0)` | `:443-444` | `:435-447` |
| 10 | `Last used` | **right** | `span.muted` | `formatRelativeTime(row.lastUsed)` `:453` | `:448-454` |

`rowKey = row.tool` `:196`; `limit={20}` `:199`; `selectedKey={toolFilter}` `:200`; **`dense`** `:202`.

**`formatCompact` on 5 columns** (Args, Result, Result/call, Attr. tokens, and the Calls share);
**`formatInteger` on 2** (Calls, Errors).

`.tools-share { display:inline-block; min-width:32px; margin-left:8px; text-align:right }` (`tools.css:9-14`) keeps
the three share sub-columns aligned — **independent of viewport width**.

## Card 3 — "By tool and model" — `flush`, `dense`, 8 columns, +187px

`rowKey = \`${row.tool}::${row.model}::${row.provider}\`` `:565`; actions are a 200px `<select>` filter
(`tools.css:1-3`) + clear button `:214-244`.

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Tool` | left | `Swatch` + `span.mono.truncate` | — | `:486-498` |
| 2 | `Model` | left | **`LabelCell`** `span.mono` (`"(unknown)"` fallback) / provider | — | `:499-506` |
| 3 | `Calls` | **right** | **`MeterCell`**, `maxCalls` over **filtered** rows `:484` | `formatInteger(row.calls)` `:512` | `:507-513` |
| 4 | `Errors` | **right** | `span.num.dim` + **`Badge` mono** | `formatInteger(row.errors)` `:521`; `formatErrorRate(row.errorRate)` `:523` | `:514-527` |
| 5 | `Result` | **right** | `span.num` | **`formatCompact(row.resultChars)`** `:534` | `:528-535` |
| 6 | `Attr. tokens` | **right** | `span.num` | **`formatCompact(Math.round(row.totalTokensShare))`** `:542` | `:536-543` |
| 7 | `Attr. cost` | **right** | `span.num` | `formatEstimatedCost(row.costShare, row.unpricedRequestsShare)` `:550` | `:544-551` |
| 8 | `Last used` | **right** | `span.muted` | `formatRelativeTime(row.lastUsed)` `:557` | `:552-558` |

**This table loses 2 of the 10 columns relative to "By tool"** — `Trend`, `Args`, `Result / call` and the three share
sub-figures are all absent, because the row is already keyed by tool *and* model.

## Terminal shape at 100 columns

```
Tools
Which tools omp called in the last 24 hours, how often they failed, and
what they cost.

  Tool calls         4,665   ▁▂▄▆▅
  Distinct tools     16
  Error rate         5.1%    ▁▁▁▁        ← RED spark
  Attributed tokens  942M
  Attributed cost    $3.95
                       ← 3 + 2

  Result text   9.5M chars   Call arguments 2.1M chars
  Avg result per call 2K chars   Avg arguments per call 445 chars
  ← 4 tiles in exactly 4 columns: flush (6 columns at 150)

─ Calls over time ──────── Per hour, top 6 tools stacked ──
  stacked 260px; tooltip formatInteger, axis formatCompact
  ▪ bash 1.2K  ▪ read 890  ▪ edit 640
  ▪ grep 410   ▪ …          ▪ Other 88      ← 7 items over 2 rows
─ By tool ──── Tokens and API-equivalent cost of each invoking turn … ──
  Tool  Trend  Calls     Errors  Args  Result  Res/call  Attr.tok  Attr.cost  Last used
  bash  ▁▂▄▆▅  1,204 ▓▓▓  3 [0.2%] 1.2M 3.4M    2K       410M 45%  $1.20 30%  2m ago
  ← 1048px of content in 748px
─ By tool and model ───────── Which models call which tools … ──
  Tool  Model      Calls    Errors  Result  Attr.tok  Attr.cost  Last used
  bash  muse-sp…   802      2 [0.2%] 1.1M   280M      $0.80      2m ago
```

- **No two-up anywhere on Tools at any width.**
- Both tables overflow below 1100px and the web scrolls; both stay `dense`.
