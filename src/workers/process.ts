import { getActiveProfile, getAgentDir } from "@oh-my-pi/pi-utils";

export interface StatsWorkerProcess {
	readonly pid: number;
	// `undefined` is what Bun yields for a non-piped stream, so it belongs in the
	// union: `Bun.spawn` types `stdin` as `FileSink | undefined` for the
	// `"pipe" | "ignore"` argument, and a consumer that ignores stdin (the
	// default here) sees exactly that. `client.ts` already guards with
	// `!stdin`, which is why the mismatch only surfaced at the assignment.
	readonly stdin: Bun.FileSink | number | null | undefined;
	readonly stdout: ReadableStream<Uint8Array> | number | null;
	readonly stderr: ReadableStream<Uint8Array> | number | null;
	readonly exited: Promise<number>;
	kill(signal?: NodeJS.Signals | number): void;
}

/** Compiled omp cannot execute plugin worker source through process.execPath. */
export function spawnStatsWorker(path: string, purpose: string, stdin: "pipe" | "ignore" = "ignore"): StatsWorkerProcess {
	const searchPath = process.env.PATH;
	// `PATH`, not `path`: `WhichOptions` overrides the `PATH` environment
	// variable. A lowercase `path` was silently ignored, so this searched the
	// ambient PATH rather than the one just read from `process.env`.
	const bun = searchPath ? Bun.which("bun", { PATH: searchPath }) : null;
	if (!bun) {
		throw new Error(`${purpose} requires standalone Bun. Install Bun and ensure \`bun\` is available on PATH, then restart omp.`);
	}
	const profile = getActiveProfile() ?? "";
	return Bun.spawn([bun, "run", path], {
		env: {
			...process.env,
			// This is standalone Bun source mode, never the compiled host's module registry.
			PI_BUNDLED: "",
			PI_CODING_AGENT_DIR: getAgentDir(),
			OMP_PROFILE: profile,
			PI_PROFILE: profile,
		},
		stdin,
		stdout: "pipe",
		stderr: "pipe",
	});
}
