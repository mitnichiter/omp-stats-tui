import type { FeatureContext, FeatureController } from "./types";
import { createRequestsFeature } from "./core/requests";
import { createAnalyticsFeature } from "./core/analytics";
import { createSummaryFeature } from "./core/summary";

/** One retained controller per core screen; unknown routes belong to another factory. */
export function createCoreFeature(id: string, ctx: FeatureContext): FeatureController | null {
	switch (id) {
		case "requests": case "errors": return createRequestsFeature(id, ctx);
		case "models": case "costs": case "tools": return createAnalyticsFeature(id, ctx);
		case "overview": case "projects": case "activity": return createSummaryFeature(id, ctx);
		default: return null;
	}
}
