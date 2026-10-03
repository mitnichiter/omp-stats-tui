# F13 — Morning Cleanliness Audit (read-only)

Date: 2026-10-03. Audit windows of interest: probe sessions 2026-10-02 16:11–22:30, plus
the plan-writing session 2026-10-03 09:00–09:26.

## Verdict

Nothing outside the project directory was modified or left behind by the investigation agents —
every file in `~/.omp/agent/extensions/`, `~/.omp/plugins/`, `~/.bun/install/global/node_modules/@oh-my-pi/`
and `~/.bun/install/cache/@oh-my-pi/` predates the probe sessions, and the global git config is untouched.

The project directory itself is tidy: 29 files, all deliberate documentation, zero scratch output,
zero empty directories, no `.DS_Store` or swap files, and `.gitignore` correctly excludes `node_modules/`.

Two caveats that are *not* agent residue but do deserve attention: 10 untracked
documentation files in the project root/docs tree (only the plan file is committed), and
two probe scratch directories sitting in `~/.Trash`.

# Part 1 — Outside the project directory

## 1. `~/.omp/agent/extensions/`

Exactly the two expected files. Directory mtime 2026-10-02 22:27:13 (touched by agent
run bookkeeping, no new entries).

| File | Size | mtime |
|---|---|---|
| `herdr-omp-agent-state.ts` | 12.1K | 2026-09-13 21:36:41 |
| `rtk.ts` | 2.6K | 2026-07-15 16:56:46 |

**Clean.** Nothing extra.

## 2. `~/.omp/plugins/`

| Entry | Size | mtime | Verdict |
|---|---|---|---|
| `bun.lock` | 35.2K | 2026-09-19 18:10:25 | pre-existing |
| `node_modules/` | 2.9K | 2026-09-19 18:10:25 | pre-existing, expected |
| `omp-plugins.lock.json` | 257B | 2026-08-31 09:10:04 | pre-existing |
| `package.json` | 169B | 2026-09-19 18:10:25 | pre-existing |
| `.DS_Store` | 6.0K | 2026-08-31 14:15:46 | Finder, unrelated |

**Nothing newer than 2026-10-01.** Clean.

## 3. `~/.omp/` top level

All expected entries present, nothing new:

| Entry | mtime | Note |
|---|---|---|
| `agent/` | 2026-10-02 22:26:45 | agent runtime state, mtime bump is normal |
| `logs/` | 2026-10-03 09:10:44 | normal runtime logging |
| `cache/` | 2026-09-29 14:59:58 | untouched |
| `plugins/` | 2026-09-19 18:10:25 | untouched |
| `autoresearch/` | 2026-08-31 14:15:46 | untouched |
| `run/` | 2026-08-31 14:15:46 | untouched |
| `puppeteer/` | 2026-08-17 11:53:56 | untouched |
| `browser-profiles/` | 2026-09-25 20:58:47 | untouched |
| `gpu_cache.json` | 2026-08-26 18:40:41 | untouched |
| `natives/` | 2026-08-23 12:09:45 | untouched |
| `ssh-control/` | 2026-07-18 21:41:07 | untouched |
| `install-id` | 2026-07-23 22:07:59 | untouched |
| `autoqa.db` | 2026-09-25 22:34:53 | untouched |
| `stats.db` | 2026-10-03 09:26:17 | grew, expected/correct |
| `stats.db-shm` | 2026-10-03 08:55:53 | WAL sidecar, expected |
| `stats.db-wal` | 2026-10-03 09:34:01 | WAL sidecar, expected |
| `stats.db.sync.lock` | 2026-08-04 21:17:57 | 0 bytes, pre-existing |
| `.DS_Store` | 2026-08-31 14:15:46 | Finder |

No new files. Clean.

## 4. `~/.bun/install/global/node_modules/@oh-my-pi/`

Exactly 14 directories, nothing else. All `@oh-my-pi/*` are `2026-10-02 15:53:47`;
`hashline` is `2026-09-03 14:47:02` (pre-existing, unchanged). Matches expectation exactly.

Clean.

## 5. `~/.bun/install/cache/@oh-my-pi/`

21 entries (14 bare + 7 scoped copies). All mtimes fall in `2026-10-02 15:53:46–15:53:50`.
**Nothing newer than 16:00** — the 16:11–22:30 probe sessions installed nothing.

Clean.

## 6. `/tmp`

Nothing matching `f9*`, `f11*`, `g3.ts`, `g4.ts`, `g6.ts`, `ompext-probe*`, `st-probe*`,
`stats-tui-probe*`, `p3`, `p4`, `p5`, `glyphtest*` exists.

Entries that exist, with attribution:

| Path | mtime | Attribution |
|---|---|---|
| `probe.txt`, `probe.log`, `probe2.log`, `probe3.log`, `warnprobe.log`, `dup3.py`, `cb-probe.log`, `cb-probe2.log` | Sep 30 – Oct 2 18:48 | **Unrelated.** Content is `Sources/Vorssaint/...` Swift compile probes and `dup3.py` targets `Projects/vorssaint-utils`. Different project. |
| `probe.ts` | 2026-09-29 14:07 | Pre-dates the sessions. |
| `probe.mjs`, `probe2.mjs`, `probe3.mjs`, `probe4.mjs` | Oct 2 18:31–18:33 | **Unrelated.** All launch `playwright-core` against the ms-playwright Chromium build — browser automation, not omp-stats. |
| `_audit_noop/` (empty), `_t.txt` (0B), `_t2.txt` (0B) | 2026-10-03 09:16 | **Ours.** Zero-byte canaries from a cleanup-verification probe this morning. |
| `node_modules` under `f5/`, `vis/`, `xmltest/`, `yjstest2/`, `ndr-76203/` | Sep 29 – Oct 3 00:09 | **Unrelated.** `/tmp/f5` holds editor-theme font trees (alacritty, atom-ui, zed, …), `vis`/`xmltest`/`yjstest2` are other scratch runs. |

Net: 3 zero-byte canaries are the only residue this project left in `/tmp`.

## 7. Stray `node_modules` / lockfiles

- `find ~ -maxdepth 3 -name node_modules -type d`: 14 hits — 12 under `~/.Trash` (pre-existing
  trashed projects), plus `~/.hermes/hermes-agent/node_modules` and the expected
  `~/.omp/plugins/node_modules`. **No new `node_modules` under `$HOME`.**
- `find /tmp -maxdepth 4 -name node_modules -type d`: 6 hits, all listed in §6, all attributable
  to other work.
- No stray `package.json` / `bun.lock` outside these.

Note: `~/.Trash/_probe_f11` and `~/.Trash/_probe_f11b` (both 2026-10-02 22:21) **do** contain
omp-stats probe files — `probe.ts`, `ext.ts`, `enum.ts`, `enum2.ts`, `sq.ts`, `package.json`,
`bun.lock`. These are ours, but already moved to Trash rather than left in `/tmp`.
`/tmp` has no `f11*` residue.

## 8. Database integrity

```
2026-10-03 09:26:17 | 321740800 bytes | /Users/yuzu/.omp/stats.db
PRAGMA integrity_check;  ->  ok
messages   = 185065
tool_calls = 175137
```

**`ok`.** Database is healthy; the read-only probes did not corrupt it.

## 9. Git global config

```
user.name  = Yuzu Octopus
user.email = octopusyuzu@gmail.com
```

Both set, both matching the identity on the one project commit (`da17fb0`). The worker's
`-c user.name=…` overrides did not persist. Clean.

# Part 2 — Inside the project directory

## 10. Full inventory (29 files, excluding `.git/`)

| Size | mtime | Path |
|---|---|---|
| 14B | 10-03 09:26 | `.gitignore` |
| 25790 | 10-03 09:00 | `AGENTS.md` |
| 7658 | 10-02 21:44 | `CONTEXT.md` |
| 86437 | 10-02 20:51 | `RESEARCH-stats-impl.md` |
| 18363 | 10-02 20:47 | `RESEARCH-tui-hooks.md` |
| 1986 | 10-02 21:40 | `docs/adr/0001-own-sql-over-readonly-bun-sqlite.md` |
| 801 | 10-02 21:40 | `docs/adr/0002-command-name-stats-tui.md` |
| 1350 | 10-02 21:41 | `docs/adr/0003-read-only-panel-no-writes-no-sync.md` |
| 1103 | 10-02 21:41 | `docs/adr/0004-render-terminal-native-not-port-react.md` |
| 2023 | 10-02 21:41 | `docs/adr/0005-glyph-policy-hardcoded-unicode-data-ink.md` |
| 136594 | 10-03 09:26 | `docs/plans/2026-10-03-stats-tui-panel.md` |
| 67952 | 10-02 22:22 | `docs/research/omp-stats-tui/REPORT.md` |
| 14992 | 10-02 21:13 | `docs/research/omp-stats-tui/findings/F1-api-decoupling.md` |
| 54459 | 10-03 09:09 | `docs/research/omp-stats-tui/findings/F10-glyph-system.md` |
| 25179 | 10-02 22:30 | `docs/research/omp-stats-tui/findings/F11-zero-install-paths.md` |
| 9946 | 10-03 09:17 | `docs/research/omp-stats-tui/findings/F12-install-footprint-audit.md` |
| 27388 | 10-02 21:15 | `docs/research/omp-stats-tui/findings/F2-data-layer.md` |
| 40360 | 10-02 21:19 | `docs/research/omp-stats-tui/findings/F3-tui-rendering.md` |
| 25108 | 10-02 21:18 | `docs/research/omp-stats-tui/findings/F4-extension-packaging.md` |
| 28152 | 10-02 21:26 | `docs/research/omp-stats-tui/findings/F5-resolution-probe.md` |
| 77239 | 10-02 21:32 | `docs/research/omp-stats-tui/findings/F6-builtin-views.md` |
| 20811 | 10-02 21:27 | `docs/research/omp-stats-tui/findings/F7-web-dashboard.md` |
| 24092 | 10-02 21:31 | `docs/research/omp-stats-tui/findings/F8-terminal-graphics.md` |
| 17884 | 10-02 22:05 | `docs/research/omp-stats-tui/findings/F9-import-strategies.md` |
| 8205 | 10-03 09:04 | `docs/research/tui-chart-glyphs/findings/F1.md` |
| 6233 | 10-03 09:04 | `docs/research/tui-chart-glyphs/findings/F2.md` |

> **Snapshot as of 10-03 09:00.** The two root RESEARCH rows above are historical: both files
> were deleted later the same day. See §14.

**Zero scratch files.** No `.log`, `.tmp`, `*.bak`, `probe-*`, `tmp*`, `.DS_Store`,
or editor swap files. No `node_modules/`. No build output.

## 11. Git state

Single commit:

```
da17fb0 docs: add the /stats-tui implementation plan
Author: Yuzu Octopus <octopusyuzu@gmail.com>   Date: Sat Oct 3 09:26:57 2026
 .gitignore                                 |   1 +
 docs/plans/2026-10-03-stats-tui-panel.md   | 2391 ++++++
```

Uncommitted (`git status --porcelain`):

```
?? AGENTS.md
?? CONTEXT.md
?? RESEARCH-stats-impl.md
?? RESEARCH-tui-hooks.md
?? docs/adr/
?? docs/research/
```

> Historical `git status` output as of 10-03 09:00; the untracked state no longer applies.

**Everything except the plan file and `.gitignore` is untracked.** 24 documentation files
are outside version control. Nothing is *modified* — no tracked file has unstaged edits.

## 12. `.gitignore`

```
node_modules/
```

Adequate. Single line, exactly the right entry, added ahead of the first install so the
~180 MB native addon tree cannot be committed accidentally. (Optionally worth adding
`.DS_Store`, but the project currently has none.)

## 13. Docs tree

- `docs/adr/` — 0001 through 0005 present. ✅
- `docs/research/omp-stats-tui/` — `REPORT.md` + findings F1–F12, all twelve present. ✅
- `docs/plans/` — `2026-10-03-stats-tui-panel.md` (136594 B). ✅
- Bonus: `docs/research/tui-chart-glyphs/findings/{F1,F2}.md` — a second, separate research
  stream (glyph/chart width probing) with its own findings dir. Not an orphan; it is
  parallel to F10-glyph-system.

## 14. Duplicate / stale root RESEARCH files — **resolved**

`RESEARCH-stats-impl.md` (86K) and `RESEARCH-tui-hooks.md` (18K) were early working notes.
They were **superseded** — `docs/research/omp-stats-tui/findings/F2-data-layer.md` covers
the stats implementation and F3/F6 cover the TUI hooks and built-in views.

They were not orphaned: three live references existed.

```
docs/research/omp-stats-tui/REPORT.md:457  RESEARCH-stats-impl.md — … [primary]
docs/research/omp-stats-tui/REPORT.md:458  RESEARCH-tui-hooks.md — … [primary]
AGENTS.md:68                                early working notes, superseded
```

`REPORT.md` cited them as *primary* sources in its source register, which contradicted the
"superseded" framing, and deleting them as-is would have broken two citations.

**Resolution (10-03):** the three references were repointed before deletion, then the files
were removed. Register entries 18/19 now cite F2/F11/F4 and F3/F6 respectively, with the
`omp://` primary sources on entry 19 retained. The `AGENTS.md:68` key-directory row was
dropped. No content was lost: the only claim unique to the deleted files was the nine-item
"Hard limits" list, whose substance is already carried in `REPORT.md` §1 (React client is a
rewrite, not a port), §6(b) (`cost_unpriced`), §6(e) (mode guards, idempotent `dispose()`),
and register entries 5/10/30 (rollup tables, `exports` map, `withStatsSyncLock`).

## 15. Empty directories

`find . -type d -empty` → **none.** Clean.

# Recommended cleanup

None of these were run. All are optional and low-risk.

**1. Clear this morning's zero-byte `/tmp` canaries (ours):**
```sh
rm -rf /tmp/_audit_noop /tmp/_t.txt /tmp/_t2.txt
```

**2. Empty the trash of the two f11 probe dirs (ours, already trashed):**
```sh
rm -rf ~/.Trash/_probe_f11 ~/.Trash/_probe_f11b
```

**3. Commit the untracked research corpus** (docs only — nothing else is
uncommitted, so this is a pure-doc commit):
```sh
cd /Users/yuzu/Documents/Projects/omp-stats-tui
git add AGENTS.md CONTEXT.md docs/adr docs/research
git commit -m "docs: add ADRs, research findings and agent context"
```

**4. ~~Tidy the redundant root RESEARCH files~~ — done (10-03).** Not relocated:
the content was already superseded by `docs/research/`, so the references were repointed
to the covering findings and the two root files were deleted rather than moved. See §14.

**Not ours, leave alone:** all `/tmp/probe*`, `/tmp/cb-probe*`, `/tmp/dup3.py`,
`/tmp/warnprobe.log` (Vorssaint Swift work), `/tmp/f5`, `/tmp/vis`, `/tmp/xmltest`,
`/tmp/yjstest2`, `/tmp/ndr-76203`, and everything else under `~/.Trash`.