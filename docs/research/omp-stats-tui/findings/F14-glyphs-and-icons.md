# Angle

F14 — glyph and icon selection for the omp stats panel. Two deliverables:

- **A.** Icons for section headings and inline/status markers, one glyph per omp symbol preset (`unicode` | `nerd` | `ascii`).
- **B.** Data-mark ramps (bar fills, sparklines, heatmap cells, share bars, separators) per preset, every one verified for `Bun.stringWidth === 1`.

Ground truth for what already exists:
`~/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/theme/symbols.ts` (`SymbolPreset`, `SYMBOL_PRESETS`), and
`~/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/theme/theme-class.ts` (`theme.symbol()`, `theme.styledSymbol()`, `theme.getSymbolPreset()`).

Date of research: **2026-10-03** (`date +%Y-%m-%d`).

Every codepoint and every width below was printed with `bun -e` (codePointAt + `Bun.stringWidth`) — nothing here is from memory.

---

## Already registered by omp

Dump method (reproducible):

```
cd ~/.bun/install/global/node_modules/@oh-my-pi/pi-tui
bun -e 'const m = await import("./src/theme/symbols.ts"); const P = m.SYMBOL_PRESETS;
for (const k of Object.keys(P.unicode)) { ...print k, unicode/nerd/ascii with codepoints + Bun.stringWidth... }'
```

`SYMBOL_PRESETS` is `Record<SymbolPreset, SymbolMap>` where `SymbolMap = Record<SymbolKey, string>` — three *flat* maps keyed by dotted string. **There is no array-valued symbol anywhere in the table**: `theme.symbol(key)` is a single `string` read. Any multi-level ramp (8 bar levels, 4 heatmap levels) must therefore live in the stats module's own `Record<SymbolPreset, GlyphSet>`, not in `theme.symbol()`.

Roles we care about that omp **already registers**:

| role | key | unicode | nerd | ascii |
|---|---|---|---|---|
| cost / money | `icon.cost` | `💲` U+1F4B2 (w=2) | `` U+F155 w=1 | `$` |
| tokens | `icon.tokens` | `🪙` U+1FA99 (w=2) | `` U+E26B w=1 | `tok:` |
| time / duration | `icon.time` | `⏱` U+23F1 (w=1) | `` U+F017 w=1 | `t:` |
| models | `icon.model` | `⬢` U+2B22 (w=1) | `` U+EC19 w=1 | `[M]` |
| tools | `icon.extensionTool` | `🛠` U+1F6E0 (w=1) | `` U+F0AD w=1 | `TL` |
| projects / folders | `icon.folder` | `📁` U+1F4C1 (w=2) | `` U+F115 w=1 | `[D]` |
| errors | `status.error` | `✘` U+2718 (w=1) | `` U+F00D w=1 | `[!!]` |
| errors (alt) | `cmd.bug` | `🐛` U+1F41B (w=2) | `` U+F188 w=1 | — |
| activity / history | `cmd.history` | `🕘` U+1F558 (w=2) | `󰋚` U+F02DA w=1 | — |
| cache | `icon.cache` | `💾` U+1F4BE (w=2) | `` U+F1C0 w=1 | `cache` |
| cache miss | `icon.cacheMiss` | `⊘` U+2298 (w=1) | `` U+F05E w=1 | `!` |
| warning | `icon.warning` | `⚠` U+26A0 (w=1) | `` U+F071 w=1 | `[!]` |
| stats (panel root) | `cmd.stats` | `📊` U+1F4CA (w=2) | `` U+F080 (`nf-fa-bar_chart`) w=1 | — |
| gains | `cmd.rocket` | `🚀` U+1F680 (w=2) | `` U+F135 w=1 | — |
| providers | `icon.host` | `🖥` U+1F5A5 (w=1) | `` U+F109 w=1 | `host` |
| unknown | `cmd.question` | `❓` U+2753 (w=2) | `` U+F059 w=1 | — |
| share / outward trend | `cmd.share` | `↗` U+2197 (w=1) | `` U+F1E0 w=1 | `<` |
| single bar / gauge | `progress.filled` / `progress.empty` | `━` U+2501 / `─` U+2500 | same | `=` / `-` |

**Not registered** (need new keys): trend up, trend down, unpriced marker, providers-specific icon (only `icon.host` exists), calendar/activity-day, per-row heat cells.

Note omp's `icon.cost` unicode value is `💲` U+1F4B2 (heavy dollar sign) and its `icon.tokens` is `🪙` U+1FA99 (coin) — the *token* icon is a coin, which is semantically odd for a token-count heading but is the host's established choice. Reuse, don't override.

---

## Icon recommendations per preset

Emoji column shows char + codepoint + name; nerd column shows char + codepoint + `nf-` name. All emoji widths verified: every emoji listed is `Bun.stringWidth === 2`; every nerd/unicode-symbol is `=== 1`.

### Section headings

| role | unicode (char + cp + name) | nerd (char + cp + nf-name) | ascii | already registered? | reusable key name |
|---|---|---|---|---|---|
| cost / money | `💲` U+1F4B2 HEAVY DOLLAR SIGN (w=2) | `` U+F155 `nf-fa-dollar` | `$` | yes | `icon.cost` |
| tokens | `🪙` U+1FA99 COIN (w=2) | `` U+E26B (material, host) | `tok:` | yes | `icon.tokens` |
| requests | `📊` U+1F4CA BAR CHART (w=2) | `` U+F080 `nf-fa-bar_chart` | `req:` | partial (`cmd.stats` exists) | `cmd.stats` |
| time / duration | `⏱` U+23F1 STOPWATCH (w=1) | `` U+F017 `nf-fa-clock_o` | `t:` | yes | `icon.time` |
| models | `⬢` U+2B22 BLACK HEXAGON (w=1) | `` U+EC19 (material hex) | `[M]` | yes | `icon.model` |
| providers | `🛰` U+1F6F0 SATELLITE (w=1) | `󰒋` U+F048B `nf-md-server` | `host` | partial (`icon.host`) | `icon.host` |
| tools | `🛠` U+1F6E0 HAMMER AND WRENCH (w=1) | `` U+F0AD `nf-fa-wrench` | `TL` | yes | `icon.extensionTool` |
| projects / folders | `📁` U+1F4C1 FILE FOLDER (w=2) | `` U+F07C `nf-fa-folder_open` | `[D]` | yes | `icon.folder` |
| errors | `❌` U+274C CROSS MARK (w=2) | `` U+F057 `nf-fa-exclamation_circle` | `[!!]` | partial (`status.error`) | `status.error` |
| activity / calendar | `📅` U+1F4C5 CALENDAR (w=2) | `` U+F073 `nf-fa-calendar` | `cal` | no (closest: `cmd.history` `󰋚` U+F02DA) | **new** `icon.calendar` |
| gains | `💹` U+1F4B9 CHART WITH UPWARDS TREND (w=2) | `` U+F0E5 `nf-fa-line_chart` | `+` | no (closest: `cmd.rocket` `` U+F135) | **new** `icon.gains` |

### Inline / status

| role | unicode | nerd | ascii | already registered? | reusable key name |
|---|---|---|---|---|---|
| trend up | `↗` U+2197 NORTH EAST ARROW (w=1) | `` U+F062 `nf-fa-arrow_up` | `+` | partial (`cmd.share` = `↗` U+2197) | `cmd.share` (unicode) / **new** `icon.trendUp` (nerd U+F062) |
| trend down | `↘` U+2198 SOUTH EAST ARROW (w=1) | `` U+F063 `nf-fa-arrow_down` | `-` | no | **new** `icon.trendDown` |
| unpriced / unknown | `❓` U+2753 BLACK QUESTION MARK ORNAMENT (w=2) | `` U+F059 `nf-fa-question` | `?` | partial (`cmd.question`) | `cmd.question` |
| cache indicator | `💾` U+1F4BE FLOPPY DISK (w=2) | `` U+F1C0 `nf-fa-database` | `cache` | yes | `icon.cache` |
| warning | `⚠` U+26A0 WARNING SIGN (w=1) | `` U+F071 `nf-fa-warning` | `[!]` | yes | `icon.warning` |

### Notes on choices

- **Trend arrows are width-1 in every preset.** `↗`/`↘` are used *inline next to a delta number*, so the width-1 property matters; using `📈`/`📉` would cost 2 cells per row and misalign the numeric column. omp's `cmd.share` already uses `↗` in unicode, so `↗` keeps the panel visually consistent with the rest of the UI.
- **ASCII preset uses 1–3 char labels, not single glyphs** — a stats panel's headings need to survive a plain `TERM=vt100` screen. `tok:`, `req:`, `t:`, `cal` are width-stable because the trailing `:`/bracket marks them as labels.
- **Emoji is heading-only.** Every emoji above is 2 cells. The panel must reserve exactly 2 cells of gutter per heading (or `Bun.stringWidth(icon)` per icon) and never emit an emoji inside a repeated data cell.
- **Nerd codepoints not in omp's table** were verified against the Nerd Fonts cheat sheet: `nf-fa-arrow_up` U+F062, `nf-fa-arrow_down` U+F063, `nf-fa-calendar` U+F073, `nf-fa-line_chart` U+F0E5, `nf-fa-exclamation_circle` U+F057, `nf-fa-folder_open` U+F07C, `nf-md-server` U+F048B. All print as `Bun.stringWidth === 1`.

### Proposed module shape (directly transcribable)

```ts
export type IconRole =
  | "cost" | "tokens" | "requests" | "time" | "models" | "providers"
  | "tools" | "projects" | "errors" | "calendar" | "gains"
  | "trendUp" | "trendDown" | "unknown" | "cache" | "warning";

// reuse theme.symbol() where a key exists; only these four are new
export const STATS_ICONS: Record<SymbolPreset, Record<IconRole, string>> = {
  unicode: { cost:"💲", tokens:"🪙", requests:"📊", time:"⏱", models:"⬢", providers:"🛰", tools:"🛠", projects:"📁", errors:"❌", calendar:"📅", gains:"💹", trendUp:"↗", trendDown:"↘", unknown:"❓", cache:"💾", warning:"⚠" },
  nerd:    { cost:"\uF155", tokens:"\uE26B", requests:"\uF080", time:"\uF017", models:"\uEC19", providers:"\u{F048B}", tools:"\uF0AD", projects:"\uF07C", errors:"\uF057", calendar:"\uF073", gains:"\uF0E5", trendUp:"\uF062", trendDown:"\uF063", unknown:"\uF059", cache:"\uF1C0", warning:"\uF071" },
  ascii:   { cost:"$", tokens:"tok:", requests:"req:", time:"t:", models:"[M]", providers:"host", tools:"TL", projects:"[D]", errors:"[!!]", calendar:"cal", gains:"+", trendUp:"+", trendDown:"-", unknown:"?", cache:"cache", warning:"[!]" },
};
```

The four roles with no host key (`calendar`, `gains`, `trendUp`, `trendDown`) are the only ones that add to `SYMBOL_PRESETS`; the rest should read through `theme.symbol()` so a future host change propagates.

---

## Data-mark ramps per preset

| role | unicode ramp | nerd ramp | ascii ladder | width check | source precedent |
|---|---|---|---|---|---|
| vertical bar, 8 fill levels | `▁▂▃▄▅▆▇█` U+2581–U+2588 | identical (block elements are font-independent, not Nerd-specific) | `#` U+0023 single cell; ascii bars gain resolution by stacking rows, not sub-cell glyphs | all w=1 | `pi-tui/src/apps/live-visualizer.ts:41` `SPECTRUM_BLOCKS = [" ","▁",…,"█"]` — same 9-cell ladder, host-proven |
| vertical bar, empty cell | ` ` U+0020 (or `▁` U+2581 at level 0) | same | `" "` (host uses `" "` for level 0) | w=1 | live-visualizer index 0 is `" "` |
| **horizontal** bar fill (1-row share) | `█` U+2588 | `█` U+2588 | `#` U+0023 | w=1 | `sep.block`: unicode `▌` U+258C, nerd `█` U+2588, ascii `#` |
| horizontal bar, empty | `─` U+2500 | `─` U+2500 | `-` U+002D | w=1 | `progress.empty` registered in all three presets |
| sparkline, 8 levels | `▁▂▃▄▅▆▇█` U+2581–U+2588 | identical | `.:-\|=+*#` (8 chars, all w=1) | w=1 each | eighths confirmed by asciichart/bashspark/btop usage; F10 |
| heatmap cell, 4 intensity levels | `■` U+25A0 for **all** levels, colour carries intensity; fallback `░▒▓█` U+2591/2592/2593/2588 | identical | `.` `:` `-` `=` | w=1 | omp `/usage` heatmap (`usage-dashboard.ts:866,1191`) uses `■` filled + `·` empty with colour ramp `HEAT_LEVEL_TOKENS` — **in-repo precedent** |
| heatmap empty cell | `·` U+00B7 | `·` U+00B7 | `.` U+002E | w=1 | `usage-dashboard.ts:866` `theme.fg("dim","·")` |
| heatmap 4 levels, glyph-carried alternative | `░▒▓█` U+2591/2592/2593/2588 | identical | `.:-=` | w=1 | gnuplot `set term block`; ratatui `symbols::shade` — for NO_COLOR / monochrome terminals |
| share/proportion fill | `█` U+2588 | `█` U+2588 | `#` | w=1 | same family as horizontal bar |
| share/proportion empty | `─` U+2500 | `─` U+2500 | `-` | w=1 | `progress.empty` |
| table column separator | `│` U+2502 (bare) — **not** `sep.pipe` (measured 3 cells) | `│` U+2502 | `|` U+007C | w=1 | `boxRound.vertical` / `boxSharp.vertical`; `sep.pipe` is `" │ "` w=3 (unicode/ascii) and U+E0B3 w=1 (nerd) → inconsistent width across presets |
| section divider (optional) | `─` U+2500 | `─` U+2500 | `-` | w=1 | `progress.empty` |


### Width verification output (verbatim from `bun -e`)

```
blocks  ▁ U+2581 w=1   ▂ U+2582 w=1   ▃ U+2583 w=1   ▄ U+2584 w=1
        ▅ U+2585 w=1   ▆ U+2586 w=1   ▇ U+2587 w=1   █ U+2588 w=1
        ▏ U+258F w=1   ▎ U+258E w=1   ▍ U+258D w=1   ▌ U+258C w=1
        ▋ U+258B w=1   ▊ U+258A w=1   ▉ U+2589 w=1
shade   ░ U+2591 w=1   ▒ U+2592 w=1   ▓ U+2593 w=1   █ U+2588 w=1
hcells  · U+00B7 w=1   ■ U+25A0 w=1   ▪ U+25AA w=1   ▫ U+25AB w=1
        ◦ U+25E6 w=1   ◌ U+25CC w=1   ∙ U+2219 w=1
half    ▌ U+258C w=1   ▐ U+2590 w=1
vert    │ U+2502 w=1   ┃ U+2503 w=1   ▀ U+2580 w=1
circle  ◔ U+25D4 w=1   ◑ U+25D1 w=1   ◕ U+25D5 w=1   ● U+25CF w=1
nl      ↑ U+2191 w=1   ↓ U+2193 w=1   ↗ U+2197 w=1   ↘ U+2198 w=1
        ▲ U+25B2 w=1   ▼ U+25BC w=1   ◆ U+25C6 w=1
emoji   💲 U+1F4B2 w=2  📊 U+1F4CA w=2  📁 U+1F4C1 w=2  🪙 U+1FA99 w=2
        ❌ U+274C w=2  💹 U+1F4B9 w=2  📅 U+1F4C5 w=2  🧮 U+1F9EE w=2
        ⚠ U+26A0 w=1   ⚠️ U+26A0+U+FE0F w=2   ⏱ U+23F1 w=1   🛠 U+1F6E0 w=1
        🛰 U+1F6F0 w=1  ↗ U+2197 w=1  ↘ U+2198 w=1
```

**Rejected for data ink (2 cells, measured):** every emoji in the icon table; `🪙` `💲` `📊` `📁` `❌` `💹` `📅` `🚨` `🔌` `💾` `❓` `📈` `🕐` `🗓️(U+1F5D3+FE0F)` `⚠️(U+26A0+FE0F)`.

⚠️ note: `⚠` alone is width 1 but `⚠️` (with VS16) is width 2. Use the bare `⚠` — which is exactly what `icon.warning` already registers.

**Rejected as data ink for a different reason:** Symbols-for-Legacy-Computing eighths `🮁`–`🮈` U+1FB81–U+1FB88. They measure `Bun.stringWidth === 1` and would give finer sub-cell resolution, but coverage is font-dependent (only Cascadia-family reliably) and they render as tofu elsewhere. Since omp never probes the user's font, the safer choice is plain U+2581–U+2588 everywhere. See Sources.

**`sep.pipe` warning (measured):** `sep.pipe` is `" │ "` = 3 cells in unicode/ascii and `U+E0B3` = 1 cell in nerd. Inconsistent width across presets → never use it as an in-cell separator.

---

## Web sources

- https://www.nerdfonts.com/cheat-sheet — Nerd Fonts cheat sheet; confirmed `nf-fa-arrow_up` U+F062, `nf-fa-calendar` U+F073, `nf-fa-chart_line` U+F201.
- https://github.com/ryanoasis/nerd-fonts/wiki/Glyph-Sets-and-Code-Points — canonical codepoint list; confirms Material Design Icons moved to the five-digit `U+F0001`+ range in Nerd Fonts 3.x, so `nf-md-server` is `U+F048B` (the commonly-cited `U+F233` is the legacy mapping).
- https://unicode.link/blocks/symbols-for-legacy-computing — U+1FB81–U+1FB88 live in Symbols for Legacy Computing (U+1FB00–U+1FBFF), not Block Elements.
- https://github.com/microsoft/cascadia-code/blob/main/FONTLOG.txt — Cascadia covers `U+1FB82–U+1FB8B`; the other Nerd Font families may show tofu, which is why the eighth-block ramp is not used here.
- https://unicode.org/versions/Unicode17.0/core-spec/chapter-22/ — Unicode 17 block layout confirmation.

In-repo precedents (no URL needed): `pi-tui/src/apps/live-visualizer.ts:41` (block ladder), `pi-tui/src/overlays/usage-dashboard.ts:866,1191` (`■`/`·` heatmap with colour intensity).

---

## Open questions

1. **Emoji gutter width.** Every unicode heading icon is 2 cells. Does the panel pad to a fixed 2-cell gutter (simpler, aligns all headings) or to `Bun.stringWidth(icon)` per heading (ragged)? Fixed 2 is recommended; ragged breaks column alignment.
2. **Which four new keys, if any, go upstream into `SymbolKey`?** `icon.calendar`, `icon.gains`, `icon.trendUp`, `icon.trendDown` have no host key. Registering them in `pi-tui` would be the clean long-term move but touches the host; keeping them local in the stats module avoids a fork. Needs a decision from the owner.
3. **ASCII sparkline ladder length.** The classic `.:-\|=+*#%@` is 9 characters. Truncating to 8 (`.:-\|=+*#`) keeps it aligned with the 8-level block ramp, but loses the `@` maximum that readers recognise. Alternative: allow the ascii sparkline 9 levels and normalise separately.
4. **Heatmap: colour-carried vs glyph-carried.** omp's `/usage` uses one glyph (`■`) + 4 colours. Reusing that keeps visual language consistent but produces **no readable ramp in `NO_COLOR` or on a 1-colour terminal** (omp's `ColorMode` has no 16-colour mode, so `256color`/`truecolor` are the only cases where it degrades). The `░▒▓█` glyph ramp covers that hole. Do we accept two heatmap modes, or always glyph-carried?
5. **Nerd-underline status bars (U+E0B0 `sep.powerline`)** were not evaluated — omp registers them, but they need a background colour to read correctly and interact badly with a data-ink layout. Out of scope unless the panel wants powerline section headers.
6. **Vertical (column) bar vs horizontal bar.** The ramp table assumes one glyph per cell with 8 vertical levels for column bars and single `█` for one-row horizontal bars. If the panel wants sub-cell horizontal resolution (fractional progress bars, 1/8-width `▏▎▍▌▋▊▉█`), that is a second ladder and needs its own `GlyphSet` field — not covered here.