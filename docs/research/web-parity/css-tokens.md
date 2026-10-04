# CSS tokens — the web dashboard's design system, extracted

**Source of truth:** `~/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/client/styles.css` (1834 lines).
**How produced:** every `--*` declaration was read out of `styles.css` with line numbers, then the values used in this
table were **confirmed against the live DOM** via `getComputedStyle` on the running dashboard at `1200px`, dark theme.
Where the two disagree, the computed value wins and the CSS line is still cited as the declaration site.

**Who this is for:** a terminal implementer. A terminal has no alpha compositing, no blur and no subpixel, so a token
that only exists to blend is either a colour you cannot reproduce or a value you must hard-pick. The "Terminal" column
names what omp's own `/usage` and `/settings` overlays already use, so the panel inherits a palette that matches
`detectColorMode()`'s `truecolor` / `256color` modes rather than inventing a third one.

Terminal colour vocabulary referenced below:

| Terminal name | hex | Where it comes from |
|---|---|---|
| `ink-1` | `#ededef` | primary text |
| `ink-2` | `#a0a0a8` | secondary text |
| `ink-3` | `#6c6c74` | muted / dim |
| `ink-4` | `#46464c` | disabled, scrollbar thumb |
| `accent` | `#f068c8` | omp accent pink |
| `accent-a` | `#5ad8e6` | omp cyan (chart primary, focus) |
| `ok` / `warn` / `bad` | `#3ecf8e` / `#f5a524` / `#ff6166` | status |
| `chart-1`…`chart-10` | `SERIES_COLORS` | categorical series, `data/colors.ts:8-19` |

---

## 1. Surface ramp

Every step rises exactly one notch off the page. There is no border on the page; separation is done by *elevation*,
and hairline borders only appear ON a raised surface. A terminal must reproduce the RAMP (four steps of lightness),
not the hairlines.

| Token | Dark value | Line | Light value | Line | Terminal equivalent |
|---|---|---|---|---|---|
| `--bg` | `#000` | `styles.css:12` | `#f2f2f3` | `styles.css:66` | panel background — pure black, never a grey |
| `--panel` | `#09090a` | `styles.css:13` | `#ffffff` | `styles.css:67` | the inset content panel's own background |
| `--card` | `#0e0e10` | `styles.css:14` | `#ffffff` | `styles.css:68` | the surface every stat tile / table sits on |
| `--raised` | `#17171a` | `styles.css:15` | `#f6f6f7` | `styles.css:69` | badge / delta pill fill, un-toned chips |
| `--overlay` | `rgba(14,14,16,0.78)` | `styles.css:16` | `rgba(255,255,255,0.8)` | `styles.css:70` | floating surfaces (tooltip, drawer). No terminal analogue: draw it solid. |
| `--hover` | `rgba(255,255,255,0.035)` | `styles.css:17` | `rgba(0,0,0,0.03)` | `styles.css:71` | row hover — terminal equivalent is a reverse-video row, not a tint |
| `--press` | `rgba(255,255,255,0.06)` | `styles.css:18` | `rgba(0,0,0,0.05)` | `styles.css:72` | transient press |
| `--selected` | `rgba(255,255,255,0.075)` | `styles.css:19` | `rgba(0,0,0,0.06)` | `styles.css:73` | selected table row / active nav row |

**Live confirmation:** `body` background computed to `rgb(0,0,0)`, and `.card` background's inner gradient layer
computed to `rgb(14,14,16)` — i.e. `--card`, confirming `--card` is what a card actually paints, not `--panel`.

**Load-bearing number:** the three dark surfaces differ by **#09090a and #0e0e10 — 5 and 14 steps above black**. A
terminal cannot show a 5/255 difference. So: **one surface step only.** Cards are drawn as a labelled region (a rule or
an indent), never as a different background colour. The separation a reader feels in the web comes from the hairline,
not the fill.

## 2. Hairlines (lines)

Alpha so one value reads on every surface step. **This is the mechanism a terminal must actually use for separation**,
because it is the only one that survives a 4-colour terminal.

| Token | Dark value | Line | Light value | Line | Terminal equivalent |
|---|---|---|---|---|---|
| `--line-1` | `rgba(255,255,255,0.06)` | `styles.css:22` | `rgba(0,0,0,0.06)` | `styles.css:75` | the row rule; also card borders, meter track |
| `--line-2` | `rgba(255,255,255,0.09)` | `styles.css:23` | `rgba(0,0,0,0.09)` | `styles.css:76` | button border, tooltip border |
| `--line-3` | `rgba(255,255,255,0.14)` | `styles.css:24` | `rgba(0,0,0,0.14)` | `styles.css:77` | card top-lit edge start, chart baseline |
| `--line-4` | `rgba(255,255,255,0.22)` | `styles.css:25` | `rgba(0,0,0,0.22)` | `styles.css:78` | strongest divider |

**Load-bearing number:** four hairline weights at **0.06 / 0.09 / 0.14 / 0.22 alpha** — a geometric-ish ladder
(≈1.5× each step). Over `#0e0e10` these composite to roughly `#1f1f21`, `#2a2a2c`, `#3a3a3c`, `#4e4e50`. A terminal
should use exactly two: **`dim` (`ink-3`) for ordinary row rules**, and bold/`ink-4` for the card's top edge.

## 3. Ink

Four-step ink ramp, then inverse. `ink-3` is the workhorse: card descriptions, `.stat-foot`, `th`, `.cell-secondary`
and `.empty-hint` **all** use it.

| Token | Dark value | Line | Light value | Line | Terminal equivalent |
|---|---|---|---|---|---|
| `--ink-1` | `#ededef` | `styles.css:27` | `#151518` | `styles.css:80` | `ink-1` — values, primary text |
| `--ink-2` | `#a0a0a8` | `styles.css:28` | `#5a5a63` | `styles.css:81` | `ink-2` — stat labels, legends, muted secondary |
| `--ink-3` | `#6c6c74` | `styles.css:29` | `#8b8b94` | `styles.css:82` | `ink-3` — footers, table headers, `micro` |
| `--ink-4` | `#46464c` | `styles.css:30` | `#b9b9c0` | `styles.css:83` | `ink-4` — disabled, `/` in brand, placeholder |
| `--ink-inverse` | `#0a0a0b` | `styles.css:31` | `#ffffff` | `styles.css:84` | text on a filled accent chip |

**Live confirmation:** `body` color `rgb(237,237,239)` = `#ededef`; `.stat-value` `rgb(237,237,239)`; `.stat-label`
`rgb(160,160,168)` = `#a0a0a8`; `.stat-foot` `rgb(108,108,116)` = `#6c6c74`; `.table th` `rgb(108,108,116)` = `#6c6c74`.

**Load-bearing number:** **label is `ink-2`, foot/header is `ink-3`, value is `ink-1`.** A terminal that draws every
stat's label in the same ink as its value has thrown away the entire three-level hierarchy. This is the single most
commonly lost proportion in a terminal port.

## 4. Accent

Solid `--accent` for text and strokes; the gradient is reserved for hero marks.

| Token | Dark value | Line | Light value | Line | Terminal equivalent |
|---|---|---|---|---|---|
| `--accent-a` | `#5ad8e6` | `styles.css:34` | `#1fa9bb` | `styles.css:86` | `chart-1` cyan — **default chart primary, meter fill, focus ring** |
| `--accent-b` | `#ed4abf` | `styles.css:35` | `#d42ea3` | `styles.css:87` | `chart-2` pink |
| `--accent` | `#f068c8` | `styles.css:36` | `#c42596` | `styles.css:88` | the **active nav item's icon and text accent** |
| `--accent-soft` | `rgba(237,74,191,0.14)` | `styles.css:37` | `rgba(212,46,163,0.1)` | `styles.css:89` | accent badge fill |
| `--accent-line` | `rgba(237,74,191,0.35)` | `styles.css:38` | `rgba(212,46,163,0.3)` | `styles.css:90` | accent divider |
| `--accent-gradient` | `linear-gradient(100deg, var(--accent-a), var(--accent-b))` | `styles.css:39` | *(not redefined; inherits dark)* | — | **no terminal analogue** — pick one hue per element |
| `--focus` | `#5ad8e6` | `styles.css:40` | `#1fa9bb` | `styles.css:91` | keyboard focus ring — the panel's focus colour |

**Load-bearing number:** `--accent` `#f068c8` is *between* `--accent-a` (cyan) and `--accent-b` (pink) in hue. It is a
distinct third colour and it is used for exactly two things: **the active sidebar item's icon** and the **value flash**
animation. A terminal must not use it as "the chart colour".

## 5. Status

`--live` is deliberately identical to `--ok` and is reserved for the live-sync dot.

| Token | Dark value | Line | Light value | Line | Terminal equivalent |
|---|---|---|---|---|---|
| `--ok` | `#3ecf8e` | `styles.css:43` | `#12a36b` | `styles.css:93` | `ok` — success, `delta[data-tone=good]`, `badge[data-tone=ok]` |
| `--ok-soft` | `rgba(62,207,142,0.13)` | `styles.css:44` | `rgba(18,163,107,0.11)` | `styles.css:94` | soft fill behind an ok pill |
| `--warn` | `#f5a524` | `styles.css:45` | `#c77c02` | `styles.css:95` | `warn` |
| `--warn-soft` | `rgba(245,165,36,0.13)` | `styles.css:46` | `rgba(199,124,2,0.11)` | `styles.css:96` | soft fill behind a warn pill |
| `--bad` | `#ff6166` | `styles.css:47` | `#dc3a40` | `styles.css:97` | `bad` — failures, error messages, the error-rate sparkline |
| `--bad-soft` | `rgba(255,97,102,0.13)` | `styles.css:48` | `rgba(220,58,64,0.1)` | `styles.css:98` | soft fill behind a bad pill |
| `--live` | `#3ecf8e` | `styles.css:49` | `#12a36b` | `styles.css:99` | the pulsing "syncing" dot only |

## 6. Chart

| Token | Dark value | Line | Light value | Line | Terminal equivalent |
|---|---|---|---|---|---|
| `--chart-grid` | `rgba(255,255,255,0.055)` | `styles.css:52` | `rgba(0,0,0,0.06)` | `styles.css:101` | horizontal gridline stroke |
| `--chart-axis` | `#5c5c64` | `styles.css:53` | `#9a9aa2` | `styles.css:102` | axis tick label ink — **dimmer than `ink-3`** (`#6c6c74`) |
| `--chart-cursor` | `rgba(255,255,255,0.05)` | `styles.css:54` | `rgba(0,0,0,0.04)` | `styles.css:103` | hover column highlight |
| `--chart-primary` | `#5ad8e6` | `styles.css:55` | `#1fa9bb` | `styles.css:104` | **default single-series bar/sparkline/meter colour** |
| `--chart-secondary` | `#ed4abf` | `styles.css:56` | `#d42ea3` | `styles.css:105` | **the cost-coloured series** — every cost sparkline, cost meter and cost bar-list |

**Load-bearing number:** `--chart-secondary` is what the web uses for **money**, every time. `data/colors.ts` does not
include it — the categorical `SERIES_COLORS` starts cyan/pink and the pink doubles as "cost". Verified in source:
`sparkColor="var(--chart-secondary)"` on the cost stat at `OverviewRoute.tsx:114`, `CostsRoute.tsx:253`,
`ProvidersRoute.tsx:178`; `color="var(--chart-secondary)"` on the cost BarList at `ProjectsRoute.tsx:133` and the cost
MeterCell at `ProjectsRoute.tsx:255`.

## 7. Categorical series palette (not a CSS token — a TS constant)

`data/colors.ts:8-19`, ten hues, assigned **by descending weight**, ties broken by key, so a series' colour is
determined by its RANK and is stable across every chart on a page (`data/colors.ts:42-45`).

| Index | Hex | Name | `--ink` equivalent in a terminal |
|---|---|---|---|
| 0 | `#5ad8e6` | cyan | `chart-1` |
| 1 | `#ed4abf` | pink | `chart-2` |
| 2 | `#9d7bff` | violet | `chart-3` |
| 3 | `#f5b54a` | amber | `chart-4` |
| 4 | `#4ade80` | green | `chart-5` |
| 5 | `#5b8cff` | blue | `chart-6` |
| 6 | `#ff7a59` | coral | `chart-7` |
| 7 | `#2dd4bf` | teal | `chart-8` |
| 8 | `#c3e94f` | lime | `chart-9` |
| 9 | `#fb7185` | rose | `chart-10` |
| — | `#6c6c74` | `OTHER_COLOR`, "Other" rollups and unknown buckets | `ink-3` (`data/colors.ts:22`) |

**Terminal constraint that must be stated:** in `256color` mode a terminal has 256 entries and omp's own
`detectColorMode()` returns `"truecolor" | "256color"` — never 16. Ten hues plus five status inks plus four surface
inks is ~19 distinct colours, which is inside 256 but past anything a reader distinguishes reliably. **When a screen
would need more than 6 series, fold to `Other (n)` in `ink-3`** — the web already does exactly this at
`ErrorsRoute.tsx:211` (`.slice(0, 12)`), `ProvidersRoute.tsx` (`TOP_PROVIDERS`) and `ToolsRoute.tsx` (`TOP_TOOLS = 6`).

## 8. Radius

| Token | Value | Line | Terminal equivalent |
|---|---|---|---|
| `--r-chip` | `6px` | `styles.css:116` | n/a — no rounded chips in a terminal |
| `--r-control` | `8px` | `styles.css:117` | n/a — controls are glyphs |
| `--r-card` | `12px` | `styles.css:118` | n/a — a card is a rule + an indent, not a rounded box |
| `--r-panel` | `16px` | `styles.css:119` | n/a |
| `--r-pill` | `999px` | `styles.css:120` | a bracket pair `[ ok ]` or a single reverse-video run |

**Load-bearing:** the radius ladder is **6 / 8 / 12 / 16 / 999** — a card is 12, a pill is fully round. In a terminal
the only radius that survives is **the pill**, and its equivalent is enclosure: `[` … `]`. A badge's *width* (see
`layout-rules.md`) is what conveys the pill; a badge never occupies a full terminal cell.

## 9. Spacing — there are no spacing tokens

**This is a finding, not an omission.** `styles.css` defines **no** `--space-*` / `--gap-*` custom properties. Every
gap in the design system is a hardcoded literal, and the literals form a short, consistent set:

| Value | Where it is used | Citation |
|---|---|---|
| `2px` | `.card-titles` gap, `.legend` row-gap, `.bar-list` gap, `.bar-list-fill` inset, `.stat-spark` margin-top | `styles.css:767`, `1735`, `1787`, `1809-1810`, `877` |
| `4px` | `.page-description` margin-top, `.stack` gap, `.share-bar` gap, `.stat-spark` margin-top | `styles.css:686`, `734`, `1773`, `877` |
| `6px` | `.stat` gap (label→value→foot), `.stat-label` gap, `.card-actions` gap, `.table-mic`, `.chart-tooltip-row` gap | `styles.css:832`, `845`, `787`, `1707` |
| `8px` | `.page-header` gap, `.page-actions` gap, `.stat-foot` gap, `.btn` padding-x | `styles.css:673`, `694`, `870`, `913` |
| `10px` | `.table-more` padding, `.sidebar-foot` padding, `.row` gap (`.meter-cell` gap), `.errors-detail` gap, `.share-bar` default height | `styles.css:1362`, `578`, `1397`, `36` (errors.css), `1770` |
| `12px` | `.card-header` gap, `.table th`/`td` padding-x, `.grid` gap, `.stack` gap override, `.btn` gap | `styles.css:758`, `1277`, `1314`, `701`, `912` |
| `14px` | `.card-body` padding-top, `.card-header` padding-top, `.error-state` padding, `.topbar-hide-narrow` | `styles.css:792`, `759`, `1438` |
| `16px` | `.grid` gap, `.card-body` padding-x, `td:first/last-child` padding-x, `.page` gap, `.topbar` padding | `styles.css:701`, `792`, `1286`, `666`, `409` |
| `18px` | `.card-body` padding-bottom | `styles.css:792` |
| `20px` | `.page` gap (between top-level sections) | `styles.css:666` |
| `22px` | `--gutter` at ≤1360px | `styles.css:124`, `616` |
| `26px` | `.shell-content` padding-top | `styles.css:600` |
| `28px` | `--gutter` default; chart `padLeft` floor | `styles.css:124`, `114` (Chart.tsx) |
| `48px` | `.shell-content` padding-bottom | `styles.css:600` |

**The one ratio that matters: `.page` gap is `20px` and `.grid` gap is `16px`.** A terminal cannot express either as
blank lines — but it CAN express the ratio: **one blank line between top-level sections, and a single leading indent
step between sibling cards inside one section.**

## 10. Duration and easing

| Token | Value | Line | Terminal analogue |
|---|---|---|---|
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | `styles.css:126` | none |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | `styles.css:127` | none |
| `--dur-1` | `120ms` | `styles.css:128` | **the panel's own settle time** |
| `--dur-2` | `200ms` | `styles.css:129` | — |
| `--dur-3` | `360ms` | `styles.css:130` | — |
| `--stagger` | `40ms` | `styles.css:131` | per-card entrance delay, `calc(var(--i, 0) * var(--stagger))` at `styles.css:374` |

**What to carry into the terminal:** durations are decorative here and have **no terminal analogue** — but the
*presence* of motion has one honest analogue, which is the `rise` entrance stagger (`styles.css:372-375`). A terminal
panel draws once, so this is a no-op. What must NOT be dropped is `prefers-reduced-motion` (`styles.css:381-389`),
which forces every duration to `1ms`. **A terminal that animates nothing satisfies it trivially.** State that in the
implementation and the requirement is met rather than ignored.

## 11. Shadows

| Token | Value | Line | Terminal analogue |
|---|---|---|---|
| `--shadow-1` | `0 1px 0 rgba(255,255,255,0.03) inset, 0 1px 2px rgba(0,0,0,0.5)` | `styles.css:58` | none — **but the `0 1px 0 rgba(255,255,255,0.03) inset` is the "top-lit hairline"**, which a terminal CAN and should render as a `─` rule |
| `--shadow-2` | `0 8px 24px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.05) inset` | `styles.css:59` | none |
| `--shadow-3` | `0 24px 64px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.06) inset` | `styles.css:60` | none |

## 12. Breakpoints

There are **four** `@media` queries in the whole design system, and **none of them is a content breakpoint** — they are
all chrome adjustments plus one grid collapse. This matters: the web never reorganises content on width, it only
re-flows.

| Breakpoint | What changes | Citation |
|---|---|---|
| `max-width: 1360px` | `--sidebar-w: 224px → 204px`, `--gutter: 28px → 22px` | `styles.css:613-618` |
| `max-width: 1100px` | `.grid-2`, `.grid-3`, `.grid-main-side` all collapse to `minmax(0, 1fr)` — i.e. **a two-up grid becomes a single column** | `styles.css:716-722` |
| `max-width: 1100px` | `.models-detail` collapses to one column, `padding-left` `44px → 16px` | `models.css:38-43` |
| `max-width: 900px` | `--gutter: 22px → 16px`; `.topbar-menu` appears; `.sidebar` becomes a 260px `translateX(-102%)` overlay drawer with blur; `.shell-panel` margin-left `→ 8px`; `.topbar-hide-narrow` (the LiveChip) hidden | `styles.css:620-658` |
| `prefers-reduced-motion: reduce` | all durations → `1ms`, all delays → `0ms` | `styles.css:381-389` |

**Live confirmation of the 1100px collapse:** at `1200px`, `.grid-main-side` computed to
`grid-template-columns: 617.328px 308.656px` — a **2fr : 1fr** split with the `16px` gap. The sidebar computed to
`204px` (confirming `max-width: 1360px` applies at 1200px) and `.topbar` to `52px`.

**The terminal's four widths (150/100/60/40) map onto these as:**

| Terminal width | CSS pixel width used for capture | Web state |
|---|---|---|
| 150 | 1200px | full desktop: sidebar docked, `grid-main-side` 2:1 |
| 100 | 800px | below the 1100px collapse → **all grids single-column**; above 900px → sidebar still docked |
| 60 | 480px | below 900px → sidebar becomes an overlay drawer, gutter 16px |
| 40 | 320px | same as 60; `.stat-grid` wraps to its minimum tile count |

So **at terminal width 100 the web's two-up cards are already stacked.** A terminal that keeps Activity next to
Token mix at 100 columns has *invented* a layout the web does not have. See `layout-rules.md` § 9.
