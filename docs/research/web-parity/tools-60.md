# Tools — 60 columns (480px viewport)

**Web route:** `routes/ToolsRoute.tsx` · **IR citation:** `src/layout/spec.ts:1016-1020`
**Capture:** `screens/tools-60.png` — live, `#/tools?range=24h`, 480px, dark, fullPage. Page height **3306px**.
Full column/format detail: **`tools-150.md`**. All deltas measured live.

## Measured at 480px

| Property | At 1200px | **At 480px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`462px`** (inner `430px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-*` container | n/a | n/a |
| StatGrid A (`min 190`) | 4 cols → 4 + 1 | **2 columns**, 5 tiles → **2 + 2 + 1** |
| StatGrid B (`min 150`) | 6 cols, 4 tiles | **2 columns**, 4 tiles → **2 + 2** |
| By-tool table | 10 cols, `940px` client, `1048px` scroll | 10 cols, **`428px` client**, `1048px` scroll → **+620px (2.4×)** |
| Tool×model table | 8 cols, `940px` = `940px` | 8 cols, **`428px` client**, `935px` scroll → **+507px (2.2×)** |
| `data-dense` | both `true` | both `true` |
| Legend items | 7 | **7**, now 4 rows |

`floor(430/190) = 2` and `floor(430/150) = 2`, so **both stat grids become 2-wide at the same width** — the `sm`
secondary row and the `md` primary row differ only in value size (24px vs 18px), not in layout.

## Page header

```
h1.page-title        "Tools"                                                    ToolsRoute.tsx:75-78
p.page-description   "Which tools omp called in the last 24 hours, how often they failed, and what they cost."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:75-78` |
| 2 | StatGrid A — 5 `md` tiles, `min={190}` → **2 cols** | `:85-121` |
| 3 | StatGrid B — 4 `sm` tiles, `min={150}` → **2 cols** | `:122-145` |
| 4 | Card "Calls over time" | `:151-183` |
| 5 | Card "By tool" — `flush`, `dense`, `limit={20}` | `:185-206` |
| 6 | Card "By tool and model" — `flush`, `dense` | `:208-249` |

## StatGrid A — 2 + 2 + 1

| # | Tile | value | hint | spark |
|---|---|---|---|---|
| 1 | Tool calls | `formatInteger(t.calls)` `:88` | `formatInteger(t.errors)` `" failed"` `:89` | `view.totalCalls` `:90` |
| 2 | Distinct tools | `formatInteger(t.tools)` `:94` | `Most used: ${view.rows[0].tool}` `:95` | none |
| 3 | Error rate | `formatErrorRate(t.calls > 0 ? t.errors / t.calls : 0)` `:100` | `formatInteger(t.calls - t.errors)` `" succeeded"` `:101` | **`var(--bad)`** `:102-103` |
| 4 | Attributed tokens | **`formatCompact(Math.round(t.tokens))`** `:108` | **`formatCompact(Math.round(t.output))`** `" output"` `:109` | none |
| 5 | Attributed cost | `formatEstimatedCost(t.cost, t.unpriced)` `:114` | `formatInteger(Math.round(t.unpriced))` \| `"API-equivalent"` `:115-119` | none |

**`formatCompact` on exactly two figures** (tile 4 value + hint).

## StatGrid B — 2 + 2, all `sm`, all `formatCompact`

| # | Tile | value formatter | `file:line` |
|---|---|---|---|
| 1 | Result text | `` `${formatCompact(t.resultChars)} chars` `` | `:127` |
| 2 | Call arguments | `` `${formatCompact(t.argsChars)} chars` `` | `:133` |
| 3 | Avg result per call | `` `${formatCompact(t.calls > 0 ? Math.round(t.resultChars / t.calls) : 0)} chars` `` | `:138` |
| 4 | Avg arguments per call | `` `${formatCompact(t.calls > 0 ? Math.round(t.argsChars / t.calls) : 0)} chars` `` | `:143` |

All four are 18px values with the literal `" chars"` suffix and **no hint** — 2-line tiles. At 2 columns the row is
2 + 2 and the two rows are the same height, which is why the `md`/`sm` distinction is carried entirely by value size
at this width.

## Card 1 — "Calls over time"

Title `:153`; description `"Per hour, top 6 tools stacked"` `:154` (`TOP_TOOLS = 6`, `:52`); `Segmented[sm]` `:155`.
`div.stack[gap:12]` → `TimeChart height={260}` `:166` (stacked, ~396px wide → plot ≈ `396 - 28 - 8 = 360px`;
24 hourly buckets → `slotW ≈ 15px` → `barW = 15 × 0.72 ≈ 10.8px`) → `Legend` with **7 items** `:170-179`, now
wrapping to **4 rows** (`flex-wrap: wrap`, `styles.css:1733`), `value = formatCompact(sum)` `:175`,
`formatTooltip={formatInteger}` `:167`.

## Card 2 — "By tool" — `flush`, `dense`, 10 columns, 2.4×

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Tool` | left | `Swatch` + `span.mono.truncate.tools-name` (`max-width 220px`) | — | `:339-351` |
| 2 | `Trend` | left | **`Sparkline 80×20`**, else `span.dim "–"` | — | `:352-364` |
| 3 | `Calls` | **right** | **`MeterCell`**: `formatInteger(row.calls)` + `dim formatPercent(row.callFraction, 0)` | `:376-377` | `:365-382` |
| 4 | `Errors` | **right** | `span.num.dim` + **`Badge` mono** | `formatInteger(row.errors)` `:391`; `formatErrorRate(row.errorRate)` `:393` | `:383-397` |
| 5 | `Args` | **right** | `span.num` | **`formatCompact(row.argsChars)`** `:404` | `:398-405` |
| 6 | `Result` | **right** | `span.num` | **`formatCompact(row.resultChars)`** `:412` | `:406-413` |
| 7 | `Result / call` | **right** | `span.num.muted` | **`formatCompact(Math.round(row.avgResultChars))`** `:420` | `:414-421` |
| 8 | `Attr. tokens` | **right** | `span.num` + `dim formatPercent(tokenFraction, 0)` | `:430-431` | `:422-434` |
| 9 | `Attr. cost` | **right** | `span.num` = `formatEstimatedCost(costShare, unpricedRequestsShare)` + `dim formatPercent(costFraction, 0)` | `:443-444` | `:435-447` |
| 10 | `Last used` | **right** | `span.muted` | `formatRelativeTime(row.lastUsed)` `:453` | `:448-454` |

`rowKey = row.tool` `:196`; `limit={20}` `:199`; **`dense`** `:202`.

**`formatCompact` on 5 columns; `formatInteger` on 2.** The fixed-size elements do not shrink: `.meter` `64px × 4px`
(`styles.css:1401-1403`, `1379`), `.sparkline` `80×20` (`ToolsRoute.tsx:359`), `.tools-share` `min-width: 32px`
(`tools.css:11`). In a 428px wrapper those three consume 176px before a single character.

## Card 3 — "By tool and model" — `flush`, `dense`, 8 columns, 2.2×

`rowKey = \`${row.tool}::${row.model}::${row.provider}\`` `:565`; `maxCalls` computed over the **filtered** rows `:484`.

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Tool` | left | `Swatch` + `span.mono.truncate` | — | `:486-498` |
| 2 | `Model` | left | **`LabelCell`** `span.mono` (`"(unknown)"` fallback `:504`) / provider | — | `:499-506` |
| 3 | `Calls` | **right** | **`MeterCell`** | `formatInteger(row.calls)` `:512` | `:507-513` |
| 4 | `Errors` | **right** | `span.num.dim` + **`Badge` mono** | `formatInteger(row.errors)` `:521`; `formatErrorRate(row.errorRate)` `:523` | `:514-527` |
| 5 | `Result` | **right** | `span.num` | **`formatCompact(row.resultChars)`** `:534` | `:528-535` |
| 6 | `Attr. tokens` | **right** | `span.num` | **`formatCompact(Math.round(row.totalTokensShare))`** `:542` | `:536-543` |
| 7 | `Attr. cost` | **right** | `span.num` | `formatEstimatedCost(row.costShare, row.unpricedRequestsShare)` `:550` | `:544-551` |
| 8 | `Last used` | **right** | `span.muted` | `formatRelativeTime(row.lastUsed)` `:557` | `:552-558` |

## Terminal shape at 60 columns

```
Tools
Which tools omp called in the last 24 hours, how often they failed,
and what they cost.

  Tool calls         4,665   ▁▂▄▆▅
  Distinct tools     16
  Error rate         5.1%    ▁▁▁▁       ← RED spark
  Attributed tokens  942M
  Attributed cost    $3.95
                       ← 2 + 2 + 1

  Result text   9.5M chars   Call arguments 2.1M chars
  Avg result per call 2K chars   Avg arguments per call 445 chars
  ← 2 + 2; all four are 18px with " chars" appended

─ Calls over time ──────── Per hour, top 6 tools stacked ──
  stacked, ~11px bars at 396px
  ▪ bash 1.2K
  ▪ read 890
  ▪ edit 640
  ▪ grep 410
  ▪ …
  ▪ Other 88                 ← 7 legend items, 4 rows
─ By tool ──── Tokens and API-equivalent cost of each invoking turn … ──
  Tool  Trend  Calls    Errors  Args  Result  Res/call  Attr.tok  Attr.cost  Last used
  bash  ▁▂▄▆▅  1,204▓▓  3[0.2%] 1.2M 3.4M    2K       410M 45% $1.20 30%  2m ago
  ← 1048px of content in 428px
─ By tool and model ───────── Which models call which tools … ──
  Tool  Model      Calls    Errors  Result  Attr.tok  Attr.cost  Last used
  bash  muse-sp…   802      2[0.2%] 1.1M   280M      $0.80      2m ago
```

- **Both stat grids become 2-wide at the same width**, so at 60 columns the primary and secondary stat rows differ
  only by value size (24px vs 18px) — the `md`/`sm` distinction must still be visible.
- The **`figure + dim share(%, 0)`** cell motif survives at every width because `.tools-share`'s `min-width: 32px`
  (`tools.css:11`) is fixed.
