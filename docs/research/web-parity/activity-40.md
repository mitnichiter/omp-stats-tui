# Activity — 40 columns (320px viewport)

> ## ⚠️ Source-derived — no web capture exists
>
> The web dashboard has **no Activity screen** (`app/nav.ts:16-27`, `:43-70`). This screen is ported from
> **omp's own `/usage` overlay**, per the IR at `src/layout/spec.ts:474-478`.
> **Source of truth:** `@oh-my-pi/pi-tui/src/overlays/usage-dashboard.ts`.
> **No screenshot can exist** — there is no web URL for this screen.
>
> **IR citation** (`spec.ts:474-478`): `lines: "305-345 (buildHeatmapLayout), 467-476 (totals),
> 824-875 (#renderHeatmap)"`. Full structure: **`activity-150.md`**.

---


## How this maps onto the web's palette

The overlay is not a CSS consumer, so these files cite no `styles.css` line. For a terminal port that wants the
web's colour discipline, the correspondence is exact and worth stating once:

| Overlay | Web equivalent | Value |
|---|---|---|
| `theme.fg("accent", "Activity")` on the title (`:848`) | `--accent` | `#f068c8` (`styles.css:36`) |
| `theme.fg("dim", …)` for the totals, labels, month row (`:848`, `:862`) | `--ink-3` | `#6c6c74` (`styles.css:29`) |
| `theme.getColorHex("accent")` as the ramp's `to` (`:811`) | `--accent-a` | `#5ad8e6` (`styles.css:34`) |
| ramp `from = rgb(20,20,24)` on a dark chassis (`:810`) | `--card` | `#0e0e10` (`styles.css:14`) — +6 on each channel |
| `HEAT_LEVEL_TOKENS` (`:366`) | `--chart-grid` → `--chart-primary` ramp | `rgba(255,255,255,0.055)` → `#5ad8e6` (`styles.css:52`, `55`) |
| `HEATMAP_DAY_LABELS` (`:293`) | the web's `.chart-axis text` colour | `#5c5c64` (`styles.css:53`) |

## The one number that changes: week count

`usage-dashboard.ts:833-834` — `weeks = Math.max(4, Math.min(53, Math.floor((innerWidth - labelWidth) / 2)))`,
`labelWidth = 2`, `innerWidth = Math.max(20, width - 4)` (`:898`).

| Width | `innerWidth` | **weeks** | Days spanned | Cells per row |
|---|---|---|---|---|
| 150 | 146 | 53 | 371 | 106 |
| 100 | 96 | 47 | 329 | 94 |
| 60 | 56 | 27 | 189 | 54 |
| **40** | **36** | **17** | **119** | **34** |

**At 40 columns the heatmap shows 17 weeks — about four months.** The grid start moves to
`currentMonday - 16 * 7 days` (`:324`), i.e. 112 days before this week's Monday. The right edge stays pinned to
today, so the panel always shows the *most recent* 17 weeks and silently drops the older ones.

**The `max(4, …)` floor still has not engaged** — 40 columns yields 17. The floor would need
`innerWidth ≤ 10`, which `Math.max(20, …)` (`:898`) already excludes. Record the floor; do not design around it.

## Headline

No `PageHeader`. One bold-accent line (`:848-850`):

```
Activity  $4 · 5.6K requests · last 17 weeks
```

- `theme.bold(theme.fg("accent", "Activity"))` + space + `theme.fg("dim", "<cost> · <requests> requests · last <N> weeks")`.
- `" · syncing…"` appended `dim` while syncing.
- **53 → 47 → 27 → 17** is the whole width story, visible in this one string.
- The native `chart` path appends a **constant** `· last ${NATIVE_HEATMAP_WEEKS} weeks` with
  `NATIVE_HEATMAP_WEEKS = 53` (`:364`, `:1144`), so it would wrongly claim 53 weeks at 40 columns. **The glyph path
  is authoritative.**

## Formatters — unchanged by width

`formatActivityTotals`, `usage-dashboard.ts:467-476`:

| Figure | Rule | Output |
|---|---|---|
| Cost ≥ `$1` | `Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })` | `$4` |
| Cost < `$1` | `.toFixed(2)` | `$0.41` |
| Requests | `Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })` | `5.6K` |

**One decimal on the requests figure** — `data/formatters.ts:15-17`'s `formatCompact` uses `notation: "compact"`
with the **default** `maximumFractionDigits` and prints `6K`. Two conventions, two results; do not unify them.

The IR models the pair as two hintless `derived` `sum` tiles — `Activity cost` (`emphasis: "primary"`),
`Activity requests` — `spec.ts:481-494`, both **2-line** (`Stat.tsx:37-42`).

## Heatmap — 17 week columns

```
<provider quota cards>
                                ← one blank line (:879)

Activity  $4 · 5.6K requests · last 17 weeks

    Jan  Feb  Mar  Apr
M   ·   ░   ·  ░   ·  ▒  ▓  █  █  ▒  ▓  ·  █  ▓  █  ▒  ▓  ░  ▒   ← 17 columns = 34 cells
T   ·   ·  ░  ▒   ·  ▒  ·  ▓  █  ▒   ·  ·  ▒  ·  ▓  ▒  █  ·  ▒  ▒
W   ·  ░  ▒   ·  ░  ▒  ·  ▓  ▒  █   ·  ·  ·  ░  ·  ▓  ·  ▓  ░  ▒  ░
T  ▒   ·  ░  ▒   ·  ▒  ·  ·  ░  ▒   ·  ·  ·  ░  ▒  ·  ▓  ▒  ·  ░  ·
F  ·   ·   ·   ·   ·  ░  ·  ·   ·  ·  ·  ·   ·  ·  ░  ·  ·  ░  ·  ░
S
S
```

| Property | Value | Citation |
|---|---|---|
| Day-label gutter | `2` cells | `:833` |
| Cell width | `2` cells | `:834` |
| **Weeks** | **17** | `:834` |
| Level 0 | `·` in `dim` | `:868` |
| Levels 1–4 | `■` in `ramp[level-1]` | `:870` |
| Future day | two spaces | `:867` |
| Row labels | all 7 — `["M","T","W","T","F","S","S"]` | `:293` |
| Line trim | `.trimEnd()` | `:871` |

**At 40 columns two of the seven rows (Saturday, Sunday) are almost certainly blank** — but the overlay prints all
seven regardless, and the day-label ladder is what lets a column be read as a week. **Do not drop weekend rows at
this width**; that trades the grid's readability for two lines.

## Intensity and colour — unchanged by width

`level = min(4, max(1, ceil(sqrt(value / max) * 4)))` (`:325-328`) — 0–4, square-root compressed so mid-size days
stay distinct from outliers, **never rank quartiles** (comment `:305-312`; IR `spec.ts:512-515`).
Metric `anyCost ? point.cost : point.requests` (`:315-316`), `max` over in-range points only (`:320`).

Ramp `[0.3, 0.5, 0.72, 1]` from `rgb(20,20,24)` (dark) / `rgb(244,244,246)` (light) toward the accent hex,
through `colorToAnsi(…, mode)` (`:807-822`) — **mode-aware**, degrading in `256color`.
Native tokens `["dim","accent dim","accent","accent strong"]` (`:366`).

**At 40 columns a `■` is 1 cell of a 36-cell line** — the whole ramp has to survive the terminal's own colour
resolution, which is exactly what `colorToAnsi(…, mode)` is for.

## Month labels

`:853-862`: emitted **only where the month changes** (`:339-344`), **3 letters** (`MONTH_NAMES`, `:291`),
right-positioned at `labelWidth + week * 2`, line `truncateToWidth(..., innerWidth)` in `dim`.

**At 40 columns a 17-week window spans ~4 months, so ~4 labels across 34 cells (12% of the row)** — still fits.
The native `chart` path drops any label whose successor starts within two columns (`:1167-1171`), which at this
density can remove a label the glyph path would keep.

## Terminal shape at 40 columns

```
<provider quota cards>

Activity  $4 · 5.6K requests · last 17 weeks

    Jan  Feb  Mar  Apr
M   ·   ░   ·  ░   ·  ▒  ▓  █  █  ▒  ▓  ·  █  ▓  █  ▒  ▓  ░  ▒
T   ·   ·  ░  ▒   ·  ▒  ·  ▓  █  ▒   ·  ·  ▒  ·  ▓  ▒  █  ·  ▒  ▒
W   ·  ░  ▒   ·  ░  ▒  ·  ▓  ▒  █   ·  ·  ·  ░  ·  ▓  ·  ▓  ░  ▒  ░
T  ▒   ·  ░  ▒   ·  ▒  ·  ·  ░  ▒   ·  ·  ·  ░  ▒  ·  ▓  ▒  ·  ░  ·
F  ·   ·   ·   ·   ·  ░  ·  ·   ·  ·  ·  ·   ·  ·  ░  ·  ·  ░  ·  ░
S
S
```

**What 40 columns costs.** Nothing structural. Seven rows, a 2-cell gutter, 2 cells per column, four month labels,
`·` and `■`. The only loss is **history**: 119 days instead of 371. **The screen gets shorter-narrower, not
reduced** — which is the same answer the web gives at every narrower width, and the reason a terminal port of this
screen needs no width-specific layout logic beyond the week count.
