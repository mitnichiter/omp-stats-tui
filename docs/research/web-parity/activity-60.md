# Activity — 60 columns (480px viewport)

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
with `labelWidth = 2` and `innerWidth = Math.max(20, width - 4)` (`:898`).

| Width | `innerWidth` | **weeks** | Cells per row |
|---|---|---|---|
| 150 | 146 | 53 | 106 |
| 100 | 96 | 47 | 94 |
| **60** | **56** | **27** | **54** |
| 40 | 36 | 17 | 34 |

**At 60 columns the heatmap shows 27 weeks — about half a year.** The right edge stays pinned to today; the left
edge recedes to `start = addDays(currentMonday, -(weeks - 1) * 7)` (`:324`), i.e. 182 days back.

**The `max(4, …)` floor has not engaged at any ported width** — the narrowest, 40 columns, still yields 17. The
floor would only matter below `innerWidth = 10`, which `innerWidth`'s own `Math.max(20, …)` (`:898`) already
prevents. Record it; do not rely on it.

## Headline

No `PageHeader`. One bold-accent line (`:848-850`):

```
Activity  $4 · 5.6K requests · last 27 weeks
```

- `theme.bold(theme.fg("accent", "Activity"))` + a space + `theme.fg("dim", "<cost> · <requests> requests · last <N> weeks")`.
- `" · syncing…"` appended `dim` while syncing (`:850`).
- **The `last N weeks` figure is the only width-dependent text on the screen: 53 → 47 → 27 → 17.**
- The native `chart` path instead appends a **constant** `· last ${NATIVE_HEATMAP_WEEKS} weeks` with
  `NATIVE_HEATMAP_WEEKS = 53` (`:364`, `:1144`) — so the two rendering paths disagree about this number. The glyph
  path (`#renderHeatmap`) is width-adaptive; the native path is not.

## Formatters — unchanged by width

`formatActivityTotals`, `usage-dashboard.ts:467-476`:

| Figure | Rule | Output |
|---|---|---|
| Cost ≥ `$1` | `Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })` | `$4` |
| Cost < `$1` | `.toFixed(2)` | `$0.41` |
| Requests | `Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })` | `5.6K` |

**The requests figure carries ONE decimal** — `data/formatters.ts:15-17`'s `formatCompact` uses
`notation: "compact"` with the **default** `maximumFractionDigits` and would print `6K`. Keep the two apart.

The IR splits these into two hintless `derived` `sum` tiles — `Activity cost` (`emphasis: "primary"`) and
`Activity requests` (`spec.ts:481-494`) — both **2-line** tiles (`Stat.tsx:37-42`).

## Heatmap — 27 week columns

```
<provider quota cards>
                                ← one blank line (:879)

Activity  $4 · 5.6K requests · last 27 weeks

      Jan  Feb  Mar  Apr  May  Jun  Jul
M     ·   ░   ·  ░   ·  ▒  ▓  █  █  ▒  ▓  ·  █  ▓  █  ▒  ▓  ░  ▒  ▓      ← 27 columns = 54 cells
T     ·   ·  ░  ▒   ·  ▒  ·  ▓  █  ▒   ·  ·  ▒  ·  ▓  ▒  █  ·  ▒  ▒  ▓
W     ·  ░  ▒   ·  ░  ▒  ·  ▓  ▒  █   ·  ·  ·  ░  ·  ▓  ·  ▓  ░  ▒  ░
T    ▒   ·  ░  ▒   ·  ▒  ·  ·  ░  ▒   ·  ·  ·  ░  ▒  ·  ▓  ▒  ·  ░  ·  ·
F    ·   ·   ·   ·   ·  ░  ·  ·   ·  ·  ·  ·   ·  ·  ░  ·  ·  ░  ·  ░
S
S
```

| Property | Value | Citation |
|---|---|---|
| Day-label gutter | `2` cells | `:833` |
| Cell width | `2` cells | `:834` |
| **Weeks** | **27** | `:834` |
| Level 0 | `·` in `dim` | `:868` |
| Levels 1–4 | `■` in `ramp[level-1]` | `:870` |
| Future day | two spaces | `:867` |
| Row labels | all 7 — `["M","T","W","T","F","S","S"]` | `:293` |
| Line trim | `.trimEnd()` | `:871` |

**The weekend rows are almost always empty** — a working week has little Saturday/Sunday activity — so at 60
columns two of the seven rows carry visible information while five do not. **The overlay still prints all seven.**
That vertical cost is intentional: the `M T W T F S S` ladder is what makes a column readable as a week.

## Intensity and colour — unchanged by width

`level = min(4, max(1, ceil(sqrt(value / max) * 4)))` (`:325-328`). Metric `anyCost ? point.cost : point.requests`
(`:315-316`), `max` over in-range points (`:320`), **square-root compressed, never rank quartiles** (comment
`:305-312`; IR `spec.ts:512-515`).

Ramp `[0.3, 0.5, 0.72, 1]` blended from `rgb(20,20,24)` (dark) / `rgb(244,244,246)` (light) toward the accent hex,
through `colorToAnsi(…, mode)` (`:807-822`) — **mode-aware**, so it degrades in `256color`.
Native tokens: `["dim","accent dim","accent","accent strong"]` (`:366`).

## Month labels

`:853-862`: emitted **only on the week column where the month changes** (`:339-344`), **3 letters**
(`MONTH_NAMES`, `:291`), right-positioned at `labelWidth + week * 2`, whole line `truncateToWidth(..., innerWidth)`
in `dim`.

**At 60 columns a 27-week window spans ~7 months, so ~7 labels across 54 cells** — 21% of the row. The native
`chart` path additionally drops any month label whose successor starts within two columns (`:1167-1171`).

## Terminal shape at 60 columns

```
<provider quota cards>

Activity  $4 · 5.6K requests · last 27 weeks

      Jan  Feb  Mar  Apr  May  Jun  Jul
M     ·   ░   ·  ░   ·  ▒  ▓  █  █  ▒  ▓  ·  █  ▓  █  ▒  ▓  ░  ▒  ▓
T     ·   ·  ░  ▒   ·  ▒  ·  ▓  █  ▒   ·  ·  ▒  ·  ▓  ▒  █  ·  ▒  ▒  ▓
W     ·  ░  ▒   ·  ░  ▒  ·  ▓  ▒  █   ·  ·  ·  ░  ·  ▓  ·  ▓  ░  ▒  ░
T    ▒   ·  ░  ▒   ·  ▒  ·  ·  ░  ▒   ·  ·  ·  ░  ▒  ·  ▓  ▒  ·  ░  ·  ·
F    ·   ·   ·   ·   ·  ░  ·  ·   ·  ·  ·  ·   ·  ·  ░  ·  ·  ░  ·  ░
S
S
```

- **Only the week count changes: 47 → 27.** No row is dropped, no label is dropped, no glyph changes.
- The two weekend rows cost 2 of 7 rows and carry almost nothing — but the overlay prints them anyway, and so
  must the port, or a column stops being readable as a week.
- The IR declares `orientation: "weeks-as-columns"` and the 7-label set (`spec.ts:502`) but **no week count** — the
  terminal derives it from its own width using `floor((innerWidth - 2) / 2)` clamped to `[4, 53]`.
