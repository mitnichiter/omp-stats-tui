import type { Theme } from "@oh-my-pi/pi-tui/theme";
import type { DataNeed, PanelData } from "../../data/api";
import type { Range } from "../../data/ranges";

export interface StatsApiOptions {
	method?: "GET" | "POST";
	headers?: Record<string, string>;
}
export interface FeatureReader {
	api<T>(path: string, params?: Record<string, string>, options?: StatsApiOptions): Promise<T>;
	fetch(needs: readonly DataNeed[], range: Range): Promise<PanelData>;
}
export interface FeatureContext {
	reader: FeatureReader;
	theme: Theme;
	changed(): void;
	copy(text: string): Promise<void>;
	openTrace(file: string, entryId?: string): void;
	openScreen(id: string): void;
	/** Return from a request-linked trace; false when navigation has no origin. */
	backToOrigin?(): boolean;
	now(): number;
}
/** Controllers retain per-screen controls; the parent owns scroll and mount lifetime. */
export interface FeatureController {
	load(range: Range): Promise<void>;
	render(width: number, height: number): readonly string[];
	readonly inputMode?: "text" | "navigation";
	/** true consumes input; false leaves global navigation/scroll/close to the parent. */
	handleInput(data: string): boolean;
	dispose(): void;
	/** Optional cross-route entry for opening a request's associated trace. */
	openTrace?(file: string, entryId?: string): Promise<void>;
}
