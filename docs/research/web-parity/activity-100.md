# Activity — 100 columns (800px viewport)

> ## ⚠️ Source-derived — no web capture exists
>
> The web dashboard has **no Activity screen**. Its eleven routes are listed in `app/nav.ts:16-27` and
> `app/nav.ts:43-70`; none renders a calendar. The Activity screen is ported from **omp's own `/usage` overlay**,
> a terminal-native panel — the IR says so at `src/layout/spec.ts:474-478`.
>
> **Source of truth:** `@oh-my-pi/pi-tui/src/overlays/usage-dashboard.ts`, cited inline.
> **No screenshot can exist** — there is no web URL for this screen.
>
> **IR citation** (`spec.ts:474-478`):
> `lines: "305-345 (buildHeatmapLayout), 467-476 (totals), 824-875 (#renderHeatmap)"`.
> Full structure: **`activity-150.md`**.

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

`usage-dashboard.ts:833-834`:

```ts
const labelWidth = 2;
const weeks = Math.max(4, Math.min(53, Math.floor((innerWidth - labelWidth) / 2)));
```

The overlay computes `innerWidth = Math.max(20, width - 4)` (`:898`), so a 100-column panel yields
`innerWidth = 96`:

| Width | `innerWidth` | `floor((innerWidth - 2) / 2)` | **clamped `weeks`** | Cells per row |
|---|---|---|---|---|
| 150 | 146 | 72 | **53** (capped at 53) | 106 |
| **100** | **96** | **47** | **47** | **94** |
| 60 | 56 | 27 | 27 | 54 |
| 40 | 36 | 17 | 17 | 34 |

**At 100 columns the heatmap shows 47 weeks, not 53.** The 53-week cap only engages at 150 columns (106 cells of
153 available). Below that the grid **slides its start date backwards** — `start = addDays(currentMonday,
-(weeks - 1) * 7)` (`:324`) — so the right edge always stays pinned to today and the left edge recedes.

**Everything else about the heatmap is identical at every width:** 7 rows, a 2-cell day-label gutter, 2 cells per
week column, `·` for level 0, `■` for levels 1–4, blank for future days.

## Headline

No `PageHeader` equivalent. One bold-accent line plus a dim totals string (`:848-850`):

```
Activity  $4 · 5.6K requests · last 47 weeks
```

- Bold accent `"Activity"`, one space, then `theme.fg("dim", "<cost> · <requests> requests · last <N> weeks")`.
- `" · syncing…"` is appended in `dim` while a sync is in flight (`:850`).
- **The `last N weeks` figure in the headline changes with the width** — at 150 it reads `last 53 weeks`, at 100 it
  reads `last 47 weeks`. This is the only place in the Activity block where the width is visible in the *text*.
- Native equivalent: `" · last ${NATIVE_HEATMAP_WEEKS} weeks"` appended to `formatActivityTotals(layout)` (`:1144`),
  where `NATIVE_HEATMAP_WEEKS = 53` (`:364`) — **a constant**, so the native path always shows 53 regardless of
  width, while the glyph path adapts. Two renderings, two answers.

## Formatters — unchanged by width

`formatActivityTotals`, `usage-dashboard.ts:467-476`:

| Figure | Rule | Output shape |
|---|---|---|
| Cost ≥ `$1` | `Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })` | `$4` |
| Cost < `$1` | `.toFixed(2)` | `$0.41` |
| Requests | `Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })` | `5.6K` |

**The requests figure carries ONE decimal — unlike `formatCompact` in `data/formatters.ts:15-17`, which uses
`notation: "compact"` with the default `maximumFractionDigits`.** `data/formatters.ts` would print `6K`; the overlay
prints `5.6K`. Keep them distinct.

The IR models the same two figures as two `derived` `sum` tiles at `spec.ts:481-494` — `Activity cost`
(`emphasis: "primary"`) and `Activity requests` — **neither with a `hint`**, so both render as 2-line tiles
(`Stat.tsx:37-42`).

## Heatmap — 47 week columns

```
<provider quota cards>
                                ← one blank line (:879)

Activity  $4 · 5.6K requests · last 47 weeks

        Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
M        ·   ░   ·  ░   ·  ▒  ▓  █  █  ▓  █  ▒  ▓  ·  ▓  ▒  █  ▓        ← 47 columns = 94 cells
T        ·   ·  ░  ▒   ·  ▒  ·  ▓  █  ▒  █  ·  ·  ▒  ·  ▓  ▒  █  ▒  ▓
W        ·  ░  ▒   ·  ░  ▒  ·  ▓  ▒  █  ·  ·  ▒  ▒  ·  ▓  ·  ▓  ░  ▒  ░
T        ▒   ·  ░  ▒   ·  ▒  ·  ·  ░  ▒  █  ·  ·  ·  ░  ▒  ·  ▓  ▒  ·  ·
F        ·   ·   ·   ·   ·  ░  ·  ·  ·  ·  ·  ·  ·  ·  ░  ·  ·  ░  ·  ░
S                                                                    
S                                                                    
```

| Property | Value | Citation |
|---|---|---|
| Day-label gutter | `2` cells | `:833` |
| Cell width | `2` cells | `:834` |
| Weeks | **47** | `:834` |
| Level 0 | `·` in `dim` | `:868` |
| Levels 1–4 | `■` in `ramp[level-1]` | `:870` |
| Future day | two spaces | `:867` |
| Row labels | all 7, `["M","T","W","T","F","S","S"]` | `:293` |
| Trailing spaces | `.trimEnd()` | `:871` |

## Intensity and colour — unchanged by width

`level = min(4, max(1, ceil(sqrt(value / max) * 4)))` (`:325-328`) — **0–4, square-root compressed, never rank
quartiles** (comment `:305-312`; IR `spec.ts:512-515`). Metric is `anyCost ? point.cost : point.requests`
(`:315-316`), with `max` over in-range points only (`:320`).

Ramp (`:807-822`): `[0.3, 0.5, 0.72, 1]` blended from `rgb(20,20,24)` (dark) or `rgb(244,244,246)` (light) toward
the accent hex, emitted through `colorToAnsi(…, mode)` so it **degrades in `256color`**.
Native equivalent tokens: `HEAT_LEVEL_TOKENS = ["dim","accent dim","accent","accent strong"]` (`:366`).

## Month labels — unchanged in rule, fewer fit

`usage-dashboard.ts:853-862`: a label is emitted only on the week column where the month changes (`:339-344`), is
**3 letters** (`MONTH_NAMES`, `:291`), is right-positioned at `labelWidth + week * 2`, and the whole line is
`truncateToWidth(..., innerWidth)`-clipped in `dim`.

**At 100 columns a 47-week window spans ~11 months, so ~11 month labels are emitted** against 94 cells — they fit
comfortably. The clipping rule only starts biting at 40 columns.

## Terminal shape at 100 columns

```
<provider quota cards>

Activity  $4 · 5.6K requests · last 47 weeks

        Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
M        ·   ░   ·  ░   ·  ▒  ▓  █  █  ▓  █  ▒  ▓  ·  ▓  ▒  █  ▓
T        ·   ·  ░  ▒   ·  ▒  ·  ▓  █  ▒  █  ·  ·  ▒  ·  ▓  ▒  █  ▒  ▓
W        ·  ░  ▒   ·  ░  ▒  ·  ▓  ▒  █  ·  ·  ▒  ▒  ·  ▓  ·  ▓  ░  ▒  ░
T        ▒   ·  ░  ▒   ·  ▒  ·  ·  ░  ▒  █  ·  ·  ·  ░  ▒  ·  ▓  ▒  ·  ·
F        ·   ·   ·   ·   ·  ░  ·  ·  ·  ·  ·  ·  ·  ·  ░  ·  ·  ░  ·  ░
S
S
```

- **The only structural change from 150 columns is the week count: 53 → 47.** Nothing else about the heatmap
  responds to width.
- The right edge stays pinned to today; the left edge recedes (`start = currentMonday - (weeks-1)*7`, `:324`).
- The IR's `calendar` field already declares `orientation: "weeks-as-columns"` and the full 7-label set
  (`spec.ts:502`) — it declares **no** week count, so the terminal must derive it from its own width.
