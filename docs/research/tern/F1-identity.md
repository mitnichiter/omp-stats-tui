# F1 — Tern identity, surfaces, and omp relationship

## Angle

Identify "Tern" — a product the user just downloaded and is trying out with omp
(oh-my-pi / omp coding agent, terminal-based), reportedly with nice interfaces.
Find: what Tern is (vendor, official site, docs URL, current version), what its
interfaces/surfaces are, and exactly how omp relates to it
(does omp run inside Tern? any documented integration, plugin model, or protocol?).

## Claims

| # | Claim | Source URL | Fetch date | Confidence |
|---|-------|------------|------------|------------|
| 1 | Tern is a native terminal from Stencil (vendor: Stencil / Stencil Labs); official product page is https://stencil.so/tern | https://stencil.so/tern | 2026-10-04 | primary |
| 2 | Tern is a Rust-native, Kitty-compatible multiplexer/terminal; sessions persist in a daemon (`tern daemon`, `tern remote serve`) and survive window close/reboot | https://stencil.so/tern | 2026-10-04 | primary |
| 3 | Tern is in CLOSED BETA (no public version number published on the product page; waitlist-gated) | https://stencil.so/tern | 2026-10-04 | primary |
| 4 | Tern surfaces: shell/zsh panes, omp panes, browser panes; clients on Mac, iOS, and WebGPU browser tab sharing one live session; blocks beside the terminal: git, SQLite, Jupyter, kanban, task-manager, screen-sharing | https://stencil.so/tern | 2026-10-04 | primary |
| 5 | Tern Surface Protocol (TSP): programs describe UI as structured surface updates and Tern draws them natively (Mermaid, LaTeX/math, diffs, live pages); omp demo shows ANSI-vs-native rendering and TSP frame bytes | https://stencil.so/tern | 2026-10-04 | primary |
| 6 | omp runs inside Tern as a pane type (shell, omp, browser panes keep running in the daemon); Tern promo shows "Ask omp anything" prompt and omp drawing diagrams/diffs in Tern windows | https://stencil.so/tern | 2026-10-04 | primary |
| 7 | omp is "a coding agent with the IDE wired in", built by Stencil Labs, fork of Pi (mariozechner/pi-mono); repo github.com/can1357/oh-my-pi; omp.sh is the install site | https://github.com/can1357/oh-my-pi | 2026-10-04 | primary |
| 8 | omp latest release at fetch time: 18.6.0 dated 2026-10-03 (18.5.x same day; 18.4.x series ~2026-10-01/02) | https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md | 2026-10-04 | primary |
| 9 | omp↔Tern integration is documented in omp changelog: native Tern sheets/views for /usage-class surfaces (/changelog, /context, /jobs, /predict, MCP auth prompts), Tern transcript navigation (Esc-Esc rewind, turn/branch nav), progress/agent indicators, effort indicator with max-level fireball, status bar replaced by pane header/composer/turn summaries, attached images open in Tern image viewer, browser tabs as PiP over omp pane with Tern native web view (Chromium fallback) | https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md | 2026-10-04 | primary |
| 10 | omp probes for TSP: PI_TUI_NATIVE controls probing, PI_TUI_TSP_RECORD logs protocol messages; falls back to ANSI renderer when no TSP hello | secondary search summary citing unpkg/sourceforge mirrors of oh-my-pi dist | 2026-10-04 | secondary |
| 11 | omp `browser` tool has a Tern backend speaking Tern's protobuf session / JSON script protocol (level 12), with Chromium fallback; Tern older than supported reports unavailable | https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md | 2026-10-04 | primary |
| 12 | omp theming: a live Tern native surface forces the Nerd symbol preset process-locally and restores the user's preset when it closes; interactive Glyph Protocol handshake can upgrade unicode→Nerd icons | https://github.com/can1357/oh-my-pi/blob/main/docs/theme.md | 2026-10-04 | primary |
| 13 | "Tern" is ambiguous: tern.sh is a separate unrelated product (agent-session/PR review tool, `curl https://tern.sh/install | bash`, Claude Code/Codex/Cursor/Copilot hooks, "Tours" over PRs) — NOT the terminal the user downloaded | https://tern.sh/ | 2026-10-04 | primary |
| 14 | No standalone Tern docs URL or public changelog/version found: no docs link on stencil.so/tern page; web search for stencil.so Tern docs/changelog/version returned nothing usable | https://stencil.so/tern (absence) + web search 2026-10-04 | 2026-10-04 | primary (absence) |
| 15 | No omp plugin/extension-point model specific to Tern found in changelog/docs surveyed; Tern integration is first-party (built into omp releases), not a plugin API | https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md | 2026-10-04 | speculative |

## Searches

| # | Query | Purpose | Date | Result |
|---|-------|---------|------|--------|
| 1 | `Tern terminal coding agent product official site docs` | Identify Tern product/vendor/site | 2026-10-04 | Inconclusive: mostly unrelated Terns (tern.travel, termio, termany); no Stencil hit |
| 2 | `"Tern" omp OR "oh-my-pi" coding agent terminal integration` | Find omp↔Tern relation | 2026-10-04 | Hit: stencil.so/tern (Tern by Stencil, TSP, omp sessions/themes, closed beta) + tern.sh disambiguation |
| 3 | `site:stencil.so Tern Surface Protocol TSP omp` | Ground TSP claims | 2026-10-04 | Confirmed TSP description from stencil.so/tern only; single-source |
| 4 | `oh-my-pi omp changelog "Tern" native surface Glyph Protocol` | Ground changelog entries | 2026-10-04 | Hit: v18.4.3+ native Tern UI entries, browser PiP, TSP naming |
| 5 | `Stencil Tern terminal docs changelog version download "stencil.so" OR "docs" Tern Surface Protocol` | Find Tern docs/version | 2026-10-04 | Failed: returned Ionic Stencil, tern-lang, travel Tern — no Tern docs/version |
| 6 | `github can1357 oh-my-pi docs "Tern" terminal native sheet HUD` | Ground omp-side Tern docs | 2026-10-04 | Partial: TSP wire-contract mention via release mirrors; "sheet HUD" name unconfirmed; TSP added v18.4.4 (2026-09-29) per secondary summary |

## Conflicting evidence

- **Two products named "Tern"**: Stencil's Tern (native terminal, stencil.so/tern, closed beta) vs tern.sh (agent decision-review/PR tool). Only Stencil's Tern relates to omp-as-terminal-app. Source for both first-party pages; no conflict once disambiguated, but any bare "Tern" citation must name which one.
- **AI-search summaries assert TSP probe/env-var details** (PI_TUI_NATIVE, PI_TUI_TSP_RECORD, hello handshake) citing unpkg/sourceforge mirrors; these were not directly verified against the omp repo source in this pass — treated as secondary until confirmed in-repo.
- **"Glyph Protocol" vs "Tern Surface Protocol"**: omp theme.md mentions a "Glyph Protocol handshake" (glyph upgrade) alongside "live Tern native surface"; search summaries call the native-render protocol TSP. Whether these are the same protocol or two adjacent ones is unresolved.

## Gaps

1. Tern version number, docs URL, changelog, download/install path: not found on any primary source (closed beta, waitlist only). Re-check post-launch.
2. TSP wire spec: only marketing-level description on stencil.so/tern; no public protocol doc found. Check omp repo source (`packages/tui`, natives) for the client-side implementation.
3. Tern theming surface: stencil.so/tern says Tern "can use omp themes" per secondary summary; not verified on the product page text fetched. Confirm in Tern app or omp source.
4. Exact minimum Tern build for omp's browser/TSP backends (protobuf session level 12): changelog mentions it, but no Tern-side build mapping available.
5. Whether omp extension/plugin authors can target Tern native surfaces (custom TSP components): no evidence found; default assumption is no public API.
