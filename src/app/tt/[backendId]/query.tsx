/**
 * Query: any named query with JSON filters and options (POST /v1/query/<name>), or read-only SQL (POST /v1/sql) with
 * saved queries (GET /v1/saved-queries; owners save, rename, chart, pin to the Overview and delete them).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import type { Api } from "@/api/backend";
import { SAVED_QUERY_CHARTS, type SavedQuery, type SavedQueryChart, type SqlResult } from "@/api/tt/types";
import { LineChart, ShareBars } from "@/charts/LineChart";
import { Button, Card, Chips, ErrorState, Field, Segmented, Txt, confirm } from "@/components/ui";
import { CopyButton, JsonBlock, Note, Panel } from "@/features/typetorch/bits";
import { DataTable, typeFromSql, type DataColumn } from "@/features/typetorch/table";
import { FilterBar, useTTFilters } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtInt, fmtTime } from "@/lib/format";
import { space } from "@/theme";

function parseJson(text: string, what: string): object {
	if (!text.trim()) return {};
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(`${what} is not a JSON object: ${(error as Error).message}`);
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} is not a JSON object: not an object`);
	return value;
}

export default function QueryScreen() {
	return <TTScreen title="Query">{({ backendId, api, account }) => <Query backendId={backendId} api={api} readOnly={account.role !== "admin"} />}</TTScreen>;
}

function Query({ backendId, api, readOnly }: { backendId: string; api: Api; readOnly: boolean }) {
	const [tab, setTab] = useState<"named" | "sql">("named");
	return (
		<>
			<Note>Run any named query with JSON options, or read-only SQL, and see the raw answer.</Note>
			<Segmented
				options={[
					{ value: "named", label: "Named query" },
					{ value: "sql", label: "SQL" },
				]}
				value={tab}
				onChange={setTab}
			/>
			{tab === "named" ? <NamedQuery backendId={backendId} api={api} /> : <AdHocSql backendId={backendId} api={api} readOnly={readOnly} />}
		</>
	);
}

function NamedQuery({ backendId, api }: { backendId: string; api: Api }) {
	const { apiFilters } = useTTFilters(backendId);
	const list = useTTQuery(backendId, ["queries"], (a, s) => a.queries(s), { staleTime: Infinity });
	const [name, setName] = useState("overview");
	const [filters, setFilters] = useState(() => JSON.stringify(apiFilters, null, 2));
	const [options, setOptions] = useState("{}");
	useEffect(() => setFilters(JSON.stringify(apiFilters, null, 2)), [apiFilters]);
	const run = useMutation({ mutationFn: () => api.raw(name, { filters: parseJson(filters, "filters"), options: parseJson(options, "options") }) });
	const info = list.data?.find((q) => q.name === name);
	return (
		<>
			<FilterBar backendId={backendId} />
			<Panel title="Named query" note={info ? `${info.summary} (default range ${info.defaultDays} days)` : "POST /v1/query/<name> with { filters, options }"}>
				<Chips options={(list.data ?? [{ name, summary: "", defaultDays: 0 }]).map((q) => ({ value: q.name, label: q.name }))} value={name} onChange={setName} />
				<Field label="filters (from the filter bar; edit freely)" multiline value={filters} onChangeText={setFilters} />
				<Field label='options, e.g. { "pid": "..." } or { "facet": "zone" }' multiline value={options} onChangeText={setOptions} />
				<Button title="Run" variant="brand" icon="play" loading={run.isPending} onPress={() => run.mutate()} style={{ alignSelf: "flex-start" }} />
			</Panel>
			{run.isError ? <ErrorState error={run.error} title="Query failed" /> : null}
			{run.data ? (
				<Panel title="Result" note={`${run.data.ms} ms on the server`}>
					<JsonBlock value={run.data.result} max={520} />
					<CopyButton text={JSON.stringify(run.data.result, null, 2)} title="Copy JSON" />
				</Panel>
			) : null}
		</>
	);
}

const SAMPLE = `SELECT kind, name, COUNT(*) AS n, COUNT(DISTINCT pid) AS players
FROM events
WHERE t >= epoch_ms(now() - INTERVAL 7 DAY)
GROUP BY kind, name
ORDER BY n DESC`;

const CHART_LABELS: Record<SavedQueryChart, string> = { table: "Table", bar: "Bar chart", line: "Line chart" };

interface Draft {
	name: string;
	chart: SavedQueryChart | null;
	pinned: boolean;
}
const draftOf = (q: SavedQuery | undefined): Draft => ({ name: q?.name ?? "", chart: q?.chart ?? null, pinned: q?.pinned ?? false });

function isDirty(saved: SavedQuery | undefined, sql: string, draft: Draft): boolean {
	if (!saved) return true;
	return saved.sql.trim() !== sql.trim().replace(/;\s*$/, "").trimEnd() || saved.name !== draft.name.trim() || saved.chart !== draft.chart || saved.pinned !== draft.pinned;
}

function AdHocSql({ backendId, api, readOnly }: { backendId: string; api: Api; readOnly: boolean }) {
	const client = useQueryClient();
	const list = useTTQuery(backendId, ["saved-queries"], (a, s) => a.savedQueries(s), { retry: false, staleTime: 30_000 });
	const [savedId, setSavedId] = useState("");
	const selected = list.data?.find((q) => String(q.id) === savedId);
	const [sql, setSql] = useState(SAMPLE);
	const [draft, setDraft] = useState<Draft>(draftOf(undefined));
	const [limitText, setLimitText] = useState("1000");
	const limit = Math.min(10_000, Math.max(1, Number(limitText) || 1000));
	const run = useMutation({ mutationFn: (text: string) => api.sql(text, limit) });
	const loaded = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (!selected || loaded.current === selected.id) return;
		loaded.current = selected.id;
		setSql(selected.sql);
		setDraft(draftOf(selected));
		run.mutate(selected.sql);
	}, [selected, run]);
	const pick = (id: string) => {
		if (!id) {
			loaded.current = undefined;
			setDraft(draftOf(undefined));
		}
		setSavedId(id);
	};
	const done = (q?: SavedQuery) => {
		void client.invalidateQueries({ queryKey: ["tt", backendId, "saved-queries"] });
		if (q) pick(String(q.id));
	};
	const fields = { name: draft.name.trim(), sql, chart: draft.chart, pinned: draft.pinned };
	const save = useMutation({ mutationFn: () => (selected ? api.updateSavedQuery(selected.id, fields) : api.createSavedQuery(fields)), onSuccess: (q) => done(q) });
	const saveNew = useMutation({ mutationFn: () => api.createSavedQuery(fields), onSuccess: (q) => done(q) });
	const remove = useMutation({
		mutationFn: () => api.deleteSavedQuery((selected as SavedQuery).id),
		onSuccess: () => {
			pick("");
			done();
		},
	});
	const failed = save.error ?? saveNew.error ?? remove.error;
	const busy = save.isPending || saveNew.isPending || remove.isPending;
	const named = draft.name.trim().length > 0;
	return (
		<>
			<Panel title="Saved queries" note={readOnly ? "Read-only: you can run saved queries; your edits stay on this phone's screen." : "Saved for everyone signed in to this backend."}>
				{list.error ? <Note>{list.error.message}</Note> : null}
				<Chips options={[{ value: "", label: readOnly ? "None" : "New query" }, ...(list.data ?? []).map((q) => ({ value: String(q.id), label: `${q.name}${q.pinned ? " (pinned)" : ""}` }))]} value={savedId} onChange={pick} />
				{selected ? (
					<Note>
						Saved by {selected.createdBy} {fmtTime(selected.createdAt)}
						{selected.updatedAt !== selected.createdAt ? `, changed by ${selected.updatedBy} ${fmtTime(selected.updatedAt)}` : ""}.
					</Note>
				) : null}
				<Segmented options={SAVED_QUERY_CHARTS.map((c) => ({ value: c, label: CHART_LABELS[c] }))} value={draft.chart ?? "table"} onChange={(v) => setDraft({ ...draft, chart: v === "table" ? null : v })} />
				{readOnly ? null : (
					<>
						<Field placeholder="Name to save it under" maxLength={100} value={draft.name} onChangeText={(t) => setDraft({ ...draft, name: t })} />
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
							<Button title={draft.pinned ? "Pinned to Overview" : "Pin to Overview"} small icon={draft.pinned ? "pin" : "pin-outline"} variant={draft.pinned ? "brand" : "secondary"} onPress={() => setDraft({ ...draft, pinned: !draft.pinned })} />
							<Button title={selected ? "Save" : "Save query"} small icon="save-outline" disabled={busy || !named || !isDirty(selected, sql, draft)} loading={save.isPending} onPress={() => save.mutate()} />
							{selected ? (
								<>
									<Button title="Save as new" small disabled={busy || !named || draft.name.trim().toLowerCase() === selected.name.toLowerCase()} loading={saveNew.isPending} onPress={() => saveNew.mutate()} />
									<Button
										title="Delete"
										small
										variant="destructive"
										icon="trash-outline"
										disabled={busy}
										onPress={async () => {
											if (await confirm("Delete this saved query?", `"${selected.name}" goes for everyone signed in to this backend.`, "Delete")) remove.mutate();
										}}
									/>
								</>
							) : null}
						</View>
					</>
				)}
				{failed ? <ErrorState error={failed} title="Could not save" /> : null}
			</Panel>
			<Panel title="SQL (read-only)" note="One SELECT or WITH over the views events and recordings (DuckDB SQL; t is unix ms; props and exp are JSON text). Fleet rows show no props.">
				<Field multiline value={sql} onChangeText={setSql} style={{ minHeight: 160 }} />
				<Note>Columns: t, kind, name, pid, sid, job, srv, place, art, seq, branch, channel, dev, newp, state, exp, sexp, src, props, rt.</Note>
				<View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
					<View style={{ width: 100 }}>
						<Field label="Limit" keyboardType="number-pad" value={limitText} onChangeText={setLimitText} />
					</View>
					<Button title="Run" variant="brand" icon="play" loading={run.isPending} onPress={() => run.mutate(sql)} />
				</View>
			</Panel>
			{run.isError ? <ErrorState error={run.error} title="Query failed" /> : null}
			{run.data ? <SqlResultView data={run.data} chart={draft.chart} /> : null}
		</>
	);
}

const cellText = (value: unknown): string => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
const NUMERIC = /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?\d*|FLOAT\d*|DOUBLE|REAL|DECIMAL.*|NUMERIC.*)$/;

/** The chart's x column (the first) and up to four number columns after it, as the web's chartShape. */
function chartShape(result: SqlResult): { x: number; series: number[] } | undefined {
	if (result.columns.length < 2 || !result.rows.length) return undefined;
	const series: number[] = [];
	for (let i = 1; i < result.columns.length && series.length < 4; i++) {
		const numeric = NUMERIC.test((result.columns[i]?.type ?? "").toUpperCase()) || result.rows.every((r) => r[i] === null || typeof r[i] === "number" || (typeof r[i] === "string" && r[i] !== "" && Number.isFinite(Number(r[i]))));
		if (numeric) series.push(i);
	}
	return series.length ? { x: 0, series } : undefined;
}

function ResultChart({ result, chart }: { result: SqlResult; chart: "bar" | "line" }) {
	const shape = useMemo(() => chartShape(result), [result]);
	if (!shape) return <Note>Nothing to chart: it needs a first column and at least one number column after it.</Note>;
	const num = (v: unknown) => {
		const n = v === null || v === undefined ? Number.NaN : Number(v);
		return Number.isFinite(n) ? n : null;
	};
	if (chart === "bar") {
		const s = shape.series[0] as number;
		return (
			<View style={{ gap: 6 }}>
				<Txt variant="label">{result.columns[s]?.name}</Txt>
				<ShareBars rows={result.rows.slice(0, 40).map((r) => ({ label: cellText(r[shape.x]), value: num(r[s]) ?? 0 }))} />
			</View>
		);
	}
	// A line over the x column: times when it parses as a date or unix ms, else the row order.
	const xs = result.rows.map((r, i) => {
		const v = r[shape.x];
		if (typeof v === "number" && v > 1e11) return v;
		const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
		return Number.isFinite(t) ? t : i;
	});
	const asTime = xs.every((x, i) => x !== i) || xs.some((x) => x > 1e11);
	return (
		<LineChart
			area={false}
			series={shape.series.map((s) => ({ label: result.columns[s]?.name ?? "", points: result.rows.map((r, i) => ({ t: xs[i] as number, v: num(r[s]) })) }))}
			{...(asTime ? {} : { timeLabel: (t: number) => cellText(result.rows[t]?.[shape.x]).slice(0, 10) })}
		/>
	);
}

function SqlResultView({ data, chart }: { data: SqlResult; chart: SavedQueryChart | null }) {
	const columns = useMemo(
		() =>
			data.columns.map(
				(c, i): DataColumn<unknown[]> => ({
					id: `${c.name}-${i}`,
					header: c.name,
					hint: c.type.toLowerCase(),
					width: NUMERIC.test(c.type.toUpperCase()) ? 96 : 150,
					...(typeFromSql(c.type) ? { type: typeFromSql(c.type) } : {}),
					mono: true,
					accessor: (row) => row[i],
					format: (v) => cellText(v),
					filter: typeFromSql(c.type) ? undefined : "text",
				}),
			),
		[data.columns],
	);
	return (
		<Panel title={`${fmtInt(data.rows.length)} row${data.rows.length === 1 ? "" : "s"}${data.truncated ? " (more exist: raise the limit or narrow the query)" : ""}`} note={`${data.ms} ms on the server`}>
			{chart && chart !== "table" ? (
				<Card>
					<ResultChart result={data} chart={chart} />
				</Card>
			) : null}
			<DataTable id="query-sql" label="SQL result" columns={columns} data={data.rows} pageSize={100} rowJson={(row) => Object.fromEntries(data.columns.map((c, i) => [c.name, row[i]]))} />
		</Panel>
	);
}
