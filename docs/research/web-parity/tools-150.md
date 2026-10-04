# Tools — 150 columns (1200px viewport)

**Web route:** `routes/ToolsRoute.tsx`
**IR citation:** `src/layout/spec.ts:1016-1020` —
`lines: "74-78 (header), 84-119 (StatGrid), 121-140 (second StatGrid), 150-183 (calls-over-time card), 184-206 (By tool),
207-233 (By tool and model), 339-458 (columns), 486-560 (tool×model columns)"`
**Capture:** `screens/tools-150.png` — live, `#/tools?range=24h`, 1200px, dark, fullPage. Page height **2975px**.

## Page header

```
h1.page-title        "Tools"                                                       ToolsRoute.tsx:75-78
p.page-description   "Which tools omp called in the last 24 hours, how often they failed, and what they cost."
(no .page-actions)
```

## Top-level order — **no grid container**, and **two StatGrids stacked**

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `:75-78` |
| 2 | **StatGrid A** — 5 `md` tiles, `min={190}` | `div.stack[gap:16]` inside `QueryView` | `:85-121` |
| 3 | **StatGrid B** — 4 `sm` tiles, `min={150}` | same `div.stack[gap:16]` | `:122-145` |
| 4 | **Card** "Calls over time" | full width | `:151-183` |
| 5 | **Card** "By tool" — `flush`, `dense`, `limit={20}` | full width | `:185-206` |
| 6 | **Card** "By tool and model" — `flush`, `dense` | full width | `:208-249` |

Tools shares Overview's `div.stack[gap: 16px]` pattern (`:84`) wrapping two StatGrids — the same structure at
`OverviewRoute.tsx:102`. Only those two routes use it. The gap from the stat block down to the first card is the
`.page` gap of **20px**.

`.stack`'s base gap is `4px` and `div.stack[gap: 16px]` overrides it (`styles.css:731-736`); the gap from the stat
block down to the first card is the `.page` gap of `20px` (`styles.css:666`). The second grid is `stack`-separated
from the first by `16px` (`:84`) — **the only place on this screen where two different gaps both appear.**

`.stat-grid` sets **no `gap`**: tiles are separated by `box-shadow: 1px 0 0 var(--line-1), 0 1px 0 var(--line-1)`
(`styles.css:815-837`). A 4-tile row in a 6-column grid leaves **two blank columns**.

`.stat-foot { min-height: 18px }` (`styles.css:873`) means a tile that has a foot never changes height when the
foot's text does. Tiles 1, 2 and 4 all do (`ToolsRoute.tsx:89`, `:95`, `:109`); all four StatGrid-B tiles do not.

`.card-actions` is `flex-wrap: wrap` (`styles.css:788`), so a `Segmented` drops below the title on a narrow card.

`.legend` is `flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--ink-2)` (`styles.css:1732-1738`).

The `Errors` cell is `span.row[gap: 8px, justify-content: flex-end]` (`ToolsRoute.tsx:390`) — a **count plus a
badge**, right-aligned as a unit, so the badge column lines up down the whole table.

## StatGrid A — `--stat-min: 190px`, 5 tiles

`ToolsRoute.tsx:85-121`. `floor(942/190) = 4` → **4 columns, 5 tiles wrap 4 + 1**.

`div.stack[gap: 16px]` is the `.stack` primitive with its base `4px` gap overridden (`styles.css:731-736`), and
the gap down to the first card is the `.page` gap of `20px` (`styles.css:666`).


| # | Tile | label | value formatter | hint | spark | `file:line` |
|---|---|---|---|---|---|---|
| 1 | Tool calls | `formatInteger(t.calls)` `:88` | `` `${formatInteger(t.errors)} failed` `` `:89` | `spark={view.totalCalls}` (cyan default) `:90` | `:86-91` |
| 2 | Distinct tools | `formatInteger(t.tools)` `:94` | `view.rows[0] ? \`Most used: ${view.rows[0].tool}\` : undefined` `:95` | none | `:92-96` |
| 3 | Error rate | `formatErrorRate(t.calls > 0 ? t.errors / t.calls : 0)` `:100` | `` `${formatInteger(t.calls - t.errors)} succeeded` `` `:101` | `spark={view.totalErrors}` **`sparkColor="var(--bad)"`** `:102-103` | `:97-104` |
| 4 | Attributed tokens | **`formatCompact(Math.round(t.tokens))`** `:108` | `` `${formatCompact(Math.round(t.output))} output` `` `:109` | none | `:105-110` |
| 5 | Attributed cost | `formatEstimatedCost(t.cost, t.unpriced)` `:114` | `t.unpriced > 0 ? \`${formatInteger(Math.round(t.unpriced))} unpriced requests\` : "API-equivalent"` `:115-119` | none | `:111-120` |

**`formatCompact` vs `formatInteger` — tiles 4's value AND hint are both compact; everything else is integer.**

- **`formatCompact`** (tile 4 value `:108` and hint `:109`) — the only two compact figures on this row, because
  attributed-token totals reach 9 digits (the live capture reads `942M`).
- **`formatInteger`** — tiles 1, 1's hint, 2, 2's hint, 3's hint, 5's hint.
- `Math.round(...)` wraps tile 4 and 5's hints because `toolsByTool` carries fractional shares.

**Spark colours are semantic:** tile 1 default cyan (calls, `:90`), tile 3 **`var(--bad)`** red (errors, `:103`).
Same convention as Overview's Error rate tile (`OverviewRoute.tsx:140`).

**`ATTRIBUTION_NOTE`** (`ToolsRoute.tsx:54-55`) is the string *"Tokens and API-equivalent cost of each invoking turn,
split evenly across that turn's tool calls"* — it is the `title` on tiles 4 and 5 (`:107`, `:113`) and the description
of the "By tool" card (`:188`). The IR carries the same warning as a note at `spec.ts:1147-1150`: attributed tokens
and cost are **per-call SHARES of the assistant turn that asked for them, never per-call measurements.**

## StatGrid B — `--stat-min: 150px`, 4 tiles, **all `sm`**

`ToolsRoute.tsx:122-145`. `floor(942/150) = 6`, so **6 columns for 4 tiles** — the row is left-heavy with two blank
columns. Measured `cols === 6`, `tiles === 4`.

| # | Tile | label | value formatter | `file:line` |

`.stat-grid` sets **no `gap`**: tiles are separated by `box-shadow: 1px 0 0 var(--line-1), 0 1px 0 var(--line-1)`
(`styles.css:815-837`). A 4-tile row in a 6-column grid leaves **two blank columns** — the row does not stretch its
tiles to fill, because `auto-fit` collapses *empty tracks* to zero.

|---|---|---|---|---|
| 1 | Result text | `` `${formatCompact(t.resultChars)} chars` `` | `:127` |
| 2 | Call arguments | `` `${formatCompact(t.argsChars)} chars` `` | `:133` |
| 3 | Avg result per call | `` `${formatCompact(t.calls > 0 ? Math.round(t.resultChars / t.calls) : 0)} chars` `` | `:138` |
| 4 | Avg arguments per call | `` `${formatCompact(t.calls > 0 ? Math.round(t.argsChars / t.calls) : 0)} chars` `` | `:143` |

**All four are `formatCompact`, all four are `size="sm"` (18px values), and none has a `hint`.** Each value is a
compact figure with the literal suffix `" chars"` appended — the only place a unit suffix is baked into a stat value
rather than being implied. These tiles are therefore **2 lines**: label + 18px value.

Because `Math.round` runs *before* `formatCompact`, a per-call mean of 2038 renders `2K`, not `2.04K`
(`formatters.ts:15-17` picks compact at ≥1000). The IR models these as `resultChars`/`argsChars` sums and
`avgResult`/`avgArgs` shares (`spec.ts:1051-1070`).

## Card 1 — "Calls over time"

```
section.card.rise[--i=1]
  header.card-header
    h2.card-title        "Calls over time" | "Errors over time"              :153
    p.card-description   "Per {5 minutes|hour|day}, top 6 tools stacked"     :154
    div.card-actions > div.segmented[sm]   CALLS | ERRORS                     :155
  div.card-body
    div.stack[gap:12]
      div.chart[height:260px]                                                 :166
      div.legend > button.legend-item ×N     (measured 7 items)               :170
```

Title switches with the metric (`:153`); description is computed from `meta.bucketMs` and `TOP_TOOLS = 6`
(`ToolsRoute.tsx:52`, `:154`).

`TimeChart height={260}` `:166`, **stacked**, `formatTooltip={formatInteger}` `:167` (so the tooltip shows exact
counts while the axis stays compact — the Chart's default `format = formatCompact`, `Chart.tsx:62`),
`emptyLabel` switches to `"No tool errors in this range"` in errors mode `:168`.

**The legend has 7 items in the live capture** — 6 tools plus the `Other` rollup. `pivotSeries` stacks the top
`TOP_TOOLS = 6` and folds the rest into `Other` (`:306`), and the IR records this as
`foldTo: { limit: 6, label: "Other" }` (`spec.ts:1080`). **This is the one place the web's fold and the IR's fold
agree exactly.** Legend `value = formatCompact(sum(values))` `:175`; toggleable via `onToggle={toggleHidden}` `:178`.


`.stat-foot { min-height: 18px }` (`styles.css:873`) means a tile that has a foot never changes height when the
foot's text does. Tiles 1, 2 and 4 all do (`ToolsRoute.tsx:89`, `:95`, `:109`).

## Card 2 — "By tool" — `flush`, `dense`, 10 columns

Table props: `rowKey={row => row.tool}` `:196`, `initialSort {{key:"calls",dir:"desc"}}` `:198`,
**`limit={20}`** `:199`, `selectedKey={toolFilter}` `:200`, `onRowClick` filters by tool `:201`, **`dense`** `:202`.

### Columns — `buildToolColumns`, `ToolsRoute.tsx:333-456`. Ten.

| # | key | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `tool` | `Tool` | left | `span.row[gap:8]` = `Swatch` + `span.mono.truncate.tools-name` (`max-width: 220px`, `tools.css:5-7`) | — | `:339-351` |
| 2 | `trend` | `Trend` | (left) | **`Sparkline width={80} height={20}`**, or `span.dim "–"` | — | `:352-364` |
| 3 | `calls` | `Calls` | **right** | **`MeterCell`** `max={maxCalls}`; display is a two-part span: `formatInteger(row.calls)` + `<span className="dim tools-share">{formatPercent(row.callFraction, 0)}</span>` `:377` | `formatInteger(row.calls)` `:376` | `:365-382` |
| 4 | `errorRate` | `Errors` | **right** | `span.row[gap:8, justify-content:flex-end]` = `span.num.dim` + **`Badge`** `mono`, `tone="neutral"` when `row.errors === 0` else `errorRateTone(row.errorRate)` `:392` | `formatInteger(row.errors)` `:391` and `formatErrorRate(row.errorRate)` `:393` | `:383-397` |
| 5 | `args` | `Args` | **right** | `span.num` | **`formatCompact(row.argsChars)`** `:404` | `:398-405` |
| 6 | `result` | `Result` | **right** | `span.num` | **`formatCompact(row.resultChars)`** `:412` | `:406-413` |
| 7 | `avgResult` | `Result / call` | **right** | `span.num.muted` | **`formatCompact(Math.round(row.avgResultChars))`** `:420` | `:414-421` |
| 8 | `tokens` | `Attr. tokens` | **right** | `span.num` = `formatCompact(Math.round(row.totalTokensShare))` `:430` + `<span className="dim tools-share">{formatPercent(row.tokenFraction, 0)}</span>` `:431` | **`formatCompact`** `:430`; share `formatPercent(…, 0)` `:431` | `:422-434` |
| 9 | `cost` | `Attr. cost` | **right** | `span.num` = `formatEstimatedCost(row.costShare, row.unpricedRequestsShare)` `:443` + `<span className="dim tools-share">{formatPercent(row.costFraction, 0)}</span>` `:444` | **`formatEstimatedCost`** `:443` | `:435-447` |
| 10 | `lastUsed` | `Last used` | **right** | `span.muted` | `formatRelativeTime(row.lastUsed)` `:453` | `:448-454` |

**`formatCompact` vs `formatInteger` — Tools is the most compact-heavy table in the dashboard:**

- **`formatCompact` on FIVE columns:** `Args` `:404`, `Result` `:412`, `Result / call` `:420`,
  `Attr. tokens` `:430`, and the `Calls` column's share via `formatPercent(…, 0)` `:377`.
- **`formatInteger` on exactly TWO figures:** `Calls` `:376` and `Errors` `:391` — and both are **counts**, both
  `Math.round`-free, and both sit in the same cell as a compact secondary figure.
- **`Result / call` is `span.num.muted`**, not plain `num` (`:420`) — a per-call mean is a secondary figure.
- **`Calls` cell is the most complex in the dashboard**: a `MeterCell` whose `display` is itself a nested
  `formatInteger` + a `dim` `formatPercent(…, 0)` (`:374-379`). `.tools-share { display: inline-block; min-width: 32px;
  margin-left: 8px; text-align: right }` (`tools.css:9-14`) — **another fixed-width alignment hack**, so the
  percentage sub-column lines up down the whole table.
- **The same `formatInteger + dim formatPercent(…, 0)` pairing appears in three columns** — Calls `:376-377`,
  `Attr. tokens` `:430-431`, `Attr. cost` `:443-444`. It is the dashboard's signature "figure + its share" cell.
- `Trend`'s sparkline is **`80×20`** — the smallest of the three in-table sparklines (Models uses `96×22`).

Measured: `scrollWidth 1048px > clientWidth 940px` → **overflows at 1200px too.**

## Card 3 — "By tool and model" — `flush`, `dense`, 8 columns

Table props: `rowKey={row => \`${row.tool}::${row.model}::${row.provider}\`}` `:565` — **a three-part key**, so the
same tool under two models by two providers is three rows. Actions are a `<select>` filter (`.tools-filter`,
`width: 200px`, `tools.css:1-3`) plus a clear button `:214-244`.

### Columns — `ToolsRoute.tsx:483-560`. Eight.

| # | key | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `tool` | `Tool` | left | `Swatch` + `span.mono.truncate.tools-name` | — | `:486-498` |
| 2 | `model` | `Model` | left | **`LabelCell`** `primary={<span className="mono">{row.model \|\| "(unknown)"}</span>}` `secondary={row.provider}` `:504` | — | `:499-506` |
| 3 | `calls` | `Calls` | **right** | **`MeterCell`** `max={maxCalls}` (recomputed over `filtered`, `:484`) | `formatInteger(row.calls)` `:512` | `:507-513` |
| 4 | `errorRate` | `Errors` | **right** | `span.num.dim` + **`Badge`** `mono` (`tone="neutral"` when 0) `:522` | `formatInteger(row.errors)` `:521`; `formatErrorRate(row.errorRate)` `:523` | `:514-527` |
| 5 | `result` | `Result` | **right** | `span.num` | **`formatCompact(row.resultChars)`** `:534` | `:528-535` |

`.card-actions` is `flex-wrap: wrap` (`styles.css:788`), so the `Segmented` drops below the title when the card is
narrow.

| 6 | `tokens` | `Attr. tokens` | **right** | `span.num` | **`formatCompact(Math.round(row.totalTokensShare))`** `:542` | `:536-543` |
| 7 | `cost` | `Attr. cost` | **right** | `span.num` | `formatEstimatedCost(row.costShare, row.unpricedRequestsShare)` `:550` | `:544-551` |
| 8 | `lastUsed` | `Last used` | **right** | `span.muted` | `formatRelativeTime(row.lastUsed)` `:557` | `:552-558` |

**This table is the "By tool" table minus `Trend`, `Args`, `Result / call`, and the share sub-figures** — 8 columns
against 10, because the row is already keyed by tool *and* model so the tool-level trend is redundant.
**`formatCompact` on 2 columns** (`Result`, `Attr. tokens`); **`formatInteger` on 2** (`Calls`, `Errors`).
`maxCalls` here is recomputed over the **filtered** rows (`:484`), unlike Projects' deliberately range-scoped maxima.

## Notable formatter calls, verbatim

```
formatInteger(t.calls) / (t.errors)                             ToolsRoute.tsx:88-89
formatErrorRate(t.calls > 0 ? t.errors / t.calls : 0)           ToolsRoute.tsx:100
formatCompact(Math.round(t.tokens))                              ToolsRoute.tsx:108
formatCompact(Math.round(t.output))                              ToolsRoute.tsx:109
formatEstimatedCost(t.cost, t.unpriced)                          ToolsRoute.tsx:114
`${formatCompact(t.resultChars)} chars`                          ToolsRoute.tsx:127
`${formatCompact(t.calls > 0 ? Math.round(t.resultChars / t.calls) : 0)} chars`   :138
formatCompact(row.argsChars)                                    ToolsRoute.tsx:404
formatCompact(row.resultChars)                                  ToolsRoute.tsx:412
formatCompact(Math.round(row.avgResultChars))                   ToolsRoute.tsx:420
formatCompact(Math.round(row.totalTokensShare)) + formatPercent(row.tokenFraction, 0)   :430-431
formatEstimatedCost(row.costShare, row.unpricedRequestsShare)    ToolsRoute.tsx:443
formatRelativeTime(row.lastUsed)                                ToolsRoute.tsx:453
formatInteger(row.calls)                                        ToolsRoute.tsx:512
formatCompact(row.resultChars)                                  ToolsRoute.tsx:534
```

## Terminal shape at 150 columns

```
Tools
Which tools omp called in the last 24 hours, how often they failed, and what they cost.

  Tool calls         4,665    ▁▂▄▆▅      ← 5 tiles, min 190px → 4 + 1
  Distinct tools     16
  Error rate         5.1%     ▁▁▁▁       ← spark RED
  Attributed tokens  942M               ← formatCompact, NO foot
  Attributed cost    $3.95

  Result text   9.5M chars   Call arguments  2.1M chars
  Avg result per call  2K chars   Avg arguments per call  445 chars
  ← 4 sm tiles in a 6-column grid: two blank columns on the right

─ Calls over time ───────── Per hour, top 6 tools stacked ── [CALLS | ERRORS]
  stacked, 260px; tooltip formatInteger, axis formatCompact
  ▪ bash 1.2K  ▪ read 890  ▪ edit 640  ▪ grep 410  ▪ …  ▪ Other 88   ← 7 items
─ By tool ──── Tokens and API-equivalent cost of each invoking turn, split … ──
  Tool    Trend  Calls      Errors   Args   Result  Res/call  Attr.tok  Attr.cost  Last used
  bash    ▁▂▄▆▅  1,204 ▓▓▓▓  3 [0.2%] 1.2M  3.4M   2K        410M 45%   $1.20 30%  2m ago
  ← 10 columns; the web scrolls (1048px in 940px)
─ By tool and model ──────── Which models call which tools … ── [All tools ▾]
  Tool    Model      Calls     Errors  Result  Attr.tok  Attr.cost  Last used
  bash    muse-sp…   802       2 [0.2%] 1.1M   280M      $0.80      2m ago
```

- **Two StatGrids in one `div.stack[gap:16px]`** — unique to Tools and Overview.
- The `figure + dim share(%, 0)` cell appears in three columns of "By tool" and is the screen's most repeated motif.
- **`Attr. tokens` and `Attr. cost` are per-call SHARES of the invoking turn, never per-call measurements**
  (`ATTRIBUTION_NOTE`, `ToolsRoute.tsx:54-55`; IR note `spec.ts:1147-1150`).
