# F17 — Crush's graphs, and the wider TUI chart tradition

**Access date: 2026-10-03.** All codepoints below were read out of source files and
re-derived programmatically; none are from memory.

## Headline

**Crush's TUI has no charts.** Not one sparkline, bar, gauge, meter, histogram or
heatmap exists in `internal/ui/`. Crush's charting lives in `internal/cmd/stats/`,
which generates an HTML/Chart.js dashboard and opens it in a browser — a different
program with a different renderer. The brief's premise that Crush "recently added
graph features" is true of the *web* stats command, not the terminal UI.

This is a useful negative result, and it inverts the usual reason for reading a
reference implementation: we cannot copy Crush's chart code because there is none.
What Crush *does* offer is (a) hard evidence that the closest Charm app deliberately
renders usage as a **number rather than a bar**, (b) a width-heuristic glyph table
whose weightings independently endorse our eighth-block ramp, (c) a per-cell
gradient primitive that is the exact ink model of a heatmap, and (d) two
degenerate-case guards (`max(...) == 0 → 1`, "top N plus an *others* bucket").
Everything else we need came from outside Charm — btop, ratatui, gnuplot, bubbles,
termgraph, VisiData — and those are where the recommendations below come from.

## What Crush actually has

Method: enumerated the full repository tree (1,229 paths, via
`https://api.github.com/repos/charmbracelet/crush/git/trees/HEAD?recursive=1`) and
then fetched and scanned all 232 Go files under `internal/ui/` (excluding the
vendored `internal/ui/diffview/`) plus all of `internal/cmd/`, enumerating every
non-ASCII codepoint per file. Files were read over HTTP; nothing was cloned.

### The negative result, quantified

| Probe | Range | Hits in Crush TUI code |
|---|---|---|
| Braille | U+2800–U+28FF | **0** |
| Shade blocks | U+2591–U+2593 | **0** |
| Eighth blocks | U+2581–U+2588 | 6 occurrences, all in one weight table (see below) |
| Left eighth blocks | U+2587–U+258F | 6 occurrences, all in that same table |
| Half blocks | U+2580, U+2584 | banner/wordmark art only |

There is no `graph`, `chart`, `sparkline`, `bar`, `gauge`, `meter` or `usage`
component under `internal/ui/`. A GitHub commit search for `sparkline` in the repo
returns 0 commits; `chart` returns 2, both about the web dashboard.

### Chart-adjacent files that do exist

| File | What it actually does |
|---|---|
| [`internal/ui/common/scrollbar.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/common/scrollbar.go) | A proportional meter: a thumb sized and positioned inside a fixed track. One glyph per **row**. The only genuine data-to-length mapping in the TUI. |
| [`internal/ui/logo/letterforms.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/logo/letterforms.go) + [`logo.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/logo/logo.go) | Block-letter wordmark art with a width-responsive "stretch" and separate landscape/portrait letterforms. |
| [`internal/ui/image/image.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/image/image.go) | `EncodingBlocks` — an image-to-cell painter carrying a **weighted glyph table**. Not a chart, but the table is a rarity. |
| [`internal/ui/styles/grad.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/styles/grad.go) | `ForegroundGrad` / `ApplyForegroundGrad` — one foreground colour per grapheme cluster, driven by a `Blend1D` ramp. This is a heatmap's ink model with the data removed. |
| [`internal/ui/model/header.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/model/header.go) + [`internal/ui/common/elements.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/common/elements.go) | Context-window usage as a **percentage number**, never a bar. `todoPill` does the same with `"%d/%d"`. |
| [`internal/cmd/root.go`](https://github.com/charmbracelet/crush/blob/main/internal/cmd/root.go) + [`internal/ui/model/ui.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/model/ui.go) | `supportsProgressBar()` / `applyProgressBar` — delegates to the **terminal's own** OSC 9;4 progress bar. No drawn glyphs at all. |
| [`internal/cmd/stats/index.js`](https://github.com/charmbracelet/crush/blob/main/internal/cmd/stats/index.js) | The actual charts — Chart.js in a browser. Bar, doughnut, and an hour×day-of-week bubble heatmap. |
| [`internal/db/sql/stats.sql`](https://github.com/charmbracelet/crush/blob/main/internal/db/sql/stats.sql) | The bucketing queries behind that dashboard. |

### Crush has no symbol-preset system at all

Searching every file in `internal/config/` for `nerd`, `nerdfont`, `symbolpreset`,
`ascii`, `unicodepreset` or `glyph` returns **eight** matches, none of which is a
glyph setting: an `ExitBanner` enum, a filename, a warning string, and two tests.
Every glyph Crush draws is a hardcoded Go `string` constant in
[`internal/ui/styles/styles.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/styles/styles.go)
(`styles.go:23-83`). There is no `unicode`/`nerd`/`ascii` tier, no ASCII fallback,
and no capability detection — so Crush offers nothing to copy on the preset question,
and its answer to "what if the font lacks the glyph" is "a tofu box".

## Techniques

### 1. Scrollbar — the only proportional meter in the TUI

Source: [`scrollbar.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/common/scrollbar.go),
glyphs at `styles.go:74-75`.

```
ScrollbarThumb string = "┃"    // U+2503 BOX DRAWINGS HEAVY VERTICAL
ScrollbarTrack string = "│"    // U+2502 BOX DRAWINGS LIGHT VERTICAL
```

- **Axis encoding:** the vertical axis is the track. One glyph per row; a row is
  either thumb or track. No horizontal axis, no data axis, no glyph ramp.
- **Scaling:** integer proportional, zero-baselined, on two independent quantities.
  - `thumbSize = max(1, height * viewportSize / contentSize)`
  - `maxOffset = contentSize - viewportSize`; `thumbPos = min(trackSpace, offset * trackSpace / maxOffset)`
  - Note Go integer division **truncates** — this is floor, not round-half-up.
- **Degenerate cases:** three separate early-outs, all of them deliberate.
  - `height <= 0 || contentSize <= viewportSize` → return `""`. Nothing to show is
    rendered as nothing, not as a full track.
  - `maxOffset <= 0` → return `""`.
  - `max(1, …)` floors the thumb so it **cannot vanish** when the ratio is tiny. This
    is the flat-series guard: a vanishing mark would be indistinguishable from no data.
- **Narrow terminal:** height-driven, not width-driven. Width is irrelevant here, so
  Crush gets this for free — and it is why the scrollbar is a poor model for our
  width-sensitive charts.

### 2. Wordmark letterforms — width-responsive block art

Source: [`letterforms.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/logo/letterforms.go),
[`logo.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/logo/logo.go).

Glyphs used, verified: `█` U+2588, `▀` U+2580, `▄` U+2584, `╱` U+2571.

- **Stretch algorithm:**
  ```go
  func stretchLetterformPart(s string, p letterformProps) string {
      if p.maxStretch < p.minStretch { p.minStretch, p.maxStretch = p.maxStretch, p.minStretch }
      n := p.width
      if p.stretch { n = cachedRandN(p.maxStretch-p.minStretch) + p.minStretch }
      parts := make([]string, n)
      for i := range parts { parts[i] = s }
      return lipgloss.JoinHorizontal(lipgloss.Top, parts...)
  }
  ```
- **Responsive policy — three ordered stages:** a width **floor**
  (`rightWidth = max(15, o.Width - crushWidth - leftWidth - 2)`) so a region never
  collapses to zero; then **fill** to the available width; then **clip** the whole
  line (`ansi.Truncate(line, o.Width, "")`). And a genuinely different idea: separate
  letterforms for portrait and landscape (`LetterE` vs `LetterEAlt`,
  `LetterSAlt`, `LetterYAlt`, documented `DO NOT REMOVE`) rather than one form that
  gets squeezed.
- **Degenerate cases:** `stretch == false` uses the declared minimum `width`; a
  `maxStretch < minStretch` configuration is repaired by swapping them.

### 3. `EncodingBlocks` — a weighted nearest-glyph painter

Source: [`internal/ui/image/image.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/image/image.go),
`canvas.Weights` map, ~line 210.

Crush paints a real image into cells by handing a third-party painter
(`go-ansi-paintbrush`) a **glyph → similarity weight** table:

| Glyph | Codepoint | Weight |
|---|---|---|
| `▁ ▂ ▃ ▄ ▅` | U+2581 U+2582 U+2583 U+2584 U+2585 | **.9** |
| `▆` | U+2586 | .85 |
| `█` | U+2588 | .85 |
| `▊ ▋ ▌ ▍ ▎ ▏` | U+258A U+258B U+258C U+258D U+258E U+258F | .95 |
| `● ◀ ▲ ▶ ◉` | U+25CF U+25C0 U+25B2 U+25B6 U+25C9 | .95 |
| `▼` | U+25BC | .9 |
| `○` | U+25CB | .8 |
| `◧ ◨ ◩ ◪` | U+25E7 U+25E8 U+25E9 U+25EA | .9 |
| *(nerd font)* | U+E0B0 U+E0B2 | .95 |

Three things matter here:

1. **The lower eighth blocks are weighted highest** (`.9`), above `▆` and `█` (`.85`).
   Crush's own painter, given real pixels, treats `▁▂▃▄▅` as the best match for dim
   ink and saves `█` for saturated cells. That is an independent endorsement of our
   eighth-block ramp.
2. **No shade characters appear in the table at all.** When Crush needed
   intermediate coverage it used *more block geometry*, not grayscale. btop, by
   contrast, reached for `░▒`. There is no consensus here; see the comparison section.
3. The left-eighth set `▊▋▌▍▎▏` is present because horizontal resolution was wanted.

### 4. `ForegroundGrad` — per-cell colour as a pure function of x

Source: [`internal/ui/styles/grad.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/styles/grad.go).

```go
ramp := lipgloss.Blend1D(len(clusters), color1, color2)
for i, c := range ramp { clusters[i] = base.Foreground(c).Render(clusters[i]) }
```

- **Axis encoding:** colour, one step per grapheme cluster, `i/(n-1)` along a CIELAB ramp.
- **Degenerate cases, both explicit:** `input == ""` → `[]string{""}`; `len(input) == 1`
  → single colour, ramp skipped entirely (a 1-step blend would be undefined).
- **Cluster safety:** segmentation uses `uniseg.NewGraphemes`, so multi-cell clusters
  are handled correctly rather than split by rune.
- This is the closest thing in Crush to a heatmap cell. Colour is independent of the
  glyph, which is exactly the property braille destroys.

### 5. Usage as a number, not a bar — the most decision-relevant finding

Source: [`header.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/model/header.go)
(`renderHeaderDetails`) and [`elements.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/common/elements.go)
(`formatTokensAndCost`).

```go
percentage := (float64(tokens) / float64(contextWindow)) * 100
percentageText := fmt.Sprintf("%d%%", int(percentage))
if estimated { percentageText = "~" + percentageText }
...
if percentage > 80 { formattedTokens = fmt.Sprintf("%s %s", styles.LSPWarningIcon, formattedTokens) }
```

- **No bar exists.** Context usage, to-do progress (`"%d/%d"`), and queue depth are
  all text. Queue depth uses `▶▶▶▶▶▶▶▶▶` U+25B6 truncated to `queue` — glyph count as
  an unbounded counter, which is a different and cleverer encoding, but capped at 9.
- **Degenerate case:** `percentage` stays 0 when `contextWindow <= 0` (explicit guard);
  a model with an unknown window never divides.
- **Width behaviour:** truncation with `…` on every measured segment
  (`ansi.Truncate(result, max(0, availWidth), "…")`).
- **Read this as a decision, not an omission.** Crush sidestepped the entire
  "what happens when the container is 14 columns wide" problem by refusing to draw a
  bar. We are drawing one, so we own that problem and must solve it explicitly.

### 6. Progress = the terminal's own progress bar

Source: [`root.go`](https://github.com/charmbracelet/crush/blob/main/internal/cmd/root.go) ~line 221,
[`ui.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/model/ui.go) ~line 3777.

```go
func supportsProgressBar() bool {
    if !term.IsTerminal(os.Stderr.Fd()) { return false }
    termProg := os.Getenv("TERM_PROGRAM")
    _, isWindowsTerminal := os.LookupEnv("WT_SESSION")
    return isWindowsTerminal || xstrings.ContainsAnyOf(strings.ToLower(termProg), "ghostty", "iterm2", "rio")
}
...
v.ProgressBar = tea.NewProgressBar(tea.ProgressBarIndeterminate, rand.Intn(100))
```

This is an **allowlist of terminal names**, not a capability probe — and the *only*
reason it is safe is that the pixels belong to the terminal, not to Crush. Every
glyph Crush does draw is unconditional Unicode. This is the concrete demonstration
behind ADR 0005's rejection of capability detection, and we should not copy it.

### 7. The web dashboard's actual chart algorithms

Source: [`internal/cmd/stats/index.js`](https://github.com/charmbracelet/crush/blob/main/internal/cmd/stats/index.js).

**Ranked-list tail policy — the one clearly portable piece:**

```js
function getTopItemsWithOthers(items, countKey, labelKey, topN = 10) {
  const topItems = items.slice(0, topN);
  const otherItems = items.slice(topN);
  const otherCount = otherItems.reduce((sum, item) => sum + item[countKey], 0);
  const displayItems = [...topItems];
  if (otherItems.length > 0) {
    displayItems.push({ [countKey]: otherCount, [labelKey]: "others" });
  }
  return displayItems;
}
```

Applied to both `tool_usage` (top 10 tools) and `usage_by_model` (top 10 models).

**Heatmap (hour × day-of-week bubble chart):**

```js
let maxCount = stats.hour_day_heatmap?.length > 0
  ? Math.max(...stats.hour_day_heatmap.map((h) => h.session_count)) : 0;
if (maxCount === 0) maxCount = 1;                 // degenerate guard
const scaleFactor = 20 / Math.sqrt(maxCount);
...
r: Math.sqrt(h.session_count) * scaleFactor,      // radius ∝ √count ⇒ AREA ∝ count
...
const ratio = count / maxCount;
return interpolateColor(ratio);                   // linear in colour, 0..1
```

Three decisions worth stealing: the **`max === 0 → 1` guard** before any division;
**max-anchored** colour (`count / maxCount`) rather than min-max, so "3× a normal day"
reads as 3× rather than as "maxed out"; and **√ scaling for area** because terminal
cell area, not radius, is what the eye compares. (Area scaling is moot for us — every
glyph is one cell — but the *max-anchored* part is not.)

Zero-count points are filtered out of the dataset entirely
(`.filter((h) => h.session_count > 0)`), so empty cells are absent cells.

**Bar charts:** `ratio = value / maxValue` drives colour; length is Chart.js's job
(linear, zero-baselined, common axis). No glyphs involved — this is SVG.

**The bucketing SQL — and a bug we must not reproduce**
([`stats.sql`](https://github.com/charmbracelet/crush/blob/main/internal/db/sql/stats.sql)):

```sql
-- name: GetUsageByDay :many
SELECT date(created_at, 'unixepoch') as day, ... GROUP BY date(created_at, 'unixepoch')
-- name: GetRecentActivity :many
... WHERE created_at >= strftime('%s', 'now', '-30 days') GROUP BY date(...)
```

Every day bucket is emitted **only if it has rows**. The JS then charts that array
directly (`stats.recent_activity.map(...)`), so days with no activity vanish from the
x-axis instead of appearing as zero. For a bar chart of "activity per day" that
misrepresents the time axis. For a calendar heatmap it would destroy the calendar
entirely. Every query also filters `parent_session_id IS NULL`, excluding subagent
sessions from all statistics — a scoping decision worth matching explicitly.

**Timezone:** `stats.go` notes SQL dates are UTC, and `index.js` shifts hour and
day-of-week into local time with a wrap-around (`(h.hour + utcOffsetHours + 24) % 24`,
and a separate day rollover for both directions). A calendar heatmap keyed on UTC
dates will be visibly wrong for every user outside UTC.

## PORTABLE vs NOT-TRANSFERABLE

### PORTABLE-AS-APPROACH

| Finding | Why it transfers | Where it came from |
|---|---|---|
| `max(1, ratio)` floor on a mark's extent | The one-line flat-series guard; a mark that reaches zero stops being distinguishable from no data | Crush `scrollbar.go:17` |
| "Render nothing when the data fits" (`contentSize <= viewportSize → ""`) | Correct degenerate policy for a component whose series is shorter than its domain | Crush `scrollbar.go:12` |
| Measure the readout first, give the bar the remainder; truncate with `…` on every measured segment | Prevents overflow without a layout engine; we do it with `Bun.stringWidth` | Crush `elements.go`, `header.go` |
| `max === 0 → 1` before dividing | Guards `0/0` in one readable line | Crush `index.js` heatmap |
| Top-N plus a synthetic **"others"** row carrying the summed tail | Keeps the ranked list short without lying about the total | Crush `index.js` |
| Colour as a pure function of cell index, independent of the glyph | Precisely why a heatmap needs one colour per cell and cannot use braille | Crush `grad.go` |
| Max-anchored ratio (`value / max`) rather than min-max | A stats panel must show absolute magnitude; min-max makes a quiet week look like a busy one | Crush `index.js`, ratatui `.max()`, btop `max_value` |
| 1-step ramp degenerates to a single colour; empty input degenerates to empty | Explicit handling of the ramp-length edge cases | Crush `grad.go`; lipgloss `Blend1D` |
| Width **floor** → fill → clip, plus genuinely different portrait/landscape forms | Prevents a region collapsing to zero, and avoids squeezing one form into both shapes | Crush `logo.go` |
| Weighted glyph table (`glyph → similarity`) | A precedent for ranking our own ramp by measured ink rather than by index | Crush `image.go` |

### NOT-TRANSFERABLE

| Finding | Why not |
|---|---|
| Every Crush component, `Styles` struct, `uv.Screen`/`Canvas` plumbing, `Draw()` signature | Go, Charm-specific, and we have no canvas — our primitive is `render(width) => readonly string[]` |
| `lipgloss.Blend1D` / `Blend2D` | Go + CIELAB. The *idea* (build a discrete ramp once, index it per cell) transfers; the code does not. We implement the ramp as an array we build at module load |
| The `EncodingBlocks` painter | Needs `go-ansi-paintbrush` and a real RGB image. We have no image path |
| The OSC 9;4 terminal progress bar and its terminal-name allowlist | Not ours to draw, and the allowlist is a guess about capability — the exact strategy ADR 0005 rejects |
| Chart.js bar/bubble/doughnut configuration | SVG in a browser; irrelevant to a string renderer |
| `ansi.Truncate` / `lipgloss.Width` | Replace with `Bun.stringWidth` and our own truncation |
| Crush's "draw a number, not a bar" | A legitimate escape hatch we are declining, not a technique to reuse |

## Comparison with our current glyph choices

### U+2581–U+2588 for sparklines — keep. Independently validated three times.

Crush does not do better because Crush has no sparkline. Outside Crush, three
independent projects converge on the same ramp:

- **ratatui** ships `symbols::bar::NINE_LEVELS` as the *default* `Marker::Bar`:
  `▁▂▃▄▅▆▇█` (U+2581–U+2588) with `█` at the top and a blank at level 0. Braille is
  opt-in there.
- **gnuplot** `set term block` half-mode (1×2 sub-cells) uses
  `U+00A0, ▀, ▄, █` — the coarse subset, because half-mode is the only sub-cell mode
  that survives its own colour rules.
- **Crush's own image painter** weights `▁▂▃▄▅` at `.9` and `▆`/`█` at `.85`.

It also matches omp's own `SPECTRUM_BLOCKS`. Four sources, no dissent. **Keep it.**

The one thing worth stealing is ratatui's *abstraction*, not its glyphs: `sub_rows`
(`Bar => 8, HalfBlock => 2, Sextant => 3, Quadrant => 2, Braille/Octant => 4, Dot => 1`)
and the tick computation `ticks = value * (height * sub_rows) / max`, then per row
`cell_ticks(...)` marks full/partial/empty against `row_base = row_from_bottom * sub_rows`.
With `sub_rows = 8` and `height = 1` that degenerates to exactly our eighth-block
sparkline — but a 3-row sparkline becomes 24 levels without touching the glyph set.

### Shade ramp U+2591/2592/2593/U+2588 for the heatmap — keep, and Crush adds nothing. Argue it.

Two credible alternatives exist, and neither beats us for a calendar:

**gnuplot's quadrant map** — `block_quadrant_map[16]`, indexed by a **4-bit occupancy
mask**, not a density level:
`U+00A0, ▘ U+2598, ▝ U+259D, ▀ U+2580, ▖ U+2596, ▌ U+258C, ▞ U+259E, ▛ U+259B,
▗ U+2597, ▚ U+259A, ▐ U+2590, ▜ U+259C, ▄ U+2584, ▙ U+2599, ▟ U+259F, █ U+2588`.
It looks richer — 16 states versus our 4 — but it is not a richer *density* ramp. The
glyph is chosen purely by which sub-cells are lit; there is no ordinal magnitude
ordering you could read a level off. gnuplot's own documentation states the reason it
is unsuitable for us: *"Multiple 'pixels' necessarily share the same color… averaging
the color of all pixels in a charcell. This trick works perfectly for the `half` mode,
but is increasingly difficult for `quadrants`, `sextants`, or `octants`. For `braille`
this cannot be used."* Using quadrant glyphs on a calendar would spend our one colour
channel to re-encode a variable we already have a better channel for. gnuplot's lesson
is the inverse of what it looks like: **put the second variable in colour, not in the
glyph.**

**btop's `tty_up`/`tty_down` ramp** — `" ", ░ ░ ▒ ▒, ░ ░ ▒ ▒ █, ░ ▒ ▒ ▒ █, ▒ ▒ ▒ █ █,
▒ █ █ █ █`, i.e. U+0020, U+2591, U+2592, U+2588. Twenty-five density levels collapsed
onto **three** visible glyphs, shipped as btop's deliberately-degraded non-braille
mode, with per-cell colour from a gradient retained throughout. This is the closest
thing in the survey to our exact situation, and it *confirms* rather than improves on
us: btop, faced with a terminal it can't trust for sub-cell blocks, kept shade glyphs
and dropped resolution. Our four-level ramp is the same decision with one more level
than btop's ASCII end.

**Where Crush is genuinely more capable, and whether it helps:** bubbles' `progress`
defaults its fill to `▌` U+258C rather than `█` U+2588 specifically so the last filled
cell can carry **different foreground and background colours** — fg for the left half,
bg for the right half, "doubling blending resolution" to two colour steps per cell. It
is the same fg/bg trick gnuplot's half-mode uses. It does not apply to us: it assumes
truecolour, and a heatmap already has a dedicated colour channel, so there is nothing
to gain. Recorded, not adopted.

### The ASCII ladder — Crush has nothing; three other projects do

- **bubbles `progress`**: `DefaultFullCharHalfBlock '▌'` U+258C, `DefaultFullCharFullBlock '█'`
  U+2588, `DefaultEmptyCharBlock '░'` U+2591. The **only** hook is
  `WithFillCharacters(full, empty rune)` — two runes, no ladder, no ascii mode (v2
  dropped the v1 setters entirely).
- **termgraph**: `TICK = "▇"` U+2587 filled, `SM_TICK = "▏"` U+258F for a zero-length
  bar — two glyphs, both one cell, and zero is *visibly distinct from absent*.
- **VisiData** (`visidata/graph.py`) is the only surveyed project with a real preset
  notion, and it does it as **user-overridable theme options**:
  `disp_graph_tick_x = '╵'` U+2575, `disp_graph_reflines_x_charset = '▏││▕'`
  (U+258F, U+2502, U+2502, U+2595 — a 4-step *sub-cell vertical position* ladder),
  `disp_graph_reflines_y_charset = '▔──▁'` (U+2594, U+2500, U+2500, U+2581),
  `disp_graph_multiple_reflines_char = '▒'` U+2592. Two lessons: the ladder is a
  **one-dimensional string indexed by a sub-position**, and "several things occupy this
  cell" gets its own glyph rather than a blended one.
- **k9s** has only a binary `noIcons` flag (`internal/view/browser.go:100`,
  `b.SetNoIcon(b.app.Config.K9s.UI.NoIcons)`) — on or off, no ladder.

A note on ADR 0005: its stated reason for hardcoding Unicode is that `theme.symbol()`
only resolves keys the host registers. That reason does **not** apply to chart ink —
a chart owns its glyph table outright and never needs the host's registry. So a
chart-internal preset ladder is implementable without the upstream change ADR 0005
declined to wait for. Whether to revise the ADR's letter is a call for you, not one
to make silently in a research file.

## Recommendations for our four chart types

### 1. Sparkline — keep U+2581–U+2588; adopt ratatui's tick model and a zero baseline

- **Encoding:** one character per sample; value on the vertical axis via one of
  eight eighth blocks; `level = clamp(round(v / max * 8), 0, 8)`, index `SPECTRUM_BLOCKS`.
- **Scaling:** **zero-baselined against a caller-supplied max**, never min-max and
  never auto-stretched to the observed window. Three sources agree: ratatui's
  `Sparkline` defaults `.max()` to the dataset max (so it is zero-baselined unless you
  override), btop's `Draw::Graph` takes an explicit `max_value` in 0..100 units and
  never rescales, bottom pins percentage panels at `AxisBound::Max(100.5)` — 0.5 of
  headroom so a full value does not touch the frame.
- **Degenerate cases:**
  - *Flat series* → every glyph identical. This is the correct zero-baselined
    rendering. Ratatui makes the same choice deliberately ("there is no min-max
    stretch, so a flat series renders as a solid row rather than as noise"), and
    min-max is exactly what turns a flat series into noise.
  - *All-zero series* → all level-0 glyphs, still emitting `width` characters. A
    zero-baselined renderer must **never** return `""` for a series that has data;
    return the baseline run.
  - *Single point* → emit exactly one glyph at its level, anchored to the **right**
    edge, so a one-column panel shows the current value rather than a one-character
    history pinned to the past.
  - *Empty series* → return the baseline run too, not an empty array. An empty line
    inside a bordered panel reads as a layout bug.
- **Narrower than the data:** **clip, take the newest.** Ratatui takes
  `max_index = min(area.width, data.len())` (the *oldest* samples — wrong for a live
  panel); btop drops from the left; gnuplot hard-clips at the canvas. **No surveyed
  implementation downsamples**, and that is the right call: averaging adjacent samples
  invents values that were never observed, and on a stats panel a fabricated
  intermediate is a lie. Take the last `width` samples.

### 2. Ranked bar list — btop's integer meter plus Crush's "others" bucket

- **Encoding:** horizontal axis is length, one glyph per cell, no partial glyph.
  `filled = clamp(round(rowValue / maxShown * track), 0, track)`.
- **Scaling:** zero-baselined against the **largest row in the shown set** —
  Crush does exactly this (`Math.max(...displayTools.map(t => t.call_count))`), ratatui
  does exactly this (dataset max), and btop's `Draw::Meter` does it in integer form:
  `value = clamp(value, 0, 100)` then per column `y = round(i * 100.0 / width)`, emit
  the glyph while `value >= y`. Because every row shares one divisor, **every bar in
  the list is directly comparable** and no axis, tick, or legend is needed.
- **Degenerate cases:**
  - *Flat list* (all rows equal) → every bar full. Truthful, and visibly so.
  - *A zero-valued row* → emit **at least one empty-glyph cell** so the row is visible
    as "measured, and zero" rather than as "no data". termgraph's `SM_TICK` `▏` and
    gnuplot's `'#'`-for-zero-length-fill are both doing this deliberately.
  - *Empty list* → return an empty array. There is genuinely nothing to draw, and this
    is the one case where Crush's `""` early-out is right.
- **Long tail:** use Crush's `getTopItemsWithOthers` shape — top N rows, then one
  synthetic **"others"** row carrying the summed tail, appended last. Without it, a
  long tail produces a list that is either truncated (lying about the total) or as
  long as the data (unusable in a panel).
- **Narrower than the data:** shrink the **label** column first and truncate labels
  with `…`; never shrink the bar below 1 cell, and never drop rows silently —
  Crush's own rule is that a component with too little room drops the *lowest-priority
  whole column* before it shrinks anything (bandwhich's `compute_actual_widths` maps a
  minimum terminal width to a column layout and drops columns before resizing; Crush
  clamps its sidebar with `applyInfoColumnVisibility`). Then reduce `N` — drop rows
  into the "others" bucket — before touching geometry.

### 3. Share bar — copy bubbles/progress; it is the closest thing in the ecosystem

- **Encoding:** `fill = '█'` U+2588, `empty = '░'` U+2591. Both one cell.
- **Algorithm, transcribed from `progress.ViewAs`:**
  ```
  textWidth = Bun.stringWidth(readout)          // render the number FIRST
  track     = Math.max(0, width - textWidth - gap)
  filled    = Math.max(0, Math.min(track, Math.round(track * share)))
  line      = '█'.repeat(filled) + '░'.repeat(track - filled) + readout
  ```
  Linear, round-to-nearest, clamped at both ends. This is the whole algorithm and it
  needs no eighth-block ramp — one cell is `1/track` of the scale, which for a
  share bar is plenty.
- **Degenerate cases:**
  - *`share > 1`* → clamped to a full bar; a percentage over 100 must never overflow
    the column.
  - *Zero total* → **do not compute `x / 0`.** Crush's guard is the pattern
    (`if (maxCount === 0) maxCount = 1`): emit an all-`░` track so the reader sees a
    measured zero, not a missing component.
  - *Single category* → `share = 1`, full bar. Correct, not a degenerate case.
  - *`track === 0`* → `Math.max(0, …)` yields 0 and the bar disappears while the
    readout still prints. That is the desired behaviour: at narrow widths the number
    wins and the bar yields.
- **Why `█` and not bubbles' `▌`:** bubbles picks `▌` only so the terminal cell can
  carry two different colours. `▌` in a one-colour bar leaves the right half showing
  the track glyph, which reads as a rendering gap rather than as a fill boundary.

### 4. Calendar heatmap — keep the shade ramp; zero-fill; anchor to max

- **Encoding:** one cell per day; **level** on the shade ramp, **colour** on the value.
  This is exactly the `ForegroundGrad` model — the glyph is redundant, the colour
  carries the data — and exactly what gnuplot says you must do when sub-cells cannot
  be individually coloured.
- **Scaling:** **max-anchored, discrete**, not min-max and not continuous.
  `level = 0` for 0; then thresholds at fixed fractions of the grid maximum
  (`count / maxCount`, Crush's formula, quantised to our 4 steps). Min-max would make
  a quiet fortnight look identical to a busy one, which is the opposite of the point
  of a stats calendar.
- **Degenerate cases:**
  - *Empty grid* → render the full empty calendar so the weekday/date frame stays
    legible. Never return `""`.
  - *All-zero grid* → same, every cell level 0.
  - *A single non-zero day* → one level-4 cell, everything else level 0. The
    `max === 0 → 1` guard from Crush prevents the division; the shape still renders.
  - **Zero-fill the entire grid.** This is the one thing we must be most careful
    about: Crush's `GetUsageByDay` / `GetRecentActivity` SQL emit a row only for days
    that have activity, and its charts chart that sparse array directly, so quiet days
    silently vanish from the time axis. For a *bar* chart that is a misrepresentation;
    for a calendar it is a broken component. Every cell in the date range gets a row,
    value 0 if need be.
- **Local time:** key on local dates. Crush has to post-process UTC hour/day-of-week in
  JS with wrap-around arithmetic; we should just query in local time and not carry
  that bug.
- **Narrower than the data:** a calendar has no natural clip. Crush has no precedent;
  the sane policy is to reduce the **window** (last 12 weeks → last 8 → last 4, dropping
  whole columns) rather than squeeze cells, because a sub-cell calendar is unreadable
  and cannot be redrawn at a different cell size.
- **ASCII ladder** (btop's `tty_up` precedent): `" " ░ ▒ ▓ █` — btop ships exactly this
  collapse and keeps per-cell colour through it.

### Cross-cutting width policy

**Every implementation surveyed clips; none aggregates.** Crush truncates with `…`;
ratatui clamps `max_index`; btop drops from the left; gping gets a smaller rect;
gnuplot hard-clips at a declared canvas. Our rule should be the same: **drop whole
buckets, keep the newest or highest-ranked end, truncate labels with `…`, never
average, never squeeze a cell below one character.**

## Other TUI projects rendering graphs or meters

Short entries. Every glyph below was copied from source that was actually opened.

**gnuplot `set term block`** ([`term/block.trm`](https://raw.githubusercontent.com/gnuplot/gnuplot/master/term/block.trm))
— The ancestor. Rasterises any plot into Unicode pseudo-graphics at selectable
sub-cell resolution: dot 1×1, half 1×2, quadrants 2×2 (default), sextants 2×3,
octants 2×4, braille 2×4. Quadrant map indexed by a **4-bit occupancy mask**:
`U+00A0, ▘ U+2598, ▝ U+259D, ▀ U+2580, ▖ U+2596, ▌ U+258C, ▞ U+259E, ▛ U+259B,
▗ U+2597, ▚ U+259A, ▐ U+2590, ▜ U+259C, ▄ U+2584, ▙ U+2599, ▟ U+259F, █ U+2588`.
Its own docs state the sub-cells *must share one averaged colour* — the reason
braille cannot carry our heatmap. **Applies to: calendar heatmap, as the argument for
colour-over-geometry.**

**gnuplot `set term dumb`** ([`term/dumb.trm`](https://raw.githubusercontent.com/gnuplot/gnuplot/master/term/dumb.trm))
— The ASCII ancestor. Series pens `'*' '#' '$' '%' '@' '&' '='`; FILL vector `'X'`
with `'#'` for **zero-length** fill; axes `':'`/`'.'` with `'+'` corners; border `'|'`/`'-'`;
`fillchar solid` defaults to `"\U+2588"`. One char per pixel, hard clip at a declared
79×24 canvas. The `"X" fill / "#" zero-fill` pair is the ancestor of our
filled-vs-zero distinction. **Applies to: share bar, as the two-glyph bar primitive.**

**btop** ([`src/btop_draw.cpp`](https://raw.githubusercontent.com/aristocratos/btop/main/src/btop_draw.cpp))
— Six 25-entry symbol tables, each a 5×5 matrix of levels 0–4 for *two horizontally
adjacent samples* (`index = result[0]*5 + result[1]`), so one character carries two
time samples in braille mode. Braille `U+2800–U+28FF`; block `▗▐▖▄▟▌▙█`;
**`tty_*` fallback `" ", ░ U+2591, ░, ▒ U+2592, ▒, ░ ░ ▒ ▒ █, …, ▒ █ █ █ █`** — the
only grayscale shade ramp in the survey, shipped as its deliberate degraded mode with
per-cell colour intact. Vertical level: `clamp(round((v - cur_low) * 4 / (cur_high - cur_low) + mod), min, 4)` with
`mod = 0.3` when `height == 1` (so single-row graphs round up instead of vanishing)
and `0.1` otherwise. `max_value == 0` is rescued by an explicit `offset`, and temps
use `offset = -23` because Celsius is negative. Narrower than data → **clip from the
left, never aggregate**. Meter (`Draw::Meter`) uses `■` U+25A0 with
`y = round(i*100/width)` per column — the purest integer horizontal bar surveyed.
**Applies to: ranked bar list (the meter rule), calendar heatmap (the `tty_*` ladder).**

**ratatui `Sparkline`** ([`ratatui-widgets/src/sparkline.rs`](https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-widgets/src/sparkline.rs),
[`symbols/bar.rs`](https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-core/src/symbols/bar.rs))
— Canonical single-line sparkline. Default marker is `symbols::bar::NINE_LEVELS`
= `█` U+2588, `▇` U+2587, `▆` U+2586, `▅` U+2585, `▄` U+2584, `▃` U+2583,
`▂` U+2582, `▁` U+2581 — braille is **opt-in**, not the default. `sub_rows`
abstraction (Bar 8, HalfBlock 2, Sextant 3, Quadrant 2, Braille/Octant 4, Dot 1).
Degenerates are explicit: `max_height = data.max().unwrap_or(1)` (empty *and*
all-absent fall back to 1, never 0 or ∞); `scale_height` returns 0 immediately if
`max == 0`; `Option<u64>` gaps get their own symbol and style, so a **gap is never
drawn as zero**; narrow → `max_index = min(area.width, data.len())`, take the first
`max_index` and drop the tail. **Applies to: sparkline — validates our ramp and supplies
the tick model.**

**termgraph** ([`constants.py`](https://raw.githubusercontent.com/mkaz/termgraph/main/termgraph/constants.py),
[`chart.py`](https://raw.githubusercontent.com/mkaz/termgraph/main/termgraph/chart.py),
[`data.py`](https://raw.githubusercontent.com/mkaz/termgraph/main/termgraph/data.py))
— `TICK = "▇"` U+2587 filled, `SM_TICK = "▏"` U+258F for a zero bar, `" "` padding.
`num_blocks = v * width / max_datum`. Degenerates: `if min_datum == max_datum: return
data_offset` — a flat series returns the raw values rather than dividing by a zero
range; negatives are `abs()`-ed and added back as an offset. **Applies to: ranked bar
list and share bar — the two-glyph filled/zero system and the flat-series early-out.**

**VisiData `graph.py`** ([`visidata/graph.py`](https://raw.githubusercontent.com/saulpw/visidata/develop/visidata/graph.py))
— Scatter/line over a `Canvas` that is 2 pixels wide × 4 tall per character. Its
glyphs are all **user-overridable theme options**, the closest thing to a symbol preset
in the survey: `disp_graph_tick_x = '╵'` U+2575,
`disp_graph_reflines_x_charset = '▏││▕'` (U+258F, U+2502, U+2502, U+2595 — a four-step
sub-cell *vertical position* ladder), `disp_graph_reflines_y_charset = '▔──▁'`
(U+2594, U+2500, U+2500, U+2581), `disp_graph_multiple_reflines_char = '▒'` U+2592
used when two reference lines collide in one cell. **Applies to: the ladder design —
a one-dimensional string indexed by sub-position, and a dedicated "collision" glyph
rather than a blend.**

**bubbles `progress`** ([`progress/progress.go`](https://raw.githubusercontent.com/charmbracelet/bubbles/main/progress/progress.go))
— Charm's only data-mark component, and a bar rather than a chart. `▌` U+258C default
fill (chosen so one cell carries two colours), `█` U+2588 opt-in, `░` U+2591 empty;
`tw = max(0, width - textWidth)`, `fw = round(tw * percent)` clamped to `[0, tw]`.
`WithFillCharacters(full, empty rune)` is the **only** preset hook — there is no
ascii mode and no ladder in v2 (the v1 `SetFilled`/`SetEmpty`/`Format` names are gone).
**Applies to: share bar — transcribed almost verbatim in the recommendation above.**

**lipgloss** ([`blending.go`](https://raw.githubusercontent.com/charmbracelet/lipgloss/main/blending.go),
[`canvas.go`](https://raw.githubusercontent.com/charmbracelet/lipgloss/main/canvas.go))
— No chart, no gauge, no sparkline, no meter. What it does have is `Blend1D(steps,
stops...)` (CIELAB ramp with explicit degenerate handling: `steps <= len(stops)`
returns the stops **verbatim with no interpolation**; 1 valid stop repeats it; 0
returns nil), `Blend2D(w, h, angle, stops...)`, and `Canvas` — an addressable cell grid
with per-cell style, whose doc example paints a gradient as runs of **spaces**.
**Applies to: calendar heatmap — "build a discrete ramp once, index it per cell", and
the warning that asking for fewer steps than stops silently skips interpolation.**

**bubbletea / charmbracelet/x** — **Negative results, verified.** bubbletea's package
root contains no `graph/chart/sparkline/gauge/meter/plot/canvas` file; it is the
Elm-architecture runtime. `charmbracelet/x/exp/` contains
`charmtone, golden, higherorder, maps, open, ordered, slice, strings, teatest, toner`
— no `gauge`. bubbles' component list is `cursor, filepicker, help, key, list,
paginator, progress, spinner, stopwatch, table, textarea, textinput, timer, viewport`
— **no gauge, no sparkline**. Nothing to learn.

**bandwhich** ([`src/display/components/table.rs`](https://raw.githubusercontent.com/imsnif/bandwhich/main/src/display/components/table.rs))
— **Negative result worth keeping:** a network dashboard TUI with *zero* data marks.
Bandwidth is text only ("12.34 MiB / 5.67 KiB"). Its one reusable idea is
`compute_actual_widths`, which drops whole columns via a `column_selector` before
shrinking any. **Applies to: our width policy for the ranked bar list.**

**bottom** ([`time_series/base.rs`](https://raw.githubusercontent.com/ClementTsang/bottom/main/src/canvas/components/time_series/base.rs))
— Braille only (`Marker::Braille`; `•` U+2022 dots under `simple_graphics`), via a
vendored ratatui `Chart`. `ChartScaling::{Linear, Log10, Log2}` as a first-class enum,
and percentage panels pinned at `AxisBound::Max(100.5)` — fixed max with half a point
of headroom, so a full bar does not touch the frame. **Applies to: the headroom idea —
borrow the `+0.5` trick for any percentage-scaled chart.**

**gping** ([`gping/src/main.rs`](https://raw.githubusercontent.com/orf/gping/main/gping/src/main.rs),
[`plot_data.rs`](https://raw.githubusercontent.com/orf/gping/main/gping/src/plot_data.rs))
— No glyphs of its own (braille/dots via ratatui). Worth reading for axis bounds:
min/max autoscaled with a ±10% buffer, `if max <= min { max = min + 1000ms }` so the
axis can never collapse, empty data → `[0.0, 1000.0]`, and explicit `--ymin/--ymax`
honoured verbatim with no buffer. **Applies to: sparkline — the never-collapse-the-axis
guard, though its min-max policy is wrong for a stats panel.**

**k9s** ([`internal/view/browser.go`](https://github.com/derailed/k9s/blob/master/internal/view/browser.go),
[`pod.go`](https://github.com/derailed/k9s/blob/master/internal/view/pod.go),
[`log.go`](https://github.com/derailed/k9s/blob/master/internal/view/log.go))
— **No data marks at all**, verified by scanning `pod.go`, `node.go`, `container.go`,
`helpers.go`, `table.go`, `table_helper.go`, `types.go`, `browser.go`, `log.go`,
`details.go` for non-ASCII: the entire inventory is `Ⓕ` U+24BB and `🏁` U+1F3C1.
CPU and memory are `%CPU/R`, `%CPU/L`, `%MEM/R`, `%MEM/L` — **text percentages, not
bars** — with colour thresholds from config. Its only preset is the binary
`noIcons: true` flag. **Applies to: nothing. Included because a Kubernetes dashboard
choosing numbers over bars independently corroborates Crush.**

**glowing reviews, gitui, spotify-tui, dockerlazy, lazysql** — could not reach
verifiable source in this session and are therefore **omitted rather than guessed**.
Several of them render no data marks at all, but that is an inference, not a finding,
so it is not written down as one.

## Emoji width violations

**Crush itself: none in UI chrome, and it has the best width-discipline comment in the
ecosystem.**

- The only astral-plane codepoints in Crush's Go source are **test fixtures** —
  👩 U+1F469 and 💻 U+1F4BB inside markdown test content in
  `chat/assistant_plan_test.go` and `model/chat_draw_cache_test.go`. They are never
  rendered as data ink.
- `™` U+2122 (in `"Charm™"`) and `€` U+20AC (in the non-TTY spinner alphabet,
  `anim/anim.go:57`) are Neutral/Narrow-width and measure 1 cell.
- **The one to copy** — `styles.go:49`:
  ```go
  CodespanPadding string = "\u00a0\ufe0e"
  ```
  with a comment explaining that `ansi.StringWidth` measures *any cluster ending in
  U+FE0F as two cells* while the terminal renders it as one, so an emoji-presentation
  selector causes the whole frame to repaint every frame as visible flicker. Crush
  picked the text-presentation selector U+FE0E deliberately for exactly that reason.
  This is the same hazard our `Bun.stringWidth === 1` assertion guards, stated from
  the other side — and it is a concrete argument for keeping the assertion in our test
  suite rather than trusting it.
- Crush does use nerd-font private-use codepoints, but only inside the image painter's
  weight table: U+E0B0 and U+E0B2. No Nerd Font glyph reaches Crush's normal UI, which
  is consistent with there being no nerd preset.

**Elsewhere in the survey:**

- **k9s** — `🏁` U+1F3C1 at `internal/view/log.go:122` (`"\n🏁 [red::b]Stream exited!"`)
  and `Ⓕ` U+24BB at `internal/view/pod.go:40`. U+1F3C1 is Emoji_Presentation and
  measures 2 cells in every terminal we care about: **forbidden for us.**
- **btop** — its meter glyph `■` U+25A0 is Neutral-width, 1 cell. Fine.
- **VisiData** — `╵` U+2575, `▏` U+258F, `▕` U+2595, `▔` U+2594, `▒` U+2592: all
  1 cell, but `▕` U+2595 is a less-supported glyph than `│` U+2502 and is worth a
  rendering check before we adopt the same sub-cell ladder idea.
- **btop and ratatui** use `•` U+2022 as their "simple graphics" marker — 1 cell, but
  visually weak as a data mark.

Nothing in the recommended glyph sets violates the 1-cell rule.

## Sources

All accessed **2026-10-03**.

Crush:
- https://github.com/charmbracelet/crush
- https://api.github.com/repos/charmbracelet/crush/git/trees/HEAD?recursive=1
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/common/scrollbar.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/styles/styles.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/styles/grad.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/logo/letterforms.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/logo/logo.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/image/image.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/model/header.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/model/status.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/model/pills.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/model/ui.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/common/elements.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/exitbanner/exitbanner.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/AGENTS.md
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/cmd/root.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/cmd/stats.go
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/cmd/stats/index.js
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/cmd/stats/index.css
- https://raw.githubusercontent.com/charmbracelet/crush/main/internal/db/sql/stats.sql
- https://api.github.com/search/commits?q=repo:charmbracelet/crush+sparkline
- https://api.github.com/search/commits?q=repo:charmbracelet/crush+chart

Charm ecosystem:
- https://github.com/charmbracelet/bubbletea/tree/main
- https://raw.githubusercontent.com/charmbracelet/bubbles/main/progress/progress.go
- https://github.com/charmbracelet/bubbles/tree/master
- https://raw.githubusercontent.com/charmbracelet/lipgloss/main/blending.go
- https://raw.githubusercontent.com/charmbracelet/lipgloss/main/canvas.go
- https://github.com/charmbracelet/x/tree/main/exp
- https://raw.githubusercontent.com/charmbracelet/ultraviolet/main/cell.go

Other projects:
- https://raw.githubusercontent.com/gnuplot/gnuplot/master/term/block.trm
- https://raw.githubusercontent.com/gnuplot/gnuplot/master/term/dumb.trm
- https://raw.githubusercontent.com/aristocratos/btop/main/src/btop_draw.cpp
- https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-widgets/src/sparkline.rs
- https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-core/src/symbols/bar.rs
- https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-core/src/symbols/block.rs
- https://raw.githubusercontent.com/mkaz/termgraph/main/termgraph/constants.py
- https://raw.githubusercontent.com/mkaz/termgraph/main/termgraph/chart.py
- https://raw.githubusercontent.com/mkaz/termgraph/main/termgraph/data.py
- https://raw.githubusercontent.com/saulpw/visidata/develop/visidata/graph.py
- https://raw.githubusercontent.com/imsnif/bandwhich/main/src/display/components/table.rs
- https://raw.githubusercontent.com/ClementTsang/bottom/main/src/canvas/components/time_series/base.rs
- https://raw.githubusercontent.com/orf/gping/main/gping/src/plot_data.rs
- https://github.com/derailed/k9s/blob/master/internal/view/browser.go
- https://github.com/derailed/k9s/blob/master/internal/view/pod.go
- https://github.com/derailed/k9s/blob/master/internal/view/log.go

Local context:
- `docs/adr/0005-glyph-policy-hardcoded-unicode-data-ink.md`
