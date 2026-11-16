/**
 * A custom dashboard document as something the phone can draw: every tile (chart, table, summary card, tabbed and
 * controlled variants) in reading order, each turned into Analytics Query API calls. Computed metrics query each
 * source and evaluate the formula here (+ - * / and parentheses over the source keys). Also the small edits the app
 * makes to a document (add a chart tile, remove a tile) before validating and publishing it.
 */
import type { Granularity } from "@/api/opencloud";

import type {
	ChartTile,
	CustomDashboardDocument,
	DashboardChartDataSpec,
	DashboardControlledSubcontextBody,
	DashboardChartType,
	DashboardGranularity,
	DashboardLayoutNode,
	DashboardMetricReference,
	DashboardSurface,
	DashboardTable,
	SummaryCardTile,
	TileFilter,
} from "../api/analytics-tools";

export interface DashTile {
	/** Stable key (tileId / componentId, else the position). */
	key: string;
	/** The tileId / componentId the document uses (for removal); empty when it has none. */
	id: string;
	kind: "chart" | "table" | "summary";
	title: string;
	/** Where it sits ("Tab: Retention"), when the page has tabs. */
	section?: string;
	chartType?: DashboardChartType | number | null;
	/** One entry per series / column. */
	series: { key: string; label: string; metric: DashboardMetricReference; filters: TileFilter[] }[];
	granularity: Granularity;
	breakdown: string[];
	filters: TileFilter[];
	aggregation?: string | number | null;
}

const GRANULARITY: Record<string, Granularity> = {
	DASHBOARD_GRANULARITY_CUMULATIVE: "None",
	DASHBOARD_GRANULARITY_MINUTE: "OneMinute",
	DASHBOARD_GRANULARITY_HALF_HOUR: "HalfHour",
	DASHBOARD_GRANULARITY_HOUR: "OneHour",
	DASHBOARD_GRANULARITY_DAY: "OneDay",
	DASHBOARD_GRANULARITY_WEEK: "OneWeek",
	DASHBOARD_GRANULARITY_MONTH: "OneMonth",
};
const GRANULARITY_BY_NUMBER: Granularity[] = ["OneDay", "None", "OneMinute", "HalfHour", "OneHour", "OneDay", "OneWeek", "OneMonth"];

export function toGranularity(g: DashboardGranularity | number | null | undefined, fallback: Granularity): Granularity {
	if (typeof g === "number") return g > 0 ? (GRANULARITY_BY_NUMBER[g] ?? fallback) : fallback;
	return (g && GRANULARITY[g]) || fallback;
}

export const DASH_GRANULARITIES: { value: DashboardGranularity; label: string }[] = [
	{ value: "DASHBOARD_GRANULARITY_DAY", label: "Daily" },
	{ value: "DASHBOARD_GRANULARITY_HOUR", label: "Hourly" },
	{ value: "DASHBOARD_GRANULARITY_WEEK", label: "Weekly" },
	{ value: "DASHBOARD_GRANULARITY_MONTH", label: "Monthly" },
	{ value: "DASHBOARD_GRANULARITY_CUMULATIVE", label: "Total" },
];

export const DASH_CHART_TYPES: { value: DashboardChartType; label: string }[] = [
	{ value: "DASHBOARD_CHART_TYPE_SPLINE", label: "Line" },
	{ value: "DASHBOARD_CHART_TYPE_AREA", label: "Area" },
	{ value: "DASHBOARD_CHART_TYPE_COLUMN", label: "Columns" },
	{ value: "DASHBOARD_CHART_TYPE_BAR", label: "Bars" },
	{ value: "DASHBOARD_CHART_TYPE_PIE", label: "Pie" },
	{ value: "DASHBOARD_CHART_TYPE_TABLE", label: "Table" },
];

/** Chart types drawn as totals per breakdown value rather than over time. */
export function isTotalsChart(t: DashTile): boolean {
	const c = t.chartType;
	return t.kind !== "chart" || c === "DASHBOARD_CHART_TYPE_BAR" || c === "DASHBOARD_CHART_TYPE_PIE" || c === "DASHBOARD_CHART_TYPE_TABLE" || c === 3 || c === 5 || c === 6 || t.granularity === "None";
}

export function metricLabel(m: DashboardMetricReference | null | undefined): string {
	if (!m) return "metric";
	if (m.computedMetric) return m.computedMetric.displayName || m.computedMetric.formula || "computed metric";
	return m.metricKey || "metric";
}

function surfaceGranularity(s: DashboardSurface | null | undefined): Granularity {
	return toGranularity(s?.controls?.granularity?.fixed?.granularity, "OneDay");
}

function fromSpec(base: { key: string; id: string; title: string; section?: string; kind: DashTile["kind"]; chartType?: DashTile["chartType"] }, spec: DashboardChartDataSpec | null | undefined, surface: DashboardSurface | null | undefined): DashTile {
	const metrics = spec?.metrics ?? [];
	return {
		...base,
		series: metrics
			.filter((m) => m.metric)
			.map((m, i) => ({ key: m.seriesKey || `s${i}`, label: metricLabel(m.metric), metric: m.metric!, filters: m.filters ?? [] })),
		granularity: base.kind === "table" ? "None" : toGranularity(spec?.granularity, surfaceGranularity(surface)),
		breakdown: spec?.breakdownDimensionKeys?.length ? spec.breakdownDimensionKeys : (surface?.controls?.defaultBreakdownDimensionKeys ?? []),
		filters: [...(surface?.controls?.defaultFilters ?? []), ...(spec?.filters ?? [])],
		aggregation: spec?.aggregation,
	};
}

/** Every tile of the document, in reading order. */
export function collectTiles(doc: CustomDashboardDocument | null | undefined): DashTile[] {
	const out: DashTile[] = [];
	const page = doc?.config?.page;
	let n = 0;
	const chart = (c: ChartTile, surface: DashboardSurface | null | undefined, section?: string, extraTitle?: string) => {
		const id = c.tileId ?? "";
		const kind = c.chartSpec?.chartType === "DASHBOARD_CHART_TYPE_TABLE" || c.chartSpec?.chartType === 6 ? "table" : "chart";
		out.push(fromSpec({ key: id || `tile-${n++}`, id, title: [extraTitle, c.title].filter(Boolean).join(" · ") || "Chart", section, kind, chartType: c.chartSpec?.chartType }, c.dataSpec, surface));
	};
	const table = (t: DashboardTable, surface: DashboardSurface | null | undefined, section?: string, extraTitle?: string) => {
		const id = t.componentId ?? "";
		out.push(fromSpec({ key: id || `tile-${n++}`, id, title: [extraTitle, t.title].filter(Boolean).join(" · ") || "Table", section, kind: "table" }, t.dataSpec, surface));
	};
	const summary = (s: SummaryCardTile, surface: DashboardSurface | null | undefined, section?: string) => {
		const id = s.tileId ?? "";
		out.push({
			key: id || `tile-${n++}`,
			id,
			kind: "summary",
			title: s.title || metricLabel(s.metric),
			section,
			series: s.metric ? [{ key: "value", label: metricLabel(s.metric), metric: s.metric, filters: [] }] : [],
			granularity: "None",
			breakdown: [],
			filters: [...(surface?.controls?.defaultFilters ?? []), ...(s.filters ?? [])],
			aggregation: s.aggregation,
		});
	};
	const walk = (nodes: DashboardLayoutNode[] | null | undefined, surface: DashboardSurface | null | undefined, section?: string, depth = 0) => {
		if (!nodes || depth > 20) return;
		for (const node of nodes) {
			const c = node.component;
			if (c) {
				const body = c.controlledSubcontext?.body;
				for (const part of [c, body]) {
					if (!part) continue;
					if (part.chart) chart(part.chart, surface, section);
					if (part.table) table(part.table, surface, section);
					for (const tab of part.tabbedChart?.tabs ?? []) if (tab.chart) chart(tab.chart, surface, section, part.tabbedChart?.title ? `${part.tabbedChart.title} (${tab.labelKey || tab.tabKey})` : tab.labelKey || tab.tabKey);
					for (const tab of part.tabbedTable?.tabs ?? []) if (tab.table) table(tab.table, surface, section, part.tabbedTable?.title ? `${part.tabbedTable.title} (${tab.labelKey || tab.tabKey})` : tab.labelKey || tab.tabKey);
				}
				if (c.summaryCard) summary(c.summaryCard, surface, section);
			}
			walk(node.stack?.children, surface, section, depth + 1);
			walk(node.flex?.children, surface, section, depth + 1);
			walk(node.grid?.children, surface, section, depth + 1);
		}
	};
	if (page?.untabbed?.surface) walk(page.untabbed.surface.bodyNodes, page.untabbed.surface);
	for (const tab of page?.fixedTab?.tabs ?? []) walk(tab.surface?.bodyNodes, tab.surface, `Tab: ${tab.labelKey || tab.tabKey || "?"}`);
	if (page?.breakdownTab) {
		walk(page.breakdownTab.preTabNodes, page.breakdownTab.tabSurface);
		walk(page.breakdownTab.tabSurface?.bodyNodes, page.breakdownTab.tabSurface, `Per ${page.breakdownTab.tabBreakdownDimensionKey || "breakdown"}`);
	}
	return out;
}

/** The default date range of the page's surface ("LAST_28_DAYS" and the like), as days; null when it has none. */
export function defaultRangeDays(doc: CustomDashboardDocument | null | undefined): number | null {
	const key = doc?.config?.page?.untabbed?.surface?.controls?.timeRangeOptions?.dateRange?.defaultSelection?.relativeRangeKey ?? "";
	const m = /(\d+)/.exec(key);
	return m ? Number(m[1]) : null;
}

// Edits --------------------------------------------------------------------------------------------------------------

const CURRENT_SCHEMA = 3;

/** A copy of the document with a chart tile appended to the (untabbed) page; an empty document gets one. */
export function addChartTile(
	doc: CustomDashboardDocument | null | undefined,
	tile: { title: string; metricKey: string; granularity: DashboardGranularity; chartType: DashboardChartType; breakdown: string[]; filters: TileFilter[] },
): CustomDashboardDocument {
	const next: CustomDashboardDocument = JSON.parse(JSON.stringify(doc ?? {}));
	if (!next.schemaVersion) next.schemaVersion = CURRENT_SCHEMA;
	next.config = next.config ?? {};
	next.config.page = next.config.page ?? {};
	if (!next.config.page.untabbed && (next.config.page.fixedTab || next.config.page.breakdownTab)) throw new Error("This dashboard uses tabs; add tiles to it on Creator Hub.");
	const page = (next.config.page.untabbed = next.config.page.untabbed ?? {});
	const surface = (page.surface = page.surface ?? { resourceTypeKeys: ["DASHBOARD_RESOURCE_TYPE_KEY_UNIVERSE"] });
	surface.bodyNodes = surface.bodyNodes ?? [];
	const chart: ChartTile = {
		tileId: `tile-${Date.now().toString(36)}`,
		title: tile.title,
		dataSpec: {
			metrics: [{ metric: { metricKey: tile.metricKey }, seriesKey: "series-1" }],
			granularity: tile.granularity,
			...(tile.breakdown.length ? { breakdownDimensionKeys: tile.breakdown } : {}),
			...(tile.filters.length ? { filters: tile.filters } : {}),
		},
		chartSpec: { chartType: tile.chartType },
	};
	surface.bodyNodes.push({ component: { chart } });
	return next;
}

/**
 * A copy of the document without the tile `id` (a chart / summary tileId or a table / tabbed componentId). A tile
 * inside a tabbed chart or table removes just that tab, and the whole tabbed component when it was the last tab.
 * `removed` is false when nothing matched, so the caller doesn't publish an unchanged document.
 */
export function removeTile(doc: CustomDashboardDocument, id: string): { doc: CustomDashboardDocument; removed: boolean } {
	const next: CustomDashboardDocument = JSON.parse(JSON.stringify(doc));
	let removed = false;
	/** Drops matching tabs from a component part; true when the part had tabs and none are left. */
	const pruneTabs = (part: DashboardControlledSubcontextBody): boolean => {
		let emptied = false;
		if (part.tabbedChart?.tabs?.length) {
			const kept = part.tabbedChart.tabs.filter((t) => !(t.chart?.tileId && t.chart.tileId === id));
			if (kept.length !== part.tabbedChart.tabs.length) {
				removed = true;
				part.tabbedChart.tabs = kept;
				if (!kept.length) emptied = true;
			}
		}
		if (part.tabbedTable?.tabs?.length) {
			const kept = part.tabbedTable.tabs.filter((t) => !(t.table?.componentId && t.table.componentId === id));
			if (kept.length !== part.tabbedTable.tabs.length) {
				removed = true;
				part.tabbedTable.tabs = kept;
				if (!kept.length) emptied = true;
			}
		}
		return emptied;
	};
	const matches = (node: DashboardLayoutNode): boolean => {
		const c = node.component;
		if (!c) return false;
		const body = c.controlledSubcontext?.body;
		const whole =
			[c, body].some((part) => !!part && (part.chart?.tileId === id || part.table?.componentId === id || part.tabbedChart?.componentId === id || part.tabbedTable?.componentId === id)) ||
			c.summaryCard?.tileId === id;
		if (whole) {
			removed = true;
			return true;
		}
		let emptied = false;
		for (const part of [c, body]) if (part && pruneTabs(part)) emptied = true;
		return emptied;
	};
	const prune = (nodes: DashboardLayoutNode[] | null | undefined, depth = 0): DashboardLayoutNode[] | null | undefined => {
		if (!nodes || depth > 20) return nodes;
		return nodes
			.filter((node) => !matches(node))
			.map((node) => {
				if (node.stack) node.stack.children = prune(node.stack.children, depth + 1);
				if (node.flex) node.flex.children = prune(node.flex.children, depth + 1);
				if (node.grid) node.grid.children = prune(node.grid.children, depth + 1);
				return node;
			});
	};
	const page = next.config?.page;
	if (page?.untabbed?.surface) page.untabbed.surface.bodyNodes = prune(page.untabbed.surface.bodyNodes);
	for (const tab of page?.fixedTab?.tabs ?? []) if (tab.surface) tab.surface.bodyNodes = prune(tab.surface.bodyNodes);
	if (page?.breakdownTab) {
		page.breakdownTab.preTabNodes = prune(page.breakdownTab.preTabNodes);
		if (page.breakdownTab.tabSurface) page.breakdownTab.tabSurface.bodyNodes = prune(page.breakdownTab.tabSurface.bodyNodes);
	}
	return { doc: next, removed };
}

// Formulas -----------------------------------------------------------------------------------------------------------

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
	const out: Tok[] = [];
	const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/()]))/y;
	let i = 0;
	while (i < src.length) {
		if (/^\s*$/.test(src.slice(i))) break;
		re.lastIndex = i;
		const m = re.exec(src);
		if (!m) throw new Error(`can't read the formula near “${src.slice(i, i + 8)}”`);
		if (m[1] !== undefined) out.push({ t: "num", v: Number(m[1]) });
		else if (m[2] !== undefined) out.push({ t: "id", v: m[2] });
		else out.push({ t: "op", v: m[3]! });
		i = re.lastIndex;
		if (out.length > 200) throw new Error("the formula is too long");
	}
	return out;
}

/** Evaluates `formula` with `vars` (a missing or null source makes the result null; x / 0 is null). */
export function evaluateFormula(formula: string, vars: Record<string, number | null>): number | null {
	const toks = tokenize(formula);
	let pos = 0;
	const peek = () => toks[pos];
	const expr = (): number | null => {
		let left = term();
		while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
			const op = toks[pos++]!.v;
			const right = term();
			left = left === null || right === null ? null : op === "+" ? left + right : left - right;
		}
		return left;
	};
	const term = (): number | null => {
		let left = factor();
		while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
			const op = toks[pos++]!.v;
			const right = factor();
			left = left === null || right === null ? null : op === "*" ? left * right : right === 0 ? null : left / right;
		}
		return left;
	};
	const factor = (): number | null => {
		const tok = toks[pos++];
		if (!tok) throw new Error("the formula ends too early");
		if (tok.t === "num") return tok.v;
		if (tok.t === "id") {
			if (!(tok.v in vars)) throw new Error(`the formula uses “${tok.v}”, which is not one of its sources`);
			return vars[tok.v] ?? null;
		}
		if (tok.v === "-") {
			const v = factor();
			return v === null ? null : -v;
		}
		if (tok.v === "(") {
			const v = expr();
			if (toks[pos++]?.v !== ")") throw new Error("a parenthesis is not closed");
			return v;
		}
		throw new Error(`unexpected “${tok.v}” in the formula`);
	};
	const value = expr();
	if (pos < toks.length) throw new Error(`unexpected “${toks[pos]!.v}” in the formula`);
	return value !== null && Number.isFinite(value) ? value : null;
}

/** "a, b , c" -> ["a","b","c"] */
export function splitList(text: string): string[] {
	return text
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}
