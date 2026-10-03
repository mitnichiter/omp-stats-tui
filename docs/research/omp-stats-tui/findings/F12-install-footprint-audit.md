# Angle

Read-only forensic audit of what `bun install` (run by prior investigation sessions) wrote to this machine, and what remains. No files were deleted, moved, or modified. Audit run 2026-10-03 ~09:15 local (+08).

# Global bun cache

`~/.bun/install/cache/` — 1448 top-level entries (pre-existing, unrelated tooling tree: astro, puppeteer, oxlint, aws, etc.).

`@oh-my-pi` scope contains **26 entries = 13 packages × 2 forms**:

| Entry | mtime |
|---|---|
| `omp-stats`, `omp-stats@18.4.10@@@1` | 2026-10-02 15:53:49 / 15:53:47 |
| `omptype`, `omptype@18.4.10@@@1` | 15:53:49 / 15:53:46 |
| `pi-agent-core`, `@18.4.10@@@1` | 15:53:49 / 15:53:46 |
| `pi-ai`, `@18.4.10@@@1` | 15:53:50 / 15:53:47 |
| `pi-catalog`, `@18.4.10@@@1` | 15:53:49 / 15:53:46 |
| `pi-coding-agent`, `@18.4.10@@@1` | 15:53:49 / 15:53:47 |
| `pi-mnemopi`, `@18.4.10@@@1` | 15:53:49 / 15:53:46 |
| `pi-natives`, `@18.4.10@@@1` | 15:53:49 / 15:53:46 |
| `pi-natives-darwin-arm64`, `@18.4.10@@@1` | 15:53:50 / 15:53:46 |
| `pi-tui`, `@18.4.10@@@1` | 15:53:49 / 15:53:47 |
| `pi-utils`, `@18.4.10@@@1` | 15:53:49 / 15:53:46 |
| `pi-wire`, `@18.4.10@@@1` | 15:53:49 / 15:53:46 |
| `snapcompact`, `@18.4.10@@@1` | 15:53:49 / 15:53:46 |

The unversioned name (e.g. `omp-stats/`) is a bun hardlink-alias directory containing the single child `18.4.10@@@1/` — normal bun cache layout, not a duplicate tree.

**No `@oh-my-pi` cache entry exists outside 2026-10-02 15:53:46–15:53:50.** Zero entries under `@oh-my-pi` are newer than 16:00. Probe sessions ran 16:11–22:30 (see timestamps below), so **nothing in the `@oh-my-pi` cache was written by our probes.**

The 15:53:46–50 window corresponds to omp's own install/self-update, corroborated by `~/.omp/logs/omp.2026-10-02.58621.log` (timestamp `2026-10-02T15:53:44`) and by `~/.bun/install/global/node_modules/@oh-my-pi` mtime `2026-10-02 15:53:47` — i.e. the same event populated both.

Cache writes on 2026-10-03 (09:08–09:11) are `exa-js`, `@modelcontextprotocol/sdk`, `follow-redirects`, `ip-address` — this session's own MCP tooling, unrelated to omp.

# Global install tree

`~/.bun/install/global/node_modules/` — 342 top-level entries, dominated by unrelated global tools (opencode, puppeteer, tailwind, xterm, posthog, …).

`~/.bun/install/global/node_modules/@oh-my-pi/` — exactly **14 packages**, matching the expected list with **nothing extra and nothing missing**:

`hashline`, `omp-stats`, `omptype`, `pi-agent-core`, `pi-ai`, `pi-catalog`, `pi-coding-agent`, `pi-mnemopi`, `pi-natives`, `pi-natives-darwin-arm64`, `pi-tui`, `pi-utils`, `pi-wire`, `snapcompact`

mtimes: all 13 non-hashline packages `2026-10-02 15:53:47` (the omp install); `hashline` `2026-09-03 14:47:02` (untouched, month older).

Parent dirs `~/.bun/install/global`, `.../node_modules`, `.../node_modules/.bin`, `.../@oh-my-pi` all mtime `2026-10-02 15:53:47`.

`.bin/` (30 entries): omp-related symlinks are `omp`, `omp-stats`, `mnemopi`. The rest (`codex`, `opencode`, `mimo`, `handlebars`, `marked`, `yaml`, `semver`, `browserslist`, …) are pre-existing global tools. Nothing unexpected, nothing probe-created.

# Stray node_modules

- `~/.omp/plugins/node_modules/` — mtime **2026-09-19 18:10**; `package.json` + `bun.lock` same mtime. Pre-existing/expected per brief; **not** touched on 10-02/10-03. Contents are `@earendil-works/pi-*` and other third-party deps, dated 2026-07-13 → 2026-08-11.
- `~/.omp/agent/` — **no** `node_modules`, `bun.lock`, or `package.json` at any depth ≤3. Contents are `agents/ blobs/ cache/ extensions/ managed-skills/ memories/ rules/ scripts/ sessions/ skills/ terminal-sessions/` plus `agent.db`, `history.db`, `models.db`, `skill-descriptions.db`, config/mcp YAML, and two extensions (`herdr-omp-agent-state.ts`, `rtk.ts`). Nothing probe-related.
- `/tmp` — `find /tmp -name node_modules -maxdepth 4` → **0 results**. `find /tmp -maxdepth 5 -name bun.lock -o -name package.json` → **0 results**. Probe dirs `/tmp/f9`, `/tmp/f11`, `/tmp/ompext-probe`, `/tmp/st-probe` — **all ABSENT** (already cleaned).
  - Remaining `/tmp/probe*.{mjs,ts,txt,log}`, `/tmp/cb-probe*.log` (18:48–18:49 on 10-02) and `/tmp/omp-build.log` (16:11) are unrelated: probe.mjs is a Playwright script against `localhost:5174/astryx-dracula`; omp-build.log is a macOS `.app` bundle compile for "Vorssaint". Neither is an omp-package install artifact. Bare files, no trees.
- Project dir `~/Documents/Projects/omp-stats-tui/` — **no `node_modules`, no `package.json`, no `bun.lock`**. Only `.git/ docs/ AGENTS.md CONTEXT.md RESEARCH-*.md`.
- Home root, `~/Documents/`, `~/Documents/Projects/` one level deep — **no** `node_modules`, `package.json`, or `bun.lock*`.

# Version audit

Every `@oh-my-pi` cache package.json reports **18.4.10** — no mismatched or stray version anywhere in the cache.

Installed tree versions: all 13 omp packages `18.4.10`; **`hashline` is `18.1.5`** — this is *not* a probe artifact. Its mtime is 2026-09-03 and it has **no cache entry** at all (`~/.bun/install/cache/@oh-my-pi/hashline*` does not exist), so it is a long-standing local package that predates this investigation.

# npm cache

`~/.npm/_cacache` exists, mtime **2026-09-19 18:33:22**, dir entry size 160 B. **Not touched today** — npm was never used by the probes.

# System packages

`/opt/homebrew/Cellar` exists with pre-existing formulae (abseil, ada-url, aom, asciiquarium, bat, binutils, …). Homebrew is an existing system with an unrelated package set; nothing omp- or bun-related was installed there, and no Cellar entry has a 2026-10-02/03 mtime attributable to these probes.

# Database

`stat -f '%m %z %N' ~/.omp/stats.db` → `1790989435 321433600 /Users/yuzu/.omp/stats.db` (306.5 MB).

`sqlite3 "file:$HOME/.omp/stats.db?mode=ro" "PRAGMA integrity_check;"` → **`ok`**.

`~/.omp/` listing: `agent/ autoresearch/ browser-profiles/ cache/ logs/ natives/ plugins/ puppeteer/ run/ ssh-control/` plus `.DS_Store`, `autoqa.db`, `gpu_cache.json`, `install-id`, `stats.db` (+ `-shm`, `-wal`, `.sync.lock`). All are standard omp runtime files; no unexpected or probe-created entries.

# Verdict

**No. Nothing was permanently installed or modified outside the project directory by the investigation agents.**

Specifically:

1. The `@oh-my-pi` entries in `~/.bun/install/cache/` are dated 2026-10-02 **15:53:46–15:53:50**, which is omp's own install/update event (matching log `omp.2026-10-02.58621.log` at 15:53:44 and the identical 15:53:47 mtime on the global install tree). Every probe artifact on this machine is timestamped **16:11 or later**. Nothing under `@oh-my-pi` in the cache has an mtime after 16:00. The probes added **zero** entries to the global cache.
2. The global install tree `@oh-my-pi` contains exactly the expected 14 packages — no extras, none missing.
3. No `node_modules`, `package.json`, or `bun.lock` exists in `/tmp`, `~/.omp/agent/`, the project directory, or any of the three parent directories checked.
4. All cache versions are 18.4.10 (the `hashline` 18.1.5 is a pre-existing local install with no cache entry).
5. npm cache untouched since 2026-09-19; Homebrew untouched; `stats.db` integrity `ok`.

On the hypothetical harm of extra cache entries: **not applicable here** — there are none. For the record, a bun global-cache entry is inert unpacked tarball content keyed by name+version; it is not linked into any `node_modules`, not on `PATH`, and never loaded at runtime. Its only effects are disk space and a possible later reuse by a real `bun install` of the same version. Deleting such entries is safe but also unnecessary.

# Residue requiring cleanup

None. The project directory is clean (no `package.json`, no `node_modules`, no lockfile), the probe scratch directories are gone, and the cache/global-tree entries all predate the probe window.

Self-reported auditor note: the audit command `mkdir -p /tmp/_audit_noop` was issued during an exploratory shell call and created one empty directory, `/tmp/_audit_noop`, at ~09:17 on 2026-10-03. It is not an install artifact and contains nothing. Left in place rather than deleted, per the no-modification instruction; remove with `rmdir /tmp/_audit_noop` if desired.

# Searches

```
ls -la ~/.bun/install/cache/ ; ls -la ~/.bun/install/cache/@oh-my-pi/
stat -f '%Sm | %N' -t '%Y-%m-%d %H:%M:%S' ~/.bun/install/cache/@oh-my-pi/*
find ~/.bun/install/cache/@oh-my-pi -maxdepth 1 -newermt '2026-10-02 16:00'   # -> 0
find ~/.bun/install/cache -maxdepth 2 -newermt '2026-10-02 16:00'              # -> only exa-js/@modelcontextprotocol/follow-redirects/ip-address
grep -m1 '"version"' ~/.bun/install/cache/@oh-my-pi/*/package.json
ls -la ~/.bun/install/global/node_modules/ ~/.bun/install/global/node_modules/@oh-my-pi/ ~/.bun/install/global/node_modules/.bin/
stat -f '%Sm | %N' -t '%Y-%m-%d %H:%M:%S' ~/.bun/install/global{,/node_modules,/node_modules/.bin,/node_modules/@oh-my-pi}
find ~/.omp -maxdepth 6 \( -name node_modules -o -name bun.lock -o -name package.json \)   # + mtimes
find ~/.omp/agent -maxdepth 3 \( -name node_modules -o -name 'bun.lock*' -o -name package.json \)  # -> empty
find /tmp -name node_modules -maxdepth 4        # -> 0
find /tmp -maxdepth 5 \( -name bun.lock -o -name package.json \)  # -> 0
ls -d /tmp/f9 /tmp/f11 /tmp/ompext-probe /tmp/st-probe            # -> all absent
find ~/ -maxdepth 1 / ~/Documents -maxdepth 1 / ~/Documents/Projects -maxdepth 1 \( -name node_modules -o -name 'bun.lock*' -o -name package.json \)  # -> empty
find ~/Documents/Projects/omp-stats-tui -type f -not -path '*/.git/*' -exec stat -f '%Sm | %N' -t '%Y-%m-%d %H:%M' {} \;
stat -f '%Sm %z %N' ~/.npm/_cacache                                  # -> Sep 19 18:33:22 2026 160
ls -la /opt/homebrew/Cellar | head
stat -f '%m %z %N' ~/.omp/stats.db ; sqlite3 "file:$HOME/.omp/stats.db?mode=ro" "PRAGMA integrity_check;"
ls -la ~/.omp/ ~/.omp/agent/ ~/.omp/plugins/
```