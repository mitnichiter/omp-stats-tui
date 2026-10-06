# HOLDING NOTE — docs-owner (2026-10-03, EOD)

**CLOSED — retained as a historical record, not as instructions.** The "do NOT apply yet" hold
was lifted when all four workstreams landed. Everything below was subsequently written into
`AGENTS.md`/`CONTEXT.md` or superseded by PR #1 (`c1396d3`); the "unreachable today" and
"uncommitted working tree" notes describe 2026-10-03 and no longer hold. Do not act on this file.

## Relay 1: responsive-frame (eb1f053 + 352f214)
- New `src/tui/responsive.ts`: framePolicy(width) deriving sidebar/topbar modes from layout.ts BREAKPOINTS — wide/medium/narrow/tiny bands.
- RENDER-OUTPUT section 12 captures at 40/60/100/120.
- Probable docs impact: CONTEXT.md layout-IR addition (`framePolicy`, band terms); AGENTS.md Key Dirs row for src/tui/responsive.ts + section-12 reference.
- Status: additive, no contradiction with band/ScreenSpec terms.

## Relay 2: usage-mirror-2 (divergence-11 handoff)
- Host heatmap strings to pin when per-need phase lands:
  - loading = dim `Loading usage history…` (U+2026, usage-dashboard.ts:831, activity null + no error)
  - error = dim `Usage history unavailable (${detail}).` / `...unavailable.` when empty (:828; detail via formatActivityErrorDetail sans ANSI/whitespace-collapse/home→~/trailing-dots :509-517)
  - syncing suffix = dim ` · syncing…` on summary line while sync loads (:847, ScreenRenderOptions.syncing threads it)
- Unreachable today: all-or-nothing panel, no activity-error channel (fetchFor throws → panel error phase). Sibling implements fetched-but-empty → host zero-filled grid only.
- Probable docs impact: CONTEXT.md loading-vs-error-vs-empty states; AGENTS.md convention + Do-Not (no invented strings).
- Status: additive future pin, no contradiction.

## Observed (from git log, NOT relayed — verify before using)
- Chrome/nav grammar landed: `src/tui/chrome.ts`, panel strip-as-drawer (883327a, b8f3f61, 95dfd07), probe-frame + section 13 (75335fe).
- Screens through IR: requests/errors/tools/overview/models/costs parity (3cf0c66, 0fa6f73, 28e2cf1, 470d02a, 3bc0cef, 195b3c9, 586f68b); `succeededRequests` computed exemption; models band-order legend drop.
- Data: providers/gain fetchers (bcd1b24), honest unpriced counts (d94de95).
- Heatmap fixes: summary line + syncing suffix (123037e), 4 ramp stops (eed3a6a), byte-for-byte grid (735bc89), weeks clamp (6f5984c), day gutters (22e668a), heatCell U+25A0 (1103ace).
- Sync lifecycle spec (bf12762).
- Uncommitted working tree (screens-A/B in flight): layout host-derived/resolve/spec, format, panel, render/screen, gain/providers screens, tabs, fixtures, layout-ir/panel/render-screen/requests/resolve/screens/tabs tests + new gain-screen test, F20/F23 research files.
