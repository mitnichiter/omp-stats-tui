# F18 — ratatui & scope-tui: terminal graph techniques

**Access date for all URLs: 2026-10-03.** All codepoints below were copied from source and then
independently verified with `Bun.stringWidth` (see *Verification method*).

Scope: we are porting a stats dashboard into `omp`, a terminal AI coding agent whose renderer is
`render(width: number) => readonly string[]`. We are about to build sparklines, ranked bar lists,
share bars and a calendar heatmap. We want proven techniques, not invented ones.

**Hard constraint carried through every finding:** every character we draw must measure exactly
1 cell (`Bun.stringWidth === 1`). Emoji measure 2 and are forbidden in data cells.

---

## ratatui: what it has

First, a factual correction to the brief's premise: **there is no separate `ratatui-chart` or
`tui-chart` crate in current ratatui.** The chart widget was folded into the main workspace. Per
`ARCHITECTURE.md`, the workspace split began at ratatui 0.30.0; `Chart`, `Dataset`, `Axis` and
`GraphType` now live in `ratatui-widgets` and are re-exported as `ratatui::widgets::{Chart,
Dataset, Axis, GraphType}`. Applications depend on `ratatui = "0.30"`. Do not design against a
split crate.

Relevant repo paths (branch `main`):

| Path | What it gives us |
|---|---|
| `ratatui-core/src/symbols/bar.rs` | The 9-level eighth-block ramp used by `Sparkline` and `BarChart`, plus a `Set` struct and `THREE_LEVELS` degraded set |
| `ratatui-core/src/symbols/block.rs` | Left-half-block ramp (`▏…█`), used by `Gauge`'s sub-cell precision |
| `ratatui-core/src/symbols/shade.rs` | The 4-level density ramp `░▒▓█` |
| `ratatui-core/src/symbols/half_block.rs` | `▀` `▄` `█` |
| `ratatui-widgets/src/sparkline.rs` | The single most relevant file: tick-based scaling, degenerate guards, clipping |
| `ratatui-widgets/src/gauge.rs` | `Gauge` (2-D bar) and `LineGauge` (1-D); share-bar relevant |
| `ratatui-widgets/src/barchart.rs` | Vertical bars with the same 9-level ramp; ranked-list relevant |
| `ratatui-widgets/src/chart.rs` | `Chart`/`Dataset`/`Axis`/`GraphType` — delegates to Canvas |
| `ratatui-widgets/src/canvas.rs`, `canvas/line.rs` | Per-cell Bresenham rasterizer with clipping |
| `ratatui-widgets/examples/sparkline.rs`, `gauge.rs`, `barchart.rs` | Runnable demonstrations |

`Marker` (`ratatui-core/src/symbols/marker.rs`) is the multi-resolution selector: `Bar`, `Block`,
`Dot`, `Braille`, `HalfBlock`, `Quadrant`, `Sextant`, `Octant`, `Custom(char)`.

---

## ratatui: techniques

### Axis encoding — two completely different subsystems

This is the single most important structural finding, and it cleanly divides the codebase:

**Subsystem 1 — `Sparkline` / `BarChart` / `Gauge`: discrete ticks, glyph-ramp indexed.**
There is no continuous x/y plane. Each data value becomes an integer number of **ticks**, and the
tick count indexes a glyph in a ramp. `bar.rs`:

```rust
pub const FULL: &str = "█";           // U+2588
pub const SEVEN_EIGHTHS: &str = "▇";  // U+2587
pub const THREE_QUARTERS: &str = "▆"; // U+2586
pub const FIVE_EIGHTHS: &str = "▅";   // U+2585
pub const HALF: &str = "▄";           // U+2584
pub const THREE_EIGHTHS: &str = "▃";  // U+2583
pub const ONE_QUARTER: &str = "▂";    // U+2582
pub const ONE_EIGHTH: &str = "▁";     // U+2581
```

**Subsystem 2 — `Chart`: continuous float plane rasterized per-cell.**
`Chart` does *not* use a glyph ramp at all. `GraphType::Bar` emits a vertical `CanvasLine` per
point (`chart.rs`), and `canvas/line.rs` maps it to integer cells via a Bresenham walk:

```rust
fn draw(&self, painter: &mut Painter) {
    if [self.x1, self.y1, self.x2, self.y2]
        .iter().any(|coordinate| !coordinate.is_finite()) { return; }
    let (x_bounds, y_bounds) = painter.bounds();
    let Some((wx1, wy1, wx2, wy2)) = clip_line(x_bounds, y_bounds, ...) else { return };
    let Some((x1, y1)) = painter.get_point(wx1, wy1) else { return };
    let Some((x2, y2)) = painter.get_point(wx2, wy2) else { return };
    draw_line(painter, x1, y1, x2, y2, self.color);
}
```

`GraphType::Bar` therefore draws bars as *thin 1-cell-wide rasterized lines*, coloured per cell —
a vertical run of same-colour cells, not a filled block glyph. Bars are consequently visually
thinner and blunter than a block ramp produces. The `Canvas` then composes a grid character from
two vertically-stacked samples (`▀`/`▄`/`█`) per cell, or braille/quadrant/sextant/octant sets.

### The tick model, precisely

`Sparkline::render_single_width` walks rows bottom-up and computes a *total tick count* for a
column, then distributes ticks into rows:

```rust
const fn cell_ticks(total_ticks: u64, row_from_bottom: u16, sub_rows: u16) -> u16 {
    let row_base = (row_from_bottom as u64) * (sub_rows as u64);
    let row_ceiling = row_base + (sub_rows as u64);
    if total_ticks >= row_ceiling { sub_rows }
    else if total_ticks <= row_base { 0 }
    else { (total_ticks - row_base) as u16 }
}
```

and maps the residual to a glyph — the same 0..8 ladder `BarChart` reuses verbatim:

```rust
const fn symbol_for_height(&self, height: u16) -> &str {
    match height {
        0 => self.bar_set.empty,
        1 => self.bar_set.one_eighth,
        2 => self.bar_set.one_quarter,
        3 => self.bar_set.three_eighths,
        4 => self.bar_set.half,
        5 => self.bar_set.five_eighths,
        6 => self.bar_set.three_quarters,
        7 => self.bar_set.seven_eighths,
        _ => self.bar_set.full,
    }
}
```

`BarChart::render_vertical_bars` is character-for-character the same ladder, consuming with
`ticks = ticks.saturating_sub(8);` per row.

### Scaling algorithm — linear, integer, no division by zero

`Sparkline::scale_height` is the whole algorithm. It is **purely linear** — no sqrt, no log, no
min-max normalisation — and does the multiply in `u128` before dividing, so no overflow and no
precision loss:

```rust
fn scale_height(value: u64, max: u64, max_height: u16, sub_rows: u16) -> u64 {
    if max == 0 { return 0; }
    let max_ticks = u128::from(max_height) * u128::from(sub_rows);
    let ticks = u128::from(value) * max_ticks / u128::from(max);
    ticks.min(max_ticks) as u64
}
```

Note `max == 0 → return 0`. This is the **flat-series guard**, and it is the degenerate case done
correctly: a series where every value is 0 (or where the derived max collapses to 0) renders as
blank rather than dividing by zero or NaN-ing. The `.min(max_ticks)` clamp handles the opposite
degenerate case — a value exceeding the declared max is clamped, not allowed to bleed outside the
plot area.

### Degenerate cases — a complete inventory

This is where ratatui is strongest and where most implementations break. Enumerated from source:

- **Empty series.** `render_sparkline` computes the max as
  `self.data.iter().filter_map(|s| s.value).max().unwrap_or(1)` — empty falls back to `max = 1`,
  not 0. A one-line guard `if spark_area.is_empty() { return; }` precedes it.
  `BarChart` bails with `if inner.is_empty() || self.data.is_empty() || self.bar_width == 0`.
- **Flat series (all values identical).** Two distinct paths, both safe:
  - If the values are non-zero and all equal, the derived max equals every value, so every column
    scales to `max_ticks` — a solid full-height block at the very top. Correct, no crash.
  - If the values are all zero, `max == 0` and `scale_height` returns `0` → blank.
  - `BarChart` uses `maximum_data_value()` whose doc comment states *"the returned value is always
    greater equal 1"* — implemented as `.max(1)`. A hard floor, which is the cleaner formulation
    and the one to copy.
- **Single data point.** No special case exists and none is needed. One point, one column. The
  horizontal scaling is `let max_index = min(spark_area.width as usize, self.data.len());` — the
  point renders at column 0. Crucially the **vertical** scaling depends only on value ÷ max, which
  is defined for a single point, so the point correctly renders as a full-height bar. Ratatui
  never divides by `data.len()`.
- **Non-finite values.** `canvas/line.rs` rejects them up front with
  `.any(|coordinate| !coordinate.is_finite())` → early return. Defensive but real.
- **Degenerate canvas bounds.** `Canvas::default` is `x_bounds: [0.0, 0.0], y_bounds: [0.0, 0.0]`
  — a zero-width world. Note the guard is *not* in the mapping code; `get_point` returns `Option`
  and `clip_line` returns `Option`, and callers `let Some(..) else { return }`. The zero-span
  world is handled by the `Option` return, not by a divide-by-zero guard.

### Narrow-terminal behaviour: clip, never downsample or re-bucket

Both subsystems clip; neither aggregates. `Sparkline`:
`let max_index = min(spark_area.width as usize, self.data.len());` — takes the first `width`
points, drops the tail. `Chart` clips in world space via `clip_line` against the bounds. The
sub-cell markers *increase* horizontal resolution (2 data points per column for braille/quadrant/
sextant/octant); the doc comment states they *"display up to twice the width of the spark area in
data points; all other markers display up to the width of the spark area"*.

**This is a deliberate design choice we should note as a limitation, not copy blindly.** For a
stats sparkline showing recent history, clipping shows you the oldest window and hides the newest
data. Whether that is right depends on intent; for a "recent activity" sparkline you almost
certainly want to keep the *right-hand* (most recent) samples and bucket the excess. Ratatui's
`RenderDirection::RightToLeft` hints at the intent but does not implement re-bucketing.

### Absence, not zero — a data-modelling idea worth taking

`SparklineBar { value: Option<u64>, style: Option<Style> }`. `None` is the *absence of a value*,
explicitly distinguished from `Some(0)`, and rendered via dedicated
`absent_value_symbol` / `absent_value_style` setters. For a stats dashboard with gaps in telemetry
(session boundaries, missing days in a heatmap) this distinction is directly valuable: a day with
no data should not render as a zero-value day and drag a heatmap's scale to zero.

### Sparkline and gauge primitives — confirmed, and what they actually are

- **`Sparkline`** — yes, a first-class primitive. Defaults to `Marker::Bar` with `bar_set` =
  `NINE_LEVELS`. `sub_rows = 8` for `Marker::Bar`, giving the eighth-block ramp; `2` for
  `HalfBlock`; `1` for `Block`/`Dot`/`Custom`. Multi-row and multi-direction (`LeftToRight` /
  `RightToLeft`).
- **`Gauge`** — 2-D progress bar. `ratio` in `[0,1]` (panics outside). The sub-cell technique is
  the interesting part:

  ```rust
  let filled_width = f64::from(gauge_area.width) * self.ratio;
  let end = if self.use_unicode {
      gauge_area.left() + filled_width.floor() as u16
  } else {
      gauge_area.left() + filled_width.round() as u16
  };
  ...
  if self.use_unicode && self.ratio < 1.0 {
      buf[(end, y)].set_symbol(get_unicode_block(filled_width % 1.0));
  }
  ```

  `get_unicode_block` rounds the fraction to 8 steps and indexes `symbols::block`. Note it uses
  `.floor()` for the boundary cell and `.round()` for the remainder — a deliberate split so the
  partially-filled cell is never double-counted or skipped. The `use_unicode: false` path is a
  built-in ASCII-ish degrade (just `█` + spaces), toggled by one bool. **This bool is the closest
  thing either project has to our `unicode`/`nerd`/`ascii` preset concept — see below.**
- **`LineGauge`** — 1-D bar, always height 1, with independent `filled_symbol`/`unfilled_symbol`
  and separate styles. This is the closest existing analogue to our share bar.

### `symbols::shade` — confirmed exact codepoints and intended use

Verbatim from `ratatui-core/src/symbols/shade.rs`:

```rust
pub const EMPTY:  &str = " ";   // U+0020
pub const LIGHT:  &str = "░";   // U+2591 LIGHT SHADE
pub const MEDIUM: &str = "▒";   // U+2592 MEDIUM SHADE
pub const DARK:   &str = "▓";   // U+2593 DARK SHADE
pub const FULL:   &str = "█";   // U+2588 FULL BLOCK
```

**Intended use — important and slightly different from ours.** Shade is a *density* ramp where the
four glyphs sit at roughly 25% / 50% / 75% / 100% coverage, intended for filling a cell's area
(pattern fill), and it is used in `Sparkline` **not for bar heights but for marking absent values**
(`AbsentValueSymbol::default()` is `symbols::shade::EMPTY`). It is *not* documented as a heatmap
primitive — ratatui has no heatmap widget at all. Our use of it for calendar-heatmap levels is a
legitimate extrapolation, not something ratatui prescribes.

Note the ramp is **non-linear in coverage**: `░▒▓` are dithered patterns, not solid fractions, and
`FULL` is the only solid one. On terminals with poor dither rendering `░`/`▒` can look like noise.
Also note `shade::FULL` is `█` (U+2588) — identical to `bar::FULL` and `block::FULL`. So the two
ramps **share their top rung** but diverge below it: `bar` descends by eighths (U+2581–U+2588,
vertical fill), `block` descends by eighths (U+2587–U+258F, left-anchored fill), `shade` descends
by quarters (U+2591–U+2593, dither).

### Symbol presets — does either project have an equivalent concept?

**Neither has a `unicode`/`nerd`/`ascii` tier system.** What exists is a *set-substitution*
mechanism, which is a different and arguably better-shaped idea:

- `symbols::bar::Set<'a>` is a plain struct of nine `&'a str` fields
  (`full`, `seven_eighths`, `three_quarters`, `five_eighths`, `half`, `three_eighths`,
  `one_quarter`, `one_eighth`, `empty`). `Sparkline::bar_set()` accepts any value of it.
- Two presets ship: `NINE_LEVELS` (all distinct, the default) and `THREE_LEVELS`, a graceful
  degradation that collapses the nine slots onto three glyphs:

  ```rust
  pub const THREE_LEVELS: Set = Set {
      full: FULL,           // █
      seven_eighths: FULL,  // █
      three_quarters: HALF, // ▄
      five_eighths: HALF,   // ▄
      half: HALF,           // ▄
      three_eighths: HALF,  // ▄
      one_quarter: HALF,    // ▄
      one_eighth: " ",      // (space!)
      empty: " ",
  };
  ```

This is a genuinely portable insight for us: the abstraction to take is **not** "a list of
presets" but **"a fixed-arity glyph slot struct plus the ability to substitute any slot."** The
arity stays 9 and the algorithm never changes; only the strings swap. That makes an ASCII ladder a
third `Set` literal rather than a second code path, so there is exactly one scaling algorithm to
test. `Marker::Custom(char)` is the extreme of the same idea.

---

## scope-tui: what it is

**Honest finding: scope-tui is not a system profiler, and it contains no sparkline, no bar chart
and no glyph ramp of its own.** It is a **terminal audio visualizer** — oscilloscope,
vectorscope and FFT spectroscope for live audio input, built on ratatui + crossterm + cpal +
rustfft. `cargo install scope-tui`; run as `scope-tui audio`. Confirmed from the repository tree
(`src/display/{oscilloscope,spectroscope,vectorscope}.rs`, `src/input/{cpal,file,pulse}.rs`,
`src/{cfg,music,app}.rs`) and `Cargo.toml`.

Why it is still worth reporting, and what is genuinely there:

**It renders every view through ratatui's `Dataset`/`GraphType`.** `src/display/mod.rs` defines a
local `DataSet` struct converted into `ratatui::widgets::Dataset` via
`impl<'a> From<&'a DataSet> for Dataset<'a>`, with `.marker()`, `.graph_type()`, `.style()`,
`.data()`. So **scope-tui contributes no original chart algorithm whatsoever** — it is a consumer
of ratatui, and any technique it displays is ratatui's technique.

The one genuinely interesting thing it does is **log scaling of both axes**, which ratatui does
not provide:

```rust
Dimension::X => ("frequency -", [20.0f64.ln(), ((cfg.samples / cfg.width) * 20000.0).ln()]),
Dimension::Y => (if self.log_y { "| level" } else { "| amplitude" }, [0.0, cfg.scale * 7.5]),
```

and it does that by **taking `ln()` of the data values and of the bounds** before handing them to
a chart that only ever does linear interpolation. It also normalises the input signal by its own
max before the FFT, with a floor:

```rust
let mut max_val = chunk.iter().max_by(|a, b| a.total_cmp(b)).expect("empty dataset?");
if max_val < 1. { max_val = 1.; }
```

Two portable details: (a) `total_cmp` for `f64` comparison, which is the correct total-order
comparator and avoids the classic `f64` sort-order bug; (b) a clamp-before-use on the divisor —
same defensive intent as ratatui's `.max(1)`.

Non-transferable-by-nature: its x-axis is `ln(frequency)` and its y-axis is `ln(magnitude)` — an
audio-domain choice with no meaning for a token-count or latency dashboard. Its `GraphConfig.scale`
is self-described in the source as *"very arbitrary but good default"* and marked
`// TODO super arbitraty! wtf!`; do not treat its constants as precedent. The `// TODO can we auto
generate these? lol...` gridline list of ~30 hardcoded frequency gridlines is anti-pattern, not
technique.

Also relevant: `phase()` guards with `if r.is_normal() { r } else { 0. }`, another non-finite
defence in the same spirit as ratatui's.

---

## PORTABLE vs NOT-TRANSFERABLE

**PORTABLE-AS-APPROACH**

| Finding | One-line reason |
|---|---|
| Tick-based glyph-ramp indexing (0..8 → glyph) | It is an integer→string mapping; any language can index an array with it. |
| `scale_height`: linear, `value * max_ticks / max` in wide integers, then clamp | The algorithm is language-agnostic; using a 64-bit intermediate is just overflow avoidance. |
| `if max == 0 return 0` flat-series guard | Two lines of control flow; directly prevents the most common chart crash. |
| `.max(1)` on a derived maximum (`BarChart::maximum_data_value`) | A hard floor on the divisor is portable and strictly safer than a runtime branch. |
| Empty-series `max().unwrap_or(1)` fallback | Same shape in any language: default the max, never NaN. |
| Value ÷ max only — never ÷ `data.len()` | The observation that this makes single-point and flat series safe for free is fully portable. |
| `.min(max_ticks)` clamp on out-of-range values | Prevents overspill; portable arithmetic. |
| `None` = absence, distinct from `Some(0)`, with its own glyph+style | A data-modelling distinction; needs only an optional number and two extra fields. |
| Substitution via a fixed-arity glyph-slot struct (`bar::Set`) | The insight is "one algorithm, swappable strings"; a TS object literal does this better than Rust. |
| `THREE_LEVELS` collapse of 9 slots onto 3 glyphs | Graceful degradation as *data*, not a code branch — makes ASCII a third preset for free. |
| Explicit absent/empty slot (`empty: " "`) in the ramp | Keeps the ladder total, so no index can ever be out of range. |
| `Gauge`: `.floor()` for the boundary cell, `.round()` for the fractional remainder | A precise rule for split-a-cell; portable arithmetic and a genuinely useful detail. |
| Separate filled/unfilled symbols **and** separate styles | Needed to render a share bar with a visible remainder; structural, not Rust-specific. |
| Clipping (not downsampling) when width < data | Documented behaviour we should consciously choose or reject; either way we should be explicit. |
| Finite-value rejection before drawing | `Number.isFinite()` is the exact TypeScript equivalent. |
| `total_cmp` for float ordering | Total-order comparison; TypeScript's `<`/`>` are already total for non-NaN, so this is a Rust-ism — see below. |
| Shade ramp as *density*, distinct from bar ramp as *height* | Conceptual separation of two ramps; the distinction is portable. |

**NOT-TRANSFERABLE**

| Finding | One-line reason |
|---|---|
| `Sparkline`/`Chart`/`Gauge`/`BarChart`/`Dataset`/`Axis` structs, traits and builders | Widget architecture tied to `Buffer`/`Cell`/`Rect`; our primitive is `string[]` with no cell buffer. |
| `ratatui::symbols::Marker` enum and its `resolution()` trait | Its whole purpose is telling the rasteriser how many sub-cells a glyph encodes; we have no rasteriser. |
| `canvas/line.rs` Bresenham `for_each_line_point` | Rasterises a continuous plane per-cell; our data cells must be 1 char each and braille/multi-sub-cell markers are already rejected. |
| `clip_line` world-space clipping | Operates on world→cell mapping we do not have. |
| `Canvas` grid composition (`▀`/`▄`/`█` from two stacked samples) | Assumes a mutable cell buffer with per-cell fg/bg; we emit immutable string lines. |
| Per-cell `Style` (fg, bg, modifiers) inside a buffer | Our return type is `readonly string[]` — no channel for style, hence heatmap intensity must be carried by the *character*, not colour. |
| `Chart`'s `Axis`/`GraphType::Area`/`fill_to_y` | Built on the Canvas; no glyph-ramp analogue and no value to us at row-0 resolution. |
| The braille/quadrant/sextant/octant marker family | Already rejected on our side: multi-sub-cell, one colour per cell, breaks per-cell colour for a heatmap. |
| scope-tui's `ln()`-on-both-axes scaling | Audio frequency/magnitude domain; meaningless for token counts and latencies. |
| scope-tui's hardcoded 30-entry frequency gridline list | Self-described by its author as a TODO anti-pattern. |
| scope-tui's `GraphConfig.scale` ("very arbitrary") constants | Unjustified magic numbers. |
| scope-tui's `DataSet` → `Dataset` conversion shim | A Rust ownership workaround ("TODO this is pretty ugly"), not a technique. |
| `total_cmp` itself | Rust-specific IEEE-754 total-order API; JS comparison operators already give a total order on non-NaN numbers. The *intent* (don't write a broken comparator) is portable; the function is not. |

---

## Comparison with our current glyph choices

**Our sparkline ramp (U+2581–U+2588 eighth blocks, matching omp's `SPECTRUM_BLOCKS`) is exactly
ratatui's `symbols::bar::NINE_LEVELS`, including the top rung and the ordering.** ratatui names them
`ONE_EIGHTH ▁` / `ONE_QUARTER ▂` / `THREE_EIGHTHS ▃` / `HALF ▄` / `FIVE_EIGHTHS ▅` /
`THREE_QUARTERS ▆` / `SEVEN_EIGHTHS ▇` / `FULL █`. Independent confirmation that the choice is
right: this is the de facto standard, and omp already agrees with it.

Is there anything better? **No.** Nothing in either project improves on it for our constraints. The
alternatives are all worse for us:

- `symbols::block` (U+2587–U+258F, left-anchored eighths) is a *left-fill* ramp, correct for a
  horizontal gauge where the fill grows rightward. For a **vertical** sparkline column the
  bottom-anchored `bar` ramp is the correct one. ratatui itself makes this distinction: `Gauge`
  uses `block`, `Sparkline`/`BarChart` use `bar`. Don't mix them up — using `block` in a vertical
  sparkline is a real bug (the bar would hang from the top).
- The sextant/octant/quadrant markers give finer vertical resolution (3, 4, or 8 sub-rows) but
  cost 2 columns per glyph and one colour per cell — both disqualifying for us.
- `Marker::Dot` (U+2022 `•`, width 1) is available but binary: presence/absence only.

**Our heatmap ramp (U+2591/2592/2593/U+2588 shade) is `symbols::shade`, exactly.** ratatui ships
it under exactly those names. But ratatui does **not** use it as a heatmap — it uses `shade::EMPTY`
as the absent-value marker, and offers `shade::FULL` as an example absent-value override. So we
should be careful about the claim: our heatmap use is a *sound extrapolation of a density ramp*
that ratatui reserves for a different purpose. Two caveats we should act on:

1. **Four levels is very coarse** for a heatmap whose whole point is discriminating between
   buckets. ratatui's ramp is 4 because pattern-fill glyphs are visually loud; a heatmap can carry
   far more information. The portable lever is `bar_set`'s arity-9 slot struct: a 5- or 6-level
   density ramp is a legal `Set` value, and mixing in `bar`'s eighths gives a continuous-looking
   9- or 10-step ladder (`▁▂▃▄▅▆▇█` then `░▒▓`) at zero extra algorithmic cost.
2. **`░▒▓` are dithered, not solid**, and dithering renders inconsistently across terminals. If we
   want a robust ladder, the eighth-blocks are strictly more predictable than the shades. That is
   a case where our *sparkline* ramp is the better primitive for the *heatmap* too — with the
   important caveat that a heatmap cell has no "bottom", so a vertical-fill glyph is semantically
   odd for it. `block`'s U+2589–U+258F left-fill ladder is the natural fit for a horizontally
   progressive heatmap cell.

Neither project has a calendar/heatmap widget, so there is no precedent to copy for layout
(week columns, weekday gutters, month labels) — only for the glyphs.

---

## Recommendations for our four chart types

### 1. Sparkline — keep U+2581–U+2588; add ratatui's guards and its `Set` indirection

Implement ratatui's tick model exactly: `ticks = value * (8 * rows) / max`, guard `max === 0 → 0`,
clamp to `max_ticks`. Put the eight glyphs behind a fixed-shape slot object so the ASCII preset is
a different string table rather than a branch — ratatui's `bar::Set` / `THREE_LEVELS` is the
proof this stays one code path. For the ASCII ladder use ratatui's degraded shape (`' '`, `▄`-like
replacement, full) or, better, `.:|`-style: reserve `empty` for `' '` so the index ladder is total.
**One deliberate divergence from ratatui: when `data.length > width`, bucket rather than clip** —
take the last `width` samples and, for much longer series, average into `width` buckets. Ratatui
clips to the *oldest* `width` points, which for a stats dashboard would hide recent activity. Add
a documented `sparklineDownsample: 'bucket' | 'clip'` option defaulting to `bucket`.

### 2. Ranked bar list — use ratatui's `BarChart` ladder, one row per entry

One row per ranked item, label left, then a horizontal bar built from the same 0..8 ladder, then
the value. Scale with `.max(1)` on the maximum (ratatui's `maximum_data_value`), so a list of all
zeros renders blanks instead of dividing by zero — and unlike a vertical sparkline, a flat list
should normalise to the largest entry (min-max to `[0, max]`) since the whole point is comparison.
Use **9 levels on one row** rather than ratatui's multi-row vertical layout: rank is encoded by
row order, magnitude by horizontal extent, and one row per entry keeps the line count predictable.
Because the bar is horizontal and left-anchored, this is the one place where `block`'s left-fill
semantics are irrelevant and `bar`'s are fine either way — pick `bar` for visual consistency with
the sparkline. Guard: if `labelWidth + barArea + valueWidth > width`, shrink the bar area first,
then truncate labels with a measured ellipsis (never a raw slice that can split a wide glyph).

### 3. Share bar — adopt `Gauge`'s floor/remainder split with `LineGauge`'s dual symbols

Model it exactly as `Gauge` does, one line high: `filled = width * ratio`, fill cells
`[0, floor(filled))` with the full block, then draw the cell at `floor(filled)` with the
eighth-block glyph for `filled % 1.0` (ratatui's `get_unicode_block`, rounded to 8 steps), and fill
the remainder with a distinct *unfilled* symbol plus a **separate style** (ratatui's
`LineGauge` distinguishes `filled_symbol`/`unfilled_symbol` *and* `filled_style`/`unfilled_style`
for exactly this reason — without a distinct remainder the user cannot see the boundary). Clamp
`ratio` to `[0,1]` (ratatui panics; we must clamp, since we cannot crash a render). Use `block`'s
left-fill ramp here, not `bar`'s — this is a horizontal gauge. For `nerd` preset, a filled
background colour on the filled run is the cleanest degrade; for `ascii`, `[####----]`.

### 4. Calendar heatmap — keep the shade ramp, but widen it and add a true "no data" glyph

Two changes to what we already measured. First, **widen the ladder.** A 4-step ramp cannot
discriminate the buckets a stats calendar needs. Follow `bar::Set`'s shape and use the continuous
eighth-blocks U+2581–U+2588 as the ladder — they are solid, universally rendered, and width-1 —
reserving the shades U+2591/2592/2593 for the ASCII-preset degrade where you want density
*without* relying on solid blocks. Second, **carry the absence distinction** ratatui's
`SparklineBar { value: Option<u64> }` makes explicit: a day with no data must render as a distinct
"no data" cell, never as the zero rung of the ladder — otherwise every calendar gets a false
zero-usage band. Then quantise the month's values into `buckets.length - 1` levels with
`Math.floor(normalised * levels)` clamped to `levels - 1`, so the maximum day never lands outside
the array. For the ASCII preset use a separate density ladder entirely (`.` `:` `+` `#`), which
ratatui has no equivalent for but which is exactly what `THREE_LEVELS` demonstrates is safe to do
as a swapped string table.

---

## Emoji / width violations

**Verified measurement.** Every glyph listed below was extracted from ratatui source and then
measured with `Bun.stringWidth`. All block/shade glyphs are exactly 1 cell.

| Glyph | Codepoint | `Bun.stringWidth` | Usable? |
|---|---|---|---|
| `█` (bar/block/shade `FULL`) | U+2588 | 1 | ✅ |
| `▇` `▆` `▅` `▄` `▃` `▂` `▁` (bar ramp) | U+2587–U+2581 | 1 | ✅ |
| `▉` `▊` `▋` `▌` `▍` `▎` `▏` (block ramp) | U+2589–U+258F | 1 | ✅ |
| `░` `▒` `▓` (shade ramp) | U+2591–U+2593 | 1 | ✅ |
| `▀` `▄` (half block) | U+2580 / U+2584 | 1 | ✅ |
| `•` (`symbols::DOT`) | U+2022 | 1 | ✅ (but binary: presence/absence only) |

**Things to watch, flagged from source:**

- **`ratatui::symbols::Marker::Sextant`** — the sextant set starts at U+1FB00. Measured
  `Bun.stringWidth("🬀") === 1` on Bun, so these *do* pass. **However**, U+1FB00–U+1FB3B
  (Sextants) and U+1CD00–U+1CDE5 (Octants) are from very recent Unicode additions and are
  **missing from many fonts**. They will render as tofu (`��`) at width 1 on older systems, which
  is a worse failure than a width mismatch: layout stays correct and the chart is silently
  unreadable. If we ever offer a higher-resolution preset, gate it on explicit font support rather
  than assuming. They are irrelevant to us anyway — already rejected on colour grounds.
- **`Marker::Octant`** starts at U+1CE80, same font-support caveat, same irrelevance.
- **No emoji are used as data glyphs in either project.** `braille` (U+2800–U+28FF) is width 1 and
  is not emoji, but it is a 2×4 sub-cell raster — already rejected by us for per-cell colour.
- **Nothing in either project's ramp set violates the width-1 rule.** This is a genuinely
  well-behaved area of ratatui: every symbol constant is a single-width string, and
  `pub const ... : &str` (rather than a grapheme cluster) makes that structurally hard to get wrong.
- **The risk on our side is not these projects — it is labels and icons.** None of the four chart
  types draws user data as emoji, so the rule holds by construction provided our own icons and
  badge glyphs stay out of data cells. Worth asserting in a test: for every string a chart
  component returns, `Bun.stringWidth(line) <= width`, and every character drawn from a ramp is
  width 1.

**Verification method:** each glyph literal was read out of the ratatui source files listed above,
then measured in a Bun kernel with `[...s].map(c => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4,"0"))` and `Bun.stringWidth(s)`. No codepoint in this document is quoted from memory.

---

## Sources

All accessed **2026-10-03**.

**ratatui** (`https://github.com/ratatui/ratatui`, branch `main`):

- `ARCHITECTURE.md` — https://raw.githubusercontent.com/ratatui/ratatui/main/ARCHITECTURE.md
- `ratatui-core/src/symbols/bar.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-core/src/symbols/bar.rs
- `ratatui-core/src/symbols/block.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-core/src/symbols/block.rs
- `ratatui-core/src/symbols/shade.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-core/src/symbols/shade.rs
- `ratatui-core/src/symbols/half_block.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-core/src/symbols/half_block.rs
- `ratatui-widgets/src/sparkline.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-widgets/src/sparkline.rs
- `ratatui-widgets/src/gauge.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-widgets/src/gauge.rs
- `ratatui-widgets/src/barchart.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-widgets/src/barchart.rs
- `ratatui-widgets/src/chart.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-widgets/src/chart.rs
- `ratatui-widgets/src/canvas.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-widgets/src/canvas.rs
- `ratatui-widgets/src/canvas/line.rs` — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-widgets/src/canvas/line.rs
- Repo tree (path verification) — https://api.github.com/repos/ratatui/ratatui/git/trees/main?recursive=1
- `Chart` API docs — https://docs.rs/ratatui/latest/ratatui/widgets/struct.Chart.html
- `Dataset` API docs — https://docs.rs/ratatui-widgets/latest/ratatui_widgets/chart/struct.Dataset.html

**scope-tui** (`https://github.com/alemidev/scope-tui`, branch `dev`):

- Repository root — https://github.com/alemidev/scope-tui
- `src/display/mod.rs` — https://raw.githubusercontent.com/alemidev/scope-tui/dev/src/display/mod.rs
- `src/display/spectroscope.rs` — https://raw.githubusercontent.com/alemidev/scope-tui/dev/src/display/spectroscope.rs
- `Cargo.toml` — https://raw.githubusercontent.com/alemidev/scope-tui/dev/Cargo.toml
- Repo tree (path verification) — https://api.github.com/repos/alemidev/scope-tui/git/trees/dev?recursive=1

**Verification:** Bun kernel measuring `Bun.stringWidth` and `codePointAt` for every glyph quoted
above, run in-session on 2026-10-03.