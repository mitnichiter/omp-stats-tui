# Angle
Glyph selection for a time-series stats panel in `pi-tui`, reconciled against what `pi-tui` already ships.

## Recommendation

Four visuals, four glyph sets, all plain Unicode — **no Nerd Font codepoints for data ink**:

1. **Daily cost/requests bars → eighth blocks `▁▂▃▄▅▆▇█` (U+2581–U+2588)**, one column per day, drawn bottom-anchored with the accent colour. This is the same set `spark` uses and the same ramp the first-party splash screen already uses (`WATER_RAMP` uses `█▓▒░`). Eighth blocks give 8 sub-cell levels, so a 7-row panel holds 56 distinct bar heights before rounding, and columns stay exactly one cell wide so layout maths never breaks. ASCII fallback: `#` / `=` ramp (omp's `ascii` preset uses `=` for `progress.filled`, `#` for `sep.block`).
2. **Cumulative token sparkline → same eighth-block ramp**, top-aligned (value → glyph level), with the ASCII fallback being a literal `*`/`:` column. Do *not* introduce a second ramp; one ramp across bars and sparkline reads as one system.
3. **Per-model comparison → `█` (U+2588) horizontal bars via `renderProgressBar`** with `theme.symbol("progress.filled")` / `theme.symbol("progress.empty")`. This is exactly what first-party `tools/find.ts` already does for its score gauge — reuse `ProgressBar` and you inherit theming, width clamping, truncation, and the native `progress` node for free.
4. **GitHub-style calendar heatmap → shades `░▒▓█` (U+2591–U+2593 + U+2588) for the fill ramp, with the eight eighth-blocks reused for the day-cell body when a fifth intensity step is needed.** Colour carries the bucketing (accent at low alpha → full accent), glyph carries the fallback when colour is unavailable. Cells stay one column wide with an empty column between weeks.

**Never use braille for the bars or the heatmap.** See the Braille assessment.

**Never use emoji for data ink** (`📊`, `🛒`): they are East-Asian-Wide or fallback to double-width inconsistently, and omp already confines them to the `unicode` preset's *icon* slots. Use `theme.symbol("cmd.stats")` / `theme.icons.gauge` / `theme.icons.stats` for headings and let the preset system decide the icon glyph.

**Do not draw the panel's own box.** Use pi-tui's `Box` component and `theme.symbol("boxRound.*")` so the panel frames identically to every other omp surface.

The whole glyph decision collapses to: **read the preset through the theme, never branch on terminal detection yourself.** See Capability detection.

## Glyph sets (web research)

### Eighth blocks — U+2581–U+2588

`▁` U+2581 LOWER ONE EIGHTH BLOCK, `▂` U+2582, `▃` U+2583, `▄` U+2584, `▅` U+2585, `▆` U+2586, `▇` U+2587, `█` U+2588 FULL BLOCK. Eight levels per cell because each glyph fills the bottom `n/8` of the cell box. Use: vertical bar charts and sparklines. Tradeoff: baseline-only — you cannot draw a bar that floats mid-cell without upper blocks (`▀` U+2580, `▄` U+2584), which is fine for magnitude-from-zero data (our case) and wrong for anything with a non-zero baseline.
https://en.wikipedia.org/wiki/Block_Elements — accessed 2026-10-02 — [secondary]

### Shade ramp — U+2591–U+2593

`░` U+2591 LIGHT SHADE, `▒` U+2592 MEDIUM SHADE, `▓` U+2593 DARK SHADE, `█` U+2588. Only four density levels, so the ramp is coarse; pair with colour. Use: heatmaps where colour may be stripped (`NO_COLOR`). This is the exact ramp omp's splash uses (`WATER_RAMP`, lightest→heaviest `█▓▒░` by descending density threshold).
https://en.wikipedia.org/wiki/Block_Elements — accessed 2026-10-02 — [secondary]

### Block Elements block — U+2580–U+259F

`▀` U+2580 UPPER HALF, `▁`–`█` U+2581–U+2588 lower eighths→full, `▉` U+2589 LEFT SEVEN EIGHTHS, `▊`–`▋` U+258A–U+258B left eighths, `▌` U+258C LEFT HALF, `▍`–`▎` U+258D–U+258E, `▏` U+258F LEFT ONE EIGHTH, `▐` U+2590 RIGHT HALF, `░▒▓` U+2591–U+2593, `▔` U+2594 UPPER ONE EIGHTH, `▕` U+2595 RIGHT ONE EIGHTH, `▖`–`▛` U+2596–U+259B QUADRANTS, `▜`–`▟` U+259C–U+259F QUADRANTS heavy/light.
https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt — accessed 2026-10-02 — [primary]

### Box drawing — U+2500–U+257F

Light `─` U+2500, `│` U+2502, `┌┐└┘` U+250C/2510/2514/2518; heavy `━` U+2501, `┃` U+2503, `┏┓┗┛` U+250F/2513/2517/251B; double `═` U+2550, `║` U+2551, `╔╗╚╝` U+2554/2557/255A/255D; rounded `╭╮╰╯` U+256D/256E/2570/257F-range corners (`╰` U+2570, `╯` U+256F); mixed `╞╡│├┤` U+255E/2561/2502/251C/2524. **Ambiguous-width**: `U+2500..U+254B` and `U+2550..U+2573` are `East_Asian_Width=A`; `U+254C..U+254F` and `U+2574..U+257F` are `N`. In a CJK-ambiguous-wide terminal the `A` subset renders double-width and any hand-rolled frame tears. omp's `unicode` preset uses `boxRound` (rounded light) and `boxSharp` (heavy) and maps both to pure `+ - |` under `ascii`, so this risk is already absorbed for us.
https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt — accessed 2026-10-02 — [primary]
https://unicode.org/reports/tr11/ — accessed 2026-10-02 — [primary]

### Braille — U+2800–U+28FF (Bit Patterns)

Each codepoint is an 8-dot bitmask, 2 columns × 4 rows, giving 4× vertical and 2× horizontal sub-cell resolution. plotext exposes it as `marker="braille"` with subdivision table `hd` 2×2 (default), `fhd` 3×2, `braille` 4×2. Plotext warns that all points sharing one cell share one foreground colour, and that non-supporting terminals show replacement glyphs. Also note plotext's own sizing guidance: use roughly 2× as many columns as rows because cells are taller than wide.
https://plotext.readthedocs.io/en/latest/marker.html — accessed 2026-10-02 — [primary]

### `spark` / bashspark — `▁▂▃▄▅▆▇█`

The canonical sparkline script maps each value onto eight levels by linear min–max interpolation: `index = (value - min) * 7 / range`. Known weaknesses: (a) min/max scaling means a single outlier flattens everything else; (b) it is a magnitude-from-zero-relative-to-the-series-min encoding, so it does not read as absolute magnitude — a "cost" sparkline silently rescales as the window changes; (c) fixed one-cell-per-sample width means wide terminals just get a long thin strip unless you explicitly downsample, which is where the "issues with wide terminals" come from — the script has no windowing.
https://linuxcommandlibrary.com/man/spark — accessed 2026-10-02 — [secondary]

### asciichart / asciigraph (Go)

The Go port exposes a configurable char set; `asciigraph.CreateCharSet("█")` maps the full block onto horizontal/vertical/corner/cap so a line chart renders as solid blocks. It also accepts graduated sets like `{' ','░','▒','▓','█'}` for density and heavy box-drawing (`━┃┏┓┗┛╸╺`) for smooth line joins. **Last-column problem**: asciichart-family tools pad each row to the plot width and the final column is where the series terminates — the classic symptom is a plot whose right edge appears one cell short or whose cap glyph overwrites the last data point, because the algorithm reserves a cell for an axis/intercept glyph.
https://pkg.go.dev/github.com/guptarohit/asciigraph — accessed 2026-10-02 — [primary]
https://raw.githubusercontent.com/guptarohit/asciigraph/master/options.go — accessed 2026-10-02 — [primary]

### Plotext / termplot

`plotext` `render`/figure API does not expose block-element bars as a first-class marker set — its markers are `hd`/`fhd`/`braille` (subcell dots), which is why braille-mode plots are the high-resolution path rather than bars. `termplot` is not documented in the sources I reached.
https://plotext.readthedocs.io/en/latest/marker.html — accessed 2026-10-02 — [primary]
**Gap:** no authoritative `termplot` glyph documentation was found in this pass.

### Pie / chart-like symbols in Unicode proper

`◔` U+25D4, `◕` U+25D5, `◑` U+25D1, `◕◖◗◘` U+25D5–U+25D8, `◙` U+25D9, and emoji `🧭` U+1F9ED are the only "pie" affordances; there is no filled-pie wedge in Unicode proper. Everything else (📊 U+1F4CA) is in the emoji blocks.
https://en.wikipedia.org/wiki/Block_Elements — accessed 2026-10-02 — [secondary]

### Nerd Fonts ranges

Authoritative ranges per the project wiki: Powerline `U+E0A0–U+E0A2`, `U+E0B3`, `U+E0B4–U+E0C8`, `U+E0CA`, `U+E0CC–U+E0D7`; Font Awesome legacy `U+F000–U+F2E0`-ish; Material Design Icons relocated to `U+F0001–U+F1AF0`. Underlying PUA boundaries per Unicode: `U+E000–U+F8FF`, `U+F0000–U+FFFFD`, `U+100000–U+10FFFD` — note `U+FFFFE–U+FFFFF` and `U+10FFFE–U+10FFFF` are noncharacters, not PUA. Nerd Fonts' own development guidance says: prefer an existing standardised Unicode character, and only use a PUA codepoint when no Unicode assignment exists.
https://github.com/ryanoasis/nerd-fonts/wiki/Glyph-Sets-and-Code-Points — accessed 2026-10-02 — [primary]
https://unicode.org/faq/private_use.html — accessed 2026-10-02 — [primary]

### Ambiguous width

`East_Asian_Width=A` means "narrow in a Western terminal, possibly wide in a CJK terminal". In Unicode 18.0, `U+2580..U+258F` and `U+2592..U+2595` are `A`; `U+2590`, `U+2591`, `U+2596..U+259F` are `N`. Unicode explicitly declines to prescribe a single terminal answer. Practical rule used by terminals: `W`/`F` → 2, `A` → 1 (or 2 under an explicit ambiguous-wide policy), else 1.
https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt — accessed 2026-10-02 — [primary]
https://unicode.org/reports/tr11/ — accessed 2026-10-02 — [primary]

### Terminal capability detection (termenv / colorprofile)

`termenv.ColorProfile()` order: non-TTY → Ascii; `GOOGLE_CLOUD_SHELL=true` → TrueColor; `COLORTERM=truecolor|24bit` → TrueColor; `COLORTERM=true|yes` → ANSI256; known direct-color `TERM` → TrueColor; `TERM=linux|xterm` → ANSI; `*256color` → ANSI256; contains `color|ansi` → ANSI; else Ascii. `EnvColorProfile()` layers `NO_COLOR` → Ascii, and `CLICOLOR_FORCE` → at least ANSI. Degradation order is TrueColor > ANSI256 > ANSI > Ascii (the Go enum is declared in the opposite numeric order — don't infer precedence from the constants). Newer Charm uses `colorprofile.Detect`, which takes the max of env detection, terminfo (`Tc`/`RGB`), and tmux detection.
https://raw.githubusercontent.com/muesli/termenv/master/termenv_unix.go — accessed 2026-10-02 — [primary]
https://raw.githubusercontent.com/charmbracelet/colorprofile/main/env.go — accessed 2026-10-02 — [primary]

**There is no documented Nerd-Font detection heuristic.** No primary source describes a reliable program-side "does this terminal have a Nerd Font" probe; the only sound mechanisms are an explicit user setting or a font-coverage query protocol — which is exactly what pi-tui's own Glyph Protocol is (see below).

## What omp already uses (local recon)

All paths relative to `~/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/`.

`theme/symbols.ts:5` — the whole system is three presets:
```ts
export type SymbolPreset = "unicode" | "nerd" | "ascii";
```

`theme/theme-class.ts:214` — `const baseSymbols = SYMBOL_PRESETS[symbolPreset];` (preset chosen by user setting, `theme/schema.ts:38` `preset?: "unicode" | "nerd" | "ascii"`; setters `theme/theme.ts:328 setSymbolPreset`, `:361 setNativeSymbolPreset`).

Key glyphs, with codepoints (computed with `bun -e`):

| key | unicode | nerd | ascii | file:line |
|---|---|---|---|---|
| `progress.filled` | `━` U+2501 | `━` U+2501 | `=` U+003D | symbols.ts:415 / 737 / 1194 |
| `progress.empty` | `─` U+2500 | `─` U+2500 | `-` U+002D | symbols.ts:416 / 739 / 1195 |
| `sep.block` | `█` U+2588 | `█` U+2588 | `#` U+0023 | symbols.ts:800 / 1226 |
| `context.speculation` | `╎` U+254E | `\u{f055d}` U+F055D | `:` U+003A | symbols.ts:418 / 741 / 1197 |
| `context.compaction` | `┃` U+2503 | `\u{f0068}` U+F0068 | `|` U+007C | symbols.ts:419 / 742 / 1198 |
| `cmd.stats` (`/stats`) | `📊` U+1F4CA | `\uf080` U+F080 (nf-fa-bar_chart) | `""` (disabled) | symbols.ts:529 / 954 / 1305 |
| `icon.throughput` (`/usage` `icon:"gauge"`) | `⚡` U+26A1 | `\uf0e4` U+F0E4 (nf-fa-tachometer) | `tok/s:` | symbols.ts:489 / 878 / 1264 |
| `icon.cost` | `💲` U+1F4B2 | `\uf155` U+F155 | `$` U+0024 | symbols.ts:476 / 849 / 1254 |
| `icon.subscription` | `(sub)` | `\u{f067a}` U+F067A (nf-md-currency_usd_off) | `(sub)` | symbols.ts:477 / 851 / 1255 |
| `icon.intelligence` | `🧠` U+1F9E0 | `\uee9c` U+EE9C (findnerd) | `IQ` | symbols.ts:490 / 880 / 1265 |
| `cmd.wave` | `∿` U+223F | `\u{f095b}` U+F095B (nf-md-sine_wave) | `""` | symbols.ts:521 / 938 / 1297 |
| `cmd.cart` | `🛒` U+1F6D2 | `\uf07a` U+F07A (nf-fa-shopping_cart) | `""` | symbols.ts:558 / 1012 / 1334 |
| `cmd.inbox` | `📥` U+1F4E5 | `\uf01c` U+F01C (nf-fa-inbox) | `""` | symbols.ts:523 / 942 / 1299 |
| `boxRound.*` | `╭╮╰╯` U+256D/256E/2570/256F | same | `+` U+002B, `-`, `|` | symbols.ts:~420 / ~743 / 1200-1205 |
| `boxSharp.*` | heavy `┏┓┗┛` U+250F/2513/2517/251B | same | `+ - |` | symbols.ts / 1213-1224 |
| `cmd.stats` in ascii | — | — | `""` | symbols.ts:1305 |

Icon-name → glyph mapping, `theme/theme-class.ts`:
```ts
667:			stats: this.#symbols["cmd.stats"],
705:			gauge: this.#symbols["icon.throughput"],
706:			context: this.#symbols["icon.context"],
```

Box symbol interfaces (`symbols.ts:1-26`): `BoxSymbols` (11 keys incl. tees/cross), `SymbolTheme` with `boxRound`, `boxSharp`, `table`, `spinnerFrames`, `colorSwatch?`.

The one first-party density ramp, `setup/scenes/splash.ts:33-38`:
```ts
/** Density ramp for the rippling water, lightest → heaviest. */
const WATER_RAMP = [
	{ min: 0.62, char: "█" },
	{ min: 0.5, char: "▓" },
	{ min: 0.36, char: "▒" },
	{ min: 0.24, char: "░" },
];
```
That is precedent for shade-ramp-by-threshold, plus `✦` U+2726 for stars.

**No first-party component draws a sparkline or a bar chart.** `components/progress-bar.ts` is the closest: `renderProgressBar(value, width, {style:{filled,empty}})` fills a run of `filled` glyphs then a run of `empty` glyphs, measuring with `visibleWidth()` and clamping via `truncateToWidth(..., Ellipsis.Omit)`. `tools/find.ts:105-122` is the only data-viz consumer:
```ts
/** Cells in the per-hit score gauge. */
const GAUGE_WIDTH = 6;
function gauge(p: number, theme: Theme): string {
	return renderProgressBar(p, GAUGE_WIDTH, { style: { … } });
}
```

`theme/symbols.ts:779` styles itself:
```ts
// pick: █ | alt: ▓ ▒ ░ ▉ ▌
"sep.block": "█",
```

## Capability detection

`terminal-capabilities.ts` (60.6K) exports **no unicode/nerd-font/cell-width-for-glyphs helper at all**. What it does detect:

- Terminal identity: `detectTerminalId(env)` (line 718), `export const TERMINAL_ID: TerminalId` (774), `export const TERMINAL: RuntimeTerminal` (799). `TerminalId` includes a `"trueColor"` pseudo-id derived at line 769: `if (caseEq(COLORTERM, "truecolor") || caseEq(COLORTERM, "24bit")) return "trueColor";`
- Feature flags on `TERMINAL`: `hyperlinks`, `deccara`, `imageProtocol`, `supportsScreenToScrollback`, `textSizing`, `styledUnderlines`, `rectangularSgr` — with setters `setTerminalHyperlinks` (881), `setTerminalDeccara` (850), `setTerminalGlyphProtocol(supported)` (855), `setOsc99Supported` / `isOsc99Supported` (1439/1444).
- Cell size, via **CSI 16t**: `tui.ts:2241` writes `"\x1b[16t"`, the reply is parsed at `tui.ts:2683` → `setCellDimensions({ widthPx, heightPx })`; read via
  ```ts
  export interface CellDimensions { widthPx: number; heightPx: number }
  // Default cell dimensions - updated by TUI when terminal responds to query
  let cellDimensions: CellDimensions = { widthPx: 9, heightPx: 18 };
  export function getCellDimensions(): CellDimensions { return cellDimensions; }
  ```
  Cursor position uses CSI 6n (`tui.ts:1949`, geometry epoch at 821).
- Environment overrides: `synchronizedOutputUserOverride` (357), `hyperlinksUserOverride` (503), `isInsideZellij` (282), `isSshSession` (290), `isNotificationSuppressed` (294), `isImageProtocolForced` (316), `isPaseoEmbedder` (615).

`NO_COLOR` is honoured in exactly one place — `render/hyperlink.ts:95`:
```ts
if (Bun.env.NO_COLOR) return false;
```
There is **no `TERM=dumb` check** anywhere, and no `unicode: false` config flag. ASCII degradation is purely the user's `symbolPreset: "ascii"` setting.

**What an extension should call:** nothing from `terminal-capabilities.ts`. Use the theme:

```ts
theme.symbol(key)            // theme/theme-class.ts:463  — raw glyph for the active preset
theme.styledSymbol(key, fg)  // :470                    — glyph in a theme colour
theme.getSymbolPreset()      // :477                    — "unicode" | "nerd" | "ascii"
```
and branch on `getSymbolPreset()` only for *icon choices*. Never branch on glyph codepoints yourself; that is the entire point of the preset system.

For cell size (only needed if we want pixel-accurate braille or aspect correction) call `getCellDimensions()` from `terminal-capabilities.ts:922`.

## Nerd Font finding

**omp's icons are real Nerd Font codepoints, not PUA-local ones** — in the `nerd` preset only. `cmd.stats` → `\uf080` U+F080 is annotated in-source as `nf-fa-bar_chart`; `icon.throughput` → `\uf0e4` U+F0E4 is `nf-fa-tachometer`; `icon.cost` → `\uf155` U+F155. The source comments carry the Nerd Fonts names inline (`symbols.ts:953-954`, `:877-878`, `:848-849`), and later additions use the Material Design range (`\u{f067a}`, `\u{f095b}`, `\u{f04e1}`) and even non-Nerd PUA (`\uee9c`, "findnerd"). Both BMP PUA (U+E000–U+F8FF) and Supplementary PUA-A (`\u{f055d}` = U+F055D) are in play.

Separately, pi-tui ships its **own** glyph protocol on those same PUA ranges — `glyph-protocol.ts` registers base64 font outlines into the terminal over APC `\x1b_25a1;r;cp=…` and can query coverage. That is a custom icon font, and it is orthogonal to the `nerd` preset.

**What follows for us:**
1. **Presets are opt-in, never detected.** There is no probe, no heuristic, and no `TERM=dumb`/`NO_COLOR` glyph fallback. A user on `unicode` gets `📊`; a user on `nerd` gets U+F080; a user on `ascii` gets `""` (the ASCII preset intentionally disables the slash-command icon column). If we hardcode a Nerd Font codepoint we break the `unicode` preset with a tofu box.
2. **Therefore: never emit a PUA codepoint from the data layer.** Data ink must be standard Unicode (eighth blocks / shades), which is correct under all three presets. Nerd Fonts should be used only where omp already uses them — icons — and only through `theme.symbol("cmd.stats")` / `theme.icons.*`.
3. **Don't invent Nerd Font detection.** If we ever need a chart-specific Nerd icon, add a `SymbolKey` to all three presets in `theme/symbols.ts` (with an ASCII entry) rather than branching in our own code.
4. **Never use emoji for data ink.** `📊` U+1F4CA is the `unicode` preset's `cmd.stats`; reusing it as a bar glyph would inherit its width instability.

## Braille assessment

**Verdict: no, braille is wrong for the daily-bucket bar chart and wrong for the calendar heatmap. It is defensible only for a dense multi-series cumulative line plot, and even then it is a marginal win for our panel size.**

The reasoning:
- **It is a raster, not a bar chart.** Braille U+2800–U+28FF is an 8-bit dot mask over a 2×4 sub-cell grid. There is no "column height" in braille; you get a bitmap and you decide for yourself what it depicts. Every braille terminal plot (plotext's `marker="braille"`, `fbb`, `ascii-charts`) is doing point/line rasterisation, and plotext explicitly makes it a *marker* choice, not a bar mode.
- **Sub-cell colour is impossible.** plotext states points sharing a character cell share one foreground colour. A heatmap *is* per-cell colour — braille would destroy exactly the channel the heatmap needs. It also destroys per-column styling: you cannot tint day N differently from day N+1 if both share a cell.
- **Its resolution advantage is mostly vertical-only, which is what blocks already give.** Braille is 2 wide × 4 tall. Eighth blocks give 1 cell × 8 vertical levels and are trivially per-column colourable, alignable to a shared baseline, and pausable/animatable. For a 30-day bar chart at 8 levels, blocks are strictly better.
- **Aspect is wrong without a 2:1 fudge**, per plotext's own sizing note (cells are taller than wide), which means a braille calendar has to be hand-tuned per terminal — bad for a TUI that reflows on resize.
- **Fallback is worse.** A terminal without Braille coverage renders replacement glyphs (tofu), not a degraded chart. Eighth blocks have effectively universal coverage in any UTF-8 terminal.
- **It is unreadable at our size.** A GitHub-style heatmap cell is one column of, say, 2–3 cells tall. A 2×4 braille dot matrix inside a 1-column cell loses half its horizontal resolution for no gain.

Where braille *would* win: a full-panel cumulative token plot over ~100+ samples where you want sub-column horizontal detail, with a single accent colour throughout. If we want that later, it is a per-series opt-in, not the default — and it must be gated on the user's `symbolPreset !== "ascii"`.

## Sources

1. https://plotext.readthedocs.io/en/latest/marker.html — accessed 2026-10-02 — [primary]
2. https://plotext.readthedocs.io/en/latest/size.html — accessed 2026-10-02 — [primary]
3. https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt — accessed 2026-10-02 — [primary]
4. https://unicode.org/reports/tr11/ — accessed 2026-10-02 — [primary]
5. https://unicode.org/faq/private_use.html — accessed 2026-10-02 — [primary]
6. https://github.com/ryanoasis/nerd-fonts/wiki/Glyph-Sets-and-Code-Points — accessed 2026-10-02 — [primary]
7. https://raw.githubusercontent.com/muesli/termenv/master/termenv_unix.go — accessed 2026-10-02 — [primary]
8. https://raw.githubusercontent.com/charmbracelet/colorprofile/main/env.go — accessed 2026-10-02 — [primary]
9. https://pkg.go.dev/github.com/guptarohit/asciigraph — accessed 2026-10-02 — [primary]
10. https://raw.githubusercontent.com/guptarohit/asciigraph/master/options.go — accessed 2026-10-02 — [primary]
11. https://linuxcommandlibrary.com/man/spark — accessed 2026-10-02 — [secondary]
12. https://en.wikipedia.org/wiki/Block_Elements — accessed 2026-10-02 — [secondary]
13. Local recon (read-only), `@oh-my-pi/pi-tui/src/`, accessed 2026-10-02 — [primary]

## Gaps

- **`termplot` glyph set: no authoritative source found.** Searches returned `asciigraph`, `ascii-charts`, `tplot`, `gochart` but no primary `termplot` documentation. Its last-column handling is therefore unverified in this pass.
- **`fbb` braille rasteriser: not researched.** Only braille's Unicode structure and plotext's marker docs were cited; `fbb`'s specific raster algorithm is unsourced here.
- **`spark` "wide terminal issues" are inferred, not quoted.** The original `ashberg/bashspark` repo was not read; the resize/windowing criticism above is a reading of the script's fixed one-cell-per-sample design, not a cited issue thread.
- **Nerd Font detection: confirmed absent, not merely unfound.** Searches for a documented program-side detection heuristic returned only coverage-query protocols and the "prefer standard Unicode" guidance. There is no such heuristic to cite — this is a negative finding from the available primary sources.
- **omp's `unicode` preset emoji width instability was not measured** on any specific terminal; the recommendation to avoid emoji for data ink rests on the general East Asian Width argument, not on a reproduction in Ghostty/Kitty/iTerm2.
- **The exact last-column fix used by plotext/render and termplot was not read from source.** The general asciichart-family behaviour is cited; omp's own components sidestep it by construction (`truncateToWidth` + `visibleWidth`), which is the mitigation we should copy.