# F19 — Chart iconography

**Date:** 2026-10-03
**Scope:** which glyph marks which role, per preset. Section headings, inline status markers,
axis/annotation markers. Plus the calendar-heatmap cell question.
**Method:** every Unicode codepoint below was checked against `unicodedata.name` +
`EastAsianWidth.txt` (UCD 16.0.0) and measured with `Bun.stringWidth` under Bun 1.4.2.
Every Nerd Font codepoint was resolved against `ryanoasis/nerd-fonts` `glyphnames.json`,
METADATA `version: 3.5.1, date: 2026-08-21`. Nothing here is inferred from search-engine
prose. Where a claim could not be verified against source it says so.

**Two legal zones, used throughout:**

- **Heading zone** — a 2-cell gutter is reserved. Emoji are legal here under `unicode`.
  `Bun.stringWidth === 2` is expected and accounted for.
- **Data-cell zone** — repeated, one per row/column. Must be `Bun.stringWidth === 1`.
  **No emoji, no variation selector, no PUA, no East_Asian_Width=Wide.**

A marker that appears next to a *value* (trend arrow beside a number, `?` beside a price,
`~` beside a cache ratio) is a **data cell** and is held to the 1-cell rule, even though it is
"inline" text. That is the single most likely place to smuggle a 2-cell glyph into a column.

---

## Corrections to earlier findings

These came out of checking omp's existing Nerd codepoints against `glyphnames.json`. They are
advisory — none of them are wrong-by-accident, they are wrong-by-attribution in F6/F8/F14 and
in the task brief. Reusing the codepoint is still correct; only the label attached to it changes.

| Codepoint | Previously labelled | Actual `glyphnames.json` name |
|---|---|---|
| U+E26B | "material hex" / "tokens hex" | `nf-fae-coins` (Font Awesome **E**xtension) |
| U+EC19 | "material hex" | `nf-cod-chip` |
| U+F109 | `nf-fa-desktop` | `nf-fa-laptop` — `nf-fa-desktop` is **U+F108** |
| U+F1C0 | `nf-fa-hdd_o` / "database" | `nf-fa-database` — `nf-fa-hdd_o` is **U+F0A0** |
| U+F115 | `nf-fa-folder_open` | `nf-fa-folder_open_o` — `nf-fa-folder_open` is U+F07C, `nf-fa-folder` is U+F07B |
| U+F12A | `nf-fa-warning` | `nf-fa-exclamation` — `nf-fa-warning` is **U+F071** (also `nf-fa-exclamation_triangle`) |
| U+F005 | — | `nf-fa-star` (`nf-fa-star_o` is U+F006) |

Also: **there is no `nf-fa-trend_up`.** The Font Awesome set has no trend glyphs. The trend
trio is Material: `nf-md-trending_up` U+F0535, `nf-md-trending_down` U+F0533,
`nf-md-trending_neutral` U+F0534. `nf-fa-line_chart` and `nf-fa-chart_line` are both U+F201.

---

## Heading icons

2-cell gutter under `unicode`; all `nerd` cells measure 1.

| Role | `unicode` (char, cp, name, width) | `nerd` (char, cp, nf-name, width) | `ascii` | omp key to reuse |
|---|---|---|---|---|
| cost / money | 💲 U+1F4B2 HEAVY DOLLAR SIGN — **w=2** | nf-fa-dollar U+F155 — w=1 | `$` | `icon.cost` |
| tokens | 🪙 U+1FA99 COIN — **w=2** | nf-fae-coins U+E26B — w=1 | `tok:` | `icon.tokens` |
| requests / count | ∑ U+2211 N-ARY SUMMATION — w=1 | nf-fa-tasks U+F0AE — w=1 | `req:` | **new** `icon.requests` |
| time / duration | ⏱ U+23F1 STOPWATCH — w=1 | nf-fa-clock_o U+F017 — w=1 | `t:` | `icon.time` |
| models | ⬢ U+2B22 BLACK HEXAGON — w=1 | nf-cod-chip U+EC19 — w=1 | `[M]` | `icon.model` |
| providers | 🖥 U+1F5A5 DESKTOP COMPUTER — w=1 | nf-md-server U+F048B — w=1 | `host` | `icon.host` |
| tools | 🛠 U+1F6E0 HAMMER AND WRENCH — w=1 | nf-fa-wrench U+F0AD — w=1 | `TL` | `icon.extensionTool` |
| projects / folders | 📁 U+1F4C1 FILE FOLDER — **w=2** | nf-fa-folder_open_o U+F115 — w=1 | `[D]` | `icon.folder` |
| errors | ✘ U+2718 HEAVY BALLOT X — w=1 | nf-fa-times U+F00D — w=1 | `[!!]` | `status.error` |
| activity / calendar | 📅 U+1F4C5 CALENDAR — **w=2** | nf-fa-calendar U+F073 — w=1 | `cal` | **new** `icon.calendar` |
| gains | 🚀 U+1F680 ROCKET — **w=2** | nf-md-trending_up U+F0535 — w=1 | `+` | `cmd.rocket` |

### Notes on the four non-`unicode`-emoji cells

`⏱` U+23F1, `⬢` U+2B22, `🖥` U+1F5A5 and `🛠` U+1F6E0 all measure **1** and are all
`East_Asian_Width=N` (Narrow) despite three of them being in emoji planes. They are safe in the
data-cell zone too, which is not true of `💲`/`🪙`/`📁`/`📅`/`🚀` (all `W`, all w=2).

**Requests.** No omp key exists. `cmd.stats` (📊 U+1F4CA / U+F080) is the wrong key twice over:
it is disabled (`""`) under `ascii` by design, and it is the *panel* root, not the requests
section. New local key `icon.requests`. `∑` U+2211 is chosen over `#` U+0023 because it reads as
"a total", survives next to the other geometric headings, and is unambiguous (`w=1`) so the same
glyph is legal if requests ever moves into a column. `ascii` gets `req:`, not `#` — `#` collides
with issue/PR counts in omp's own surfaces.

**Providers.** omp's `icon.host` unicode value `🖥` is a *workstation*, not a provider endpoint.
It is fine to reuse the key as-is, but the better nerd value for "which API endpoint served this"
is `nf-md-server` U+F048B, not `nf-fa-laptop` U+F109. Both w=1.

**Gains.** `cmd.rocket` 🚀/U+F135 is the established key; reuse it. Flag the semantic drift
anyway: a rocket reads as *speed*, and this section is about *savings*. If a second gains-style
marker is ever needed, `nf-md-trending_up` U+F0535 is the literal glyph, and its `unicode`
counterpart `⬆` U+2B06 is w=1 / `N` — so that pair is data-cell-legal in a way 🚀 is not.

---

## Inline markers

All held to the 1-cell rule. Every `unicode` value below is measured w=1.

| Role | `unicode` (char, cp, name, width) | `nerd` (char, cp, nf-name, width) | `ascii` | omp key to reuse |
|---|---|---|---|---|
| trend up | ⬆ U+2B06 UPWARDS BLACK ARROW — w=1 | nf-md-trending_up U+F0535 — w=1 | `+` | **new** `marker.trendUp` |
| trend down | ⬇ U+2B07 DOWNWARDS BLACK ARROW — w=1 | nf-md-trending_down U+F0533 — w=1 | `-` | **new** `marker.trendDown` |
| flat / no change | ▬ U+25AC BLACK RECTANGLE — w=1 | nf-md-trending_neutral U+F0534 — w=1 | `=` | **new** `marker.trendFlat` |
| unpriced / unknown | ? U+003F QUESTION MARK — w=1 | nf-fa-circle_question U+F059 — w=1 | `?` | **new** `marker.unknown` |
| cache indicator | ~ U+007E TILDE — w=1 | nf-md-cached U+F00E8 — w=1 | `~` | **new** `marker.cache` |
| warning | ⚠ U+26A0 WARNING SIGN — w=1 | nf-fa-warning U+F071 — w=1 | `[!]` | `icon.warning` |
| "today" (heatmap) | ▾ U+25BE BLACK DOWN-POINTING SMALL TRIANGLE — w=1 | nf-fa-caret_down U+F0D7 — w=1 | `v` | **new** `marker.today` |
| "peak" (chart) | ▴ U+25B4 BLACK UP-POINTING SMALL TRIANGLE — w=1 | nf-fa-caret_up U+F0D8 — w=1 | `^` | **new** `marker.peak` |

### Trend up / down: `⬆⬇`, not `↑↓`

`↑` U+2191 and `↓` U+2193 are what btop and k9s actually use, and they measure w=1 — but they
are `East_Asian_Width=A` (Ambiguous). `⬆` U+2B06 and `⬇` U+2B07 are **N** and measure w=1. Same
visual, same weight, no CJK-locale risk. Given the panel already commits to Ambiguous block
elements for data ink, this is a smaller win than it looks — but the arrows are cheap to get
right for free, so take it.

Counter-argument, honestly: `↑↓` is *ubiquitous* and users pattern-match it instantly; `⬆⬇` is a
filled, heavier arrow that some fonts render noticeably bolder. If A-width is already accepted
for `█`/`▒`, the consistency argument favours `↑↓`. **Recommendation: `⬆⬇`**, on the grounds
that these two glyphs are the ones most likely to sit directly beside a right-aligned number in
a narrow column, where a 2-cell blowout is most visible.

### Flat: `▬`, not `→`

`→` U+2192 is the obvious "no change" sign and is w=1, but it is `A` and it collides with
"time flows left-to-right" / "next" reading. `▬` U+25AC BLACK RECTANGLE is `N`, w=1, and reads as
a level line — which is what flat means. The nerd value is the honest one: the Material
trending set has a *neutral* member (U+F0534), so the trio up/neutral/down is a matched set.

### Unknown: `?` U+003F, not ❓ U+2753

omp's `cmd.question` is ❓ U+2753, `EAW=W`, **w=2**. That is illegal beside a price in a column.
`?` U+003F is `Na`, w=1, and universally understood. Keep `cmd.question` for headings/empty
states; do not put it in a value column.

### Cache: `~`, not 💾

Same story: `icon.cache` 💾 U+1F4BE is w=2, illegal inline. `~` U+007E is `Na`, w=1. The nerd
value `nf-md-cached` U+F00E8 is a literal "cached" badge and is more precise than the
database-disc U+F1C0 omp uses for the heading.

### Warning: bare `⚠` — the trap is real and confirmed

| String | `Bun.stringWidth` |
|---|---|
| `⚠` (U+26A0 bare) | **1** |
| `⚠️` (U+26A0 U+FE0F) | **2** |

`⚠` U+26A0 is `EAW=N`. The VS16 makes the terminal switch to an emoji-presentation font and
count 2 cells. omp's `icon.warning` already registers the bare form — do not "improve" it to
`⚠️`. Note the contrast with `⚑`: `⚑` U+2691 is w=1 **with or without** VS16, because it is
already `N` and the terminal has no emoji-presentation form to switch to. The rule is "no VS16
next to a candidate that could emoji-ise", not "no VS16 ever".

### Today / peak markers belong in the axis row, not the data row

A marker *inside* a heatmap cell or a sparkline column destroys the value it points at — the ink
is one character wide and there is no room for both. Both markers therefore live in the
**label row above the grid**, aligned to the column they describe:

```
        ▾                          ← marker.today, in the month-label row
    Oct  Nov  Dec
    ░▒▓█▒░░   ░▒░▓█▒░  ░▓███▒▒      ← data row, untouched
```

If a panel is too short for a label row, drop the marker rather than overwrite the cell.
`▾` U+25BE and `▴` U+25B4 are both `N` and w=1; the full-size `▼` U+25BC / `▲` U+25B2 are `A`
and w=1, so the small triangles are again the free win.

---

## Axis and annotation markers

| Role | `unicode` (char, cp, name, width) | `nerd` (char, cp, nf-name, width) | `ascii` | Notes |
|---|---|---|---|---|
| axis min label | ‹ U+2039 SINGLE LEFT-POINTING ANGLE QUOTATION MARK — w=1 | same char — w=1 | `<` | EAW=**N** |
| axis max label | › U+203A SINGLE RIGHT-POINTING ANGLE QUOTATION MARK — w=1 | same char — w=1 | `>` | EAW=**N** |
| tick separator | ∙ U+2219 BULLET OPERATOR — w=1 | same char — w=1 | `\|` | EAW=**N** |
| "you are here" (sparkline) | ▌ U+258C LEFT HALF BLOCK — w=1 | same char — w=1 | `\|` | EAW=**N** |
| peak annotation | ▴ U+25B4 — w=1 | nf-fa-caret_up U+F0D8 — w=1 | `^` | as above |

**Why `‹ ›` and not `« »`.** Both pairs are w=1. `«` U+00AB / `»` U+00BB are `N`, `‹` U+2039 /
`›` U+203A are also `N` — so this is purely optical: the single guillemets are visually lighter
and sit closer to the digit weight of an axis label than the doubles do. Both are legal.

**Why `∙` U+2219 and not `·` U+00B7.** This is the one place where `·` is wrong, and the
"avoid ambiguous" rule is doing real work. `·` U+00B7 is `EAW=A`; `∙` U+2219 BULLET OPERATOR is
`EAW=N`. Both measure w=1 and both look like a centred dot, so there is no visual cost to
escaping the ambiguity. omp's existing `sep.dot` is `" · "` and is fine where it is (short
inline joins inside a heading, where a CJK-locale width blowout costs nothing), but a tick
separator sits between two numbers in a column, which is exactly where a width surprise shows.

**`sep.pipe` is banned here for a second reason beyond the one already known.** It is 3 cells
under `unicode` and 1 under `nerd`, so it changes width across presets — that is already
rejected. It is additionally `U+2502`-family when it resolves to a box character and `U+E0B3`
(a powerline background glyph) under `nerd`, which is a painted-background mark, not a text
mark. Use `∙` or bare `|`.

**"You are here".** `▌` U+258C LEFT HALF BLOCK is `N`, w=1, and reads as a cursor bar sitting
immediately left of the current column — which is where "you are here" belongs. The alternative
`❯` U+276F (omp's `nav.cursor`) is also `N` and w=1 and is arguably better if the panel has a
label gutter, because it is unmistakably a pointer and cannot be confused with data ink. Pick
`▌` when the marker is in the data row; pick `❯` when it is in the label row. `▐` U+2590 is the
mirror and is equally legal — the half-blocks are the standard "half a cell" ink.

---

## Width audit

Every character recommended anywhere above, measured with `Bun.stringWidth` (Bun 1.4.2), with
its `East_Asian_Width` class from UCD 16.0.0. **Data cell = must be exactly 1 cell.**

| Char | Cp | `stringWidth` | EAW | Legal in data cell? |
|---|---|---|---|---|
| 💲 | U+1F4B2 | 2 | W | ❌ no — heading only |
| 🪙 | U+1FA99 | 2 | W | ❌ no — heading only |
| 📁 | U+1F4C1 | 2 | W | ❌ no — heading only |
| 📅 | U+1F4C5 | 2 | W | ❌ no — heading only |
| 🚀 | U+1F680 | 2 | W | ❌ no — heading only |
| ⏱ | U+23F1 | **1** | N | ✅ yes |
| ⬢ | U+2B22 | **1** | N | ✅ yes |
| 🖥 | U+1F5A5 | **1** | N | ✅ yes (surprising — emoji plane, Narrow) |
| 🛠 | U+1F6E0 | **1** | N | ✅ yes; `🛠️` +VS16 = 2 ❌ |
| ✘ | U+2718 | **1** | N | ✅ yes |
| ∑ | U+2211 | **1** | A | ✅ yes (width); A-width noted |
| ⬆ | U+2B06 | **1** | N | ✅ yes |
| ⬇ | U+2B07 | **1** | N | ✅ yes |
| ▬ | U+25AC | **1** | N | ✅ yes |
| ? | U+003F | **1** | Na | ✅ yes |
| ~ | U+007E | **1** | Na | ✅ yes |
| ⚠ | U+26A0 | **1** | N | ✅ yes |
| ⚠️ | U+26A0+FE0F | 2 | N | ❌ **no — the VS16 trap** |
| ▾ | U+25BE | **1** | N | ✅ yes |
| ▴ | U+25B4 | **1** | N | ✅ yes |
| ‹ | U+2039 | **1** | N | ✅ yes |
| › | U+203A | **1** | N | ✅ yes |
| « | U+00AB | **1** | N | ✅ yes |
| » | U+00BB | **1** | N | ✅ yes |
| ∙ | U+2219 | **1** | N | ✅ yes |
| ▌ | U+258C | **1** | N | ✅ yes |
| ▐ | U+2590 | **1** | N | ✅ yes |
| ❯ | U+276F | **1** | N | ✅ yes |
| \| | U+007C | **1** | Na | ✅ yes |
| █ | U+2588 | **1** | A | ✅ yes (already in use) |
| ░ | U+2591 | **1** | **N** | ✅ yes (already in use) |
| ▒ | U+2592 | **1** | A | ✅ yes (already in use) |
| ▓ | U+2593 | **1** | A | ✅ yes (already in use) |
| ▁ | U+2581 | **1** | A | ✅ yes (already in use) |
| ▇ | U+2587 | **1** | A | ✅ yes (already in use) |
| · | U+00B7 | **1** | A | ✅ yes (already in use) |
| ■ | U+25A0 | **1** | A | ✅ yes (currently used) |
| ◼ | U+25FC | **1** | **N** | ✅ yes |
| ▪ | U+25AA | **1** | **N** | ✅ yes |
| → | U+2192 | **1** | A | ✅ yes (A-width noted) |
| ↑ | U+2191 | **1** | A | ✅ yes (A-width noted) |
| ↓ | U+2193 | **1** | A | ✅ yes (A-width noted) |
| ⚑ | U+2691 | **1** | N | ✅ yes — and stays 1 *with* VS16 |
| ⚑️ | U+2691+FE0F | **1** | N | ✅ yes — no emoji-presentation form exists |
| ⌛ | U+231B | 2 | W | ❌ no |
| ❓ | U+2753 | 2 | W | ❌ no |
| 💾 | U+1F4BE | 2 | W | ❌ no — heading only |
| 📊 | U+1F4CA | 2 | W | ❌ no |
| ⬛ | U+2B1B | 2 | W | ❌ no — a plausible-looking trap |
| ⬜ | U+2B1C | 2 | W | ❌ no — same trap |
| nf-fa-dollar | U+F155 | **1** | — | ✅ nerd only |
| nf-fae-coins | U+E26B | **1** | — | ✅ nerd only |
| nf-fa-tasks | U+F0AE | **1** | — | ✅ nerd only |
| nf-fa-clock_o | U+F017 | **1** | — | ✅ nerd only |
| nf-cod-chip | U+EC19 | **1** | — | ✅ nerd only |
| nf-md-server | U+F048B | **1** | — | ✅ nerd only |
| nf-fa-wrench | U+F0AD | **1** | — | ✅ nerd only |
| nf-fa-folder_open_o | U+F115 | **1** | — | ✅ nerd only |
| nf-fa-times | U+F00D | **1** | — | ✅ nerd only |
| nf-fa-calendar | U+F073 | **1** | — | ✅ nerd only |
| nf-md-trending_up | U+F0535 | **1** | — | ✅ nerd only |
| nf-md-trending_down | U+F0533 | **1** | — | ✅ nerd only |
| nf-md-trending_neutral | U+F0534 | **1** | — | ✅ nerd only |
| nf-fa-circle_question | U+F059 | **1** | — | ✅ nerd only |
| nf-md-cached | U+F00E8 | **1** | — | ✅ nerd only |
| nf-fa-warning | U+F071 | **1** | — | ✅ nerd only |
| nf-fa-caret_down | U+F0D7 | **1** | — | ✅ nerd only |
| nf-fa-caret_up | U+F0D8 | **1** | — | ✅ nerd only |
| nf-fa-laptop (omp) | U+F109 | **1** | — | ✅ nerd only |
| nf-fa-database (omp) | U+F1C0 | **1** | — | ✅ nerd only |
| nf-fa-bar_chart (omp) | U+F080 | **1** | — | ✅ nerd only |
| nf-fa-exclamation (omp) | U+F12A | **1** | — | ✅ nerd only |
| nf-md-history (omp) | U+F02DA | **1** | — | ✅ nerd only |

**Zero PUA codepoints appear in any `unicode` or `ascii` cell of any table above.** That is the
rule that matters most, because omp presets are user-selected and never probed — a hardcoded
U+Fxxx outside the `nerd` table is a tofu box, not a wrong glyph.

### Three traps that would actually bite

1. **`⬛` U+2B1B and `⬜` U+2B1C measure 2.** They look exactly like "the emoji version of ■/□"
   and are the obvious pick for a heatmap if you go looking in the emoji ranges. Both are
   `EAW=W`, both w=2. Never in a cell.
2. **`🛠` vs `🛠️`.** Bare U+1F6E0 is w=1; adding VS16 makes it 2. omp's `icon.extensionTool`
   already uses the bare form. Same class of trap as `⚠️`.
3. **`⌛` U+231B (hourglass) is w=2**, so it cannot replace `⏱` U+23F1 (w=1) in a column. If a
   second time glyph is ever needed for a heading, `⌛` is fine there.

---

## The heatmap cell question

**Answer: use U+2588 FULL BLOCK `█` for the filled cell, not U+25A0 `■`.**
Everything else in the candidate set is either the same width story or too few levels.

### The candidates

| Candidate | Cp | w | EAW | Levels available | Ink coverage |
|---|---|---|---|---|---|
| `■` BLACK SQUARE | U+25A0 | 1 | **A** | as a ramp: 2 (`■`/`□`) | ~60% of cell |
| `▪` BLACK SMALL SQUARE | U+25AA | 1 | **N** | as a ramp: 2 (`▪`/`▫`) | ~35% of cell |
| `◼` BLACK MEDIUM SQUARE | U+25FC | 1 | **N** | as a ramp: 2 (`◼`/`◻`) | ~55% of cell |
| `█` FULL BLOCK | U+2588 | 1 | **A** | as a ramp: 4 with `░▒▓` | **100% of cell** |
| `░▒▓` shades | U+2591/2/3 | 1 | **N**/**A**/**A** | 3 dither levels + `█` = 4 | dithered |

### The argument

**Width does not break the tie, so stop trying to use it.** Both `■` U+25A0 and `█` U+2588 are
`East_Asian_Width=A` and both measure w=1. `▪` U+25AA and `◼` U+25FC are `N`, so if CJK-locale
safety were the only criterion `◼` would win outright. But the heatmap is a dense 7-column ×
N-row grid where every cell abuts its neighbours — this is precisely the layout where the
ambiguity rule bites hardest and where `▪`/`◼` then *still* have a second problem: a glyph with
40–60% ink coverage leaves a visible gutter on all four sides, so a 7×N grid of `■` reads as 7×N
scattered dots rather than a continuous field. The gutters destroy the thing a heatmap is for.

**`█` is full-bleed.** It tiles edge to edge with zero gutter. Adjacent cells of equal or
similar value merge into one region; a genuine level change shows as a colour step, not as a
gap. That is the correct read for a calendar heatmap.

**Truecolor makes the glyph's *shape* irrelevant and its *coverage* everything.** In a
truecolor terminal the magnitude is carried by `ESC[38;2;R;G;B m` on the foreground. Once colour
does the encoding, the glyph's only job is to be a 1-cell, full-area stencil. `█` is that
stencil. `■` adds nothing (it is smaller) and costs a gutter. The established practice matches
this: the standard terminal contribution heatmap emits `\x1b[38;2;R;G;Bm█\x1b[39m` per cell,
one `█` per day, colour-only encoding.

**Monochrome fallback is the decisive argument, and it is the one that makes `■` untenable.**
The panel already refuses to probe the terminal (omp's presets are user-selected, never
detected — F8). So the heatmap cannot ask "is this truecolor?" and branch. It must pick **one
glyph set that works in both modes without detection**. Only `█` does:

- **Truecolor mode:** always emit `█` and tint the foreground by bucket, so every cell is the
  same glyph and the grid is perfectly rectangular. The colour carries the level.
- **Monochrome mode:** the same renderer, with the foreground ignored, falls back to the bucket
  *glyph* — `·` U+00B7 for empty, `░` U+2591, `▒` U+2592, `▓` U+2593, `█` U+2588 for the top
  bucket. Four levels, monotonic, no detection.

The rule is: **`█` is both the truecolor carrier and the top of the monochrome ramp.** One
codepoint, two modes, zero capability detection — which is exactly the constraint omp imposes.

A `■`-based scheme cannot do this. `■` has no intermediate, so a monochrome fallback would
degrade to a binary filled/unfilled grid — two levels where the shade ramp gives four. To keep
four levels in monochrome you would need the shade ramp anyway, and then `■` is not in it.

**Where `■` is not wrong.** If the heatmap is ever *binary* — present/absent, hit/miss — `■`
U+25A0 with `·` U+00B7 empty is a perfectly good two-state flag, and it is what the panel
already does. The recommendation is scoped: **multi-level heatmap → `█`; binary flag → keep
`■`.** Do not "upgrade" the binary flag; `■` is the lighter, less shouty glyph for a yes/no
bit, and the two roles should not look alike.

**Rejected specifically:**

- `▪` U+25AA — `N` and safe, but 2 levels and ~35% ink. A heatmap with gutters and no middle.
- `◼` U+25FC — `N` and safe, and the best *fallback* if someone later decides the A-width of
  `█` is unacceptable; still has gutters and still only 2 levels.
- `■` U+25A0 — right answer for a binary flag, wrong answer for a ramp.
- Braille `⣿`-family U+28FF — rejected project-wide (a 2×4 raster, one colour per cell; the
  whole reason to use a heatmap is multiple colours per cell).

### Concrete recommendation

```
unicode/nerd, truecolor:   ESC[38;2;R;G;Bm█ESC[39m   for every non-empty day
unicode,  monochrome:      ·  ░  ▒  ▓  █   by bucket, empty day = ·
ascii:                     .  :  -  =  #   by bucket, empty day = (space)
```

`ascii` needs its own ramp regardless — the shade characters are not ascii — and `.`/`:`/`-`/`=`/`#`
is the honest degradation. Pick it once, at the same place the preset is picked, not by probing.

---

## What established tools do

All of the following was read out of source, not from documentation or screenshots.

**btop** (`aristocratos/btop`, `src/btop_draw.cpp`)
- `Symbols::meter = "■"` (U+25A0) — used as a *meter* glyph, not as a data cell. Line 85.
- Direction constants: `up = "↑"`, `down = "↓"`, `left = "←"`, `right = "→"`, `enter = "↵"`
  (lines 78–82). Plain `↑↓`, not `⬆⬇`.
- **Trend markers are `▲` U+25B2 / `▼` U+25BC.** Used for network up/down rate: line 1422
  `(disk.io_write.back() > 0 ? "▼" : "") + (disk.io_read.back() > 0 ? "▲" : "")`, and line 1579
  `(dir == "upload" ? "▲" : "▼")`. Battery: line 773–775 maps `charging → ▲`,
  `discharging → ▼`, `full → ■`.
- Three selectable graph ramps in `graph_symbols` (lines 89–110+): `braille_up`/`braille_down`
  (U+2800 block, 17 levels), `block_up`/`block_down` (quadrant + half blocks `▗▖▄▐▌▙█`),
  and a `tty` mode built from `░` U+2591, `▒` U+2592, `█` U+2588.
- `README.md` documents `graph_symbol = "block"` / `"tty"` as the escape hatch when the font
  cannot render braille. That is a *user*-set option — consistent with omp's no-probing stance.

**k9s** (`derailed/k9s`, `internal/tchart/`)
- **`sparkline.go` is the eighth-block ramp, exactly ours**: the file contains precisely
  U+2581, 2582, 2583, 2584, 2585, 2586, 2587, 2588 and nothing else non-ASCII.
- `gauge.go`: `printDelta` writes `'↓'` for a decrease and `'↑'` for an increase at
  `o.X-1, o.Y+1` — the delta arrow sits *beside* the number, one column to its left, exactly the
  data-cell-adjacent placement this document is worried about. Plain arrows, w=1.
- `gauge.go` also uses `⠔` U+2814 (braille) as a separator between the OK and fault readouts —
  a braille glyph used as *chrome*, not as data ink. Illustrates that a project can accept
  braille in the chrome layer while keeping data on blocks.
- `dot_matrix.go` uses `▤` U+25A4 and `▥` U+25A5 (square-with-fill) and `⠂` U+2802.

**visidata** (`saulpw/visidata`, default branch `develop`)
- **`features/colorsheet.py` is the single most useful data point in this document.** Its colour
  swatch is built as `f'█▌{fg:3}▐█'` — full block `█` U+2588, **left half block `▌` U+258C**,
  the colour index, **right half block `▐` U+2590**, full block `█`. Two adjacent half-blocks in
  different foreground colours render as one apparent cell of blended colour.
- This confirms half-blocks are the standard 1-cell "partial fill" ink (they are `EAW=N`, w=1),
  and it confirms `█` as the full-area cell — visidata reaches for the full block, not a square,
  whenever it wants the cell to read as solid colour.

**gping** (`orf/gping`)
- No characters of its own: it delegates to `tui::widgets::Chart`. `gping/src/plot_data.rs`
  selects `symbols::Marker::Braille` by default and `symbols::Marker::Dot` when
  `plot.simple_graphics` is set. Its graph is a *continuous line*, which is a different data
  shape from a sparkline — it has no reason to quantise to eighth blocks. `main.rs` carries the
  comment "Uses dot characters instead of braille".

**bottom** (`ClementTsang/bottom`)
- Contains essentially no data glyphs of its own. The only non-ASCII character found in
  `src/canvas/widgets/*.rs` was `─` U+2500 used as an axis rule. Graphs are Ratatui widgets.
  Useful as the counter-example: bottom is a full-featured monitor that ships **no** sparkline
  character ramp at all, because eighth blocks are not required to draw a graph.

**lazysql** (`jorgerojas26/lazysql`, default branch `main`)
- Effectively ASCII-only. Scanning `app/theme.go`, `app/theme_presets.go`,
  `components/constants.go`, `components/pagination.go` for every non-ASCII codepoint turned up
  exactly one: `…` U+2026 HORIZONTAL ELLIPSIS, in the literal `" [Counting…] [# cancel]"`.
- Worth recording as evidence: a dense, popular TUI chose text labels over glyphs. It is the
  strongest available argument that a heading's *label* carries the meaning and the icon is
  decoration — so when an icon's glyph is genuinely uncertain, a text label is a legitimate,
  precedented answer rather than a failure.

**bandwhich** (`imsnif/bandwhich`)
- Also near-ASCII. The single non-ASCII codepoint across `src/display/components/*.rs` was
  `💢` U+1F4A2 ANGER SYMBOL, in a comment in `table.rs`. Bandwidth bars are drawn with plain
  `#` and spaces.

**gitui — UNVERIFIED.** The repository `extrawurst/rust-gitui` no longer resolves; the project
now lives at **`gitui-org/gitui`**, default branch `master`. The current tree contains
`src/components/`, `src/keys/`, `src/popups/`, `src/tabs/`, `src/ui/` and no `icons.rs` or
`theme.rs` — the icon and theme modules are not present at the paths the older documentation
references. Code search for `ICON_DIR`, `icons::` and `Icon` returned nothing. **I could not
verify what characters gitui uses and am not going to guess.** If gitui's icon set matters,
someone needs to locate the current module first.

---

## Rejected

**Emoji in data cells — the hard rule.** Every one of these measures 2 and is forbidden in any
repeated cell, no matter how good the semantics are: 💲 U+1F4B2, 🪙 U+1FA99, 📁 U+1F4C1,
💾 U+1F4BE, 📊 U+1F4CA, 📅 U+1F4C5, 💹 U+1F4B9, 🚀 U+1F680, ❓ U+2753, ⌛ U+231B, ⚡ U+26A1,
🔧 U+1F527. And the two that look like data ink but are not: **⬛ U+2B1B and ⬜ U+2B1C, both
w=2** — searching the emoji ranges for a "black square" lands on these before U+25A0.

**Variation selector U+FE0F.** `⚠️` (U+26A0 + VS16) = **2**; bare `⚠` = **1**. `🛠️` = 2; bare
`🛠` = 1. `❤️` = 2. The rule is to emit the base codepoint alone. Confirmed exception: `⚑️`
(U+2691 + VS16) stays 1 because U+2691 is already `N` with no emoji-presentation form — but do
not generalise from that.

**Braille U+2800–U+28FF.** Rejected for data ink project-wide. A braille cell is a 2×4 raster
with **one** colour per cell, so it cannot encode a multi-colour heatmap at all, and it
misaligns any grid that also contains non-braille cells. Both btop and k9s use it, and both
therefore also offer a non-braille mode. btop makes the user pick; omp's preset system picks for
them, so braille can never be the default.

**East_Asian_Width=Ambiguous.** Box drawing U+2500–U+257F is the classic offender and is already
managed (F8 accepts it where omp's box drawing needs it). The avoidable cases found here, each
with a free `N` replacement of identical appearance:
- `↑↓→` (U+2191/2193/2192, A) → `⬆⬇` U+2B06/2B07 (N) and `▬` U+25AC (N)
- `▲▼` (U+25B2/25BC, A) → `▴▾` U+25B4/25BE (N)
- `·` U+00B7 (A) → `∙` U+2219 (N), for tick separators
- `■` U+25A0 (A) → `◼` U+25FC (N), *if* a narrow square is ever wanted
Not all A-width is worth escaping: `█` U+2588 and the eighth blocks U+2581–2588 are all `A` and
are already committed as data ink with no narrower alternative that tiles. Escaping A-width
where there is a free equivalent is worth it; escaping it by abandoning the block family is not.

**PUA outside `nerd`.** U+E000–U+F8FF and Material U+F0001+ are only rendered under the `nerd`
preset. Since omp presets are user-selected and never probed, emitting a PUA codepoint from the
data layer produces tofu for anyone on `unicode` or `ascii`. Every PUA codepoint in this document
appears in a `nerd` column and nowhere else. Per F8: a new Nerd-only icon means adding a
`SymbolKey` to all three preset tables, never a branch in our code.

**`sep.pipe`.** 3 cells under `unicode`, 1 under `nerd` — width changes across presets, which
alone disqualifies it from any fixed-width role. Under `nerd` it resolves to U+E0B3, a
powerline *background* glyph meant to be painted, not printed. Same objection applies to
`sep.slash` (U+E0BB). Only `sep.dot` is safe across all three presets.

**Asking the terminal what it can do.** No `COLORTERM` probe, no terminfo lookup, no font
coverage query. The preset *is* the capability declaration. This is why the heatmap answer
above is `█` (works coloured and monochrome with the same renderer) rather than "probe, then
choose between two ramps".

---

## Sources

**Unicode / measurement**
- UCD `EastAsianWidth.txt`, version 16.0.0 — <https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt>
- Python `unicodedata` (UCD 16.0.0) for `unicodedata.name` and `unicodedata.east_asian_width`
- `Bun.stringWidth`, Bun 1.4.2, run locally over every candidate in this document
- Unicode Core Specification — <https://www.unicode.org/versions/Unicode17.0.0/UnicodeStandard-17.0.pdf>
- U+2580 Block Elements chart — <https://www.unicode.org/charts/PDF/U2580.pdf>

**Nerd Fonts**
- `ryanoasis/nerd-fonts` `glyphnames.json` — <https://github.com/ryanoasis/nerd-fonts/blob/master/glyphnames.json>
  (METADATA: version 3.5.1, date 2026-08-21; 10 995 glyph entries). Every `nf-*` name and
  codepoint in this document was resolved from this file, not from a cheat sheet or a search
  summary.
- Glyph Sets and Code Points wiki — <https://github.com/ryanoasis/nerd-fonts/wiki/Glyph-Sets-and-Code-Points>
- Cheat sheet — <https://www.nerdfonts.com/cheat-sheet>

**Tool source (read directly)**
- btop `src/btop_draw.cpp` — <https://github.com/aristocratos/btop/blob/main/src/btop_draw.cpp>
- btop `src/btop_shared.cpp` — <https://github.com/aristocratos/btop/blob/main/src/btop_shared.cpp>
- btop graph-symbol configuration — <https://github.com/aristocratos/btop>
- k9s `internal/tchart/sparkline.go`, `gauge.go`, `dot_matrix.go` — <https://github.com/derailed/k9s/tree/master/internal/tchart>
- visidata `visidata/features/colorsheet.py` — <https://github.com/saulpw/visidata/blob/develop/visidata/features/colorsheet.py>
- gping `gping/src/plot_data.rs`, `gping/src/main.rs` — <https://github.com/orf/gping>
- bottom `src/canvas/widgets/*.rs` — <https://github.com/ClementTsang/bottom>
- lazysql `app/theme*.go`, `components/*.go` — <https://github.com/jorgerojas26/lazysql>
- bandwhich `src/display/components/*.rs` — <https://github.com/imsnif/bandwhich>
- gitui (path unresolved; see above) — <https://github.com/gitui-org/gitui>

**Terminal capability**
- 24-bit foreground, SGR 38;2 — <https://www.terminfo.dev/sgr/38-2-truecolor-fg>
- hterm control sequences, bold/bright caveat — <https://github.com/cronvel/terminal-kit/blob/master/ext-doc/hterm-control-sequences-doc/hterm%20Control%20Sequences.html>

**Internal**
- F8-terminal-graphics.md, F10-glyph-system.md, F14-glyphs-and-icons.md (this project's prior
  glyph research; three codepoint *attributions* corrected above, no codepoint *values*)