# Errors — 60 columns (480px viewport)

**Web route:** `routes/ErrorsRoute.tsx` · **IR citation:** `src/layout/spec.ts:907-910`
**Capture:** `screens/errors-60.png` — live, `#/errors?range=24h`, 480px, dark, fullPage. Page height **3661px**.
Full column/format detail: **`errors-150.md`**. All deltas measured live.

## Measured at 480px

| Property | At 1200px | **At 480px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`462px`** (inner `430px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-main-side` | `617px 309px` | **`430px` — ONE column** |
| StatGrid (`min 170`) | 5 cols, 4 tiles | **2 columns**, 4 tiles → **2 + 2** |
| Error-signatures table | 4 cols, `615px` = `615px` | 4 cols, **`428px` client**, `592px` scroll → **+164px** |
| Failures table | 6 cols, `940px` client, `1338px` scroll | 6 cols, **`428px` client**, `1338px` scroll → **+910px (3.1×)** |
| `data-dense` | signatures `false`, failures `true` | unchanged |
| BarList rows | 2 | **2** |

`floor(430/170) = 2`, so the four stat tiles pair 2 + 2 — the tidiest the Errors stat row ever gets.

**Load-bearing fact: both tables now overflow.** The signatures table fit exactly at 800px but overflows by 164px at
480px, because `.errors-signature` keeps `overflow-wrap: anywhere` (`errors.css:11`) and its 2-line clamp needs real
width.

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
| 2 | StatGrid — 4 `md` tiles, `min={170}` → **2 cols** | `:131-153` |
| 3 | Error signatures (430px) → By model (430px) | `:158-227` |
| 4 | Card "Failures" — `flush`, `dense`, `limit={50}` | `:229-288` |

## StatGrid — 2 + 2

| # | Tile | value formatter | hint formatter | value type |
|---|---|---|---|---|
| 1 | Failures | `formatInteger(loaded)` `:134` | `complete ? … : \`latest ${formatInteger(loaded)} loaded\`` `:135` | count |
| 2 | Signatures | `formatInteger(view.groups.length)` `:140` | `formatInteger(view.groups[0].count)` `:141` | count of **normalised** messages |
| 3 | Affected models | `formatInteger(view.models.length)` `:145` | `view.models[0]?.model` `:146` | count; hint is a **string** |
| 4 | Last failure | `formatRelativeTime(view.newest.timestamp)` `:150` | `formatTimestamp(view.newest.timestamp)` `:151` | **a relative time** |

**No `formatCompact`.** Tile 4's value is a time string in the 24px `tabular-nums` `.stat-value` slot
(`styles.css:848-857`) — it is not a number and must not be column-padded.

## Card 1 — "Error signatures" (430px, `flush`, 4 columns, +164px)

| # | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `Signature` | left, `wrap: true` | — | `span.errors-signature` — mono **12px**, `ink-1`, **2-line clamp**, `overflow-wrap: anywhere` (`errors.css:2-12`) | — | `:295-305` |
| 2 | `Models` | left | — | **`LabelCell`** — secondary is `+N more` (`:313`) or the provider | — | `:306-316` |
| 3 | `Last seen` | left | — | `span.muted` | `formatRelativeTime(group.lastSeen)` `:323` | `:317-326` |
| 4 | `Failures` | **right** | **`120px`** | **`MeterCell`** `color="var(--bad)"` | `formatInteger(group.count)` `:334` | `:327-336` |

`rowKey = group.signature` `:180`; `selectedKey` `:185`; `expanded` → `SignatureDetail` `:186-190`;
`limit={12}` `:191`; **not dense**.

**The 2-line clamp on `Signature` is the one cell in the dashboard that wraps by design.** `wrap: true` on the
column (`:298`) plus `-webkit-line-clamp: 2` (`errors.css:3-6`) means a signature is at most **2 terminal rows**, with
`overflow-wrap: anywhere` breaking the hex hash mid-token. Every other cell in the dashboard is `white-space: nowrap`
(`styles.css:1278`, `1317`).

`SignatureDetail` (`:340-366`): `padding 4px 16px 14px; background var(--hover)` (`errors.css:33-40`), a `<pre>`
capped at `200px` (`errors.css:42-45`), a meta line, and `.errors-detail-models` chips carrying the screen's only
**`formatCompact(m.count)`** (`:360`).

## Card 2 — "By model" (430px) — a `BarList`

```
section.card.rise[--i=2]
  h2.card-title        "By model" / "Failures per model. Select one to filter."     :199-200
  div.bar-list
    button.bar-list-row × min(models, 12)
      span.bar-list-fill[style width:%]   ← colour encodes SELECTION, not series
      span.bar-list-label > span.row[gap:6] > span.mono.truncate + span.dim.truncate
      span.bar-list-value  formatInteger(m.count)
```

`.slice(0, 12)` `:211` — **truncation without an `Other` row**, which is not what the IR's
`foldTo {limit: 12, label: "Other"}` (`spec.ts:970`) describes.

Bar colour (`:220`): `m.key === model ? "var(--bad)" : "color-mix(in srgb, var(--bad) 45%, transparent)"`.
Row height stays `30px` (`styles.css:1795`); the label's `span.row` carries **both** model and provider as separate
truncating spans (`:214-217`), so at 430px both are shortening.

## Card 3 — "Failures" — `flush`, `dense`, 6 columns, 3.1× overflow

| # | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `When` | left | **`120px`** | `span.muted` | `formatRelativeTime(row.timestamp)` `:376` | `:369-379` |
| 2 | `Model` | left | — | **`LabelCell`** `span.mono` / provider | — | `:380-385` |
| 3 | `Error` | left | — | `span.errors-message` — mono **12px**, **`var(--bad)`**, `max-width 520px`, nowrap + ellipsis (`errors.css:14-23`) | — | `:386-395` |
| 4 | `Project` | left | — | `span.mono.muted` | `formatFolder(row.folder)` `:402` | `:396-405` |
| 5 | `Tokens` | **right** | — | `span.num` | **`formatInteger(row.usage.totalTokens)`** `:411` | `:406-412` |
| 6 | `Cost` | **right** | — | `span.num` | `formatMessageCost(row, 4)` `:419` | `:413-420` |

`limit={50}` `:282`; **`dense`** `:283`; actions are the two filter chips + search `:239-262`.

**`formatInteger` for Tokens; `formatMessageCost(row, 4)` for Cost.** `formatMessageCost` must yield **`N/A`** when
a failure carries tokens but no recoverable price (`formatters.ts:29-31`, `39-53`; IR rule at `spec.ts:1004-1007`).

## Terminal shape at 60 columns

```
Errors
Failed model requests in the last 24 hours, grouped by error
signature. Open a failure for its full payload.

  Failures         50
  Signatures       3
  Affected models  2
  Last failure     4 minutes ago
                  ← 2 + 2, flush both edges

─ Error signatures ────────── Same message with ids and counters … ──
  Signature        Models       Last seen  Failures
  req_abc123 a…    muse-sp…     2m ago     18 ▓▓▓▓▓
    after 3 retr…    +1 more    ← 2-line clamp, mono 12px, ink-1
  ← 592px of content in 428px

─ By model ─────────── Failures per model. Select one to filter. ──
  muse-spark… gpt…  ▓▓▓▓░░  12
  gpt-5…      anth… ▓▓░░░░   4

─ Failures ───── 50 of 50 failures, newest first ── [chip ×] [search]
  When     Model     Error                              Project  Tokens  Cost
  4m ago   muse-sp…  Request timed out after 300000ms…  omp-st…  18,402  $0.0021
  ← 1338px of content in 428px
```

- The **only wrapping cell in the dashboard** is `Signature` (2-line clamp). Everything else ellipsises.
- **The only `formatCompact` on this screen** is inside the expanded signature's model chips (`:360`).
- The red `MeterCell` on Failures-per-model and the red-dominant BarList are the screen's two visual registers;
  every other figure is `ink-1`/`ink-2` text.
