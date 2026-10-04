# omp-stats-tui

Fullscreen local usage-stats panel for [omp](https://github.com/oh-my-pi/omp) — a TUI port of the `omp-stats` web dashboard, rendered terminal-natively inside your session.

Type `/stats-tui` and the terminal flips to an alternate-screen panel drawn from `~/.omp/stats.db` — same records as the browser dashboard (`/stats`), same figures through `@oh-my-pi/omp-stats`, no server, no SQL of our own. The transcript underneath stays untouched; dismiss and you're back where you were.

> [!NOTE]
> The built-in `/stats` launches a multi-screen browser app over the same records. `/stats-tui` is a different surface, not a replacement: terminal-native views, read-only, no port of the React components.

## Install

Prerequisites: [Bun](https://bun.sh) ≥ 1.4 and omp 18.4.x on `PATH`.

```sh
git clone <this-repo> && cd omp-stats-tui
bun install          # installs @oh-my-pi/omp-stats (84 ms, 12 packages)
omp plugin link .    # persistently link this directory as a plugin
```

> [!IMPORTANT]
> `bun install` is required, not optional. `@oh-my-pi/omp-stats` does not resolve bare from the extension loader (it is absent from the host's package allowlist), so the declared dependency plus a local install is how the import resolves. See `AGENTS.md` § Runtime & Tooling Constraints.

Verify the extension loads (fast feedback loop — loads extensions, prints load errors to stderr, no TUI, no LLM call):

```sh
omp models -e /abs/path/to/src/index.ts
```

> [!WARNING]
> `-e` must come **after** the subcommand. `omp -e … models` silently ignores the extension, and `omp --help` never loads extensions at all. Exit code is 0 either way — read stderr, not `$?`.

Other useful forms (all verified — see `AGENTS.md` § Development Commands):

```sh
omp plugin                 # list installed plugins
omp --profile <name> -e /abs/path/to/src/index.ts   # isolated auth/sessions while debugging
ls -t ~/.omp/logs/ | head  # extension error log
```

## Use

```
/stats-tui
```

In headless / print / RPC modes the command declines with `/stats-tui needs an interactive terminal` instead of hanging.

### Keys

Digits and `g`-jumps are aliases for the same screen. Digits select screens (not ranges — a digit cannot pick both).

| Key | Action |
|---|---|
| `1`–`8` | Jump to screen by position |
| `g` then letter | Jump to screen (`o` overview, `m` models, `c` costs, `a` activity, `r` requests, `e` errors, `l` tools, `j` projects). While armed, the next letter is consumed even on no match; a stale prefix (> 1200 ms) falls through |
| `←` / `→`, `Tab` / `Shift+Tab` | Previous / next screen (`Tab` always switches screens — there is no landmark-focus model to reserve it for) |
| `r` / `Shift+R` | Cycle range forward / back (`1h → 24h → 7d → 30d → 90d → all`, wraps) |
| `s` | Background sync (subprocess, SIGKILLed on close — never blocks the TUI) |
| `↑` / `↓`, `PgUp` / `PgDn`, `Home` / `End`, mouse wheel | Scroll |
| `q`, `Esc` | Close (dismisses the overlay, transcript untouched) |

Screens adapt to width: wide terminals get a grouped sidebar + full topbar, narrower ones an icon rail + condensed topbar, the narrowest brand + active range only.

## Screens

Eight selectable screens, same figures as the dashboard's routes (parity is machine-checked in `test/parity.test.ts`, not eyeballed):

| Screen | Shows |
|---|---|
| Overview | Cost, requests, tokens, cache rate, error rate + token/cost sparklines |
| Models | Per-model cost (bars scale by **cost**, never tokens), cache split, sparklines |
| Costs | Cost series, cache savings, unpriced-request counts beside every total |
| Activity | Contribution-style heatmap calendar, summary line, `· syncing…` state |
| Requests | Recent requests table |
| Errors | Error breakdown |
| Tools | Tool-call counts and shares |
| Projects | Per-folder usage |

Ranges: `1h | 24h | 7d | 30d | 90d | all` (default `24h`). There is deliberately no `365d` — the host resolves unknown ranges to its 24 h default silently, so a picker offering it would show a day of data with no error.

> [!CAUTION]
> A cost figure without its unpriced count beside it is a wrong number, not a rounded one. Requests with zero recorded cost and no catalog price card are **unpriced, not free** — every total we show is a floor, and the panel says so.

`providers` (needs network I/O) is deferred and `gain` persists as a scaffold; neither is selectable. The traces flamegraph is excluded by design — see ADR 0004.

## Develop

```sh
bun test                                              # 619 tests, 42 files — pure functions only
bun scripts/probe-render.ts [screenId] [--width N] [--range 24h] [--preset P]
bun scripts/probe-render.ts all --width 100 --width 60
omp models -e /abs/path/to/src/index.ts               # extension load check (stderr, not $?)
```

`probe-render` draws any screen (or `all`) to stdout at any width without launching a terminal — this is how a screen gets reviewed. `--range` accepts only the six valid keys; `--preset` one of `unicode | nerd | ascii` (a setting, never a detection). Other probes: `bun run scripts/probe-data.ts`, `bun run scripts/probe-glyphs.ts`.

## Architecture

The pipeline is `ScreenSpec → renderScreen → renderBands` over a small band grammar (`statRow`, `chart`, `table`, `legend`, `note`):

- `src/index.ts` — extension entry, registers `/stats-tui`, warms the DB at load (behind the loading state, never on the render loop)
- `src/data/api.ts` — the data seam: `fetchFor` fetches exactly what the screen declared, in-process via `handleApi`. No webserver, no own SQL (one marked narrow-query workaround — see the `WORKAROUND` block there)
- `src/data/ranges.ts` — the closed range set and bucket math, derived from the host's `rangeMeta`
- `src/layout/spec.ts` — the IR: `ScreenSpec`, `Band[]`, `MetricRef`
- `src/layout/resolve.ts` — `resolveCell` / `resolveNumber` / `resolveLabel`: where a ref meets data (unresolvable is `null`, never a blank cell)
- `src/tui/panel.ts` — `SELECTABLE_SCREENS`, the frame, the keymap
- `src/tui/band.ts` — `renderBands`, the G1–G6 grammar (G5: no full-width rule inside a band, ever)
- `src/tui/chrome.ts` — the one nav grammar: sidebar, topbar, live/sync chip, hotkeys
- `src/tui/responsive.ts` — `framePolicy(width)`: the width class and what chrome it affords
- `src/tui/charts/` — `bars`, `heatmap`, `sparkline`, `compose` (multi-series charts compose single-series renders — byte-identical, asserted)
- `src/tui/screens/` — one module per screen; spec'd screens carry identity and defer `render` to the pipeline
- `src/sync/`, `scripts/sync-worker.ts` — background ingest subprocess

Pointers for contributors and agents:

- **`AGENTS.md`** — repository guidelines: settled design, measured latencies, key directories, conventions, dead ends. Read it before touching code.
- **`CONTEXT.md`** — the glossary. Vocabulary is load-bearing here (`request` not message, `bucket` not granularity, `band`, `MetricRef`, `parity`, `data ink`…).
- **`docs/adr/`** — six settled decisions: reuse `@oh-my-pi/omp-stats` (0001), the `/stats-tui` name (0002), read-only panel (0003, amended by 0006), terminal-native rendering over a React port (0004), hardcoded Unicode data ink (0005), background-ingest subprocess (0006).
- **`docs/research/omp-stats-tui/REPORT.md`** (+ `findings/` F1–F11) — the investigation synthesis behind the design.

> [!TIP]
> Screens render through the IR: to change a screen, add `Band[]` to its spec — never rows to a screen module. Band order is panel order.
