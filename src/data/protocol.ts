import type { DataNeed } from "./api";
import type { Range } from "./ranges";
import type { StatsApiOptions } from "../tui/features/types";
import type { LiveStatus } from "@oh-my-pi/omp-stats/shared-types";

export type ReadStage = "initializing" | "reading";
export type DataWorkerRequest =
	| { id: number; type: "fetch"; needs: readonly DataNeed[]; range: Range }
	| { id: number; type: "sync" }
	| ({ id: number; type: "api"; path: string; params: Record<string, string> } & StatsApiOptions);
export type DataWorkerResponse =
	| { type: "live"; status: LiveStatus }
	| { id: number; stage: ReadStage }
	| { id: number; data: unknown }
	| { id: number; error: string };
