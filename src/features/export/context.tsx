/**
 * Page export (PDF report, PNG per chart, CSV per table): what a screen can export is collected here.
 *
 * A screen (TTScreen, an experience's analytics) makes an ExportRegistry and provides it. The things that draw data
 * register an ExportBlock with it on their own: charts (LineChart, BarChart, ShareBars), stat grids and data tables,
 * and pages with their own drawings (the funnel steps) call useExportBlock. A block reads its data when the export
 * runs, so it is always what is on screen: the page's filters, a table's own filters and sort, the picked funnel.
 *
 * Titles: a Panel or a titled Section around a chart or table names it (ExportTitle), unless the block names itself.
 *
 * This module imports nothing from the UI, so components/ui.tsx can use it.
 */
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";

export interface SeriesData {
	name: string;
	color?: string;
	dashed?: boolean;
	points: { t: number; v: number | null }[];
}

export type ExportBlock =
	/** A table: every row as filtered and sorted, display text; `csv` is the raw CSV the table's own export writes. */
	| {
			kind: "table";
			title: string;
			columns: string[];
			rows: string[][];
			csv: () => string;
			note?: string;
			/** Pictures per row and column (an ad's creative): drawn above the cell's text in the PDF and PNG. */
			images?: string[][][];
	  }
	/** Values over time. */
	| { kind: "series"; title: string; chart: "line" | "bar"; series: SeriesData[]; format: (v: number) => string; timeLabel: (t: number) => string; note?: string }
	/** Labelled horizontal bars (a breakdown, funnel steps): `share` 0..1 is the bar, `text` what it says. */
	| { kind: "bars"; title: string; rows: { label: string; share: number; text: string; sub?: string; alert?: boolean }[]; note?: string }
	/** Key numbers. */
	| { kind: "stats"; title: string; items: { label: string; value: string; sub?: string }[]; note?: string };

export interface ExportRegistry {
	register(id: string, get: () => ExportBlock | null): () => void;
	/** The blocks on the screen now, in the order they were first shown, empty ones left out. */
	blocks(): ExportBlock[];
	/** Lines for the export's header from what is on the screen (the filter bar: the filters in effect). */
	registerLines(id: string, get: () => string[]): () => void;
	lines(): string[];
}

export function createExportRegistry(): ExportRegistry {
	let seq = 0;
	const entries = new Map<string, { seq: number; get: () => ExportBlock | null }>();
	const lineSources = new Map<string, () => string[]>();
	return {
		registerLines(id, get) {
			lineSources.set(id, get);
			return () => {
				if (lineSources.get(id) === get) lineSources.delete(id);
			};
		},
		lines() {
			return [...new Set([...lineSources.values()].flatMap((get) => get()))];
		},
		register(id, get) {
			const entry = { seq: entries.get(id)?.seq ?? seq++, get };
			entries.set(id, entry);
			return () => {
				if (entries.get(id) === entry) entries.delete(id);
			};
		},
		blocks() {
			const out: ExportBlock[] = [];
			for (const e of [...entries.values()].sort((a, b) => a.seq - b.seq)) {
				try {
					const block = e.get();
					if (block && !isEmpty(block)) out.push(block);
				} catch {
					// a block that can't be read now is left out of this export
				}
			}
			return dedupeTitles(out);
		},
	};
}

function isEmpty(b: ExportBlock): boolean {
	switch (b.kind) {
		case "table":
			return b.rows.length === 0;
		case "series":
			return !b.series.some((s) => s.points.some((pt) => pt.v !== null));
		case "bars":
			return b.rows.length === 0;
		case "stats":
			return b.items.length === 0;
	}
}

/** Two blocks with one title ("Players", "Players") become "Players", "Players (2)", so the sheet and files tell them apart. */
function dedupeTitles(blocks: ExportBlock[]): ExportBlock[] {
	const seen = new Map<string, number>();
	return blocks.map((b) => {
		const n = (seen.get(b.title) ?? 0) + 1;
		seen.set(b.title, n);
		return n === 1 ? b : { ...b, title: `${b.title} (${n})` };
	});
}

const RegistryContext = createContext<ExportRegistry | null>(null);
const TitleContext = createContext<string | undefined>(undefined);

export function ExportProvider({ registry, children }: { registry: ExportRegistry; children: ReactNode }) {
	return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

/** Names the charts and tables inside (a Panel's or Section's title). */
export function ExportTitle({ title, children }: { title: string | undefined; children: ReactNode }) {
	return <TitleContext.Provider value={title}>{children}</TitleContext.Provider>;
}

export function useExportTitle(): string | undefined {
	return useContext(TitleContext);
}

/**
 * Registers a block while the component is mounted. `make` gets the surrounding title (or undefined) and runs when an
 * export is made, with the component's latest props. Outside an export screen it does nothing.
 */
export function useExportBlock(make: (title: string | undefined) => ExportBlock | null): void {
	const registry = useContext(RegistryContext);
	const title = useContext(TitleContext);
	const id = useId();
	const latest = useRef({ make, title });
	latest.current = { make, title };
	useEffect(() => registry?.register(id, () => latest.current.make(latest.current.title)), [registry, id]);
}

/** The plain text inside a React node ("1.2K", <Txt>45%</Txt>): what a stat's value says. */
export function textOf(node: ReactNode): string {
	if (node === null || node === undefined || typeof node === "boolean") return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (typeof node === "object" && "props" in node) return textOf((node.props as { children?: ReactNode }).children);
	return "";
}

/** Adds lines to the export's header while mounted (the filter bar: the filters in effect). */
export function useExportLines(make: () => string[]): void {
	const registry = useContext(RegistryContext);
	const id = useId();
	const latest = useRef(make);
	latest.current = make;
	useEffect(() => registry?.registerLines(id, () => latest.current()), [registry, id]);
}
