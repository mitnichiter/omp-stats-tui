# Activity — 150 columns (1200px viewport)

> ## ⚠️ THE WEB DASHBOARD HAS NO ACTIVITY SCREEN
>
> **This screen has no web page to capture.** The web dashboard's eleven routes are
> `overview | models | providers | costs | requests | errors | traces | tools | frustration | projects | gain`
> (`app/nav.ts:43-70`, `app/nav.ts:16-27`). None of them renders a calendar heatmap.
>
> The Activity screen is ported from **omp's own `/usage` overlay**, which is a terminal-native panel and
> therefore needs no porting from the web. The IR says so in its own words at `src/layout/spec.ts:474-478`:
>
> > *"THE WEB DASHBOARD HAS NO ACTIVITY ROUTE. The calendar lives in omp's own /usage overlay, fed by the same
> > local calendar-day points, so this spec is ported from there and not from routes/."*
>
> **Source of truth for this document:**
> `@oh-my-pi/pi-tui/src/overlays/usage-dashboard.ts` (54.5 KB), lines cited inline.
> **No screenshot exists and none can** — there is no web URL for this screen. This file is **source-derived only**.
> See `README.md` § Capture status.
>
> The `ir` citation in `spec.ts:474-478` is:
> `lines: "305-345 (buildHeatmapLayout), 467-476 (totals), 824-875 (#renderHeatmap)"`.

---

## How this maps onto the web's palette

The overlay is not a CSS consumer, so this file cites no `styles.css` line for its own rules. For a terminal port
that wants the web's colour discipline, the correspondence is exact and worth stating once:

| Overlay | Web equivalent | Value |
|---|---|---|
| `theme.fg("accent", "Activity")` on the title (`:848`) | `--accent` | `#f068c8` (`styles.css:36`) |
| `theme.fg("dim", …)` for the totals, labels and month row (`:848`, `:862`) | `--ink-3` | `#6c6c74` (`styles.css:29`) |
| `theme.getColorHex("accent")` as the ramp's `to` (`:811`) | `--accent-a` | `#5ad8e6` (`styles.css:34`) |
| ramp `from = rgb(20,20,24)` on a dark chassis (`:810`) | `--card` | `#0e0e10` (`styles.css:14`) — +6 on each channel |
| `HEAT_LEVEL_TOKENS` (`:366`) | the `--chart-grid` → `--chart-primary` ramp | `rgba(255,255,255,0.055)` → `#5ad8e6` (`styles.css:52`, `55`) |
| `HEATMAP_DAY_LABELS` (`:293`) | the web's `.chart-axis text` colour | `#5c5c64` (`styles.css:53`) |

## No page header

omp's `/usage` overlay has **no `PageHeader` equivalent** — no title, no description, no actions. Its Activity
block is headed by a single **bold accent line** with the totals inline (`usage-dashboard.ts:848-850`):

```ts
summary.push(
	`${theme.bold(theme.fg("accent", "Activity"))} ${theme.fg("dim", `${cost} · ${requests} requests · last ${weeks} weeks`)}${this.#syncing ? theme.fg("dim", " · syncing…") : ""}`,
);
summary.push("");
```

The structure is: **bold accent `"Activity"` → space → dim `"<cost> · <requests> requests · last <N> weeks"`**,
plus `" · syncing…"` when a sync is in flight, then **one blank line**. The native-component variant is
equivalent: `node("col", { role: "omp.usage.activity", gap: "sm" }, children, "activity")` (`:1148`) — so the block
is a titled column with an `"sm"` (≈ 8px ≈ 1 terminal cell) internal gap.

## Top-level order

The Activity block is preceded by the overlay's **cards grid** (`#overviewLines`, `:877-883`):

```ts
#overviewLines(innerWidth: number): string[] {
	const lines: string[] = [];
	lines.push(...this.#renderCardsGrid(innerWidth));
	lines.push("");
	lines.push(...this.#renderHeatmap(innerWidth));
	return lines;
}
```

| # | Element | Citation |
|---|---|---|
| 1 | `#renderCardsGrid(innerWidth)` — the per-provider quota cards | `usage-dashboard.ts:878` |
| 2 | **one blank line** | `:879` |
| 3 | `#renderHeatmap(innerWidth)` — month row + 7 day rows | `:880` |

**The IR's band order for this screen is: statRow → chart(heatmap) → note** (`spec.ts:480-516`), which matches
`#overviewLines` once the cards grid is accounted for by the IR's `deferred` boundary.

## Band 1 — statRow: Activity cost / Activity requests

`spec.ts:481-494`. Two tiles:

| Tile | label | metric | emphasis | hint | spark | `size` |
|---|---|---|---|---|---|---|
| 1 | `Activity cost` | `sum` over `dailyActivity.cost` | **`primary`** | none | none | md |
| 2 | `Activity requests` | `sum` over `dailyActivity.requests` | normal | none | none | md |

**Both are derived sums, not aggregates** — `spec.ts:486` and `:491` are `DerivedRef` with `op: "sum"` over a
`SeriesRef` on `dailyActivity`. Neither has a `hint`, so in a port both render as **2-line tiles** (label + 24px
value), matching `Stat.tsx:37-42`'s gate on `hint !== undefined || delta`.

The overlay's own headline is a **single combined line**, not two tiles (`:848-850`), built by `formatActivityTotals`
(`:467-476`):

```ts
function formatActivityTotals(layout: HeatmapLayout): string {
	const cost =
		layout.totalCost >= 1
			? `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(layout.totalCost)}`
			: `$${layout.totalCost.toFixed(2)}`;
	const requests = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
		layout.totalRequests,
	);
	return `${cost} · ${requests} requests`;
}
```

**This is a formatter combination that appears nowhere else in the dashboard:**

| Figure | Rule | Citation |
|---|---|---|
| Cost ≥ `$1` | `Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })` → **`$4`**, no decimals | `:470` |
| Cost < `$1` | `.toFixed(2)` → **`$0.41`**, exactly 2 decimals | `:471` |
| Requests | `{ notation: "compact", maximumFractionDigits: 1 }` → **`5.6K`** — **one** decimal, not the two `formatCompact` uses | `:472-474` |

Compare `data/formatters.ts`: `formatCompact` is `{ notation: "compact" }` with **default** `maximumFractionDigits`
(so `2,038` → `2K`, no decimal), and `formatCost` uses 2 or 4 decimals (`formatters.ts:19-26`). **The overlay's
activity totals deliberately use a third, tighter convention.** A terminal that reuses `formatCompact` for the
requests figure will print `6K` where the overlay prints `5.6K`.

The native variant appends the window: `· last ${NATIVE_HEATMAP_WEEKS} weeks` (`:1144`), or
`No activity in the last ${NATIVE_HEATMAP_WEEKS} weeks` when both totals are zero (`:1145`).

## Band 2 — chart: the heatmap

`spec.ts:495-511`. `type: "heatmap"`, `axis: "cost"`,
`calendar: { orientation: "weeks-as-columns", dayLabels: ["M","T","W","T","F","S","S"] }` (`:502`).

### The glyph rendering (`#renderHeatmap`, `usage-dashboard.ts:824-875`)

```
line 0   <blank>   <month labels, dim, horizontally positioned>          :853-862
line 1   "M"       ░▒▓█ …                                              :864-871
line 2   "T"       ░▒▓█ …
line 3   "W"       ░▒▓█ …
line 4   "T"       ░▒▓█ …
line 5   "F"       ░▒▓█ …
line 6   "S"       ░▒▓█ …
line 7   "S"       ░▒▓█ …
```

```ts
const labelWidth = 2;
const weeks = Math.max(4, Math.min(53, Math.floor((innerWidth - labelWidth) / 2)));   // :833-834
```

and the cell loop (`:865-871`):

```ts
const cell = layout.cells[day][week];
if (cell === null) line += "  ";
else if (cell === 0) line += `${theme.fg("dim", "·")} `;
else line += `${ramp[cell - 1]}■${reset} `;
```

**Every number that matters here:**

| Number | Value | Citation |
|---|---|---|
| **Day-label width** | **`2` cells** (1 char + 1 space) | `:833` |
| **Cell width** | **`2` cells** — the `"/2"` in the weeks formula | `:834` |
| **Weeks range** | **`max(4, min(53, …))`** — never fewer than 4, never more than 53 | `:834` |
| **Cell glyph, level 0** | **`·` MIDDLE DOT in `dim`** | `:868` |
| **Cell glyph, levels 1–4** | **`■` BLACK SQUARE (U+25A0) in `ramp[level-1]`** | `:870` |
| **Cell glyph, future day** | **two spaces** (nothing at all) | `:867` |
| **Row labels** | `HEATMAP_DAY_LABELS = ["M","T","W","T","F","S","S"]` — **all seven, Monday first** | `:293` |
| Native row labels | `HEATMAP_ROW_LABELS = ["M","","W","","F","",""]` — **only M/W/F, alternating blanks** | `:368` |
| Line trimming | `.trimEnd()` — trailing spaces removed | `:871` |

**The IR uses the 7-label form** (`spec.ts:502`), matching `HEATMAP_DAY_LABELS`. The native `chart` component uses
the 3-label form (`HEATMAP_ROW_LABELS`, `:368`, passed at `:1174`) — **two different label sets exist in the same
file for the two rendering paths.** Pick one deliberately.

### Intensity levels — square-root compressed, 0–4

`buildHeatmapLayout`, `usage-dashboard.ts:313-360`:

```ts
const level = (value: number): number => {
	if (value <= 0 || max <= 0) return 0;
	return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / max) * 4)));
};                                                                                        // :325-328
```

| Property | Value | Citation |
|---|---|---|
| Level range | **0 – 4** (5 states) | `:327` |
| Compression | **`sqrt`** — so a mid-size day stays distinguishable from an outlier | comment `:305-312` |
| Ceiling | `Math.ceil`, so any nonzero value is at least **1** | `:327` |
| Saturation | `Math.min(4, …)` | `:327` |
| **Metric** | **`anyCost ? point.cost : point.requests`** — per-day **cost**, **falling back to request counts when nothing in range has priced usage** | `:315-316` |
| `max` | taken over **in-range** points only | `:320` |
| **Explicitly NOT rank quartiles** | *"Unlike GitHub's rank quartiles, intensity tracks how much work a day carried."* | comment `:310-312` |

**The IR records the same rule** at `spec.ts:512-515`: *"Levels are square-root compressed against the busiest day,
over per-day cost, falling back to request counts when nothing in range has priced usage — never rank quartiles,
because intensity tracks how much work a day carried."* This is the one place the IR and the source agree verbatim.

### Colour ramp — 4 levels, interpolated toward the accent

`#heatRamp()`, `usage-dashboard.ts:807-822`:

```ts
const darkBackground = (colorLuma(theme.getColorHex("text")) ?? 1) > 0.5;
const from = darkBackground ? { r: 20, g: 20, b: 24 } : { r: 244, g: 244, b: 246 };
const to = hexToRgb(theme.getColorHex("accent"));
return [0.3, 0.5, 0.72, 1].map(t => colorToAnsi(rgbToHex({...}), mode));
```

| Level | Blend factor `t` | Dark-background from-colour | Native span token |
|---|---|---|---|
| — | `0` | `rgb(20,20,24)` | (level 0 uses `·` in `dim`, not the ramp) |
| 1 | **`0.30`** | `rgb(20,20,24)` | `dim` (`:366`) |
| 2 | **`0.50`** | — | `accent dim` (`:366`) |
| 3 | **`0.72`** | — | `accent` (`:366`) |
| 4 | **`1.00`** | → the accent hex exactly | `accent strong` (`:366`) |

`HEAT_LEVEL_TOKENS = ["dim", "accent dim", "accent", "accent strong"]` (`:366`) — the `table`-fallback path's
equivalent. `colorToAnsi(…, mode)` means the ramp is **colour-mode aware**: in `256color` it degrades to the nearest
representable entry rather than emitting a truecolor sequence.

**The ramp's `from` is `rgb(20,20,24)`, not the panel background.** On the dark chassis that is *lighter* than
`--bg #000` (`:12` in styles.css) and close to `--card #0e0e10` (`:14`) — so a level-1 cell is a barely-there
square, which is why level 0 uses a `·` rather than a very faint square.

### Month labels

`:853-862`:

```ts
let monthLine = " ".repeat(labelWidth);
for (let week = 0; week < weeks; week++) {
	const label = layout.monthLabels[week];
	const targetCol = labelWidth + week * 2;
	if (label && targetCol >= visibleWidth(monthLine)) {
		monthLine = monthLine.padEnd(targetCol) + label;
	}
}
summary.push(theme.fg("dim", truncateToWidth(monthLine, innerWidth)));
```

- `MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]` (`:291`) — **3 letters**.
- A month label is emitted **only on the week column where the month changes** (`buildHeatmapLayout:339-344`), so
  a 53-week year shows ~13 labels, not 53.
- Labels are **right-positioned at `labelWidth + week * 2`**, i.e. every column is exactly 2 cells.
- The line is **`truncateToWidth(..., innerWidth)`**-clipped and rendered `dim`.
- The native `chart` path additionally **drops a month label whose successor starts within two columns**
  (`:1167-1171`, "GitHub's rule").

### Grid geometry

`buildHeatmapLayout`, `usage-dashboard.ts:313-360`:

| Property | Value | Citation |
|---|---|---|
| Orientation | **weeks as columns**, days as rows | comment `:280`; IR `spec.ts:502` |
| Week start | **Monday** — `mondayOffset = (today0.getDay() + 6) % 7` | `:322` |
| Grid end | the current week (today's week) | `:323` |
| Grid start | `currentMonday - (weeks - 1) * 7` | `:324` |
| Cell array | `7 rows × weeks columns`, `null` = future day | `:334-337` |
| Day key | `localIso(date)` = local `YYYY-MM-DD` | `:295-299`, `:341` |
| Range filter | `point.day >= startIso && point.day <= todayIso` | `:319` |

## Band 3 — note

`spec.ts:512-515`, quoting the source's own comment at `usage-dashboard.ts:305-312`. The note is not rendered in
the overlay; it is the IR's record of *why* the level function is what it is.

## Terminal shape at 150 columns

```
<provider quota cards>
                                ← one blank line (:879)

Activity  $4 · 5.6K requests · last 53 weeks       ← bold accent + dim (:848-850)

              Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct
M              ·  ░   ·  ░  ·  ▒  ▓  █  █  █  █  ▒  ▒  ▓  ▓  █  █  ▓      ← 73 week columns
T              ·   ·  ░  ▒  ·  ▒  ▒  ▓  █  █  ▒  ▒  ·   ·  ▒  ▓  █  ▓
W              ·  ░  ▒  ·  ▒  ▓  ·  ▓  ▒  ▓  █  ░  ▒  ▒  ▓  ·  ▓  ▒  ▓
T              ▒  ·  ░  ▒  ▒  ·  ·  ▒  ▓  █  ▒  ·  ·  ░  ▒  █  ▒  ▒  ·
F              ·   ·  ·  ·  ·  ·  ▒  ·  ·  ·  ·  ·  ·  ░  ·  ·  ░  ·
S                                                                          
S                                                                          
```

- `weeks = max(4, min(53, floor((innerWidth - 2) / 2)))` → at innerWidth ≈ 146, `floor(144/2) = 72`, clamped to
  **53** — the full GitHub-style year.
- **Cell glyphs are `·` (level 0) and `■` (levels 1–4)**, each 2 cells wide including its trailing space.
- **Day labels occupy a fixed 2-cell gutter** on every row.
- **There is no card, no border, no stat grid and no table** — the overlay's Activity block is a bold accent title
  line, a blank line, a dim month row, and seven 2-cell-per-column day rows.
