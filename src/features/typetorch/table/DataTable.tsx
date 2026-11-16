/**
 * The app's one table, a port of the web explorer's DataTable (backend/web/src/components/data-table/DataTable.tsx):
 *
 *  - tap a header to sort (first direction, the other, off); long-press a header to add it to the sort (the web's
 *    shift-click); numbers, dates and enums sort by their underlying value (`accessor`), never by the text shown
 *  - a search box over the visible columns, per-column filters (checklist, range, "last 24 hours", contains) behind the
 *    filter icon of a header, chips for the active ones
 *  - Columns (show / hide, wider / narrower, reset), "12 of 340 rows", paging with a page size
 *  - long-press a row (or its ⋯) to copy a cell or the row as JSON; Export: save the filtered and sorted view as a CSV
 *    file (share sheet), copy it as CSV, TSV or JSON, copy a link to the view, reset the view
 *  - the view is remembered per backend and table id on the phone and travels in "Copy link to this view" links
 *    (`fleet-servers.sort=-players`)
 *
 * Define the columns outside the component (or in useMemo): the table re-reads them when the array changes.
 */
import { useLocalSearchParams } from "expo-router";
import { createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { Button, Field, Icon, SearchBar, Skeleton, Txt } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { radius, space, useTheme } from "@/theme";

import { useBackendParam } from "../screen";
import { Sheet, SheetItem } from "../sheet";
import { useViewLink, useViewLinkRegistry } from "../view-link";
import { copyText, shareTextFile } from "./export";
import {
	buildSearchIndex,
	copyValue,
	defaultView,
	describeFilter,
	effectiveView,
	exportFilename,
	filterEntries,
	filterOptions,
	isDefaultView,
	isFiltered,
	isVisible,
	numberBounds,
	PAGE_SIZES,
	resolveColumns,
	setKey,
	SINCE_LABELS,
	sortEntries,
	toCsv,
	toggleSort,
	toTsv,
	viewToParams,
	type Column,
	type ColumnFilter,
	type DataColumn,
	type Params,
	type SinceKey,
	type SortSpec,
	type TableView,
} from "./model";
import { useTableView } from "./view";

export type { DataColumn, SortSpec } from "./model";

export interface DataTableProps<T> {
	/** Names this table for the saved view and the link (`fleet-servers`). Unique in the app; letters, digits, - and _. */
	id: string;
	columns: readonly DataColumn<T>[];
	data: readonly T[];
	/** The table's name ("Live servers"), for the export sheet. */
	label?: string;
	/** A stable key for a row (default: its index in `data`). */
	rowId?: (row: T, index: number) => string;
	/** Skeleton rows instead of data. */
	loading?: boolean;
	/** Shown instead of the table when `data` is empty. */
	empty?: ReactNode;
	/** The sort a first visit starts with, e.g. [{ id: "count", desc: true }]. Removing every sort restores the data's own order. */
	defaultSort?: readonly SortSpec[];
	/**
	 * The rows are a page the server picked and ordered (a limit): a header tap asks the server instead (`onChange` gets
	 * the sort, undefined = the server's default order) and the rows are shown as they come. Only `columns` sort, one at a time.
	 */
	serverSort?: { columns: readonly string[]; onChange: (sort: SortSpec | undefined) => void };
	/** Rows per page (default 50; the user can pick 25 to 500). */
	pageSize?: number;
	/** The search box: "auto" (default) shows it from 6 rows up. */
	search?: boolean | "auto";
	/** Extra controls before the row count. */
	toolbar?: ReactNode;
	/** Extra items in the Columns sheet, under the columns (e.g. "Add funnel"). */
	columnsMenu?: ReactNode;
	/** Makes rows tappable. */
	onRowPress?: (row: T) => void;
	isRowSelected?: (row: T) => boolean;
	/** Rows shown first, outside sorting, filtering, paging and export (a total or an average). */
	pinnedRows?: readonly T[];
	/** What "Copy row as JSON" and "Copy as JSON" write (default: the row itself). */
	rowJson?: (row: T) => unknown;
	/** The per-row copy menu (long-press, ⋯). Default on. */
	rowMenu?: boolean;
	/** Remember the view on the phone (default true). */
	persist?: boolean;
	/** Read a link's view and write the view into "Copy link to this view" (default true). */
	urlSync?: boolean;
	density?: "normal" | "compact";
	/** Hide the toolbar (row count, Columns, Export): a tiny fixed table. */
	bare?: boolean;
}

/** What a cell inside a DataTable can do to its table; null outside one. */
export interface TableFilterApi {
	/** Show only the rows whose `columnId` value is `value` (that column's checklist filter, replacing its old one). */
	filterBy(columnId: string, value: unknown): void;
}

const TableFilterContext = createContext<TableFilterApi | null>(null);

/** The surrounding table's filter, for cells that filter on a tap (null outside a DataTable). */
export function useTableFilter(): TableFilterApi | null {
	return useContext(TableFilterContext);
}

const DEFAULT_WIDTH = { number: 92, date: 132, boolean: 70, enum: 110, text: 150 } as const;
const MIN_WIDTH = 48;
const MAX_WIDTH = 600;

function useFlash() {
	const [notice, setNotice] = useState("");
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const flash = useCallback((message: string) => {
		setNotice(message);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setNotice(""), 2500);
	}, []);
	return { notice, flash };
}

export function DataTable<T>({
	id,
	columns: specs,
	data,
	label,
	rowId,
	loading = false,
	empty,
	defaultSort,
	serverSort,
	pageSize: pageSizeProp,
	search: searchMode = "auto",
	toolbar,
	columnsMenu,
	onRowPress,
	isRowSelected,
	pinnedRows,
	rowJson,
	rowMenu = true,
	persist = true,
	urlSync = true,
	density = "normal",
	bare = false,
}: DataTableProps<T>) {
	const p = useTheme();
	const backendId = useBackendParam();
	const { account } = useBackend(backendId);
	const routeParams = useLocalSearchParams<Params>();
	const registry = useViewLinkRegistry();
	const viewLink = useViewLink(backendId, account?.url ?? "", registry);

	const resolved = useMemo(() => resolveColumns(specs, data), [specs, data]);
	const byId = useMemo(() => new Map(resolved.map((c) => [c.id, c])), [resolved]);
	const sortKey = JSON.stringify(defaultSort ?? []);
	const defaults = useMemo(() => defaultView({ sort: JSON.parse(sortKey) as SortSpec[], ...(pageSizeProp ? { pageSize: pageSizeProp } : {}) }), [sortKey, pageSizeProp]);
	const { view: saved, update, reset } = useTableView({ id, storageKey: backendId ? `${backendId}.${id}` : id, defaults, persist, params: urlSync ? routeParams : null });
	const view = useMemo(() => effectiveView(saved, resolved), [saved, resolved]);

	// The screen's "Copy link to this view" carries this table's view.
	const latestView = useRef(view);
	latestView.current = view;
	useEffect(() => {
		if (!registry || !urlSync) return;
		return registry.register(id, () => viewToParams(id, latestView.current, defaults));
	}, [registry, urlSync, id, defaults]);

	const visibleCols = useMemo(() => resolved.filter((c) => isVisible(c, view)), [resolved, view]);
	const visibleKey = visibleCols.map((c) => c.id).join("\n");
	// The search looks at what is on screen: the visible, searchable columns.
	// biome-ignore lint/correctness/useExhaustiveDependencies: visibleKey stands for visibleCols
	const index = useMemo(() => buildSearchIndex(data, visibleCols.filter((c) => c.searchable)), [data, resolved, visibleKey]);
	const search = useDeferredValue(view.search);
	const entries = useMemo(() => filterEntries(data, resolved, { search, filters: view.filters }, index), [data, resolved, search, view.filters, index]);

	const serverColumns = serverSort ? serverSort.columns.join("\n") : undefined;
	const serverSortable = useCallback((columnId: string) => serverColumns === undefined || serverColumns.split("\n").includes(columnId), [serverColumns]);
	const sorting = useMemo(() => (serverColumns === undefined ? view.sort : view.sort.filter((s) => serverSortable(s.id)).slice(0, 1)), [view.sort, serverColumns, serverSortable]);
	const onServerSort = useRef(serverSort?.onChange);
	onServerSort.current = serverSort?.onChange;
	const sortRequest = serverColumns === undefined ? undefined : JSON.stringify(sorting[0] ?? null);
	useEffect(() => {
		if (sortRequest !== undefined) onServerSort.current?.((JSON.parse(sortRequest) as SortSpec | null) ?? undefined);
	}, [sortRequest]);
	const sorted = useMemo(() => (serverColumns === undefined ? sortEntries(entries, resolved, sorting) : entries), [entries, resolved, sorting, serverColumns]);

	// A page's own row ids, made unique.
	const ids = useMemo(() => {
		const seen = new Set<string>();
		return data.map((row, i) => {
			let key = rowId ? rowId(row, i) : String(i);
			if (seen.has(key)) key = `${key}#${i}`;
			seen.add(key);
			return key;
		});
	}, [data, rowId]);

	const [pageIndex, setPageIndex] = useState(0);
	const pageCount = Math.max(1, Math.ceil(sorted.length / view.pageSize));
	const page = Math.min(pageIndex, pageCount - 1);
	const pageRows = sorted.slice(page * view.pageSize, (page + 1) * view.pageSize);

	const { notice, flash } = useFlash();
	const copy = useCallback(async (text: string, what: string) => flash((await copyText(text)) ? `Copied ${what}` : "Could not copy"), [flash]);

	const change = useCallback(
		(patch: Partial<TableView>) => {
			setPageIndex(0);
			update((v) => ({ ...v, ...patch }));
		},
		[update],
	);
	const setFilter = useCallback(
		(columnId: string, filter: ColumnFilter | undefined) => {
			setPageIndex(0);
			update((v) => {
				const next = { ...v.filters };
				if (filter) next[columnId] = filter;
				else delete next[columnId];
				return { ...v, filters: next };
			});
		},
		[update],
	);
	const setColumn = useCallback(
		(col: Column<T>, on: boolean) => {
			const next = { ...view.columns };
			if (on === !col.defaultHidden) delete next[col.id];
			else next[col.id] = on;
			// A hidden column stops sorting: nothing on screen would say why the rows are in that order.
			change({ columns: next, ...(on ? {} : { sort: view.sort.filter((s) => s.id !== col.id) }) });
		},
		[view.columns, view.sort, change],
	);
	const widthOf = (col: Column<T>) => view.sizes[col.id] ?? col.spec.width ?? DEFAULT_WIDTH[col.type];
	const setSize = (col: Column<T>, px: number | null) =>
		update((v) => {
			const sizes = { ...v.sizes };
			if (px === null) delete sizes[col.id];
			else sizes[col.id] = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
			return { ...v, sizes };
		});
	const onHeaderPress = (col: Column<T>, multi: boolean) => {
		if (!col.sortable || !serverSortable(col.id)) return;
		setPageIndex(0);
		update((v) => ({ ...v, sort: toggleSort(serverColumns === undefined ? v.sort : sorting, col, multi && serverColumns === undefined) }));
	};

	const [sheet, setSheet] = useState<null | { kind: "columns" } | { kind: "export" } | { kind: "filter"; col: string } | { kind: "row"; row: T }>(null);
	const close = () => setSheet(null);

	const total = data.length;
	const shown = entries.length;
	const filtered = isFiltered(view);
	const showSearch = searchMode === true || (searchMode === "auto" && (total > 5 || view.search !== ""));
	const hideable = resolved.filter((c) => c.hideable);
	const jsonOf = (row: T) => (rowJson ? rowJson(row) : row);
	const exportRows = () => sorted.map((e) => e.row);
	const pad = density === "compact" ? { paddingHorizontal: 5, paddingVertical: 4 } : { paddingHorizontal: 7, paddingVertical: 7 };
	const cellFilter = useMemo<TableFilterApi>(() => ({ filterBy: (columnId, value) => setFilter(columnId, { kind: "set", values: [setKey(value)] }) }), [setFilter]);

	if (total === 0 && !loading) return <>{empty ?? <Txt variant="muted">No rows.</Txt>}</>;

	const activeFilters = Object.entries(view.filters).flatMap(([cid, f]) => {
		const col = byId.get(cid);
		return col ? [{ col, f }] : [];
	});
	const pinned = pinnedRows ?? [];
	const menuWidth = rowMenu ? 34 : 0;

	const cell = (col: Column<T>, row: T, bold = false) => {
		const given = col.spec.cell ? col.spec.cell(row) : null;
		const content = given === undefined || given === false ? null : given;
		const text = content === null ? col.text(row) : "";
		return (
			<View key={col.id} style={[{ width: widthOf(col), justifyContent: "center", alignItems: col.align === "right" ? "flex-end" : col.align === "center" ? "center" : "flex-start" }, pad]}>
				{content !== null && typeof content !== "string" && typeof content !== "number" ? (
					content
				) : (
					<Txt
						variant={col.spec.mono ? "mono" : "small"}
						color={text || content !== null ? p.foreground : p.mutedForeground}
						numberOfLines={3}
						style={[{ fontSize: density === "compact" ? 11 : 12, textAlign: col.align }, bold && { fontWeight: "700" }, col.type === "number" && { fontVariant: ["tabular-nums"] }]}
					>
						{content !== null ? String(content) : text || "–"}
					</Txt>
				)}
			</View>
		);
	};

	const sheetCol = sheet?.kind === "filter" ? byId.get(sheet.col) : undefined;

	return (
		<TableFilterContext.Provider value={cellFilter}>
			<View style={{ gap: space.sm }}>
				{bare ? null : (
					<>
						{showSearch ? <SearchBar value={view.search} onChangeText={(t) => change({ search: t })} placeholder={`Search ${label ? label.toLowerCase() : "rows"}`} /> : null}
						<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
							{toolbar}
							<Txt variant="small" style={{ flex: 1, minWidth: 90 }}>
								{notice || (filtered && !loading ? `${fmtInt(shown)} of ${fmtInt(total)} rows` : loading ? "Loading" : `${fmtInt(total)} row${total === 1 ? "" : "s"}`)}
							</Txt>
							{hideable.length || columnsMenu ? <ToolButton icon="grid-outline" label={visibleCols.length < resolved.length ? `Columns ${visibleCols.length}/${resolved.length}` : "Columns"} onPress={() => setSheet({ kind: "columns" })} /> : null}
							<ToolButton icon="download-outline" label="Export" onPress={() => setSheet({ kind: "export" })} />
						</View>
						{activeFilters.length || view.search.trim() ? (
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
								{activeFilters.map(({ col, f }) => (
									<Pressable
										key={col.id}
										onPress={() => setFilter(col.id, undefined)}
										accessibilityLabel={`Remove filter ${col.header}: ${describeFilter(col, f, data)}`}
										style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border, backgroundColor: p.muted }}
									>
										<Txt variant="small" color={p.foreground} numberOfLines={1} style={{ flexShrink: 1 }}>
											<Txt variant="small">{col.header}:</Txt> {describeFilter(col, f, data)}
										</Txt>
										<Icon name="close" size={12} color={p.mutedForeground} />
									</Pressable>
								))}
								<Pressable onPress={() => change({ search: "", filters: {} })} hitSlop={6}>
									<Txt variant="small" color={p.brand}>
										Clear {activeFilters.length ? "filters" : "search"}
									</Txt>
								</Pressable>
							</View>
						) : null}
					</>
				)}

				<View style={{ backgroundColor: p.card, borderColor: p.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: "hidden" }}>
					<ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
						<View>
							<View style={{ flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: p.border }}>
								{visibleCols.map((col) => {
									const s = sorting.find((x) => x.id === col.id);
									const at = sorting.findIndex((x) => x.id === col.id);
									const canSort = col.sortable && serverSortable(col.id);
									const active = !!view.filters[col.id];
									return (
										<View key={col.id} style={[{ width: widthOf(col), flexDirection: "row", alignItems: "center", gap: 2, justifyContent: col.align === "right" ? "flex-end" : col.align === "center" ? "center" : "flex-start" }, pad]}>
											<Pressable
												disabled={!canSort}
												onPress={() => onHeaderPress(col, false)}
												onLongPress={() => onHeaderPress(col, true)}
												delayLongPress={350}
												hitSlop={4}
												accessibilityLabel={`Sort by ${col.header}`}
												style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 1 }}
											>
												<Txt variant="label" numberOfLines={2} color={s ? p.foreground : undefined} style={{ flexShrink: 1, textAlign: col.align }}>
													{col.header}
													{col.spec.hint ? <Txt variant="small" style={{ fontSize: 9, textTransform: "none" }}>{` ${col.spec.hint}`}</Txt> : null}
												</Txt>
												{canSort ? <Icon name={s ? (s.desc ? "arrow-down" : "arrow-up") : "swap-vertical"} size={11} color={s ? p.foreground : p.border} /> : null}
												{s && sorting.length > 1 ? (
													<Txt variant="small" style={{ fontSize: 9 }}>
														{at + 1}
													</Txt>
												) : null}
											</Pressable>
											{col.spec.headerExtra ?? null}
											{col.filterKind ? (
												<Pressable onPress={() => setSheet({ kind: "filter", col: col.id })} hitSlop={6} accessibilityLabel={`Filter ${col.header}${active ? " (active)" : ""}`} style={{ padding: 2, borderRadius: 4, backgroundColor: active ? `${p.brand}22` : undefined }}>
													<Icon name="filter" size={11} color={active ? p.brand : p.mutedForeground} />
												</Pressable>
											) : null}
										</View>
									);
								})}
								{rowMenu ? <View style={{ width: menuWidth }} /> : null}
							</View>
							{loading
								? Array.from({ length: 5 }, (_, r) => (
										<View key={r} style={{ flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border }}>
											{visibleCols.map((col) => (
												<View key={col.id} style={[{ width: widthOf(col) }, pad]}>
													<Skeleton height={12} />
												</View>
											))}
										</View>
									))
								: null}
							{!loading
								? pinned.map((row, r) => (
										<View key={`pin-${r}`} style={{ flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border, backgroundColor: p.muted }}>
											{visibleCols.map((col) => cell(col, row, true))}
											{rowMenu ? <View style={{ width: menuWidth }} /> : null}
										</View>
									))
								: null}
							{!loading && shown === 0 ? (
								<View style={{ paddingVertical: space.lg, paddingHorizontal: space.md, flexDirection: "row", gap: 6 }}>
									<Txt variant="small">No rows match.</Txt>
									<Pressable onPress={() => change({ search: "", filters: {} })} hitSlop={6}>
										<Txt variant="small" color={p.brand}>
											Clear filters
										</Txt>
									</Pressable>
								</View>
							) : null}
							{!loading
								? pageRows.map((e) => {
										const row = e.row;
										const selected = isRowSelected?.(row) ?? false;
										return (
											<Pressable
												key={ids[e.i] ?? String(e.i)}
												onPress={onRowPress ? () => onRowPress(row) : undefined}
												onLongPress={rowMenu ? () => setSheet({ kind: "row", row }) : undefined}
												delayLongPress={400}
												android_ripple={onRowPress ? { color: p.accent } : undefined}
												style={({ pressed }) => [{ flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border }, selected && { backgroundColor: `${p.brand}18` }, pressed && onRowPress && { backgroundColor: p.accent }]}
											>
												{visibleCols.map((col) => cell(col, row))}
												{rowMenu ? (
													<Pressable onPress={() => setSheet({ kind: "row", row })} hitSlop={4} accessibilityLabel="Row actions" style={{ width: menuWidth, alignItems: "center", justifyContent: "center" }}>
														<Icon name="ellipsis-horizontal" size={14} color={p.mutedForeground} />
													</Pressable>
												) : null}
											</Pressable>
										);
									})
								: null}
						</View>
					</ScrollView>
				</View>

				{!loading && (pageCount > 1 || (!bare && total > PAGE_SIZES[0])) ? (
					<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
						<Txt variant="small">
							{shown ? `${fmtInt(page * view.pageSize + 1)} to ${fmtInt(Math.min(shown, (page + 1) * view.pageSize))} of ${fmtInt(shown)}` : "0 rows"}
						</Txt>
						<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
							<Pressable
								onPress={() => {
									const sizes = [...new Set([...PAGE_SIZES, view.pageSize])].sort((a, b) => a - b);
									const next = sizes[(sizes.indexOf(view.pageSize) + 1) % sizes.length] ?? PAGE_SIZES[0];
									change({ pageSize: next });
								}}
								hitSlop={6}
								accessibilityLabel="Rows per page"
							>
								<Txt variant="small" color={p.brand}>
									{view.pageSize} per page
								</Txt>
							</Pressable>
							<PageButton icon="chevron-back" disabled={page === 0} onPress={() => setPageIndex(page - 1)} label="Previous page" />
							<Txt variant="small">
								{page + 1} / {pageCount}
							</Txt>
							<PageButton icon="chevron-forward" disabled={page >= pageCount - 1} onPress={() => setPageIndex(page + 1)} label="Next page" />
						</View>
					</View>
				) : null}
			</View>

			<Sheet open={sheet?.kind === "columns"} onClose={close} title="Columns" subtitle="Show, hide, wider or narrower">
				{hideable.map((c) => {
					const on = isVisible(c, view);
					const w = widthOf(c);
					return (
						<View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 4 }}>
							<Pressable onPress={() => (on && visibleCols.length <= 1 ? undefined : setColumn(c, !on))} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flex: 1 }}>
								<Icon name={on ? "checkbox" : "square-outline"} size={20} color={on ? p.brand : p.mutedForeground} />
								<Txt numberOfLines={1} style={{ flex: 1 }}>
									{c.header}
								</Txt>
							</Pressable>
							<Pressable onPress={() => setSize(c, w - 24)} hitSlop={6} accessibilityLabel={`Narrower ${c.header}`}>
								<Icon name="remove-circle-outline" size={20} color={p.mutedForeground} />
							</Pressable>
							<Txt variant="small" style={{ width: 34, textAlign: "center" }}>
								{w}
							</Txt>
							<Pressable onPress={() => setSize(c, w + 24)} hitSlop={6} accessibilityLabel={`Wider ${c.header}`}>
								<Icon name="add-circle-outline" size={20} color={p.mutedForeground} />
							</Pressable>
						</View>
					);
				})}
				{columnsMenu ?? null}
				<SheetItem
					icon="refresh"
					label="Reset columns"
					onPress={() => {
						// Columns that are hidden by default stop sorting, as when they are hidden by hand.
						change({ columns: {}, sizes: {}, sort: view.sort.filter((s) => !byId.get(s.id)?.defaultHidden) });
					}}
				/>
			</Sheet>

			<Sheet open={sheet?.kind === "export"} onClose={close} title={label ?? "Export"} subtitle={`${fmtInt(sorted.length)} rows, as filtered and sorted, visible columns`}>
				<SheetItem
					icon="document-outline"
					label={`Save CSV (${fmtInt(sorted.length)} rows)`}
					onPress={async () => {
						close();
						const ok = await shareTextFile(exportFilename(id, "csv"), toCsv(visibleCols, exportRows()));
						flash(ok ? `Saved ${fmtInt(sorted.length)} rows` : "Could not save");
					}}
				/>
				<SheetItem
					icon="copy-outline"
					label="Copy as CSV"
					onPress={() => {
						close();
						void copy(toCsv(visibleCols, exportRows()), "CSV");
					}}
				/>
				<SheetItem
					icon="copy-outline"
					label="Copy as TSV (paste into a sheet)"
					onPress={() => {
						close();
						void copy(toTsv(visibleCols, exportRows()), "TSV");
					}}
				/>
				<SheetItem
					icon="code-slash-outline"
					label="Copy as JSON"
					onPress={() => {
						close();
						void copy(JSON.stringify(exportRows().map(jsonOf), null, 2), "JSON");
					}}
				/>
				<SheetItem
					icon="code-download-outline"
					label="Save JSON file"
					onPress={async () => {
						close();
						const ok = await shareTextFile(exportFilename(id, "json"), JSON.stringify(exportRows().map(jsonOf), null, 2), "application/json", false);
						flash(ok ? `Saved ${fmtInt(sorted.length)} rows` : "Could not save");
					}}
				/>
				{urlSync && registry ? (
					<SheetItem
						icon="link-outline"
						label="Copy link to this view"
						onPress={() => {
							close();
							void copy(viewLink.link(), "link");
						}}
					/>
				) : null}
				<SheetItem
					icon="refresh"
					label="Reset view"
					disabled={isDefaultView(view, defaults) && !filtered}
					onPress={() => {
						close();
						setPageIndex(0);
						reset();
					}}
				/>
			</Sheet>

			<Sheet open={sheet?.kind === "row"} onClose={close} title="Row" subtitle="Copy a cell or the whole row">
				{sheet?.kind === "row" ? (
					<>
						<SheetItem
							icon="code-slash-outline"
							label="Copy row as JSON"
							onPress={() => {
								close();
								void copy(JSON.stringify(jsonOf(sheet.row), null, 2), "row");
							}}
						/>
						{onRowPress ? (
							<SheetItem
								icon="open-outline"
								label="Open"
								onPress={() => {
									close();
									onRowPress(sheet.row);
								}}
							/>
						) : null}
						<Txt variant="label" style={{ marginTop: space.sm }}>
							Copy cell
						</Txt>
						{visibleCols.map((c) => {
							const value = copyValue(c, sheet.row);
							return (
								<SheetItem
									key={c.id}
									label={c.header}
									detail={value || "empty"}
									onPress={() => {
										close();
										void copy(value, c.header);
									}}
								/>
							);
						})}
					</>
				) : null}
			</Sheet>

			<Sheet open={!!sheetCol} onClose={close} title={sheetCol ? `Filter ${sheetCol.header}` : ""} {...(sheetCol?.spec.title ? { subtitle: sheetCol.spec.title } : {})}>
				{sheetCol ? <FilterBody col={sheetCol} rows={data} value={view.filters[sheetCol.id]} onChange={(f) => setFilter(sheetCol.id, f)} onDone={close} /> : null}
			</Sheet>
		</TableFilterContext.Provider>
	);
}

function ToolButton({ icon, label, onPress }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onPress(): void }) {
	const p = useTheme();
	return (
		<Pressable onPress={onPress} hitSlop={4} accessibilityLabel={label} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 5, paddingHorizontal: 9, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border, backgroundColor: p.card }, pressed && { opacity: 0.7 }]}>
			<Icon name={icon} size={14} color={p.foreground} />
			<Txt variant="small" color={p.foreground}>
				{label}
			</Txt>
		</Pressable>
	);
}

function PageButton({ icon, disabled, onPress, label }: { icon: "chevron-back" | "chevron-forward"; disabled: boolean; onPress(): void; label: string }) {
	const p = useTheme();
	return (
		<Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityLabel={label} style={{ padding: 4, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border, opacity: disabled ? 0.4 : 1 }}>
			<Icon name={icon} size={14} color={p.foreground} />
		</Pressable>
	);
}

// ---- column filters -----------------------------------------------------------------------------------------------

function FilterBody<T>({ col, rows, value, onChange, onDone }: { col: Column<T>; rows: readonly T[]; value: ColumnFilter | undefined; onChange(filter: ColumnFilter | undefined): void; onDone(): void }) {
	return (
		<View style={{ gap: space.sm }}>
			{col.filterKind === "set" ? <SetFilter col={col} rows={rows} value={value?.kind === "set" ? value : undefined} onChange={onChange} /> : null}
			{col.filterKind === "range" ? <RangeFilter col={col} rows={rows} value={value?.kind === "range" ? value : undefined} onChange={onChange} /> : null}
			{col.filterKind === "text" ? <Field autoFocus label="Contains" placeholder="Contains" defaultValue={value?.kind === "text" ? value.q : ""} onChangeText={(t) => onChange(t ? { kind: "text", q: t } : undefined)} /> : null}
			{col.filterKind === "since" ? <SinceFilter value={value?.kind === "since" ? value.within : undefined} onChange={(k) => onChange({ kind: "since", within: k })} /> : null}
			<View style={{ flexDirection: "row", gap: space.sm }}>
				<Button title="Clear" small icon="close" disabled={!value} onPress={() => onChange(undefined)} />
				<Button title="Done" small variant="brand" onPress={onDone} />
			</View>
		</View>
	);
}

function SetFilter<T>({ col, rows, value, onChange }: { col: Column<T>; rows: readonly T[]; value: Extract<ColumnFilter, { kind: "set" }> | undefined; onChange(filter: ColumnFilter | undefined): void }) {
	const p = useTheme();
	const options = useMemo(() => filterOptions(col, rows), [col, rows]);
	const [find, setFind] = useState("");
	const chosen = new Set(value?.values ?? []);
	const toggle = (v: string) => {
		const next = new Set(chosen);
		if (next.has(v)) next.delete(v);
		else next.add(v);
		onChange(next.size ? { kind: "set", values: options.map((o) => o.value).filter((x) => next.has(x)).concat([...next].filter((x) => !options.some((o) => o.value === x))) } : undefined);
	};
	const listed = find ? options.filter((o) => o.label.toLowerCase().includes(find.toLowerCase())) : options;
	return (
		<View style={{ gap: 4 }}>
			{options.length > 10 ? <SearchBar value={find} onChangeText={setFind} placeholder="Find a value" /> : null}
			{listed.slice(0, 300).map((o) => (
				<Pressable key={o.value} onPress={() => toggle(o.value)} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6 }}>
					<Icon name={chosen.has(o.value) ? "checkbox" : "square-outline"} size={20} color={chosen.has(o.value) ? p.brand : p.mutedForeground} />
					<Txt numberOfLines={1} style={{ flex: 1 }}>
						{o.label}
					</Txt>
					<Txt variant="small">{fmtInt(o.count)}</Txt>
				</Pressable>
			))}
			{listed.length > 300 ? <Txt variant="small">{fmtInt(listed.length - 300)} more: narrow with the find box.</Txt> : null}
			{listed.length === 0 ? <Txt variant="small">No values.</Txt> : null}
			<Txt variant="small">Checked values only; none checked shows all.</Txt>
		</View>
	);
}

function RangeFilter<T>({ col, rows, value, onChange }: { col: Column<T>; rows: readonly T[]; value: Extract<ColumnFilter, { kind: "range" }> | undefined; onChange(filter: ColumnFilter | undefined): void }) {
	const p = useTheme();
	const bounds = useMemo(() => numberBounds(col, rows), [col, rows]);
	const [lo, setLo] = useState(value?.min?.toString() ?? "");
	const [hi, setHi] = useState(value?.max?.toString() ?? "");
	const commit = (a: string, b: string) => {
		const min = a.trim() === "" ? undefined : Number(a);
		const max = b.trim() === "" ? undefined : Number(b);
		const ok = (n: number | undefined) => n === undefined || Number.isFinite(n);
		if (!ok(min) || !ok(max)) return;
		onChange(min === undefined && max === undefined ? undefined : { kind: "range", ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
	};
	const input = (label: string, v: string, set: (t: string) => void, placeholder: string) => (
		<View style={{ flex: 1, gap: 4 }}>
			<Txt variant="label">{label}</Txt>
			<TextInput
				value={v}
				onChangeText={set}
				placeholder={placeholder}
				placeholderTextColor={p.mutedForeground}
				keyboardType="numbers-and-punctuation"
				style={{ color: p.foreground, borderWidth: 1, borderColor: p.input, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8 }}
			/>
		</View>
	);
	return (
		<View style={{ flexDirection: "row", gap: space.sm }}>
			{input(
				"Min",
				lo,
				(t) => {
					setLo(t);
					commit(t, hi);
				},
				bounds ? String(bounds.min) : "",
			)}
			{input(
				"Max",
				hi,
				(t) => {
					setHi(t);
					commit(lo, t);
				},
				bounds ? String(bounds.max) : "",
			)}
		</View>
	);
}

function SinceFilter({ value, onChange }: { value: SinceKey | undefined; onChange(k: SinceKey): void }) {
	const p = useTheme();
	return (
		<View style={{ gap: 2 }}>
			{(["1h", "24h", "7d", "30d"] as SinceKey[]).map((k) => (
				<Pressable key={k} onPress={() => onChange(k)} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 7 }}>
					<Icon name={value === k ? "radio-button-on" : "radio-button-off"} size={20} color={value === k ? p.brand : p.mutedForeground} />
					<Txt>{SINCE_LABELS[k]}</Txt>
				</Pressable>
			))}
		</View>
	);
}
