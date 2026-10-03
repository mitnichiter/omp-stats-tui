# Angle — F10: the per-preset glyph system for a stats panel

Read-only investigation of `~/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/` (theme +
overlays + components) and `~/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/client/data/formatters.ts`,
plus a read-only snapshot of `~/.omp/stats.db` for real magnitudes. No package or project file was
modified. Codepoints below were computed with `bun -e` printing `codePointAt(0).toString(16)`; none
are from memory. Widths were checked against both `string-width` (default) and
`Bun.stringWidth(c, { countAnsiEscapeCodes: false, ambiguousIsNarrow: true })` — the options object
omp itself uses at `pi-tui/src/utils.ts:252`.

`omp` has exactly three symbol presets (`symbols.ts:5` `export type SymbolPreset = "unicode" | "nerd" | "ascii"`),
the user picks one, and nothing detects glyph coverage. Every registered key has three hand-authored
values. That table is generous for chrome and **empty for data ink**: there is no eighth-block ramp
key, no shade key, no heatmap-cell key, no per-column bar-fill key. `theme.symbol("chart.barFill")`
returns `undefined` (verified — the map is a plain `Record`, no prototype fallback). So the panel
cannot route its ramps through the preset system, and it must supply its own.

This document:

1. Enumerates every registered key that a data panel can use, with its codepoint under each preset.
2. Names the roles omp does *not* register.
3. Proposes one module, `panelGlyphs(theme)`, that is the single place that switches on
   `theme.getSymbolPreset()` — no scattered `if (ascii)` branches.
4. Picks concrete characters per role per preset with justification against five criteria.
5. Rules on heatmap intensity: glyph, colour, or both.
6. Specifies number formatting against this user's real data (24.4 B tokens, 95.1 % of them
   cache reads, 32.4 % of tokens priced at exactly $0.00).

**Headline conclusion:** the `nerd` preset buys the panel **nothing** for data ink, and the `ascii`
preset can support exactly **five** distinct density levels per cell column, not eight. Everything
else is a straight reuse of keys omp already ships.

## Registered symbols by preset

All values are the literal source strings from `theme/symbols.ts` (`UNICODE_SYMBOLS` at `:389`,
`NERD_SYMBOLS` at `:689`, `ASCII_SYMBOLS` at `:1168`), decoded to codepoints. Keys that are relevant
to a data panel — chrome that frames or annotates numbers — fall into five groups.

### Progress / bar primitives

| key | unicode | nerd | ascii | declared at |
|---|---|---|---|---|
| `progress.filled` | `━` U+2501 | `━` U+2501 | `=` U+003D | `symbols.ts:415` / `:737` / `:1194` |
| `progress.empty` | `─` U+2500 | `─` U+2500 | `-` U+002D | `symbols.ts:416` / `:739` / `:1195` |
| `sep.block` | `▌` U+258C | `█` U+2588 | `#` U+0023 | `symbols.ts:451` / `:800` / `:1229` |
| `context.speculation` | `╎` U+254E | `󰕝` U+F055D | `:` U+003A | `symbols.ts:418` / `:741` / `:1197` |
| `context.compaction` | `┃` U+2503 | `󰁨` U+F0068 | `\|` U+007C | `symbols.ts:419` / `:742` / `:1198` |

**`sep.block` is a trap.** Under `unicode` it is `▌` U+258C (LEFT HALF BLOCK), *not* `█`. Anything
that assumes "the block key is a full block" is wrong in exactly one of the three presets, silently.
`nerd` is the only one where `sep.block` is `█`. Never use `sep.block` as a bar fill.

### Box drawing (chrome for the panel frame and for table rules)

| key | unicode | nerd | ascii | declared at |
|---|---|---|---|---|
| `boxRound.topLeft` | `╭` U+256D | same | `+` U+002B | `symbols.ts:421` / `:745` / `:1200` |
| `boxRound.topRight` | `╮` U+256E | same | `+` U+002B | `:422` / `:746` / `:1201` |
| `boxRound.bottomLeft` | `╰` U+2570 | same | `+` U+002B | `:423` / `:747` / `:1202` |
| `boxRound.bottomRight` | `╯` U+256F | same | `+` U+002B | `:424` / `:748` / `:1203` |
| `boxRound.horizontal` | `─` U+2500 | same | `-` U+002D | `:425` / `:749` / `:1204` |
| `boxRound.vertical` | `│` U+2502 | same | `\|` U+007C | `:426` / `:750` / `:1205` |
| `boxSharp.horizontal` | `─` U+2500 | same | `-` U+002D | `:435` / `:771` / `:1214` |
| `boxSharp.vertical` | `│` U+2502 | same | `\|` U+007C | `:436` / `:772` / `:1215` |
| `boxSharp.cross` | `┼` U+253C | same | `+` U+002B | `:437` / `:775` / `:1216` |
| `boxSharp.teeRight` | `├` U+251C | same | `+` U+002B | `:440` / `:781` / `:1218` |
| `boxSharp.teeLeft` | `┤` U+2524 | same | `+` U+002B | `:441` / `:782` / `:1219` |
| `boxDotted.horizontal` | `┄` U+2504 | same | `-` U+002D | `:428` / `:758` / `:1207` |
| `boxDotted.vertical` | `┆` U+2506 | same | `:` U+003A | `:429` / `:759` / `:1208` |

All three presets share identical `box*` glyphs except the `ascii` mapping. Accessors are
`theme.boxRound` / `theme.boxSharp` / `theme.boxDotted` at `theme-class.ts:528`, `:558`, `:551`.
Note `boxRound` deliberately borrows the sharp tees and the cross (`theme-class.ts:536-543`), so a
rounded box and a sharp box agree on junctions.

East Asian Width (fetched `https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt`,
2026-10-02):

- `2500..254B ; A` — every light/heavy box rule omp uses in the `unicode` preset is **Ambiguous**.
- `2574..257F ; N` — the rounded corners `╭╮╰╯` are **Narrow**. So omp's default `boxRound` frame is
  the width-*safe* choice, and `boxSharp` is the risky one. omp already lives with this; we inherit it.

### Separators (metric joiners, key hints)

| key | unicode | nerd | ascii | declared at |
|---|---|---|---|---|
| `sep.dot` | ``␣·␣`` U+0020·U+00B7·U+0020 | same | ``␣-␣`` U+0020·U+002D·U+0020 | `:455` / `:808` / `:1233` |
| `sep.slash` | ``␣/␣`` | `` U+E0BB `` | ``␣/␣`` | `:456` / `:810` / `:1234` |
| `sep.pipe` | ``␣│␣`` U+0020·U+2502·U+0020 | `` U+E0B3 `` | ``␣\|␣`` | `:457` / `:812` / `:1235` |
| `sep.space` | `␣` U+0020 | `␣` U+0020 | `␣` U+0020 | `:452` / `:802` / `:1230` |
| `sep.powerline` | `▕` U+2595 | `` U+E0B0 `` | `>` U+003E | `:443` / `:786` / `:1222` |
| `sep.powerlineThin` | `┆` U+2506 | `` U+E0B1 `` | `>` U+003E | `:444` / `:788` / `:1223` |
| `format.bracketLeft` | `⟦` U+27E6 | `⟨` U+27E8 | `[` U+005B | `:580` / `:1041` / `:1354` |
| `format.bracketRight` | `⟧` U+27E7 | `⟩` U+27E9 | `]` U+005D | `:581` / `:1043` / `:1355` |
| `key.joiner` | `` (empty) | `␣` U+0020 | `+` U+002B | `:676` / `:1149` / `:1448` |

**`sep.slash` and `sep.pipe` are unusable as text separators under `nerd`** — they are powerline
*background* glyphs (U+E0BB / U+E0B3) meant to be painted, not printed inline. Only `sep.dot` is
safe in all three presets: it is byte-identical (`" · "`) under `unicode` and `nerd`, and degrades to
`" - "` under `ascii`. omp already uses it as the metric joiner
(`pi-tui/src/overlays/agent-hub-renderer.ts:277`, `{ separator: theme.sep.dot }`).

`formatKeyHint` (`key-hint-format.ts:91`) and `formatKeyHints` (`:114`) already handle key rendering
and the `/`-joined alternative list; the panel should call them, never re-derive.

### Status and navigation markers

| key | unicode | nerd | ascii | declared at |
|---|---|---|---|---|
| `status.success` | `✔` U+2714 | `` U+F00C `` | `[ok]` | `:391` / `:692` / `:1170` |
| `status.warning` | `⚠` U+26A0 | `` U+F12A `` | `[!]` | `:393` / `:696` / `:1172` |
| `status.enabled` | `●` U+25CF | `` U+F111 `` | `[x]` | `:397` / `:704` / `:1176` |
| `status.running` | `⟳` U+27F3 | `` U+F110 `` | `[~]` | `:398` / `:706` / `:1177` |
| `status.shadowed` | `○` U+25CB | `` U+F10C `` | `[/]` | `:399` / `:708` / `:1178` |
| `status.done` | `•` U+2022 | `•` U+2022 | `*` | `:401` / `:712` / `:1180` |
| `nav.cursor` | `❯` U+276F | `` U+F054 `` | `>` | `:403` / `:715` / `:1182` |
| `nav.selected` | `➤` U+27A4 | `` U+F178 `` | `->` | `:404` / `:717` / `:1183` |
| `nav.expand` | `▸` U+25B8 | `` U+F0DA `` | `+` | `:405` / `:719` / `:1184` |
| `nav.collapse` | `▾` U+25BE | `` U+F0D7 `` | `-` | `:406` / `:721` / `:1185` |
| `checkbox.checked` | `☑` U+2611 | `` U+F14A `` | `[x]` | `:572` / `:1028` / `:1348` |
| `radio.selected` | `◉` U+25C9 | `` U+F192 `` | `(o)` | `:575` / `:1033` / `:1350` |

None of these is a data glyph, but all of them are legitimate **table annotation** glyphs: a legend
dot, a "this model is free" marker, a selected-row cursor. All are Narrow or ASCII and all three
presets have a value.

### Chart-adjacent markdown / icons

| key | unicode | nerd | ascii | declared at |
|---|---|---|---|---|
| `md.colorSwatch` | `■` U+25A0 | `■` U+25A0 | `[]` U+005B U+005D | `:586` / `:1052` / `:1360` |
| `md.hrChar` | `─` U+2500 | `─` U+2500 | `-` U+002D | `:584` / `:1048` / `:1358` |
| `md.bullet` / `format.bullet` | `•` U+2022 | `` U+F111 `` | `*` U+002A | `:584`/`:578` / `:1046`/`:1037` / `:1356`/`:1352` |
| `md.quoteBorder` | `▏` U+258F | `│` U+2502 | `\|` U+007C | `:583` / `:1046` / `:1357` |
| `cmd.stats` | `📊` U+1F4CA | `` U+F080 `` | `""` (disabled) | `:529` / `:954` / `:1305` |
| `icon.cost` | `💲` U+1F4B2 | `` U+F155 `` | `$` U+0024 | `:476` / `:849` / `:1254` |
| `icon.tokens` | `🪙` U+1FA99 | `` U+E26B `` | `tok:` | `:474` / `:843` / `:1252` |
| `icon.cache` | `💾` U+1F4BE | `` U+F1C0 `` | `cache` | `:485` / `:870` / `:1266` |
| `icon.input` / `icon.output` | `⤵` U+2935 / `⤴` U+2934 | `` U+F090 `` / `` U+F08B `` | `in:` / `out:` | `:487`-`:488` / `:874`-`:875` / `:1268`/`:1263` |
| `icon.throughput` | `⚡` U+26A1 | `` U+F0E4 `` | `tok/s:` | `:489` / `:878` / `:1264` |

**`md.colorSwatch` is `■` in two presets and the two-cell string `[]` in `ascii`.** Any grid built on
it doubles its cell width under `ascii`. It is a Markdown feature, not a cell primitive; do not use
it for the heatmap.

**`cmd.stats` is `""` under `ascii`** — the ASCII preset deliberately blanks the whole slash-command
icon column (`symbols.ts:1290` "unused; the icon column is disabled in ASCII mode"). A panel heading
that leans on it will be missing its icon for those users, which is correct and should be left alone.

### What we get for free

| need | resolved by | under `ascii` |
|---|---|---|
| panel frame | `theme.boxRound.*` | `+ - \|` |
| table column rule | `theme.boxSharp.vertical` / `boxDotted.vertical` | `\|` / `:` |
| horizontal meter fill / track | `theme.symbol("progress.filled" / "progress.empty")` | `=` / `-` |
| metric joiner | `theme.symbol("sep.dot")` | `" - "` |
| key hint | `formatKeyHint(key)` | spelled-out words |
| legend / row marker | `theme.symbol("status.*")` | `[ok]`, `[!]` |
| heading icon | `theme.symbol("cmd.stats")` | *(absent, by design)* |

## Gaps

Nine roles are needed and **only six of them lack a home today**. Verified:
`SYMBOL_PRESETS.unicode["chart.barFill"]` is `undefined`; the map is a plain object literal with no
prototype or getter fallback (`symbols.ts:389-687`), and unknown keys in the user's `symbols.overrides`
are dropped with a debug log (`theme-class.ts:216-222`) — so we cannot even smuggle a new key in
through config.

| # | role | reuse possible? | decision |
|---|---|---|---|
| 1 | `barFill` — 8-level vertical fill for a daily column | **No.** `progress.filled` is a *horizontal rule* (`━`/`=`), correct for a horizontal meter, wrong for a column fill. `sep.block` is `▌` under `unicode`. | Define. Unicode/nerd: `▁▂▃▄▅▆▇█`. ASCII: 9 entries over 5 densities — `▁`-style levels collapse to `.` `:` `-` `=` `#`. |
| 2 | `barEmpty` — the rest of a column's height | No registered key. | Define. `" "` (one space) in every preset — the column's own empty space is the grid. |
| 3 | `sparkRamp` — 8-level magnitude for a single-row strip | No. | Define as **the same array** as `barFill`, indexed by magnitude rather than by stack height. One ramp, two projections. |
| 4 | `heatCell` — filled calendar cell | `md.colorSwatch` is `■` in two presets but `[]` (2 cells) in `ascii`. Unusable as a grid cell. | Define. Unicode/nerd: `■` U+25A0 (matches `/usage` today). ASCII: `#` U+0023 (matches `sep.block`'s `ascii` value, so the panel and the rest of omp agree). |
| 5 | `heatRamp` — 4-step density for intensity | No. `WATER_RAMP` in `setup/scenes/splash.ts:35` (`█▓▒░`) is precedent for the *concept*, not a registered key. | Define. Unicode/nerd: `░▒▓█`. ASCII: `.` `:` `-` `#`. |
| 6 | `heatEmpty` — a day with no requests | `theme.symbol("sep.dot")` includes its own padding, so it is the wrong width. | Define. Unicode/nerd: `·` U+00B7 (exactly `/usage`'s choice). ASCII: `.` U+002E. |
| 7 | `columnGap` — the gutter between table columns | `renderTableRow` defaults `gap` to `" "` and accepts any string (`components/table.ts:27`, `:82`). | **Reuse the parameter**, pass `"  "` (two spaces) in all presets. A gap is whitespace; a glyph would be decoration. Preset-invariant by design. |
| 8 | `hintJoin` — delimiter between key hints | Already solved: `formatKeyHint` (`:91`) and `formatKeyHints` (`:114`, joins with `/`). | **Do not define.** Call omp's. |
| 9 | `metricSep` — joiner between inline metrics | `theme.symbol("sep.dot")` — identical in `unicode` and `nerd`, `" - "` in `ascii`. | **Reuse.** This is `agent-hub-renderer.ts:277`'s existing choice. |

Tally: **five** roles need characters we must choose ourselves (`barFill`, `sparkRamp`, `heatCell`,
`heatRamp`, `heatEmpty`); **one** (`barEmpty`) is a space in every preset; **three** dissolve into
existing omp APIs or parameters (`columnGap` → `TableOptions.gap`, `hintJoin` → `formatKeyHint`,
`metricSep` → `theme.symbol("sep.dot")`).

## Preset-aware glyph module design

One module, one switch, no scattered branches. The rule the whole design turns on: **the render code
never asks what preset is active.** It asks for a role.

```ts
// src/client/glyphs.ts  (design sketch — NOT production code)
import { theme, type SymbolPreset } from "@oh-my-pi/pi-tui/theme";

/** Semantic roles the panel needs. Closed union — render code cannot invent one. */
export type GlyphRole = "barFill" | "sparkRamp" | "heatRamp" | "columnGap";

export interface PanelGlyphs {
  /** Preset this table was built for (the renderer's own diagnostics). */
  readonly preset: SymbolPreset;
  /**
   * Bar column fill and sparkline magnitude ramp, index 0..8.
   * Index 0 is the EMPTY cell (a space); 1..8 are the eighths, 8 being full.
   * A stacked bar and a sparkline read the same array with different arithmetic.
   */
  readonly barFill: readonly string[];
  readonly sparkRamp: readonly string[];
  /** Calendar density, index 0..4: 0 = a day with no requests, 1..4 = intensity. */
  readonly heatRamp: readonly string[];
  /** Horizontal meter; delegated to omp so the panel matches every other omp surface. */
  readonly meterFilled: string;
  readonly meterEmpty: string;
  /** Gutter between table columns. Whitespace in every preset. */
  readonly columnGap: string;
}

/** Role → value, so callers spell intent rather than reaching into the table. */
export function glyph(g: PanelGlyphs, role: GlyphRole): readonly string[] | string {
  return g[role];
}

const UNICODE_AND_NERD: PanelGlyphs = {
  preset: "unicode",
  // ▁▂▃▄▅▆▇█ — the ramp omp already uses at apps/live-visualizer.ts:41
  barFill:     [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"],
  sparkRamp:   [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"],
  // · empty, then ░▒▓█ for intensity 1..4 — matches /usage's ■ + colour ramp
  heatRamp:    ["·", "░", "▒", "▓", "█"],
  meterFilled: theme.symbol("progress.filled"),
  meterEmpty:  theme.symbol("progress.empty"),
  columnGap:   "  ",
};


const ASCII: PanelGlyphs = {
  preset: "ascii",
  // 9 entries: index 0 is the empty cell (a space), 1..8 are the eighths.
  // 8 levels over 5 densities: . : - = #
  barFill:     [" ", ".", ".", ":", ":", "-", "=", "=", "#"],
  sparkRamp:   [" ", ".", ".", ":", ":", "-", "=", "=", "#"],
  heatRamp:    [".", ":", "-", "=", "#"],
  meterFilled: theme.symbol("progress.filled"),   // "="
  meterEmpty:  theme.symbol("progress.empty"),    // "-"
  columnGap:   "  ",
};

const BY_PRESET: Record<SymbolPreset, PanelGlyphs> = {
  unicode: UNICODE_AND_NERD,
  nerd: UNICODE_AND_NERD,        // identical object, deliberately
  ascii: ASCII,
};

/** The ONLY place that reads the preset. */
export function panelGlyphs(t = theme): PanelGlyphs {
  return BY_PRESET[t.getSymbolPreset()];
}
```

Three properties make this the right shape:

1. **One switch.** `BY_PRESET[...]` is the sole read of `getSymbolPreset()` outside omp. Grep for
   `getSymbolPreset` and you get one hit in this module.
2. **`nerd` shares one object with `unicode`.** That is the honest encoding of the finding below:
   no Nerd Font codepoint helps a chart, so the `nerd` branch is the same data, not a copy. If a
   future Nerd glyph is ever justified it lands here, once.
3. **Arrays are module-level constants.** The ramp is built once at import; per-cell lookups are an
   index into a frozen 8-element array. Rendering a 53-week heatmap or a 90-day bar chart allocates
   nothing beyond the strings it must produce anyway.

One refinement the sketch deliberately leaves open rather than guessing: the module must be rebuilt
when the preset changes. `theme` emits a change event
  (`theme.ts:130` `ThemeChangeEvent`, `theme.ts:328` `setSymbolPreset`), so the caller should
  either read `panelGlyphs()` per render or memoize on `getSymbolPreset()`. Reading per render is one
  property load on an already-live singleton and is not worth a cache-invalidation bug.

### ASCII degradation, verified

Both ramps were rendered over the actual September daily request series from `messages`
(local-time day buckets, 4-row tall columns, `units = round(req/max × rows × 8)`) and every column
measured with `string-width`:

```
  Sep 3    ██       Sep 3    ##
  Sep 4     █       Sep 4     #
  Sep 5     ▁       Sep 5     .
  Sep 6     ▁       Sep 6     .
  Sep 7    ▆█       Sep 7    =#
  Sep 8     ▂       Sep 8     .
  Sep 9  ████       Sep 9  ####
  Sep 10   ▁█       Sep 10   .#
unicode widths: 4,4,4,4,4,4,4,4
ascii widths:   4,4,4,4,4,4,4,4
```

(Source series: 3806, 1887, 173, 172, 3329, 498, 7392, 2137 — the low days are real, not invented
floor values.)

The heatmap grid was checked the same way (6 columns × 5 rows, intensities 0–4): every row measured
width 11 under both `·░▒▓█` and `.:-=#`. **The ASCII variants are genuinely aligned** — every
character used is ASCII, and ASCII characters are Narrow by definition under both `string-width`
defaults and omp's `ambiguousIsNarrow: true` (`utils.ts:252`). There is no ambiguity-class risk in
the ASCII branch at all, which is a real advantage over the unicode branch.

Note the ASCII render is *not* less informative here: `Sep 5` and `Sep 6` (173 and 172 requests)
render as `.` and are still visibly non-empty, and `Sep 8` (498) separates from them. A `#`/` `
binary ramp would have flattened all four of Sep 5, 6, 8 to the same empty column.

**The module sketch was compiled and executed, not just written.** Extracted to a standalone `.ts`
file with `theme` bound to a fake, typechecked under `tsc --strict` (no errors), then run against the
same September series:

```
unicode  ramp len 9  widths 4,4,4,4,4,4,4,4  | heat ·░▒▓█  meter ━/─
nerd     ramp len 9  widths 4,4,4,4,4,4,4,4  | heat ·░▒▓█  meter ━/─
ascii    ramp len 9  widths 4,4,4,4,4,4,4,4  | heat .:-=#  meter =/-
```

`unicode` and `nerd` return the same object; `ascii` differs only in the ramps and in the meter, which
`theme.symbol()` supplies. That is the entire behaviour of the module.

## Character choices

Criteria in priority order: (a) renders in every modern terminal font, (b) single-cell width,
(c) monospace alignment holds, (d) degrades to something readable rather than tofu, (e) matches what
omp already looks like.

### unicode — bar fill and sparkline

| role | char | codepoint | EAW | width | why |
|---|---|---|---|---|---|
| `barFill[1..8]` | `▁▂▃▄▅▆▇█` | U+2581–U+2588 | **A** (`2580..258F ; A`) | 1 | The only ramp with 8 usable levels per cell. Present in every UTF-8 terminal font shipped since the 1990s; zero tofu risk. Already in the codebase: `apps/live-visualizer.ts:41` `const SPECTRUM_BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;`. |
| `barEmpty` | `␣` | U+0020 | N | 1 | The unfilled part of the column is its own blank cell. No glyph needed, no ambiguity. |
| `sparkRamp` | same array | — | — | — | One ramp, projected differently (magnitude vs stack height). A second ramp would read as two systems. |
| `heatCell` | `■` | U+25A0 | **A** (`25A0..25A1 ; A`) | 1 | Identical to what `/usage` prints today (`usage-dashboard.ts:867` `` `${ramp[cell - 1]}■${reset} ` ``). Same width class as `█`, so a heatmap cell and a full bar column align in a shared grid. |
| `heatEmpty` | `·` | U+00B7 | **A** (`00B6..00B7 ; A`) | 1 | What `/usage` prints for a zero day (`usage-dashboard.ts:866`). Also the middle of `sep.dot`, so the empty cell matches omp's inline-metric punctuation. |
| `heatRamp[1..4]` | `░▒▓█` | U+2591, U+2592, U+2593, U+2588 | mixed: `2591 ; N`, `2592..2595 ; A` | 1 | First-party precedent for a density ramp: `setup/scenes/splash.ts:35` `const WATER_RAMP = [{min:0.62,char:"█"},{min:0.5,char:"▓"},{min:0.36,char:"▒"},{min:0.24,char:"░"}];`. |

**On the Ambiguous-width risk.** Every eighth block and both `■` and `·` are `East_Asian_Width=A`.
Under a CJK-configured terminal that renders ambiguous as two cells, a hand-rolled grid built on
these tears. Three mitigations, in order:

1. `pi-tui/src/utils.ts:252` sets `ambiguousIsNarrow: true`, so omp's *own* width maths (`visibleWidth`,
   `truncateToWidth`, `fitWidths`) already treats them as one cell. Layout and measurement agree.
2. omp's default frame is `boxRound`, whose corners are `2574..257F ; N` — Narrow. The panel should
   use `boxRound` (via `pi-tui`'s `Box`) and never hand-roll its frame.
3. omp already ships `━`, `─`, `│`, `╭╮╰╯`, `▏`, `✦`, `◫` — all Ambiguous or worse — in the
   `unicode` preset. This is a settled house position, not something the panel should re-litigate.

**Should the eighth blocks be avoided for that reason? No.** The alternative set with Narrow widths
is `▪` `▫` (U+25AA/25AB, `25AA..25B1 ; N`) — 2 levels, no middle, no ramp. A 2-level bar chart is
not a bar chart. Ambiguous + 8 levels beats Narrow + 2.

### nerd — the honest answer

**No Nerd Font codepoint genuinely helps a chart.** Tested against the whole registered vocabulary:

- `nf-fa-bar_chart` (U+F080, `cmd.stats`) is a chart *icon*, not a chart *mark*. It is a picture of a
  bar chart; putting it in a cell would erase the value.
- Nerd Fonts ship no eighth-block or shade glyph at all — the entire block-element range is standard
  Unicode, which is precisely why `NERD_SYMBOLS` reuses `━ ─ │ ╭╮╰╯ ├┤` verbatim from `unicode`
  (`symbols.ts:735` "Progress Bar (same as unicode)", `:744` "Box Drawing - Rounded (same as unicode)").
- PUA codepoints are U+E000–U+F8FF and U+F0000–U+FFFFD. omp itself warns about this class twice in
  source: `"icon.context": "\ue70f"` carries "INTENTIONAL … do not swap it again"
  (`symbols.ts:845-847`) and `"icon.omp": "\u{f0d57}"` carries "it renders the wrong glyph; do not
  swap it again" (`symbols.ts:859-861`). A chart glyph chosen from a PUA range inherits exactly that
  fragility, on every row of a 90-bar chart.

So `nerd` shares the `unicode` table object. The nerd preset still contributes at the *edges*:
`icon.cost` becomes `` U+F155``, `icon.tokens` `` U+E26B``, `icon.cache` `` U+F1C0`` — good
single-cell icons for the panel header, sourced through `theme.symbol()`, never hardcoded.

### ascii — what actually reads best

Constraint: ASCII has no partial-fill block. Every "density" is an ink-weight guess, so **five** is
the honest maximum, not eight.

**Bar ramp (vertical, 8 levels over 5 densities).** Rendered and measured; all variants aligned.
Candidates and the verdict:

| glyph | U+ | verdict |
|---|---|---|
| `#` | U+0023 | Densest available; also `sep.block`'s `ascii` value, so it is the glyph omp already reaches for when it needs a solid. **Keep — level 8.** |
| `=` | U+003D | Two horizontal rules; reads clearly denser than one rule. Also exactly `progress.filled` under `ascii`. **Keep — levels 6–7.** |
| `:` | U+003B→U+003A | Two dots; clearly lighter than `=`. Also `boxDotted.vertical`'s `ascii` value. **Keep — levels 3–4.** |
| `-` | U+002D | One rule. Also `progress.empty` and every box's `ascii` horizontal. **Keep — level 5.** |
| `.` | U+002E | Lightest ink that still registers as *something*. **Keep — levels 1–2.** |
| `o` / `*` | U+006F / U+002A | `o` is lighter than `.` visually but reads as a glyph, not a mark; `*` is `status.done`/`format.bullet` and would collide with list bullets. Reject. |
| `\|` / `%` | U+007C / U+0025 | `\|` is a rule, not a fill; `%` is a symbol, semantically loaded. Reject. |
| `+` | U+002B | Occupied by every `ascii` box corner and `nav.expand`. Reject — collision is disqualifying. |

**Chosen ramp (9 entries: index 0 = empty cell, 1–8 = eighths):**
`[" ", ".", ".", ":", ":", "-", "=", "=", "#"]`

Rendered output is the ASCII half of the comparison above (`Sep 3 ##`, `Sep 5 .`, `Sep 7 =#`,
`Sep 9 ####`), all columns measuring width 4.

Alternates that were actually rendered and rejected:

- `[".", ".", ":", ":", "|", "|", "#", "#"]` — the vertical bar is visually *heavy*, heavier than the
  `#` it sits below in perceived mass, so the ramp is non-monotone. Reject.
- `[".", ".", "-", "-", "=", "=", "#", "#"]` — skips `:` entirely, collapsing 3 of 8 levels onto 2
  densities and making a low-but-nonzero day indistinguishable from an empty one. Reject.
- `[".", ".", ":", ":", "=", "=", "#", "#"]` — drops the mid `-` and puts `=` directly above `:`.
  Monotone and shorter, but wastes a level: 5 and 6 collapse. The chosen ramp spends `-` there
  instead, because `progress.empty` is already `-` under `ascii`, so the glyph is familiar.

Monotonicity is the test that matters here, and it is the one thing `.` `:` `-` `=` `#` gets right
that `|`/`o` do not: reading a column top-to-bottom, ink weight never decreases downward.

**Heatmap ramp (ascii).** 5 states: `[".", ":", "-", "=", "#"]` — empty, then 1..4.
Verified aligned (all rows identical width). `#` at the top matches `sep.block`'s ascii value, so the
heat legend and any solid block elsewhere in the panel are the same visual weight.

**Heat cell / empty.** `heatCell` → `#` U+0023, `heatEmpty` → `.` U+002E. The `.` for empty is
chosen over `:` because the ASCII ramp already uses `:` for the *lowest* intensity — an empty day and
a one-unit day must not share a glyph, and `.` is the only ink lighter than `:` that still renders.

### Explicitly rejected characters

| candidate | codepoint | why not |
|---|---|---|
| braille | U+2800–U+28FF | 2×4 raster: sub-cell colour impossible, aspect wrong, tofu on coverage gap. Already rejected in `adr/0005`. |
| emoji `⬛` `🔲` | U+2B1B / U+1F532 | `2B1B..2B1C ; W` — **Wide**. Measured width 2. Breaks every column. |
| `▌` `▐` | U+258C / U+2590 | Half-blocks; only meaningful for a 2-cell grid. `sep.block` is `▌` under `unicode` precisely because it is a *rail*, not a fill. |
| `▎` `▏` | U+258E / U+258F | Eighth-width rails. `md.quoteBorder`/`advisor.rail` use them for left borders. A rail as a bar fill leaves 7/8 of the cell blank. |
| powerline separators | U+E0B0–U+E0B3, U+E0B6 | Background-painting glyphs, not text. `sep.pipe` and `sep.slash` are unusable under `nerd` for this reason. |
| `═` `║` | U+2550 / U+2551 | Double-line. `2550..2573 ; A`, and a doubled rule reads as heavier than a bar fill at the same cell. |
| `◼` `◻` | U+25FC / U+25FB | `N` width, so alignment-safe — but visually near-identical to `■`, so it buys a second square for no information. |
| `▪` `▫` | U+25AA / U+25AB | `25AA..25B1 ; N` — genuinely Narrow. But 2 levels, no middle. Correct for a filled/empty flag, wrong for a heatmap. |
| `↑` `↓` `→` | U+2191/2193/2192 | Registered under `key.*`, semantically a key. Never a chart mark. |
| box-drawing characters as *data* | U+2500–U+257F | Ambiguous-width rules with junction semantics. A rule is a frame; using it as a fill makes the two indistinguishable. |

## Heatmap

### What `/usage` does today, exactly

Text path, `usage-dashboard.ts:824-872`:

```ts
if (cell === null) line += "  ";
else if (cell === 0) line += `${theme.fg("dim", "·")} `;
else line += `${ramp[cell - 1]}■${reset} `;
```

with the ramp computed at `:807-822`:

```ts
const to = hexToRgb(theme.getColorHex("accent"));
return [0.3, 0.5, 0.72, 1].map(t => colorToAnsi(rgbToHex({ /* lerp from bg toward accent */ }), mode));
```

Native path, `#heatmapTable` at `:1181-1201`: `cells[\`w${week}\`] = level === 0 ? [span("·", "dim")] : [span("■", HEAT_LEVEL_TOKENS[level - 1])]`
with `const HEAT_LEVEL_TOKENS = ["dim", "accent dim", "accent", "accent strong"];` (`:366`).

So today: **one fill glyph (`■` U+25A0), one empty glyph (`·` U+00B7), four colour levels.** Four
intensity buckets, because `buildHeatmapLayout` returns `0..4` (`:281-284`, "7 rows × N week columns;
0..4 intensity, null = future day").

The metric itself switches on data availability (`:315-316`):
```ts
const anyCost = points.some(point => point.cost > 0);
const metric = (point: DailyActivityPoint): number => (anyCost ? point.cost : point.requests);
```
Worth flagging to the user: on this database **both** exist and the choice flips the whole grid's
meaning. Of the last 30 days that contain any requests, 27 do, and **11 of them price at exactly
`$0.00`** — free-tier models dominate token volume while costing nothing. Those same 27 days average
`$4.21` and peak at `$29.63`. So a cost-keyed heatmap for the last two weeks is mostly empty cells
with a few spikes, and a request-keyed one hides the fact that most of that activity was free.

### Verdict: **both, asymmetrically**

Colour carries **bucketing**; glyph carries **presence and the low end of the ramp**.

- **Colour alone is not enough.** `ColorMode` is only `"truecolor" | "256color"` (`theme/schema.ts:201`)
  — there is no 16-colour mode and no monochrome mode, so `NO_COLOR` (which gates only hyperlinks,
  `render/hyperlink.ts:95`) is not a colour-off switch. But colour output still leaves the terminal in
  three real states: piped to a file, `less` with colours disabled, or a screen reader reading the
  glyphs. A heatmap that is 4,000 identical `■` characters is useless in all three. And when the panel
  is copied into a bug report, colour does not travel.
- **Glyph alone is not enough either.** Four shades of one accent hue are hard to *rank* reliably —
  a reader comparing two `▒` cells at different positions is doing a perceptual magnitude judgement
  on a diagonal ramp, and the theme's own accent varies across 100+ bundled themes. The truecolor path
  is genuinely good here (`#heatRamp` lerps 30 %→100 % toward the theme's accent, anchored to black or
  white by `colorLuma(theme.getColorHex("text"))` so the ramp keeps its direction on light themes —
  `:809-810`, a careful piece of work).
- **Both together, with the same 4 buckets.** Glyph supplies the floor (empty vs present vs
  graduated) and colour refines it. They never disagree, because they are driven by one `level` value.

### How many levels can a reader actually distinguish?

| condition | distinguishable levels |
|---|---|
| truecolor, glyph ramp only (`░▒▓█`) | 4 (plus empty) — verified visually distinct at 1 cell |
| truecolor, colour ramp only | 4 by luma, monotonic toward the accent |
| 256-colour, colour ramp only | **3–4, and it varies by accent** — quantising `#heatRamp`'s four interpolated colours to the xterm-256 cube |
| 256-colour, glyph ramp only | 4 — glyphs are immune to palette depth |
| monochrome / piped | 4 via glyph; **1** via colour |
| ascii preset, colour ramp | 4 — colour is orthogonal to the preset |

The 256-colour measurement is worth stating because it is not obvious. Quantising
`#heatRamp`'s `[0.3, 0.5, 0.72, 1]` interpolation toward a dark background gives:

```
cyan   #33ccff : 60  67  74  81      all distinct
green  #4ec9b0 : 59  66  73  115     all distinct
purple #a78bfa : 60  103 104 147     all distinct, but 103/104 adjacent
yellow #e5c07b : 95  101 144 186     all distinct
pink   #ff79c6 : 95  132 175 212     all distinct
orange #d19a66 : 95  101 138 180     all distinct
white  #cccccc : 60  102 145 188     all distinct
```

Levels never *collapse* to the same index — the four-point lerp is monotonic in every accent tested.
But for a mid-luma accent like purple, levels 2 and 3 land on adjacent cube entries (103, 104) whose
perceived difference is small. **Conclusion: 4 levels is the safe number on truecolor and acceptable
on 256colour; 5 would be pushing it.** omp already ships 4. Keep 4. Do not add a fifth.

### Per-preset verdict

| preset | empty | L1 | L2 | L3 | L4 | colour |
|---|---|---|---|---|---|---|
| `unicode` | `·` U+00B7 dim | `░` dim | `▒` accent-dim | `▓` accent | `█` accent strong | full `#heatRamp` |
| `nerd` | same as `unicode` | same | same | same | same | same |
| `ascii` | `.` U+002E dim | `:` dim | `-` accent-dim | `=` accent | `#` accent strong | full `#heatRamp` |

**Colour is orthogonal to the preset — keep it on under `ascii`.** This is the key insight for the
ASCII case and it is easy to get backwards. Someone choosing the `ascii` preset has said *"I want my
terminal to render without relying on font glyph coverage."* Colour is not font coverage. Every glyph
in the ASCII ramp is ASCII, so the grid is safe in any terminal, and it is still colour-coded in every
terminal that has colour. Stripping colour under `ascii` would be answering a question nobody asked.

What *does* change under `ascii` is the **glyph** ramp, because ASCII has no density block: intensity
moves from 4 shades to 5 ink weights (`.` `:` `-` `=` `#`). The colour ramp stays at 4 levels, so the
two channels keep agreeing — one glyph step and one colour step per level.

**If a future user genuinely wants no colour**, the honest degradation is the glyph ramp carrying the
full signal (`░▒▓█` / `.:=#`), which it already does at 4–5 levels. There is no need for a separate
no-colour code path.

### Native `chart` node

Worth knowing before we hand-roll: `pi-wire` already declares a native chart node with
`kind: "heatmap" | "bars" | "spark"` (`pi-wire/src/tsp.ts:756-774`), carrying `cells` as 0–1
intensities, `cols`/`rows` labels, `tips`, and a `token` colour. `/usage` uses it when the host
reports the capability (`usage-dashboard.ts:944` `const chart = cx.supports("chart");`, `:1152`
`#heatmapChart`) and falls back to a glyph table otherwise (`:1181`). **If `cx.supports("chart")` is
true, the native renderer owns the cells and our `heatRamp` is dead code on that path.** The glyph
system must therefore be the *fallback*, and the panel should feature-detect `chart` exactly the way
`/usage` does rather than assume it either way. This also means our glyph choices should match what
a native heatmap plausibly draws (`■`-like solid cells, colour-bucketed) — which they do.

## Numeric formatting

This is not a glyph topic, but a chart that mislabels its own axis is worse than a chart with ugly
marks. All numbers below come from `~/.omp/stats.db`, snapshot **2026-10-03 01:00:46**, read-only.
The database is live and ingesting, so figures drift between reads; the values below are the ones
each rule was derived from.

### What the data actually looks like

```
messages: 184,777 requests · 24,423,630,406 total tokens · $2,582.33
  cache_read   23,232,678,069  (95.1 % of total)
  cache_write       1,271,142
  fresh input     1,091,926,145
  output              97,755,050
tokens priced at exactly $0.00: 7,902,841,881 (32.4 % of all tokens)
requests priced at exactly $0.00: 68,838 (37.3 % of all requests)
cost_unpriced = 1 rows: 0  ← every zero-cost row is a genuine $0.00 price, not a pricing failure
```

Per-request cost ranges from `$0.000065` to `$2.6688`, mean `$0.023029`. TTFT spans 710 ms to 304 s;
request duration spans 8 ms to 26 minutes.

Top models by token volume (from the `message_rollup` pre-aggregate):

| model | requests | total tokens | cache reads | cost |
|---|---|---|---|---|
| `space-bunny-free` | 34,518 | 4,407,504,146 | 4,243,498,710 | **$0.00** |
| `deepseek-v4-flash` | 27,090 | 4,152,166,232 | 4,037,139,072 | $22.85 |
| `muse-spark-1.2-contributor` | 15,832 | 3,023,846,380 | 2,843,313,262 | $24.52 |
| `gpt-5.6-terra` | 25,039 | 2,513,255,367 | 2,389,725,056 | $935.72 |
| `gpt-5.6-sol` | 9,981 | 1,702,208,825 | 1,621,699,584 | $1,292.85 |
| `gpt-5.6-luna` | 7,085 | 848,752,703 | 804,459,311 | $76.80 |


Four facts drive every rule below:

1. **Total tokens are dominated by cache reads** (95.1 % of the total; 95.5 % as a cache rate).
   "4.4 B tokens" is mostly a re-read of the same prefix, and cache reads are billed at a fraction of
   the fresh rate. A bare total is a lie by omission.
2. **`space-bunny-free` is the single largest token consumer and costs exactly $0.00.** Summing it
   into a total is arithmetically correct and analytically useless.
3. **`cost_unpriced` is 0 on every row.** The `$0.00` models are genuinely priced at zero (free-tier
   / subscription routes via `opencode-go`, `opencode-zen`, `kilo`, `openrouter`), verified by
   `cost_input`, `cost_cache_read`, `cost_no_cache_input` all being `0.0` on those rows — not a
   pricing lookup failure. So the unpriced treatment must stay **distinct** from the free treatment.
4. **A single request costs $0.000065 to $2.6688** (mean $0.023), so per-row cost needs 4 decimals at
   the bottom and 2 at the top of the same table.

### What omp already ships

`omp-stats/src/client/data/formatters.ts` (web dashboard — right ideas, browser locale):

```ts
const NUMBER_LOCALE = "en-US";                                    // :9
export function formatCompact(value: number): string {             // :15
  return value.toLocaleString(NUMBER_LOCALE, { notation: "compact" });
}
export function formatCost(value: number, digits?: number): string { // :19
  if (value === 0) return "$0";
  const fractionDigits = digits !== undefined ? digits : value > 0 && value < 0.01 ? 4 : 2;
  return `$${value.toLocaleString(NUMBER_LOCALE, { … })}`;
}
/** Format an API-equivalent estimate, using N/A when all usage is unpriced. */
export function formatEstimatedCost(value, unpricedRequests, digits?) { // :29
  return value === 0 && unpricedRequests > 0 ? "N/A" : formatCost(value, digits);
}
export function isUnpricedMessage(message): boolean {             // :39
  return message.usage.totalTokens > 0 && message.usage.cost.total === 0
    && (message.provider === "xai-oauth" || message.costUnpriced === true);
}
```

`pi-tui`'s TUI-side cost formatter, `overlays/agent-hub-renderer.ts:261`:

```ts
export function formatCost(cost: number): string {
  const amount = metricNumber(cost);
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
```

`pi-utils/src/format.ts`: `formatDuration` (`:10`, `123ms`/`1.5s`/`30m15s`/`2h30m`/`3d2h`) and
`formatNumber` (`:34`, K/M/B with a `trim1` that drops trailing `.0`).

**Three concrete divergences to resolve, not inherit:**

| | `omp-stats` web | `pi-tui` | `pi-utils` |
|---|---|---|---|
| zero | `$0` (no decimals) | `$0.0000` | — |
| sub-cent | 4 digits | 4 digits | — |
| sub-dollar | 2 digits | **3** digits | — |
| thousands sep | yes (`en-US`) | **no** (`toFixed`) | **no** |
| large K/M/B | `Intl` compact | — | own thresholds |

`pi-tui`'s `formatCost` emits `$1292.85` — no thousands separator, in a terminal where every other
number in omp is locale-formatted. For a column of dollar figures that reach four digits, that reads
badly.

**Both compact formatters round across a decade, and `Intl` is not the fix.** Measured:

```
pi-utils formatNumber(9982)  -> "10K"
Intl compact    .format(9982) -> "10K"
Intl compact maximumFractionDigits:1 -> "10K"
```

`9,982` displayed as `10K` reads larger than `10,000` would. It also affects `999,500` → `1M` and
`9,999,499` → `10M`. `Intl` has the same behaviour as `pi-utils` here, so switching to it does not
fix anything — the decade rollover is inherent to "round to N significant figures", not to either
implementation.

The fix is an explicit guard: round, and if the rounding crossed a decade, fall back to the exact
integer rather than emitting the rounded value.

```ts
const UNITS = ["", "K", "M", "B", "T"] as const;   // index = power of 1000

export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a < 1000) return sign + String(a);
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log10(a) / 3));
  const mant = a / 1000 ** i;
  if (mant < 10) {
    const tenths = Math.round(mant * 10);
    if (tenths < 100) return sign + (tenths / 10).toFixed(1) + UNITS[i];
    // 9,950..9,999 would render as "10K": crossed a decade, show the integer
    return sign + Math.round(a).toLocaleString("en-US");
  }
  const whole = Math.round(mant);
  if (whole < 1000) return sign + whole.toLocaleString("en-US") + UNITS[i];
  return sign + Math.round(a).toLocaleString("en-US");
}
```

Verified against every magnitude in this database plus the decade boundaries:

```
      999 -> 999           34,404 -> 34K          84,752,703 -> 85M
    1,000 -> 1.0K        34,518 -> 35K          97,755,050 -> 98M
    1,234 -> 1.2K      999,499 -> 999K        139,890,869 -> 140M
    9,949 -> 9.9K      999,500 -> 999,500    1,091,926,145 -> 1.1B
    9,950 -> 9,950      999,999 -> 999,999    1,702,208,825 -> 1.7B
    9,982 -> 9,982    1,000,000 -> 1.0M      23,232,678,069 -> 23B
    9,999 -> 9,999    9,999,499 -> 9,999,499 24,423,630,406 -> 24B
```

The five inputs where it deliberately differs from `Intl`: `9950`, `9982`, `9999`, `999500`,
`999999` — every decade-rollover case, which is exactly the set that was wrong.

### Proposed rules

**Tokens — never render a bare total.** The compact form is fine; what must accompany it is the split.

| input | naive | proposed |
|---|---|---|
| 4,407,504,146 (`space-bunny-free`, all-time biggest) | `4.4B` | `4.4B` |
| 4,243,498,710 (its cache reads) | `4.2B` | shown as `· 97% cached` |
| 1,091,926,145 (fresh input, whole DB) | `1.1B` | shown as `· 1.1B fresh` |
| 1,702,208,825 (`gpt-5.6-sol` total) | `1.7B` | `1.7B` |

Rule: a token figure is a **compact count plus an explicit split**. `97% cached` is a *cache rate*
per `CONTEXT.md:104` (cache reads ÷ fresh + cache-read, cache writes excluded) and must be labelled as
such, never as "how much of the input was cached".

**Cost — `$0.00` and `N/A` are different claims.**

- `$0` / `$0.00` = the price is genuinely zero (free tier / subscription). Verified: `cost_unpriced = 0`
  on all 68,838 such rows, and every per-part price column is `0.0`. This is *measured free*.
- `N/A` = the price could not be determined. Never rendered for a free row.
- Per `CONTEXT.md:117-118`, a cost figure shown without its unpriced count beside it is a wrong
  number. So any aggregate that contains unpriced requests is a **floor** and must say so.

**Percentages — one decimal, always suffixed.** Real cache rates in this DB span 95.3 %
(`gpt-5.6-terra`) to 97.8 % (`deepseek-v4-flash`). **Use `toFixed(1)` + `%`.** Note the trap this
creates: the whole-DB *cache rate* is `95.5%` (cr ÷ fresh + cache-read, per `CONTEXT.md:104`, cache
writes excluded) while the cache-read *share of total tokens* is `95.1%` — because output tokens are in
the total but not in the denominator. Two different numbers, one percentage point apart, and both are
correct. Never label one as the other.

**Durations — reuse `formatDuration` verbatim.** It already covers every magnitude in the DB:
TTFT spans 710 ms to 303 s (`303702` → `5m03s`); request duration spans 8 ms to 26 minutes
(`1582747` → `26m22s`).

### Input → rendered output, real magnitudes

| quantity | raw input | rendered | rule exercised |
|---|---|---|---|
| total tokens | `24423630406` | `24B` | ≥10 in unit → integer mantissa, suffix |
| total tokens | `4407504146` | `4.4B` | <10 in unit → keeps one decimal |
| total tokens | `23232678069` | `23B` | cache reads alone, **only shown with its `cached` label** |
| cache rate (`space-bunny-free`) | `4243498710` of `4407504146` | `97% cached` | cache rate = cr ÷ (in + cr); writes excluded |
| fresh input tokens | `1091926145` | `1.1B` | <10 in unit → one decimal |
| output tokens | `97755050` | `98M` | ≥10 in unit → integer |
| cache-write tokens | `1271142` | `1.3M` | <10 in unit → one decimal; never in the cache-rate denominator |
| request count | `184777` | `185K` | ≥10 in unit → integer |
| request count | `34518` | `35K` | ≥10 in unit → integer |
| request count | `9982` | `9,982` | **not** `10K` — decade-rollover guard, see above |
| request count | `999500` | `999,500` | **not** `1M` — same guard |
| cost, lifetime | `2582.33` | `$2,582` | ≥$1,000 → thousands separator, 0 decimals |
| cost, worst day all-time (`2026-07-19`) | `611.395381732` | `$611.40` | ≥$1 → 2 decimals, trailing zeros kept for column alignment |
| cost, per-model | `1292.8521` | `$1,293` | ≥$1,000 → 0 decimals |
| cost, per-model | `22.8519` | `$22.85` | ≥$1 → 2 decimals |
| cost, per-request mean | `0.023029` | `$0.023` | 0.01–1 → **3** decimals (pi-tui rule) |
| cost, per-request min | `0.000065` | `$0.0001` | <0.01 → 4 decimals |
| cost, per-request max | `2.6688` | `$2.67` | ≥1 → 2 decimals |
| cost, free model | `0` with `unpriced=0` | `$0` | genuinely free — **not** `N/A` |
| cost, unpriced model | `0` with `unpriced=412` | `N/A` | price unknown |
| cost, aggregate with any unpriced | `22.8519`, `unpriced=412` | `$22.85 ⌐` | floor marker; `⌐` = "≥", plus `· 412 unpriced` in the row footer |
| cache rate (`gpt-5.6-terra`) | `0.953` | `95.3%` | 1 decimal |
| cache rate, whole DB | `0.955` | `95.5%` | 1 decimal — distinct from the 95.1 % share of total |
| TTFT | `4514` | `4.5s` | `formatDuration` |
| TTFT | `303702` | `5m03s` | `formatDuration`, zero-padded seconds |
| TTFT | `710` | `710ms` | `formatDuration` |
| request duration | `9982` | `10.0s` | `formatDuration` |
| request duration | `1582747` | `26m22s` | `formatDuration` |

### The two rules that must never be broken

1. **Cached vs fresh.** A token total is never rendered without its cache rate. A chart axis that says
   `4.4B` next to a `$0.00` cost invites the reader to conclude the tokens were expensive; they were
   re-reads at a tenth of the rate. Rule: **every token figure is `compact count` + `% cached`**,
   and the tooltip/row expands to `fresh` / `cached` / `written` / `output`.
2. **Unpriced vs free.** `$0.00` means *measured at zero*; `N/A` means *unknown*. This database
   currently has 0 unpriced rows and 68,547 free ones — if we collapse the two, the panel will report
   `$0` for free models (correct today) and will *silently start reporting `$0` for models whose
   price lookup failed* (wrong tomorrow). `isUnpricedMessage()` (`formatters.ts:39`) already makes this
   distinction and the panel must keep it.

**Practical consequence for the free-tier models.** `space-bunny-free` is the #1 token consumer at
4.4 B. A per-model bar chart of *cost* gives it a zero-length bar; a bar chart of *tokens* gives it
the longest bar and a `$0.00` label. Neither is wrong, but the panel should show both axes' worth of
truth — bar length by tokens, label with both `4.4B` and `$0`, and mark the row as free-tier rather
than folding it into a total that implies $2,582 of spend happened on `gpt-5.6-sol` alone.

## Rejected options

- **Route every data glyph through `theme.symbol()` by adding `SymbolKey`s upstream.** Rejected:
  requires patching a package we do not own, and omp's own precedent for extension-packaged glyphs
  is to route *chrome* through the theme (`adr/0005`). The registry is also closed to new keys at
  runtime — `theme-class.ts:216-222` logs and drops any override key not already in the map.
- **Branch on terminal capability / font detection.** Rejected as unsound and already settled: no
  Nerd Font probe exists anywhere in omp, no `TERM=dumb` handling exists, `NO_COLOR` gates only
  hyperlinks (`render/hyperlink.ts:95`), and `ColorMode` has no monochrome variant
  (`theme/schema.ts:201`). Presets are opt-in settings, never detections.
- **Hardcode plain Unicode for data ink and accept the ASCII mismatch** (`adr/0005` as currently
  written). This document's recommendation is a small amendment to that ADR, not a reversal: chrome
  still goes through the theme, but the five data roles come from `panelGlyphs()` — a module that
  switches on the preset once, in one place, and gives ASCII a real (5-level) ramp instead of
  pretending eight levels exist. The ADR's core argument — that `theme.symbol()` cannot express a
  ramp — stands; what changes is that we own the fallback explicitly rather than leaking Unicode into
  an ASCII panel.
- **Braille for higher-resolution plots.** Rejected: 2×4 raster, per-cell colour impossible, wrong
  aspect, tofu on coverage gap. Only defensible for a dense multi-series cumulative line plot, which
  this panel is not.
- **Emoji as data ink** (`📊` U+1F4CA is the `unicode` preset's `cmd.stats`): `2B1B..2B1C ; W` and
  measured width 2 for the large squares; emoji width is unstable across terminals generally.
- **Powerline separators** for table rules: background-painting glyphs; `sep.pipe`/`sep.slash` are
  unusable under `nerd` for exactly this reason.
- **Ambiguous-width box characters as data marks.** Avoid where possible (`boxRound`'s rounded corners
  are Narrow; `boxSharp`'s are Ambiguous), accept where omp already does, and never hand-roll — use
  `theme.boxRound` via `Box`.
- **`md.colorSwatch` as the heatmap cell.** `■` in two presets, the two-cell `[]` in `ascii`. Width
  breaks under exactly the preset it is supposed to support.
- **`sep.block` as a bar fill.** `▌` U+258C under `unicode`, `█` U+2588 under `nerd`, `#` under
  `ascii` — three different shapes for one key.
- **Either shipped compact formatter for the chart axis.** Both `pi-utils`'s `formatNumber` and
  `Intl` compact render `9,982 → "10K"`, rounding across a decade. Neither is wrong for a loose
  display; both are wrong for a chart axis, where `10K` is a value the data never took.
- **Dropping colour under the `ascii` preset.** Colour is orthogonal to the preset; the ASCII preset
  is a font-coverage choice, not a colour-depth choice.

## Open questions for the user

1. **Is the ASCII ramp's 5 density levels acceptable, or should ASCII bars be `#`/` ` only (2 levels,
   full height fidelity)?** Recommendation: the 5-level ramp. Measured aligned, monotone, and it
   keeps a low-but-nonzero day distinguishable from an empty one — which matters because this DB has
   days with 173 requests next to days with 9,098.
2. **Should `barFill[0]` (the lowest eighth) be a visible glyph or a space?** Recommendation: space.
   A 1/8-filled cell at the bottom of a column reads as noise; `spark` omits it too. But if we want
   the ASCII ramp to be a strict 8-distinct-step analogue of the Unicode one, `.` is defensible.
3. **Which token metric should the heatmap bucket on — cost or requests?** `/usage` auto-switches on
   cost availability (`usage-dashboard.ts:315-316`). On this DB, cost-keyed heatmaps for the last two
   weeks are near-empty because free-tier models dominate volume while pricing at `$0.00`. Options:
   (a) follow `/usage`'s auto-switch, (b) key on requests and show cost as a separate view,
   (c) key on cost with a `N/A`-styled free-tier swatch so free days are visibly *not zero*.
   Recommendation: (c) — it is the only one that does not hide the 32 % of activity that cost nothing.
4. **Is the free-tier share a headline or a footnote?** 32.4 % of tokens and 37.3 % of requests cost
   `$0.00`. Recommendation: show it in the summary line (`$2,582 · 32% of tokens free-tier`) rather
   than in a per-row badge, because the summary is where a wrong reading of "total spend" happens.
5. **Should the panel expose a compact/exact toggle?** The guarded formatter renders `184,777 → 185K`
   and `34,518 → 35K`, which loses precision a reader may want when comparing rows.
   Recommendation: compact in charts and axis labels, exact (thousands-separated) in table cells,
   where there is room and the reader is comparing rows.
6. **Floor marker for unpriced aggregates.** No unpriced rows exist today, so the marker cannot be
   visually validated against real data. Recommendation: `⌐` (or a `≥` prefix on the `$`) plus
   `· N unpriced` in the row footer, matching `CONTEXT.md:117-118`. Needs the user's preference
   between a glyph marker and a worded footnote.
7. **Do we adopt the native `chart` node when `cx.supports("chart")` reports true?** If so, the
   glyph system is fallback-only and `heatRamp` may never render on this user's terminal.
   Recommendation: implement both paths, feature-detect exactly as `/usage` does
   (`usage-dashboard.ts:944`), and keep the glyph tables as the guaranteed path. But this needs
   confirming against what the native renderer actually draws for a heatmap cell, which this
   investigation did not read.
8. **Does the user want `formatCost` unified across `omp-stats` (web) and `pi-tui` (TUI)?** The two
   disagree on zero (`$0` vs `$0.0000`), on thousands separators, and on the sub-dollar digit count.
   We cannot change either package. Recommendation: define the panel's own formatter, document the
   divergence, and treat the shared spec as the thing a future upstream PR would unify.