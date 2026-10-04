# Tools — 40 columns (320px viewport)

**Web route:** `routes/ToolsRoute.tsx` · **IR citation:** `src/layout/spec.ts:1016-1020`
**Capture:** `screens/tools-40.png` — live, `#/tools?range=24h`, 320px, dark, fullPage. Page height **3773px**.
Full column/format detail: **`tools-150.md`**. All deltas measured live.

## Measured at 320px

| Property | At 1200px | **At 320px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`302px`** (inner `270px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-*` container | n/a | n/a |
| StatGrid A (`min 190`) | 4 cols → 4 + 1 | **1 column** — `floor(270/190) = 1` |
| StatGrid B (`min 150`) | 6 cols, 4 tiles | **1 column** — `floor(270/150) = 1` |
| By-tool table | 10 cols, `940px` client, `1048px` scroll | 10 cols, **`268px` client**, `1048px` scroll → **+780px (3.9×)** |
| Tool×model table | 8 cols, `940px` = `940px` | 8 cols, **`268px` client**, `935px` scroll → **+667px (3.5×)** |
| `data-dense` | both `true` | both `true` |
| Legend items | 7 | **7**, one per row |

**Load-bearing fact at 40 columns: both stat grids collapse to a single column**, so the screen becomes a
9-tile vertical stack (5 `md` + 4 `sm`) followed by three full-width cards. `270px` cannot fit two `150px` tiles
(2 × 150 = 300 > 270) nor two `190px` tiles. The page grows from 2975px to 3773px purely from wrapping.

## Page header

```
h1.page-title        "Tools"                                                       ToolsRoute.tsx:75-78
p.page-description   "Which tools omp called in the last 24 hours, how often they failed, and what they cost."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:75-78` |
| 2 | StatGrid A — 5 `md` tiles, `min={190}` → **1 col** | `:85-121` |
| 3 | StatGrid B — 4 `sm` tiles, `min={150}` → **1 col** | `:122-145` |
| 4 | Card "Calls over time" | `:151-183` |
| 5 | Card "By tool" — `flush`, `dense`, `limit={20}` | `:185-206` |
| 6 | Card "By tool and model" — `flush`, `dense` | `:208-249` |

Both grids stay in one `div.stack[gap:16px]` (`:84`) — the boundary between the two stat blocks survives the
collapse, so **the primary row and the secondary row are still visibly two groups**, not one 9-tile list.

## StatGrid A — one tile per row

| # | Tile | value | hint | spark |
|---|---|---|---|---|
| 1 | Tool calls | `formatInteger(t.calls)` `:88` | `formatInteger(t.errors)` `" failed"` `:89` | `view.totalCalls` `:90` |
| 2 | Distinct tools | `formatInteger(t.tools)` `:94` | `Most used: ${view.rows[0].tool}` `:95` | none |
| 3 | Error rate | `formatErrorRate(t.calls > 0 ? t.errors / t.calls : 0)` `:100` | `formatInteger(t.calls - t.errors)` `" succeeded"` `:101` | **`var(--bad)`** `:102-103` |
| 4 | Attributed tokens | **`formatCompact(Math.round(t.tokens))`** `:108` | **`formatCompact(Math.round(t.output))`** `" output"` `:109` | none |
| 5 | Attributed cost | `formatEstimatedCost(t.cost, t.unpriced)` `:114` | `formatInteger(Math.round(t.unpriced))` \| `"API-equivalent"` `:115-119` | none |

**`formatCompact` on exactly two figures.** Tiles 1 and 3 carry 28px sparklines; 2, 4 and 5 do not.

`ATTRIBUTION_NOTE` — *"Tokens and API-equivalent cost of each invoking turn, split evenly across that turn's tool
calls"* (`ToolsRoute.tsx:54-55`) — is the `title` on tiles 4 and 5 (`:107`, `:113`). **At 40 columns a tooltip
cannot be reached, so the attribution caveat has nowhere to live.** The IR carries it as a `note` band instead
(`spec.ts:1147-1150`); that is the right terminal answer and the web has no equivalent problem.

## StatGrid B — one tile per row, all `sm`

| # | Tile | value formatter | `file:line` |
|---|---|---|---|
| 1 | Result text | `` `${formatCompact(t.resultChars)} chars` `` | `:127` |
| 2 | Call arguments | `` `${formatCompact(t.argsChars)} chars` `` | `:133` |
| 3 | Avg result per call | `` `${formatCompact(t.calls > 0 ? Math.round(t.resultChars / t.calls) : 0)} chars` `` | `:138` |
| 4 | Avg arguments per call | `` `${formatCompact(t.calls > 0 ? Math.round(t.argsChars / t.calls) : 0)} chars` `` | `:143` |

All four: **18px value** (`styles.css:859-861`), **no hint** → 2-line tiles, and a literal `" chars"` suffix. In a
single column this block is four 2-line tiles that are visibly shorter than the five 3-line tiles above them. **That
height difference is the only signal separating the two stat blocks at this width** — the `div.stack[gap:16px]`
boundary and the `size="md"|"sm"` value size are doing all the work.

## Card 1 — "Calls over time"

Title `:153`; description `"Per hour, top 6 tools stacked"` `:154` (`TOP_TOOLS = 6`, `:52`); `Segmented[sm]` `:155`
— `.card-actions` wraps (`styles.css:788`), so the control drops below the title at 270px.

`TimeChart height={260}` `:166`, stacked, **236px wide**: `padLeft = 28`, `padRight = 8`, plot ≈ `200px`, 24 hourly
buckets → `slotW ≈ 8.3px` → **`barW ≈ 6px`**. `formatTooltip={formatInteger}` `:167`; axis `formatCompact`
(`Chart.tsx:62`).

`Legend` below in `div.stack[gap:12]` `:160`, **7 items** (6 tools + `Other`), each a `button.legend-item` with
`swatch` + `label` + `legend-value` (`formatCompact(sum)`, `:175`), wrapping to **one item per row** at 236px
(`flex-wrap: wrap`, `styles.css:1733`).

## Card 2 — "By tool" — `flush`, `dense`, 10 columns, 3.9×

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Tool` | left | `Swatch` + `span.mono.truncate.tools-name` (`max-width 220px`, `tools.css:5-7`) | — | `:339-351` |
| 2 | `Trend` | left | **`Sparkline 80×20`**, else `span.dim "–"` | — | `:352-364` |
| 3 | `Calls` | **right** | **`MeterCell 64×4`**: `formatInteger(row.calls)` + `dim formatPercent(callFraction, 0)` | `:376-377` | `:365-382` |
| 4 | `Errors` | **right** | `span.num.dim` + **`Badge` mono** (`tone="neutral"` at 0) | `formatInteger(row.errors)` `:391`; `formatErrorRate(row.errorRate)` `:393` | `:383-397` |
| 5 | `Args` | **right** | `span.num` | **`formatCompact(row.argsChars)`** `:404` | `:398-405` |
| 6 | `Result` | **right** | `span.num` | **`formatCompact(row.resultChars)`** `:412` | `:406-413` |
| 7 | `Result / call` | **right** | `span.num.muted` | **`formatCompact(Math.round(row.avgResultChars))`** `:420` | `:414-421` |
| 8 | `Attr. tokens` | **right** | `span.num` + `dim formatPercent(tokenFraction, 0)` | `:430-431` | `:422-434` |
| 9 | `Attr. cost` | **right** | `span.num` = `formatEstimatedCost(costShare, unpricedRequestsShare)` + `dim formatPercent(costFraction, 0)` | `:443-444` | `:435-447` |
| 10 | `Last used` | **right** | `span.muted` | `formatRelativeTime(row.lastUsed)` `:453` | `:448-454` |

`rowKey = row.tool` `:196`; `limit={20}` `:199`; `selectedKey` `:200`; **`dense`** `:202`.

**`formatCompact` on 5 columns; `formatInteger` on 2.** The fixed visuals — `80×20` sparkline, `64×4` meter,
`32px`-min share column, `220px`-capped tool name — total 396px inside a 268px wrapper. `nowrap` on every cell
(`styles.css:1278`, `1317`) plus `overflow-x: auto` (`styles.css:1259-1262`) means the web scrolls and drops nothing.

## Card 3 — "By tool and model" — `flush`, `dense`, 8 columns, 3.5×

`rowKey = \`${row.tool}::${row.model}::${row.provider}\`` `:565`; actions are a `200px` `<select>` +
clear button (`:214-244`, `tools.css:1-3`); `maxCalls` over the **filtered** rows `:484`.

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

## Terminal shape at 40 columns

```
Tools
Which tools omp called in the last 24 hours, how often they
failed, and what they cost.

  Tool calls
    4,665    ▁▂▄▆▅
  Distinct tools
    16
  Error rate
    5.1%     ▁▁▁▁        ← RED spark
  Attributed tokens
    942M
  Attributed cost
    $3.95

  Result text
    9.5M chars           ← 2-line, 18px
  Call arguments
    2.1M chars
  Avg result per call
    2K chars
  Avg arguments per call
    445 chars

─ Calls over time ───────── Per hour, top 6 tools stacked ──
  [CALLS | ERRORS]
  stacked, ~6px bars at 236px plot
  ▪ bash 1.2K
  ▪ read 890
  ▪ edit 640
  ▪ grep 410
  ▪ …
  ▪ Other 88                ← 7 items, one per row
─ By tool ──── Tokens and API-equivalent cost of each invoking turn … ──
  Tool   Trend  Calls    Errors  Args  Result  Res/call  Attr.tok  Attr.cost  Last used
  bash   ▁▂▄▆▅  1,204▓▓  3[0.2%] 1.2M 3.4M    2K       410M 45%  $1.20 30%  2m ago
  ← 1048px of content in 268px: the web scrolls
─ By tool and model ─────────── Which models call which tools … ──
  Tool   Model      Calls    Errors  Result  Attr.tok  Attr.cost  Last used
  bash   muse-sp…   802      2[0.2%] 1.1M   280M      $0.80      2m ago
```

**What 40 columns forces.** Ten columns needing 1048px in a 268px wrapper, with four fixed-size visual columns
(`80×20` sparkline, `64px` meter, `32px` share slot, `220px` name cap). The IR's `priority` field is where a drop
order belongs and it is explicitly the terminal's own decision (`spec.ts:236-244`); this document records the
measurement and stops.
