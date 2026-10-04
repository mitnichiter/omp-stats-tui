# Errors — 40 columns (320px viewport)

**Web route:** `routes/ErrorsRoute.tsx` · **IR citation:** `src/layout/spec.ts:907-910`
**Capture:** `screens/errors-40.png` — live, `#/errors?range=24h`, 320px, dark, fullPage. Page height **3961px**.
Full column/format detail: **`errors-150.md`**. All deltas measured live.

## Measured at 320px

| Property | At 1200px | **At 320px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`302px`** (inner `270px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-main-side` | `617px 309px` | **`270px` — ONE column** |
| StatGrid (`min 170`) | 5 cols, 4 tiles | **1 column** — `floor(270/170) = 1`; 4 tiles stack |
| Error-signatures table | 4 cols, `615px` = `615px` | 4 cols, **`268px` client**, `592px` scroll → **+324px (2.2×)** |
| Failures table | 6 cols, `940px` client, `1338px` scroll | 6 cols, **`268px` client**, `1338px` scroll → **+1070px (5.0×)** |
| `data-dense` | signatures `false`, failures `true` | unchanged |

**Load-bearing fact at 40 columns: the Failures table overflows 5×.** 1338px of content in a 268px wrapper. The web's
only response is the scrollbar (`.table-wrap { overflow-x: auto }`, `styles.css:1259-1262`) — every cell keeps
`white-space: nowrap` (`styles.css:1278`, `1317`).

## Page header

```
h1.page-title        "Errors"                                                      ErrorsRoute.tsx:123-126
p.page-description   "Failed model requests in the last 24 hours, grouped by error signature. Open a failure for its
                      full payload."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:123-126` |
| 2 | StatGrid — 4 `md` tiles, `min={170}` → **1 col** | `:131-153` |
| 3 | Error signatures (270px) → By model (270px) | `:158-227` |
| 4 | Card "Failures" — `flush`, `dense`, `limit={50}` | `:229-288` |

## StatGrid — one tile per row

| # | Tile | value formatter | hint formatter | value type |
|---|---|---|---|---|
| 1 | Failures | `formatInteger(loaded)` `:134` | `complete ? \`in ${meta.windowLabel}\` : \`latest ${formatInteger(loaded)} loaded\`` `:135` | count |
| 2 | Signatures | `formatInteger(view.groups.length)` `:140` | `top: ${formatInteger(view.groups[0].count)} failures` `:141` | **normalised**-message count |
| 3 | Affected models | `formatInteger(view.models.length)` `:145` | `view.models[0]?.model` `:146` | count; hint is a model name |
| 4 | Last failure | `view.newest ? formatRelativeTime(view.newest.timestamp) : "–"` `:150` | `formatTimestamp(view.newest.timestamp)` `:151` | **a relative time** |

**No `formatCompact` on this row.** Tile 4's value is prose in a 24px `nowrap`+`ellipsis` slot
(`styles.css:848-857`); at 270px `"4 minutes ago"` fits, but a value like `"about 1 month ago"` will ellipsise.

## Card 1 — "Error signatures" (270px, `flush`, 4 columns, 2.2×)

| # | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `Signature` | left, `wrap: true` | — | `span.errors-signature` — **mono 12px, `ink-1`, `-webkit-line-clamp: 2`, `overflow-wrap: anywhere`** (`errors.css:2-12`) | — | `:295-305` |
| 2 | `Models` | left | — | **`LabelCell`** — `span.mono` model over `+N more` or provider, both `.truncate` (`Table.tsx:225-226`) | — | `:306-316` |
| 3 | `Last seen` | left | — | `span.muted` + `title` | `formatRelativeTime(group.lastSeen)` `:323` | `:317-326` |
| 4 | `Failures` | **right** | **`120px`** | **`MeterCell`** `max={maxCount}` `color="var(--bad)"`, bar `64px × 4px` | `formatInteger(group.count)` `:334` | `:327-336` |

`rowKey = group.signature` `:180`; `selectedKey` `:185`; `expanded` → `SignatureDetail` `:186-190`;
`limit={12}` `:191`; **not dense**.

**`Signature` remains the only wrapping cell in the dashboard at every width.** Its 2-line clamp is a *design*
constraint (a normalised message must be readable end to end), not a narrow-width adaptation — so it survives 320px
intact while every other cell ellipsises.

The `Failures` column's fixed `120px` width (`:331`) is 45% of the 268px wrapper. The `MeterCell`'s `64px` is a
further 24%.

## Card 2 — "By model" (270px) — a `BarList`

```
section.card.rise[--i=2]
  h2.card-title        "By model" / "Failures per model. Select one to filter."     :199-200
  div.bar-list > button.bar-list-row × min(models, 12)     ← .slice(0, 12)  :211
    span.bar-list-fill[style width:%]                       ← inset 3px, opacity .16, red
    span.bar-list-label > span.row[gap:6] > span.mono.truncate + span.dim.truncate
    span.bar-list-value                                    formatInteger(m.count)
```

Bar colour is selection state (`:220`): selected = `var(--bad)`, unselected =
`color-mix(in srgb, var(--bad) 45%, transparent)`. Row height `30px`, fill 24px at `opacity 0.16`
(`styles.css:1795`, `1807-1816`); pct floor `Math.max(0.5, …)` (`BarList.tsx:26`).

**At 270px both the model name and the provider truncate independently** (`:215-216`) — the nested `.row` gives each
its own ellipsis, which is why the label is a two-part span rather than a single string.

## Card 3 — "Failures" — `flush`, `dense`, 6 columns, 5× overflow

| # | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `When` | left | **`120px`** | `span.muted` + `title={formatTimestamp(...)}` | `formatRelativeTime(row.timestamp)` `:376` | `:369-379` |
| 2 | `Model` | left | — | **`LabelCell`** `span.mono` / provider | — | `:380-385` |
| 3 | `Error` | left | — | `span.errors-message` — **mono 12px, `var(--bad)`, `max-width 520px`, nowrap + ellipsis** (`errors.css:14-23`) | — | `:386-395` |
| 4 | `Project` | left | — | `span.mono.muted` + `title` | `formatFolder(row.folder)` `:402` | `:396-405` |
| 5 | `Tokens` | **right** | — | `span.num` | **`formatInteger(row.usage.totalTokens)`** `:411` | `:406-412` |
| 6 | `Cost` | **right** | — | `span.num` | `formatMessageCost(row, 4)` `:419` | `:413-420` |

`limit={50}` `:282`; **`dense`** `:283`; `initialSort {key:"time", dir:"desc"}` `:281`.

**`Tokens` is `formatInteger` here** — exact, not compact (`:411`), matching Overview (`OverviewRoute.tsx:294`) and
differing from the Requests route (`RequestsRoute.tsx:250`, compact).

**`Cost` uses `formatMessageCost(row, 4)` and must print `N/A`, never `$0.00`, when the failure carries tokens but
no recoverable price** (`formatters.ts:29-31`, `39-53`). IR rule: `spec.ts:1004-1007`.

## Notable formatter calls, verbatim

```
formatInteger(loaded)                                     ErrorsRoute.tsx:134
formatInteger(view.groups.length)                         ErrorsRoute.tsx:140
formatInteger(view.models.length)                         ErrorsRoute.tsx:145
formatRelativeTime(view.newest.timestamp)                 ErrorsRoute.tsx:150
formatTimestamp(view.newest.timestamp)                     ErrorsRoute.tsx:151
formatRelativeTime(group.lastSeen)                        ErrorsRoute.tsx:323
formatInteger(group.count)                                ErrorsRoute.tsx:334
formatCompact(m.count)      (only in SignatureDetail)     ErrorsRoute.tsx:360
formatRelativeTime(row.timestamp)                          ErrorsRoute.tsx:376
formatFolder(row.folder)                                  ErrorsRoute.tsx:402
formatInteger(row.usage.totalTokens)                      ErrorsRoute.tsx:411
formatMessageCost(row, 4)                                 ErrorsRoute.tsx:419
```

## Terminal shape at 40 columns

```
Errors
Failed model requests in the last 24 hours, grouped by
error signature. Open a failure for its full payload.

  Failures
    50
    in the last 24 hours
  Signatures
    3
    top: 18 failures
  Affected models
    2
    muse-spark-1.3-contributor
  Last failure
    4 minutes ago
    Oct 4, 16:58

─ Error signatures ────────── Same message with ids and … ──
  Signature      Models     Last seen  Failures
  req_abc123 a…  muse-sp…   2m ago     18 ▓▓▓▓▓
    after 3 retr…  +1 more          ← the ONLY wrapping cell, 2-line cap
  ← 592px of content in 268px

─ By model ─────────── Failures per model. Select one to … ──
  muse-sp… gpt…  ▓▓▓▓░░  12
  gpt-5…  anth…   ▓▓░░░░   4

─ Failures ──── 50 of 50 failures, newest first ── [chip ×] [search]
  When     Model     Error                             Project Tokens Cost
  4m ago   muse-sp…  Request timed out after 300000ms… omp-st… 18,402 $0.0021
  ← 1338px of content in 268px: the web scrolls
```

**What 40 columns forces.** The Failures table's fixed `120px` When column plus a `520px`-capped error column total
640px of intrinsic width in a 268px box. The IR's `priority` field is where a drop order would live
(`spec.ts:236-244`) and it is explicitly the terminal's own decision; this document records the measurement that
such a decision needs and stops there.
