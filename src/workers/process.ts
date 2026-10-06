import { getActiveProfile, getAgentDir } from "@oh-my-pi/pi-utils";

export interface StatsWorkerProcess {
	readonly pid: number;
	readonly stdin: Bun.FileSink | number | null;
	readonly stdout: ReadableStream<Uint8Array> | number | null;
	readonly stderr: ReadableStream<Uint8Array> | number | null;
	readonly exited: Promise<number>;
	kill(signal?: NodeJS.Signals | number): void;
}

/** Compiled omp cannot execute plugin worker source through process.execPath. */
export function spawnStatsWorker(path: string, purpose: string, stdin: "pipe" | "ignore" = "ignore"): StatsWorkerProcess {
	const searchPath = process.env.PATH;
	const bun = searchPath ? Bun.which("bun", { path: searchPath }) : null;
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
