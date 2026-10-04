# Errors — 100 columns (800px viewport)

**Web route:** `routes/ErrorsRoute.tsx` · **IR citation:** `src/layout/spec.ts:907-910`
**Capture:** `screens/errors-100.png` — live, `#/errors?range=24h`, 800px, dark, fullPage. Page height **3486px**.
Full column/format detail: **`errors-150.md`**. All deltas measured live.

## Measured at 800px

| Property | At 1200px | **At 800px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`782px`** (inner `750px`) |
| `--gutter` | `22px` | `16px` |
| **`.grid-main-side`** | `617.328px 308.656px` (2-up) | **`750px` — ONE column** (`styles.css:716-722`) |
| StatGrid (`min 170`) | 5 cols, 4 tiles | **4 columns**, 4 tiles → **exactly 4, one clean row** |
| Error-signatures table | 4 cols, `615px` client = `615px` scroll | 4 cols, **`748px` client**, `748px` scroll → **fits** |
| Failures table | 6 cols, `940px` client, `1338px` scroll | 6 cols, **`748px` client**, `1338px` scroll → **+590px** |
| `data-dense` | signatures `false`, failures `true` | unchanged |

**Two load-bearing facts at 100 columns:**

1. **`grid-main-side` has collapsed.** Error signatures and By model are now stacked 750px cards, in that order.
2. **The stat row improves from 5-into-4 to exactly 4.** At 1200px a `min: 170px` grid fits 5 columns and leaves
   one blank; at 800px it fits exactly 4 and the row is flush. This is the only screen where narrowing produces a
   *tidier* stat row rather than a wrapped one — worth noting because it is counter-intuitive.

The Failures table still overflows (`1338px` of content), driven by `.errors-message`'s `max-width: 520px`
(`errors.css:16`) plus the 120px `When` column (`ErrorsRoute.tsx:372`).

## Page header

```
h1.page-title        "Errors"                                                    ErrorsRoute.tsx:123-126
p.page-description   "Failed model requests in the last 24 hours, grouped by error signature. Open a failure for its
                      full payload."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `:123-126` |
| 2 | StatGrid — 4 `md` tiles, `min={170}` → **4 cols** | `div[data-stale]` | `:131-153` |
| 3 | Error signatures (750px) → By model (750px) | `.grid-main-side` **collapsed** | `:158-227` |
| 4 | Card "Failures" — `flush`, `dense`, `limit={50}` | full width | `:229-288` |

## StatGrid — 4 columns, no wrap

| # | Tile | value formatter | hint formatter |
|---|---|---|---|
| 1 | Failures | `formatInteger(loaded)` `:134` | `complete ? \`in ${meta.windowLabel}\` : \`latest ${formatInteger(loaded)} loaded\`` `:135` |
| 2 | Signatures | `formatInteger(view.groups.length)` `:140` | `formatInteger(view.groups[0].count)` + `" failures"` `:141` |
| 3 | Affected models | `formatInteger(view.models.length)` `:145` | `view.models[0]?.model` `:146` — a string |
| 4 | Last failure | `formatRelativeTime(view.newest.timestamp)` `:150` — a time | `formatTimestamp(view.newest.timestamp)` `:151` |

**No `formatCompact` on this row.** Tiles 3 and 4 put strings in the value slot.

## Card 1 — "Error signatures" (750px, `flush`, 4 columns, fits)

| # | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `Signature` | left, **`wrap: true`** | — | `span.errors-signature` — mono **12px**, `ink-1`, `-webkit-line-clamp: 2`, `overflow-wrap: anywhere` (`errors.css:2-12`) | — | `:295-305` |
| 2 | `Models` | left | — | **`LabelCell`** `span.mono` model; secondary is `+N more` (`:313`) if >1 model, else the provider | — | `:306-316` |
| 3 | `Last seen` | left | — | `span.muted` + `title={formatTimestamp(...)}` | `formatRelativeTime(group.lastSeen)` `:323` | `:317-326` |
| 4 | `Failures` | **right** | **`120px`** | **`MeterCell`** `max={maxCount}` **`color="var(--bad)"`** `:334` | `formatInteger(group.count)` `:334` | `:327-336` |

`rowKey={group => group.signature}` `:180`; `selectedKey` `:185`; `expanded` → `SignatureDetail` `:186-190`;
`limit={12}` `:191`; **not dense**.

`SignatureDetail` (`:340-366`) is `padding 4px 16px 14px; background var(--hover)` (`errors.css:33-40`) and holds
a `<pre>` capped at `max-height: 200px` (`errors.css:42-45`), a meta line with "Open latest", and
`.errors-detail-models` chips — `span.badge[data-mono="true"]` showing model + `dim` provider +
**`formatCompact(m.count)`** (`:360`). **That chip is the only `formatCompact` on the Errors screen.**

## Card 2 — "By model" (750px) — a `BarList`

```
section.card.rise[--i=2]
  h2.card-title        "By model" / "Failures per model. Select one to filter."     :199-200
  div.bar-list
    button.bar-list-row × min(models, 12)          ← .slice(0, 12)  :211
      span.bar-list-fill[style width:%]
      span.bar-list-label > span.row[gap:6] > span.mono.truncate + span.dim.truncate
      span.bar-list-value  formatInteger(m.count)
```

Bar colour is **selection state, not series hue** (`:220`):
`m.key === model ? "var(--bad)" : "color-mix(in srgb, var(--bad) 45%, transparent)"`.

Row metrics, width-independent: `height 30px`, `padding 0 8px`, `radius 6px` (`styles.css:1790-1801`); fill inset
`top/bottom 3px` → 24px, `opacity 0.16`, `radius 5px` (`styles.css:1807-1816`); value `font-mono 12px tabular-nums
ink-2` (`styles.css:1829-1833`); pct floor `Math.max(0.5, …)` (`BarList.tsx:26`).

**`.slice(0, 12)` truncates without an `Other` row** — the IR records it as `foldTo {limit: 12, label: "Other"}`
(`spec.ts:970`), which the web does not do on this card.

## Card 3 — "Failures" — `flush`, `dense`, 6 columns, +590px

| # | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `When` | left | **`120px`** | `span.muted` | `formatRelativeTime(row.timestamp)` `:376` | `:369-379` |
| 2 | `Model` | left | — | **`LabelCell**` `span.mono` / provider | — | `:380-385` |
| 3 | `Error` | left | — | `span.errors-message` — mono **12px**, **`var(--bad)`**, `max-width 520px`, single-line ellipsis (`errors.css:14-23`) | — | `:386-395` |
| 4 | `Project` | left | — | `span.mono.muted` | `formatFolder(row.folder)` `:402` | `:396-405` |
| 5 | `Tokens` | **right** | — | `span.num` | **`formatInteger(row.usage.totalTokens)`** `:411` | `:406-412` |
| 6 | `Cost` | **right** | — | `span.num` | `formatMessageCost(row, 4)` `:419` | `:413-420` |

Actions: signature chip `:239-250`, model chip `:251-261` (both `.errors-filter`, `max-width 260px`,
`errors.css:25-27`), search `:262`. `limit={50}` `:282`; **`dense`** `:283`.

**`Tokens` is `formatInteger`, not `formatCompact`** (`:411`) — a failure row's token count stays exact, matching
Overview's Latest-requests Tokens column (`OverviewRoute.tsx:294`) and **differing from the Requests route**
(`RequestsRoute.tsx:250`, which is compact).

**`formatMessageCost(row, 4)` must print `N/A`, never `$0.00`, for an unpriced failure** (`formatters.ts:29-31`,
`39-53`). The IR states this rule at `spec.ts:1004-1007`.

## Terminal shape at 100 columns

```
Errors
Failed model requests in the last 24 hours, grouped by error signature.
Open a failure for its full payload.

  Failures         50
  Signatures       3
  Affected models  2
  Last failure     4 minutes ago
                  ← EXACTLY 4 in 4 columns; no wrap, no blank column

─ Error signatures ────────────────────────────────
  Same message with ids and counters normalized. Select one to filter…
  Signature       Models        Last seen   Failures
  req_abc123 a…   muse-spark    2m ago      18 ▓▓▓▓▓
    after 3 retries  +1 more    (2-line clamp, mono 12px)
  ← this table FITS: 748px content in 748px

─ By model ─────────────────────── Failures per model. Select one to filter.
  muse-spark… gpt…  ▓▓▓▓░░  12
  gpt-5…      anth…  ▓▓░░░░   4
   red bars only; selected row is full red, the rest 45%

─ Failures ──── 50 of 50 failures, newest first ── [sig ×] [search]
  When     Model     Error                               Project  Tokens  Cost
  4m ago   muse-sp…  Request timed out after 300000ms…   omp-st…  18,402  $0.0021
  ← 1338px of table in 748px: the web scrolls
```

- **`grid-main-side` collapsed.** Both cards go full width, in order.
- The signatures table gains 133px of room and now fits exactly — the only table on this screen that stops
  overflowing below 1100px.
