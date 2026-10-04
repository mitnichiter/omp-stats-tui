/**
 * `src/layout/host-derived.ts` — the derived figures the DASHBOARD computes.
 *
 * WHY THIS FILE EXISTS. `resolve.ts` implements four generic ops over the
 * payload: sum, count, share, max. Those are enough for a total, a count and a
 * ratio — and they are exactly enough to get six figures WRONG while every one
 * of them resolves to a plausible number:
 *
 *   ┌──────────────────┬────────────────────────────┬──────────────────────────┐
 *   │ figure           │ what the generic ops give  │ what the dashboard gives │
 *   ├──────────────────┼────────────────────────────┼──────────────────────────┤
 *   │ Average per day  │ max bucket cost            │ totalCost ÷ activeDays   │
 *   │ Top model        │ the first row's model     │ the highest-cost model   │
 *   │ Per priced req   │ totalCost ÷ all requests  │ totalCost ÷ (req − unpr) │
 *   │ Cache rate       │ folders[0].cacheRate      │ a rate over ALL folders  │
 *   │ Signatures       │ distinct raw messages     │ distinct SIGNATURES      │
 *   │ Affected models  │ distinct model names      │ distinct model::provider │
 *   └──────────────────┴────────────────────────────┴──────────────────────────┘
 *
 * None of these are arithmetic mistakes in the four ops. They are the ops being
 * APPLIED to the wrong question, and the result is always a real number that
 * looks like an answer. That is the worst class of bug this panel can have:
 * `$0.05 per request` instead of `$0.055`, a mean instead of a peak, a string
 * count instead of a signature count. Nothing throws; the reader simply trusts
 * a figure that is not the dashboard's.
 *
 * SO THEY ARE NOT REIMPLEMENTED HERE. Each one is a DELEGATION to the function
 * the web app itself calls, imported from the same pinned package version the
 * web client runs. That is the only way this stays true across upgrades: if the
 * host changes what "average per day" means, we change with it on the next
 * dependency bump instead of drifting silently. Re-deriving `totalCost ÷ new
 * Set(timestamps).size` here would be a second implementation of a formula we
 * do not own, and it would rot without ever failing.
 *
 * The names are the IR's, and `test/parity.test.ts` asserts each of them equals
 * the host function's answer on a shared fixture — so "we call the host's
 * function" is not a claim, it is a checked fact.
 */

import {
	buildCostSummary,
	buildFolderRows,
	errorSignature as errorSignatureOf,
	groupErrorsBySignature,
	requestStatus,
	summarizeRequests,
} from "@oh-my-pi/omp-stats/client/data/view-models";
import { modelKey } from "@oh-my-pi/omp-stats/client/data/colors";
import type { CostTimeSeriesPoint, FolderStats } from "@oh-my-pi/omp-stats/shared-types";

import type { DataRow } from "./resolve";
import { rowsFor } from "./resolve";

/** What a host-derived figure answers. `string` for the ones that name a row. */
export type HostDerived = number | string | null;

/**
 * The rows of one source, typed for a host view-model call.
 *
 * The cast is honest rather than convenient: these payload rows ARE
 * `CostTimeSeriesPoint`s / `FolderStats`s — the routes hand the very same
 * objects straight to the very same functions — and the panel's rows are typed
 * `object` only because the IR names fields by string. Where a field is missing
 * the host's own arithmetic reads it as `undefined` and its sums skip it, which
 * is what it does for a sparse row from any source.
 */
function rowsAs<T>(rows: readonly DataRow[]): readonly T[] {
	return rows as readonly T[];
}

/**
 * The cost summary, computed by the host, once per call.
 *
 * `buildCostSummary` walks the whole series and builds a per-model map, and
 * three tiles on one screen each need a different field of the result. The rows
 * are identical every time, so the map is built once per resolve call chain and
 * handed to each figure — the alternative is rebuilding it per tile, which on a
 * 90-day all-time series is the same work three times over.
 */
function costSummary(rows: readonly DataRow[]) {
	return buildCostSummary(rowsAs<CostTimeSeriesPoint>(rows));
}

/**
 * Every figure here answers `null` for a source that was never FETCHED, which
 * `resolve.ts`'s generic ops already do and which these must match. A figure
 * over an unasked query is ABSENT; only an asked-and-empty query is a zero.
 */
export interface HostContext {
	data: Parameters<typeof rowsFor>[1];
	/** True when the payload behind `source` was actually requested. */
	fetched: boolean;
}

/**
 * THE SIX FIGURES, keyed by the IR's `DerivedRef.name`.
 *
 * `Source` is declared rather than inferred so a name can never be registered
 * against a source it does not read: `hostDerived` is called with the rows the
 * IR says this ref points at, and a mismatch would silently read the wrong
 * payload.
 */
export const HOST_DERIVED: Readonly<
	Record<
		string,
		{
			readonly source: string;
			compute(rows: readonly DataRow[], ctx: HostContext): HostDerived;
		}
	>
> = {
	/**
	 * `CostsRoute.tsx:258` — "Estimate ÷ days with any usage", where the days are
	 * the DISTINCT day buckets in the series (`buildCostSummary` counts them with
	 * `new Set(timestamps)`). Not the mean of the daily totals either: a series
	 * with a gap in it has fewer rows than it has days in its span, and the
	 * denominator is days that CARRIED usage.
	 *
	 * Zero active days is 0, not `NaN` and not `Infinity`.
	 */
	avgDailyCost: {
		source: "costSeries",
		compute: rows => costSummary(rows).avgDailyCost,
	},

	/**
	 * `view-models.ts:188-189` — the top model is `models[0]` AFTER the sort by
	 * cost, requests, then key, and it is `null` when that row's cost is 0. So
	 * this is genuinely the biggest spender, not the first row of the series: the
	 * cost payload arrives in bucket order, and the cheapest model on an early day
	 * is row 0.
	 *
	 * A `string` because a tile that says which model won is a LABEL, and the IR
	 * already has a `LabelRef` for exactly that — this is the same answer reached
	 * through the host's own ranking.
	 */
	topModel: {
		source: "costSeries",
		compute: rows => costSummary(rows).topModel?.model ?? null,
	},

	/**
	 * `CostsRoute.tsx:242,270` — the denominator is `requests - unpricedRequests`,
	 * because an unpriced request has no per-request cost to divide by. Dividing by
	 * all requests understates the figure by exactly the unpriced share, and the
	 * dashboard's own hint names that share so the reader can check the work.
	 *
	 * `null` when nothing is priced: the web renders "–", and a zero would read as
	 * "free".
	 */
	perPricedRequest: {
		source: "costSeries",
		compute: rows => {
			const summary = costSummary(rows);
			const priced = summary.requests - summary.unpricedRequests;
			return priced > 0 ? summary.totalCost / priced : null;
		},
	},

	/**
	 * `view-models.ts:282` — cache reads ÷ (uncached input + cache reads), summed
	 * over EVERY folder in range and only then divided.
	 *
	 * This is the one figure the payload cannot answer directly: every folder row
	 * carries its OWN `cacheRate`, so reading `folders[0].cacheRate` is a real
	 * field that resolves cleanly and is one folder's answer to a question about
	 * all of them. Cache WRITES are excluded from the denominator, matching both
	 * the host and `format.ts`'s `cacheShare`.
	 */
	rangeCacheRate: {
		source: "folders",
		compute: rows => buildFolderRows(rowsAs<FolderStats>(rows)).cacheRate,
	},

	/**
	 * `ErrorsRoute.tsx:140` — distinct NORMALIZED messages. `errorSignature`
	 * collapses request ids, hex hashes and counters, so two failures that differ
	 * only in "req_abc123" vs "req_zzz999" and "3 tries" vs "7 tries" are one
	 * signature. Counting distinct RAW strings counts the noise, and on a rate
	 * limited provider the difference is large: the raw count grows with traffic
	 * while the signature count stays flat.
	 *
	 * `groupErrorsBySignature` also does the grouping, so this is the host's count
	 * of the host's groups rather than our regex pipeline's guess at them.
	 */
	errorSignatureCount: {
		source: "errorMessages",
		compute: rows => groupErrorsBySignature(rowsAs<Parameters<typeof groupErrorsBySignature>[0][number]>(rows))
			.length,
	},

	/**
	 * `ErrorsRoute.tsx:296-340` — one signature's share of the failures: the
	 * group count for the row's own normalized signature, from the host's
	 * `groupErrorsBySignature`. Row-scoped by construction: the table resolves
	 * it per row, so the meter divides by the largest group on screen.
	 */
	signatureFailures: {
		source: "errorMessages",
		compute: rows => {
			const [row] = rows as readonly { errorMessage?: unknown }[];
			if (!row || typeof row.errorMessage !== "string") return null;
			const groups = groupErrorsBySignature(rowsAs<Parameters<typeof groupErrorsBySignature>[0][number]>(rows));
			const signature = errorSignatureOf(row.errorMessage);
			return groups.find(group => group.signature === signature)?.count ?? null;
		},
	},

	/**
	 * `ErrorsRoute.tsx:56-65` — distinct `modelKey(model, provider)`, NOT distinct
	 * model names. One model served by two providers is two rows in the database's
	 * eyes, and the dashboard's "By model" card lists it twice.
	 *
	 * Counting model names merges them and under-reports by however many providers
	 * serve the same model — which on a gateway setup is most of them.
	 */
	affectedModelCount: {
		source: "errorMessages",
		compute: rows => {
			const seen = new Set<string>();
			for (const row of rows) {
				const record = row as Record<string, unknown>;
				const model = record.model;
				const provider = record.provider;
				if (typeof model !== "string") continue;
				seen.add(modelKey(model, typeof provider === "string" ? provider : ""));
			}
			return seen.size;
		},
	},

	/**
	 * `ModelsRoute.tsx:266-273` — the max-`totalRequests` row's name, never the
	 * first payload row: the byModel payload arrives in request-desc order from
	 * the server, but the route re-derives the top by comparison, and a server
	 * that stopped sorting would otherwise move the tile.
	 *
	 * `null` when no row carries requests: the web renders "–", and a name
	 * from an empty list would be invented.
	 */
	mostUsedModel: {
		source: "byModel",
		compute: rows => {
			let top: { model?: unknown; totalRequests?: unknown } | undefined;
			for (const row of rows) {
				const record = row as { model?: unknown; totalRequests?: unknown };
				if (typeof record.totalRequests !== "number") continue;
				if (!top || (top.totalRequests as number) < record.totalRequests) top = record;
			}
			return top && typeof top.model === "string" && (top.totalRequests as number) > 0 ? top.model : null;
		},
	},

	/**
	 * `RequestsRoute.tsx:64` — `summarizeRequests(inRange)` over the LOADED rows,
	 * not over the `errors` endpoint. The endpoint is range+limit capped and
	 * excludes the ok/aborted context the status needs, so counting it as
	 * "failed" disagrees with the dashboard by however many failures fell
	 * outside the cap. `requestStatus` is the host's own outcome rule:
	 * aborted beats error, error-or-message fails, the rest is ok.
	 */
	requestFailed: {
		source: "recentMessages",
		compute: rows => summarizeRequests(rowsAs<Parameters<typeof summarizeRequests>[0][number]>(rows)).failed,
	},

	/**
	 * `RequestsRoute.tsx:64` — the aborted share of the same summary. The
	 * `errors` payload cannot supply it: aborted is a `stopReason`, not an
	 * error message, and only the loaded rows carry it.
	 */
	requestAborted: {
		source: "recentMessages",
		compute: rows => summarizeRequests(rowsAs<Parameters<typeof summarizeRequests>[0][number]>(rows)).aborted,
	},

	/**
	 * `RequestsRoute.tsx:64` — nearest-rank quantiles over the loaded rows'
	 * durations and ttfts (`view-models.ts` quantile: ascending, ceil(q*n)-1).
	 * A mean would answer a different question; `null` when no row carried one.
	 * `formatDurationMs(null)` renders "–", which is the web's own empty path.
	 */
	medianDuration: {
		source: "recentMessages",
		compute: rows => summarizeRequests(rowsAs<Parameters<typeof summarizeRequests>[0][number]>(rows)).medianDuration,
	},
	p95Duration: {
		source: "recentMessages",
		compute: rows => summarizeRequests(rowsAs<Parameters<typeof summarizeRequests>[0][number]>(rows)).p95Duration,
	},
	medianTtft: {
		source: "recentMessages",
		compute: rows => summarizeRequests(rowsAs<Parameters<typeof summarizeRequests>[0][number]>(rows)).medianTtft,
	},

	/**
	 * `view-models.ts:325` — the outcome of ONE row: aborted, failed, or ok.
	 * Row-scoped by construction: the table resolves it per row, and a badge
	 * over `errorMessage` alone would call an aborted request failed.
	 */
	requestStatus: {
		source: "recentMessages",
		compute: (rows, ctx) => {
			const [row] = rows as readonly Parameters<typeof requestStatus>[0][];
			if (!row) return null;
			return requestStatus(row);
		},
	},

	savedPerHit: {
		source: "gainOverall",
		compute: rows => {
			const [overall] = rows as readonly { savedTokens?: unknown; hits?: unknown }[];
			const saved = typeof overall?.savedTokens === "number" ? overall.savedTokens : null;
			const hits = typeof overall?.hits === "number" ? overall.hits : null;
			if (saved === null || hits === null || hits <= 0) return null;
			return saved / hits;
		},
	},

	/**
	 * `GainRoute.tsx` `sourceRows`: one source's share of all saved tokens,
	 * `total > 0 ? saved / total : 0`. Row-scoped: the table resolves the row's
	 * own tokens and divides by the GRAND total, which the `againstScope`
	 * marker on the ref selects.
	 */
	sourceShare: {
		source: "gainBySource",
		compute: (rows, ctx) => {
			const [row] = rows as readonly { savedTokens?: unknown }[];
			const saved = typeof row?.savedTokens === "number" ? row.savedTokens : null;
			if (saved === null) return null;
			const totals = rowsFor("gainOverall", ctx.data);
			const [overall] = totals as readonly { savedTokens?: unknown }[];
			const total = typeof overall?.savedTokens === "number" ? overall.savedTokens : null;
			if (total === null || total <= 0) return 0;
			return saved / total;
		},
	},
};

/** The entry for an IR `name`, or `undefined` when the name is not host-derived. */
export function hostDerived(name: string) {
	return Object.hasOwn(HOST_DERIVED, name) ? HOST_DERIVED[name] : undefined;
}