# Angle
How to package, install, develop, test, and distribute the `omp-stats-tui` extension — confirmed against omp 18.4.10 source, docs, and this machine's install.

## Claims

### Package layout / manifest

- **There is no zod schema and no JSON Schema for a plugin manifest — `omp` is a plain TypeScript interface.** — evidence: `src/extensibility/plugins/types.ts:31-56` defines `PluginManifest` as an `interface`; the plumbing doc states "There is no strict schema validation in manager/loader. A package missing `omp`/`pi` is still installable and listable." — confidence: **high**
- **The complete, authoritative `omp.*` key set is: `name?`, `version`, `description?`, `tools?`, `hooks?`, `extensions?`, `commands?`, `features?`, `settings?`.** — evidence: `src/extensibility/plugins/types.ts:31-56` (verbatim below). Note `tools`/`hooks` are **singular strings**, while `extensions`/`commands` are **arrays** — confidence: **high**
- **Only `version` is formally required**; it is always overwritten from `package.json#version` at load. — evidence: `plugin-manager-installer-plumbing.md` §"Manifest source and required fields": "`manifest.version` is always overwritten from `package.json` version"; `types.ts:36` `version: string;` (non-optional) — confidence: **high**
- **`omp.name`, `omp.commands`, `omp.agents`, `omp.rules`, `omp.mcp`, `omp.lsp`, `omp.skills` are NOT FOUND** as manifest keys. — evidence: absent from `src/extensibility/plugins/types.ts:31-56`. `commands` exists but as a **path array**, not metadata. `agents`/`hooks`/`mcpServers`/`lspServers` exist only as *marketplace catalog* entry metadata (`omp://marketplace.md` §"Plugin entry fields"), where they are explicitly "preserved but runtime commands are discovered from the installed plugin tree". — confidence: **high**
- **Skills/hooks/tools/commands/rules/prompts/MCP come from conventional directories, not manifest keys.** — evidence: `src/discovery/omp-plugins.ts:43-47`: `PROVIDER_ID = "omp-plugins"`, `DESCRIPTION = "Sub-discovery (skills, hooks, tools, commands, rules, prompts, .mcp.json) inside extension packages"` — confidence: **high**
- **`.omp-plugin/` is NOT the extension manifest directory.** It holds marketplace/plugin catalog files only: `.omp-plugin/marketplace.json` and `.omp-plugin/plugin.json`. — evidence: `src/discovery/claude-plugins.ts:108` `path.join(root.path, ".omp-plugin", "marketplace.json")`; `src/discovery/agent-plugin-format.ts:567` `readFile(path.join(rootPath, ".omp-plugin", "plugin.json"))` — confidence: **high**

Verbatim manifest interface (`src/extensibility/plugins/types.ts`):

```ts
/**
 * Plugin manifest from package.json omp or pi field.
 */
export interface PluginManifest {
	/** Plugin display name (defaults to package name) */
	name?: string;
	/** Plugin version (copied from package.json version) */
	version: string;
	/** Human-readable description */
	description?: string;

	/** Entry point for base tools (relative path from package root) */
	tools?: string;
	/** Entry point for base hooks (relative path from package root) */
	hooks?: string;
	/** Extension entry points (relative paths from package root) */
	extensions?: string[];
	/** Command files (relative paths from package root) */
	commands?: string[];

	/** Feature definitions for selective installation */
	features?: Record<string, PluginFeature>;

	/** Settings schema for plugin configuration */
	settings?: Record<string, PluginSettingSchema>;
}
```

### Dependency resolution (the critical part)

- **`@oh-my-pi/pi-tui` resolves from an extension with no install step, because a scoped `Bun.plugin` `onResolve` hook intercepts it and rewrites it to a host-bundled in-process module.** — evidence: `src/extensibility/plugins/legacy-pi-compat.ts:2739-2743` installs `Bun.plugin({ name: "omp:legacy-pi-shim", setup(build) { build.onResolve({ filter: LEGACY_PI_SPECIFIER_FILTER, namespace: "file" }, resolveLegacyPiSpecifier); ... } })`; `LEGACY_PI_SPECIFIER_FILTER` at `:857` — confidence: **high**
- **Only seven basenames are host-resolved: `pi-agent-core`, `pi-ai`, `pi-catalog`, `pi-coding-agent`, `pi-natives`, `pi-tui`, `pi-utils`.** — evidence: `legacy-pi-compat.ts:806-814`:
  ```ts
  const PI_PACKAGE_NAMES = [
  	"pi-agent-core", "pi-ai", "pi-catalog",
  	"pi-coding-agent", "pi-natives", "pi-tui", "pi-utils",
  ] as const;
  ```
  and `:800` `const PI_SCOPE_ALIASES = ["oh-my-pi", "mariozechner", "earendil-works"] as const;` — confidence: **high**
- **⚠️ `@oh-my-pi/omp-stats` is NOT in `PI_PACKAGE_NAMES` and is therefore NOT host-resolved.** It falls through to `isBareExtensionDependencySpecifier` → `resolveExtensionBareDependency` → `resolveNodePackageDependency` (a `node_modules` walk **upward from the extension file's directory**, `:1492-1517`) → `Bun.resolveSync` fallback → then `validateResolvedBarePackagePath` (`:1718-1726`), which **rejects the result unless a real `node_modules/<name>/package.json` was found**. — evidence: `legacy-pi-compat.ts:1776-1795`, `:1492-1517`, `:1718-1726` — confidence: **high**
- **Verified empirically on this machine: both `@oh-my-pi/pi-tui` and `@oh-my-pi/omp-stats` resolve from `/tmp/exttest/ext.ts`** — the failure raised was `Export named 'somethingFromStats' not found in module '/Users/yuzu/.bun/install/cache/@oh-my-pi/omp-stats@18.4.10@@@1/src/index.ts'`, i.e. it located the module and only rejected my fabricated export name. Retesting with real exports (`Container`, `getGainDashboardStats`, `formatStatsDashboardUrl`) got past both imports. — confidence: **high** for "resolves here"; see Conflicting evidence for the portability caveat.
- **The resolver is rooted at the *extension file's own directory*, walking upward — not at the project cwd and not at the omp install.** — evidence: `findNodePackageRootUncached` at `legacy-pi-compat.ts:1501` `let dir = path.dirname(importerPath);` then `while (true) { const candidate = path.join(dir, "node_modules", packageName); ... const parent = path.dirname(dir); if (parent === dir) return null; }` — confidence: **high**
- **There is NO `peerDependencies` convention enforced for `@oh-my-pi/*`, but the design intent is peer-style:** the comment at `:792-798` states "Plugins published against any of the aliased scopes below (mariozechner's original publish, earendil-works' fork, or the canonical @oh-my-pi scope itself) are remapped to this scope and resolved against the bundled copy that ships inside the omp binary. This keeps plugins running against the exact runtime state of the host ... **regardless of which historical scope name they happened to declare in their peerDependencies**." The installer has a compiled-binary fallback that tries `Bun.resolveSync(remappedSpecifier, importerDir)` — "Prefer the canonical specifier against the importing file's directory when the plugin installed @oh-my-pi peer deps" (`:2704-2718`) — i.e. peer deps are an *accepted but optional* belt-and-braces, needed only in compiled-binary mode. — confidence: **high**
- **What installs `~/.omp/plugins/bun.lock`:** `PluginManager.install` runs `bun install --no-cache <spec>` **inside `~/.omp/plugins`**. — evidence: `plugin-manager-installer-plumbing.md` §"Install/update flow" step 4: "Run `bun install --no-cache <packageSpec>` for npm, or `bun install <gitSpec>` for Git, in the user plugins directory". `~/.omp/plugins/package.json` is the dependency manifest: `"name": "omp-plugins", "private": true, "dependencies": {...}`; bun writes `bun.lock` beside it (`lockfileVersion: 1`, workspace `""` named `omp-plugins`) — confidence: **high**
- **`CHANGELOG.md` has NO entries about extension dependency resolution / module resolution / plugin bundling.** A grep for `module resolution|dependency resolution|peer depend|extension depend|resolve.*extension.*module|bundle.*plugin|plugin.*bundl` over the 255 KB changelog returned **zero matches**. The behavior is documented only in source comments. — confidence: **high** (that they are absent), **medium** (that no differently-worded entry exists)

### Dev loop

- **No hot reload / no watcher for extension sources.** A search for a reload watcher in the extension loader found none; module reload is achieved through `?mtime=<tag>` cache-busting on re-import, and `ctx.reload()` re-runs discovery. — evidence: `omp://extension-loading.md`: "Modules are not unloaded or re-evaluated, and newly enabled modules that were not imported at startup **require a restart**"; and "the entry's realpath is resolved, then dynamically imported with a per-load `?mtime` cache-buster" — confidence: **high**
- **`ctx.reload()` exists on `ExtensionCommandContext`.** — evidence: `omp://extensions.md` §3: "`reload()` — Reload the session runtime"; working example at `examples/extensions/reload-runtime.ts` which calls `await ctx.reload()` — confidence: **high**
- **Extension load failures are surfaced as TUI notifications AND logged.** — evidence: `src/extensibility/extensions/load-errors.ts` builds `` `Failed to load extension ${displayPath}: ${displayError}` ``, consumed at `src/main.ts:2261` `for (const message of formatExtensionLoadNotifications(extensionsResult.errors))` — confidence: **high**
- **Logs go to `~/.omp/logs/omp.<DATE>.<PID>.log`, never to the console.** — evidence: `pi-utils/src/logger.ts:2-15`: "Default: rotating `~/.omp/logs/omp.<DATE>.<PID>.log`, no console output (writing to stdout/stderr would corrupt the TUI). ... Records are batched — one write per second or per 64 KiB — while `warn`/`error` records are written at once"; writer at `:280` `const logsDir = ensureDir(dir ?? getLogsDir());` — confidence: **high**
- **`--trusted-extension` and `--plugin-dir` are functional but absent from `omp --help`.** They parse in `src/cli/flag-tables.ts:220-227` and are documented in `omp://cli-reference.md`, but have **no entry** in `src/commands/launch-help.ts` (which defines `hook`, `extension`, `no-extensions`, …) and do not appear in `omp --help` output. — confidence: **high**

Verbatim help text (`src/commands/launch-help.ts:88-96`), confirmed identical in `omp --help` output:

```ts
hook: Flags.string({ description: "Load a hook/extension file (can be used multiple times)", multiple: true }),
extension: Flags.string({
	char: "e",
	description: "Load an extension file (can be used multiple times)",
	multiple: true,
}),
"no-extensions": Flags.boolean({
	description: "Disable extension discovery (explicit -e paths still work)",
}),
```

```text
      --hook=<value>                    Load a hook/extension file (can be used multiple times)
  -e, --extension=<value>               Load an extension file (can be used multiple times)
      --no-extensions                   Disable extension discovery (explicit -e paths still work)
      --profile=<value>                 Use an isolated profile for auth, sessions, settings, and caches
```

`omp plugin --help` (verbatim):

```text
Manage plugins (install, uninstall, list, etc.)

USAGE
  $ omp plugin [ACTION] [TARGETS...] [FLAGS]

ARGUMENTS
  ACTION    Plugin action (install|uninstall|list|link|doctor|features|config|enable|disable|marketplace|discover|upgrade)
  TARGETS   Packages, paths, or plugin names

FLAGS
      --json             Output JSON
      --fix              Attempt to fix issues (doctor)
      --force            Force install
      --dry-run          Show actions without applying changes
  -l, --local            Operate on local plugin directory
      --enable=<value>   Enable a feature
      --disable=<value>  Disable a feature
      --set=<value>      Set plugin config (key=value)
      --scope=<value>    Install scope: "user" (default) or "project"
```

### Testing

- **omp ships NO extension test harness in the installed package.** The published package contains **1** `*.test.ts` file total (`src/edit/auto-repair.test.ts`), none under `src/extensibility/`. `package.json` `files` ships only `src`, `scripts`, `examples`, docs — not the monorepo `test/` tree. — confidence: **high**
- **Test runner is `bun test`.** — evidence: `pi-tui/package.json` `"test": "bun test --parallel test/*.test.ts"`; pi-coding-agent's own `"test": "bun ../../scripts/ci-test-ts.ts coding-agent-heavy --full"` (a monorepo-only path that does not exist in the published package). Sibling packages use plain `bun test`. — confidence: **high**
- **Unit-testing the data layer without a terminal is supported**, but you do it yourself with `bun test` — export pure functions from a non-entry module and test those. `examples/extensions/with-deps/` is the shipped proof that an extension package can carry its own `package.json` + `node_modules` and be unit-tested independently. — confidence: **medium** (inferred; no harness is provided, but nothing prevents it)

### Distribution

- **`omp plugin link` symlinks a local package into `~/.omp/plugins/node_modules/<pkg.name>` and adds an enabled lockfile entry.** — evidence: `omp://plugin-manager-installer-plumbing.md` §"Link flow" steps 1-7, and `omp plugin --help` listing `link` as an ACTION — confidence: **high**
- **`omp plugin install <spec>` = npm or git; local paths route to `.link()` and `name@marketplace` routes to the marketplace manager.** — evidence: `classifyInstallTarget` described in §"Scope and architecture": "local paths route to `PluginManager.link()`, and `name@marketplace` routes to the marketplace manager only when the marketplace is configured" — confidence: **high**
- **Marketplace `source: { "source": "npm", ... }` is parsed but rejected at install.** — evidence: `omp://marketplace.md`: "Current installer behavior rejects npm marketplace sources with `npm plugin sources are not yet supported`" — confidence: **high**
- **Publishing to npm works, but the npm consumer is the `omp plugin install` path, not the marketplace.** — evidence: `PluginManager.install` runs `bun install` on the spec; `getEnabledPlugins` reads `<root>/node_modules` plus the lockfile — confidence: **high**
- **Install runs are validated by actually importing each declared extension** before the lockfile is written. — evidence: §"Install/update flow" step 7 `#validateInstalledExtensions`: "each manifest `extensions` entry must resolve on disk, import to a factory function, and initialize successfully against a throwaway registration surface. On failure, roll back the install" — confidence: **high**
- **Project plugins shadow user plugins by package name; disabled project entries do not.** — evidence: `src/extensibility/plugins/loader.ts:266-270`: "// Project entries shadow user entries with the same package name." — confidence: **high**
- **User plugins dir = `<home>/<configDir>/plugins`, node_modules beside it.** — evidence: `pi-utils/src/dirs.ts:644-658`:
  ```ts
  export function getPluginsDir(home?: string): string {
  	if (home !== undefined && home !== RESOLVER_HOME) {
  		return path.join(home, getConfigDirName(), "plugins");
  	}
  	return dirs.rootSubdir("plugins", "data");
  }
  /** Where npm installs packages (~/.omp/plugins/node_modules). */
  export function getPluginsNodeModules(home?: string): string {
  	return path.join(getPluginsDir(home), "node_modules");
  }
  /** Plugin manifest (~/.omp/plugins/package.json). */
  export function getPluginsPackageJson(home?: string): string {
  	return path.join(getPluginsDir(home), "package.json");
  }
  ```
  — confidence: **high**

### This machine's actual state

- **`~/.omp/plugins/package.json`** (verbatim): `{"name":"omp-plugins","private":true,"dependencies":{"cc-safety-net":"^2.0.1","pi-gpt-search":"https://github.com/mateusdcc/pi-gpt-search"}}`
- **`~/.omp/plugins/omp-plugins.lock.json`** (verbatim): `cc-safety-net@2.0.1` and `pi-gpt-search@1.1.0`, both `"enabledFeatures": null, "enabled": true`, `"settings": {}`.
- **No `installed_plugins.json`, no `cache/`, no `marketplaces.json` at `~/.omp/`** — this user has **no marketplace plugins installed**, only npm+git installs.
- **`~/.omp/agent/extensions/` contains 2 files:** `herdr-omp-agent-state.ts` (12.1 KB) and `rtk.ts` (2.6 KB) — both plain `.ts`, no package dirs.
- **omp is installed as an npm bundle**, not a compiled binary: `/Users/yuzu/.bun/bin/omp -> ../install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js`, `omp --version` = `omp/18.4.10`. `dist/cli.js` was built with `process.env.PI_BUNDLED` substituted to `"true"` (`scripts/bundle-dist.ts:100`), so `USE_BUNDLED_PI_MODULES = isCompiledBinary() || Boolean(process.env.PI_BUNDLED)` is **true** — `@oh-my-pi/*` host packages resolve through the `omp-legacy-pi-bundled:` virtual namespace, not from disk. — confidence: **high**
- **`@oh-my-pi/pi-tui` v18.4.10 does export `Table`** — `pi-tui/src/components/table.ts:94` `export class Table implements Component`, re-exported at `pi-tui/src/index.ts:32` `export * from "./components/table";`. So `import { Table } from "@oh-my-pi/pi-tui"` is valid. — confidence: **high**

## Minimal plugin layout

```
omp-stats-tui/
  package.json
  src/
    index.ts          # export default function (pi: ExtensionAPI) {}
```

`package.json`:

```json
{
  "name": "omp-stats-tui",
  "version": "0.1.0",
  "type": "module",
  "description": "Interactive omp usage-stats TUI",
  "omp": {
    "name": "omp-stats-tui",
    "description": "Interactive omp usage-stats TUI",
    "extensions": ["./src/index.ts"]
  },
  "dependencies": {
    "@oh-my-pi/omp-stats": "18.4.10"
  }
}
```

Rules that matter:

- `omp.extensions` paths are **relative to the package root** and are authoritative when non-empty.
- `version` inside `omp` is ignored/overwritten; keep it only for readability.
- Do **not** add `omp.skills` / `omp.agents` / `omp.rules` / `omp.mcp` / `omp.lsp` — they do nothing. Put content in `skills/`, `agents/`, `rules/`, `commands/`, `.mcp.json` directories instead.
- **Declare `@oh-my-pi/omp-stats` as a real dependency.** It is not host-resolved. It is only imported from disk today because this machine happens to have it in Bun's global install cache. On any machine where `~/.omp/plugins/node_modules/@oh-my-pi/omp-stats` does not exist and the resolver's upward walk from your extension dir finds nothing, the import fails. Declaring the dependency makes `omp plugin install` / `bun install` place it under the plugin root, which *is* on that upward walk.
- Pin `@oh-my-pi/*` versions exactly (the ecosystem pins: pi-tui's own deps are `"@oh-my-pi/omptype": "18.4.10"`, no carets).
- `@oh-my-pi/pi-tui` and `@oh-my-pi/pi-coding-agent` need **no** dependency entry (host-bundled), but adding them is harmless; omit to avoid a duplicate copy being installed.

## Dev loop

```sh
# 1. Fastest iteration — explicit single-file load, no install step
omp --extension /Users/yuzu/Documents/Projects/omp-stats-tui

# 2. Watch the logs while it runs
tail -f ~/.omp/logs/omp.$(date +%F).*.log

# 3. Reload extensions/skills/prompts/themes in-session (no restart) for
#    sources that were already imported at startup.
#    Implement as: pi.registerCommand("stats-tui-reload", { handler: async (_, ctx) => ctx.reload() })

# 4. Note: a NEWLY added extension file still requires a restart.
#    (omp://extension-loading.md: "newly enabled modules that were not imported
#     at startup require a restart")

# 5. Persistent local install, symlinked, so edits take effect on restart:
omp plugin link /Users/yuzu/Documents/Projects/omp-stats-tui

# 6. Isolate your plugin work from other plugins/config:
omp --profile statsdev
#    -> ~/.omp/profiles/statsdev/agent/extensions, separate plugins dir

# 7. Suppress ambient extensions while debugging a single module:
omp --no-extensions --extension /abs/path/to/src/index.ts

# 8. Unit-test the data layer (no terminal):
cd /Users/yuzu/Documents/Projects/omp-stats-tui && bun test
```

**No hot reload.** `ctx.reload()` re-runs discovery but does not re-evaluate modules ("Modules are not unloaded or re-evaluated"). Plan on restarting `omp` for code changes; use `/reload` (via your own `ctx.reload()` command) only for config/source-list changes.

## Searches

```sh
# docs (full read)
read omp://extensions.md omp://extension-loading.md omp://skills/authoring-extensions.md
read omp://skills/examples/hello-extension/README.md omp://marketplace.md
read omp://plugin-manager-installer-plumbing.md omp://cli-reference.md

# local state
ls -la ~/.omp/plugins ~/.omp/plugins/node_modules ~/.omp/agent ~/.omp/agent/extensions
cat ~/.omp/plugins/package.json ~/.omp/plugins/omp-plugins.lock.json

# manifest schema
cat  $SRC/src/extensibility/plugins/types.ts
grep -rn "PluginManifest" $SRC/src

# dependency resolution
grep -rn "Bun.plugin\|onResolve\|onLoad" $SRC/src --include=*.ts
grep -rn "createRequire\|node_modules\|Bun.resolveSync" $SRC/src/extensibility/plugins/legacy-pi-compat.ts
sed -n '780,1000p;1080,1200p;1440,1560p;1700,1800p;2660,2788p' $SRC/src/extensibility/plugins/legacy-pi-compat.ts

# flags / help
sed -n '85,110p' $SRC/src/commands/launch-help.ts
sed -n '218,230p' $SRC/src/cli/flag-tables.ts
omp --help; omp plugin --help

# logs
sed -n '1,40p' $PU/src/logger.ts

# dirs
sed -n '640,660p' $PU/src/dirs.ts

# changelog
grep -n -i "module resolution|dependency resolution|peer depend|bundle.*plugin" $SRC/CHANGELOG.md   # 0 hits

# empirical resolution (decisive)
#   real loader, stub extension importing pi-tui + omp-stats  -> imports resolved,
#   only my fake export name rejected; retest with real exports -> past both imports
```

where `SRC=/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent` and `PU=/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-utils`.

## Conflicting evidence

1. **`@oh-my-pi/omp-stats` resolves here, but the resolution path is accidental.** `Bun.resolveSync("@oh-my-pi/omp-stats", <any dir>)` succeeded from `/private/tmp` and from `~/.omp/agent/extensions`, resolving to `/Users/yuzu/.bun/install/cache/@oh-my-pi/omp-stats@18.4.10@@@1/src/index.ts` — i.e. Bun's **global install cache fallback**, not a `node_modules` walk. That fallback is not documented anywhere in omp, is not what omp's own resolver implements, and depends on this machine's populated Bun cache. The same test also resolved `left-pad` and `ms` from `/tmp`, confirming it is a general cache fallback rather than omp behavior. **Treat as medium-confidence portability.** In the loader's own `resolveExtensionBareDependency` path, `validateResolvedBarePackagePath` would *reject* such a result for lack of a real `node_modules/<name>/package.json` — meaning the rewrite returns null and Bun's native resolution is what actually saved it.
2. **The cache-based path is not fully functional.** My harness run resolved `omp-stats` into `~/.bun/install/cache/...`, which lacks the compiled native addon, producing `Failed to load pi_natives native addon for darwin-arm64 ... Cannot find module '.../native/pi_natives.darwin-arm64.node'`. This is an artifact of the cache copy, not of `omp` (which uses the bundled virtual modules via `PI_BUNDLED=true` and never touches the cache). Recorded because it demonstrates the cache fallback is a degraded path.
3. **Docs say extensions run "in-process with no isolation"; no doc contradicts the host-resolution design**, but the docs never state that `@oh-my-pi/omp-stats` is unresolvable. Docs are silent rather than wrong. (`omp://extensions.md`: "`omp.pi` (package exports)" is documented as exposed API, implying package imports are expected to work — they do, but only for the seven host basenames or anything with a real `node_modules` entry.)

## Gaps

- **Could not establish** whether `bun.lock` in `~/.omp/plugins` was written by `PluginManager.install` on this machine or by a manual `bun install` in that directory. The doc's claim (install step 4 runs `bun install` there) is consistent but the file carries no provenance marker.
- **Could not establish** a guaranteed offline-safe `peerDependencies` convention. The source comments strongly imply peers are *accepted*, and there is a compiled-binary fallback that honors them, but **no example package in `examples/` or `~/.omp/plugins/node_modules` uses `peerDependencies` for `@oh-my-pi/*`** — I found none. The claim rests on a source comment, not an observed working example.
- **No CHANGELOG entries exist** for extension dependency resolution / plugin bundling, so I could not date these behaviors or find rationale for the `PI_PACKAGE_NAMES` seven-package allowlist. Whether `omp-stats` was deliberately excluded or simply not yet added is **NOT FOUND**.
- **Could not verify** that `omp plugin link` actually surfaces `omp-stats` correctly at runtime end-to-end (would require a live `omp` session and writing into `~/.omp/plugins`); I verified the resolution primitives, not the full runtime.
- **The `--trusted-extension` help text** could not be quoted verbatim from source because it is **not defined in `launch-help.ts`** and not printed by `omp --help`. Only the `omp://cli-reference.md` paraphrase is available.