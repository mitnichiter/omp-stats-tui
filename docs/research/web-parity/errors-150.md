# Errors — 150 columns (1200px viewport)

**Web route:** `routes/ErrorsRoute.tsx`
**IR citation:** `src/layout/spec.ts:907-910` —
`lines: "123-129 (header), 131-158 (StatGrid), 159-196 (Error signatures), 197-228 (By model), 229-295 (Failures),
296-340 (signature columns), 368-421 (failure columns)"`
**Capture:** `screens/errors-150.png` — live, `#/errors?range=24h`, 1200px, dark, fullPage. Page height **3320px**.

## Page header

```
h1.page-title        "Errors"                                                      ErrorsRoute.tsx:123-126
p.page-description   "Failed model requests in the last 24 hours, grouped by error signature. Open a failure for its
                      full payload."
(no .page-actions)
```

## Top-level order

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `:123-126` |
| 2 | **StatGrid** — 4 `md` tiles, `min={170}` | `div[data-stale]` | `:131-153` |
| 3 | **`div.grid .grid-main-side`** — Error signatures (2fr, `flush`) + By model (1fr) | — | `:158-227` |
| 4 | **Card** "Failures" — `flush`, `dense`, `limit={50}` | full width | `:229-288` |

## StatGrid — `--stat-min: 170px`, 4 tiles, **5 columns available, 4 used**

`ErrorsRoute.tsx:131-153`. `floor(942/170) = 5`, so a 4-tile row leaves one empty column. Measured `cols === 5`
with `tiles === 4` — the last tile spans one column and the fifth is blank.

| # | Tile | value formatter | hint | spark | `file:line` |
|---|---|---|---|---|---|
| 1 | Failures | `formatInteger(loaded)` `:134` | `complete ? \`in ${meta.windowLabel}\` : \`latest ${formatInteger(loaded)} loaded\`` `:135` | none | `:132-136` |
| 2 | Signatures | `formatInteger(view.groups.length)` `:140` | `view.groups[0] ? \`top: ${formatInteger(view.groups[0].count)} failures\` : undefined` `:141` | none | `:137-142` |
| 3 | Affected models | `formatInteger(view.models.length)` `:145` | `view.models[0]?.model` `:146` — **a MODEL-NAME string** | none | `:143-147` |
| 4 | Last failure | `view.newest ? formatRelativeTime(view.newest.timestamp) : "–"` `:150` — **a relative TIME, not a number** | `view.newest ? formatTimestamp(view.newest.timestamp) : \`none in ${meta.windowLabel}\`` `:151` | none | `:148-152` |

**`formatCompact` vs `formatInteger`: NO `formatCompact` anywhere on this row.** Every figure is a
`formatInteger` count, a model name, or a time.

**Three of the four tiles are not numeric counts**, and this is the IR's most carefully argued spec section:
- **Signatures** (`spec.ts:921-928`) is `view.groups.length`, i.e. distinct **normalised** messages. The route's
  `title` reads *"Distinct error messages after normalizing ids and numbers"* (`:139`) — `errorSignature` collapses
  request ids, hex hashes and counters, so two messages differing only in an id are ONE signature.
- **Affected models** (`spec.ts:929-934`) is `view.models.length`, and identity is **`model::provider`**
  (`data/colors.ts:25-27`), so one model behind two providers counts twice.
- **Last failure** (`spec.ts:935-938`) is a `formatRelativeTime` in the **value** slot with a `formatTimestamp`
  (absolute `"Sep 28, 14:03:22"`) in the **hint** slot. **A terminal must not right-align this or pad it
  numerically** — it is a 24px `.stat-value` like the others (`Stat.tsx:34-36`) but its content is prose.

The IR also records tile 1's metric as `loaded` with the note that a partial load must say so (`:916-919`);
the route implements exactly that with the `complete ? … : \`latest ${…} loaded\`` ternary (`:135`).

## Card 1 — "Error signatures" (2fr, `flush`)

```
section.card.rise[--i=1] flush
  h2.card-title        "Error signatures"                                              :161
  p.card-description   "Same message with ids and counters normalized. Select one to filter the failures below."  :162
  (no card-actions)
  div.card-body[data-flush=true]
    div.table-wrap > table.table[data-dense=false]      ← NOT dense
      thead > tr > th ×4
      tbody
        tr[data-clickable][data-selected] > td ×4
        tr (detail) > td[colspan=4] > SignatureDetail    ← when expanded
```

The card is `flush`, so its body drops its left and right padding (`styles.css:797-799`) and the table runs edge
to edge under the header text.

`rowKey={group => group.signature}` `:180`, `onRowClick` toggles `selectedSignature` `:182-184`,
`selectedKey={signature}` `:185`, `expanded={group => <SignatureDetail …/>}` `:186-190`, **`limit={12}`** `:191`.

### Columns — `buildGroupColumns`, `ErrorsRoute.tsx:293-338`. Four.

| # | key | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|---|
| 1 | `signature` | `Signature` | left (`wrap: true`) | — | `span.errors-signature` | — | `:295-305` |
| 2 | `models` | `Models` | left | — | **`LabelCell`** `primary={<span className="mono">{group.models[0]?.model}</span>}` `secondary={group.models.length > 1 ? \`+${group.models.length - 1} more\` : group.models[0]?.provider}` `:313` | — | `:306-316` |
| 3 | `last` | `Last seen` | left | — | `span.muted` + `title={formatTimestamp(...)}` | `formatRelativeTime(group.lastSeen)` `:323` | `:317-326` |
| 4 | `count` | `Failures` | **right** | **`120px`** | **`MeterCell`** `max={maxCount}` `color="var(--bad)"` `:334` | `formatInteger(group.count)` `:334` | `:327-336` |

At 1200px `.grid-main-side` resolves to **`617.328px 308.656px`** — a measured **2fr : 1fr** split with the
`16px` `.grid` gap (`styles.css:712-714`, `:701`).


**Two things make this table distinct from every other one:**

1. **`.errors-signature` is the only 2-line-clamped cell in the dashboard** (`errors.css:2-12`):
   `-webkit-line-clamp: 2`, `overflow-wrap: anywhere`, `font-family: var(--font-mono)`, **`font-size: 12px`**,
   `line-height: 1.5`, `color: var(--ink-1)`. **A signature is monospace 12px, ink-1, and wraps to at most two
   lines** — because a normalised error message is a long single token that must not be truncated mid-word.
   Correspondingly the column sets `wrap: true` (`:298`), which is the only `wrap` in any ported table.
2. **`Models`' secondary line is conditional**: `+N more` when a signature spans several models, otherwise the
   provider (`:313`). The `LabelCell` slot holds a *count of other models*, not a provider, in the multi case.

**`Failures` is the only MeterCell on the dashboard coloured `var(--bad)`** — the meter's fill is red, not cyan
(`:334`). The bar's length is the error count, so red-for-errors is consistent everywhere it appears.

Measured: `scrollWidth 615px = clientWidth 615px` — **this table does NOT overflow at 1200px**, because it lives in
the 2fr column (615px) and has only 4 columns.

**The one wrapping cell in the dashboard** is `.errors-signature`, and it is the only `wrap` column anywhere.
`.table td[data-wrap="true"] { white-space: normal }` (`styles.css:1348-1350`) overrides the table's global
`white-space: nowrap` on `td` (`styles.css:1317`).

The expanded `SignatureDetail` (`:340-366`) is `div.errors-detail`: `flex column; gap 10px; padding 4px 16px 14px;
background: var(--hover); border-bottom 1px var(--line-1)` (`errors.css:33-40`), containing a `<pre>` message
(`max-height 200px`, `errors.css:42-45`), a meta row with an "Open latest" button, and a `.errors-detail-models`
row of `<span className="badge" data-mono="true">` chips — each showing `model`, a `dim` provider, and
`formatCompact(m.count)` (`:356-363`).

**That `.badge[data-mono]` chip is the only `formatCompact` on the Errors screen** (`:360`).

## Card 2 — "By model" (1fr) — a `BarList`

```
section.card.rise[--i=2]
  h2.card-title        "By model"                          :199
  p.card-description   "Failures per model. Select one to filter."   :200
  div.card-body > div.bar-list
    button.bar-list-row × N (N = min(models.length, 12))
      span.bar-list-fill[style width:%]
      span.bar-list-label
        span.row[gap:6]
          span.mono.truncate   m.model
          span.dim.truncate    m.provider
      span.bar-list-value    formatInteger(m.count)
```

`:210-223`. **`.slice(0, 12)`** at `:211` — the IR records this as `foldTo: { limit: 12, label: "Other" }`
(`spec.ts:970`), but the route **truncates without an `Other` row**, so a 13th model simply vanishes. The BarList
label is a nested `.row` with **both** model and provider truncating (`:214-217`).

**The colour encodes selection, not magnitude** (`:220`):

```ts
color: m.key === model ? "var(--bad)" : "color-mix(in srgb, var(--bad) 45%, transparent)",
```

So the selected row is full-strength red and the rest are 45%-alpha red. Every bar on this card is a **red**, at
two intensities. That is the only place in the dashboard where a BarList's fill varies by state rather than by
series hue.

## Card 3 — "Failures" — `flush`, `dense`, 6 columns

```
section.card.rise[--i=3] flush
  h2.card-title        "Failures"                                              :231
  p.card-description   "{n} of {loaded} failures, newest first" | "Loading failures…"   :232-236
  div.card-actions
    button.btn.errors-filter  (signature chip, only when a signature is selected)   :239-250
    button.btn.errors-filter  (model chip, only when a model is selected)          :251-261
    label.search > input.input  "Message, model or project"                        :262
  div.card-body[data-flush=true]
    div.table-wrap > table.table[data-dense=TRUE]
      thead > tr > th ×6
      tbody > tr ×N
  footer.card-footer   ← the Load-more footer
```

`limit={12}` on the signatures table past its visible rows renders a `.table-more` footer: `flex;
justify-content:center; gap:8px; padding:10px; border-top:1px solid var(--line-1)` (`styles.css:1357-1364`)
reading `"{n} of {total}"` in `.micro` (`styles.css:267-272`) plus a "Show more" button that adds `limit × 4`
rows at a time (`ui/Table.tsx:155-183`).

The two `.errors-filter` buttons are **active-filter chips**: each shows the filtered value in
`span.mono.truncate` plus an `<X size={12}/>` to clear it (`:247-248`, `:258-259`). `.errors-filter
{ max-width: 260px }` (`errors.css:25-27`).

### Columns — `FAILURE_COLUMNS`, `ErrorsRoute.tsx:368-421`. Six.

| # | key | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|---|
| 1 | `time` | `When` | left | **`120px`** | `span.muted` + `title` | `formatRelativeTime(row.timestamp)` `:376` | `:369-379` |
| 2 | `model` | `Model` | left | — | **`LabelCell`** `span.mono` / provider | — | `:380-385` |
| 3 | `error` | `Error` | left | — | `span.errors-message` | — | `:386-395` |
| 4 | `project` | `Project` | left | — | `span.mono.muted` + `title` | `formatFolder(row.folder)` `:402` | `:396-405` |
| 5 | `tokens` | `Tokens` | **right** | — | `span.num` | **`formatInteger(row.usage.totalTokens)`** `:411` | `:406-412` |
| 6 | `cost` | `Cost` | **right** | — | `span.num` | `formatMessageCost(row, 4)` `:419` | `:413-420` |

**`.errors-message` is the only bad-coloured monospace cell** (`errors.css:14-23`):
`display: block; max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family:
var(--font-mono); font-size: 12px; color: var(--bad)`. **12px, monospace, red, single-line, 520px max.**

**`Tokens` is `formatInteger`, NOT `formatCompact`** (`:411`) — the opposite of Overview's Latest-requests table? No:
Overview also uses `formatInteger` (`OverviewRoute.tsx:294`). **Both use integer; the Requests route is the one that
uses compact.** A failure row is a record of a single request, and its token count stays exact.

**The IR's note here is the load-bearing rule** (`spec.ts:1004-1007`): *"A failed request is still a request: it
carries tokens and may carry an unknown price, so a failure row must never print $0.00 for an unpriced one."* The
implementation is `formatMessageCost(row, 4)` (`:419`), which routes through `isUnpricedMessage` (`formatters.ts:39-53`)
and yields **`N/A`** when tokens exist but the price is unknown. **This is the only place that behaviour is visible
and it must survive the port.**

Table props: `rowKey` `:278`, `onRowClick` → drawer `:279`, `initialSort {key:"time",dir:"desc"}` `:281`,
**`limit={50}`** `:282`, **`dense`** `:283`.

Measured: `scrollWidth 1338px > clientWidth 940px` — **overflows at 1200px too**, driven by the `520px` error column.
`.errors-message` sets `white-space: nowrap` explicitly (`errors.css:18-19`), so it ellipsises like every other
cell — the two error cells are opposites: **one wraps to 2 lines, the other truncates to 1.** `limit={50}` past
the visible rows renders the same `.table-more` footer (`styles.css:1357-1364`).

## Notable formatter calls, verbatim

```
formatInteger(loaded)                                            ErrorsRoute.tsx:134
formatInteger(view.groups.length)                                ErrorsRoute.tsx:140
formatInteger(view.groups[0].count)                              ErrorsRoute.tsx:141
formatInteger(view.models.length)                                ErrorsRoute.tsx:145
formatRelativeTime(view.newest.timestamp)                        ErrorsRoute.tsx:150
formatTimestamp(view.newest.timestamp)                            ErrorsRoute.tsx:151
formatRelativeTime(group.lastSeen)                               ErrorsRoute.tsx:323
formatInteger(group.count)                                       ErrorsRoute.tsx:334
formatCompact(m.count)                                           ErrorsRoute.tsx:360
formatRelativeTime(row.timestamp)                                 ErrorsRoute.tsx:376
formatFolder(row.folder)                                         ErrorsRoute.tsx:402
formatInteger(row.usage.totalTokens)                             ErrorsRoute.tsx:411
formatMessageCost(row, 4)                                        ErrorsRoute.tsx:419
```

## Terminal shape at 150 columns

```
Errors
Failed model requests in the last 24 hours, grouped by error signature.
Open a failure for its full payload.

  Failures          50
  Signatures        3            ← distinct NORMALISED messages
  Affected models   2            ← identity is model::provider
  Last failure      4 minutes ago   ← a TIME in the 24px value slot
                       4 tiles in a 5-column grid; one column is blank

┌─ Error signatures ────────────────────────────────┐┌─ By model ─────────┐
│ Same message with ids and counters normalized.    ││ Failures per model │
│ Signature      Models          Last seen  Failures││ mus… ░ 12          │
│ req_abc123 a…  muse-spark  × 2m ago    18 ▓▓▓▓▓  ││ gpt…  ▓  4          │
│   after 3 retries   +1 more      (2-line, mono)   ││  red bar, red bar  │
│   (clamped to 2 lines, ink-1, 12px mono)          ││  selected = full   │
└───────────────────────────────────────────────────┘└───────────────────┘

─ Failures ──── 50 of 50 failures, newest first ── [chip: sig ×] [chip: model ×] [search]
  When      Model      Error                                Project  Tokens  Cost
  4m ago    muse-sp…   Request timed out after 300000ms…    omp-st…  18,402  $0.0021
  …          (red 12px mono, one line, 520px cap)                    integer  N/A if unpriced
  ─────────────────────────────────────────────────────────────────────────────
  50 of 50                                       [Load more]
```

- **`grid-main-side` is genuinely 2-up at 2:1** here (617px : 309px, measured). The signatures table fits its 615px
  column with no overflow; the Failures table does not fit 940px.
- Two `MeterCell`s, one cyan-by-row-swatch (Models) and one **red** (Errors signatures).
- **`formatCompact` appears once on the whole screen** — inside a `.badge[data-mono]` chip in the expanded
  `SignatureDetail` (`:360`). Everything else is integer, percent, cost, or a time.
