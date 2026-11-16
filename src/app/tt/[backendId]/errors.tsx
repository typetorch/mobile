/**
 * Errors: the error kinds seen in a window (GET /v1/errors), by realm, branch and build, searchable, with their trend and
 * "vs previous period" chips on the tiles; a header tap asks the server for the 200 first in that order; new errors
 * refetch the list live (SSE GET /v1/live?topics=error, features/typetorch/live-feeds.ts). The web's `fp` (its side
 * sheet) is the kind's own page here (error/<fp>); a link with `fp` opens it. The total trend (every listed kind's
 * counts per step, the window's own step) with deploy marks is the phone's summary of the kinds' trend column.
 */
import { keepPreviousData } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Switch, View } from "react-native";

import type { ErrorParams } from "@/api/backend";
import { change } from "@/api/tt/benchmarks";
import { previousWindow } from "@/api/tt/compare";
import type { ErrorKind, ErrorList } from "@/api/tt/types";
import { BarChart, Sparkline } from "@/charts/LineChart";
import { Badge, Button, Chips, EmptyState, ErrorState, Field, SearchBar, Section, Segmented, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { ChangeChip } from "@/features/typetorch/bits";
import { bucketLabel, ERROR_WINDOWS, errorKindHref, errorWindow, errorWindowLabel, KIND_SORT_COLUMNS } from "@/features/typetorch/errors";
import { useTTQuery } from "@/features/typetorch/hooks";
import { chartMarks, DeployMarksToggle, useDeployMarks, useMarkCard } from "@/features/typetorch/marks";
import { streamLabel, useErrorStream } from "@/features/typetorch/live-feeds";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn, type SortSpec } from "@/features/typetorch/table";
import { usePageParam, usePageParams } from "@/features/typetorch/view-link";
import { compact, fmtAgo, shortId } from "@/lib/format";
import { useTheme } from "@/theme";

export default function ErrorsScreen() {
	return <TTScreen title="Errors">{({ backendId }) => <Errors backendId={backendId} />}</TTScreen>;
}

/** The build choices: the builds with errors in the window, plus the picked one when the window no longer has it (a link). */
function artifactOptions(builds: { build: string }[] | undefined, current: string): string[] {
	const out = (builds ?? []).map((b) => b.build);
	if (current && !out.includes(current)) out.unshift(current);
	return out;
}

function Errors({ backendId }: { backendId: string }) {
	const p = useTheme();
	// The web's URL parameters: window, realm, branch, build, q, fp (the kind: its own page here), vs.
	const [windowParam, setWindow] = usePageParam("window", "24h");
	const window = errorWindow(windowParam);
	const [realm, setRealm] = usePageParam("realm");
	const [branch, setBranch] = usePageParam("branch");
	const [build, setBuild] = usePageParam("build");
	const [q, setQ] = usePageParam("q");
	const [fp] = usePageParam("fp");
	const [vs, setVs] = usePageParam("vs");
	const [, setPage] = usePageParams();
	const compareOn = vs === "prev";
	const [search, setSearch] = useState(q);
	useEffect(() => setSearch(q), [q]);
	const [branchText, setBranchText] = useState(branch);
	useEffect(() => setBranchText(branch), [branch]);
	const params: ErrorParams = { window, ...(realm ? { realm } : {}), ...(branch ? { branch } : {}), ...(build ? { build } : {}), ...(q ? { q } : {}) };
	// A web link's `fp` (the side sheet): open the kind's page with the same window and filters, once.
	useEffect(() => {
		if (!fp) return;
		setPage({ fp: null });
		router.push(errorKindHref(backendId, fp, { window, realm, branch, build }) as never);
	}, [fp, backendId, window, realm, branch, build, setPage]);
	const stream = useErrorStream(backendId);
	// 200 kinds come back, so a header tap asks the server for the 200 first in that order (the default is -count).
	const [sort, setSort] = useState<SortSpec | undefined>();
	const sortParam = sort && !(sort.id === "count" && sort.desc) ? `${sort.desc ? "-" : ""}${sort.id}` : undefined;
	const list = useTTQuery(backendId, ["errors", "list", params, sortParam ?? ""], (api, s) => api.errors({ ...params, limit: 200, ...(sortParam ? { sort: sortParam } : {}) }, s), {
		staleTime: 30_000,
		placeholderData: keepPreviousData,
	});
	// "vs previous period": the window of the same length right before (the web's previousWindow), totals only.
	const before = list.data ? previousWindow(list.data.window) : undefined;
	const { window: _window, ...withoutWindow } = params;
	const prev = useTTQuery(backendId, ["errors", "list", "previous", withoutWindow, before ?? null], (api, s) => api.errors({ ...withoutWindow, ...(before as { from: number; to: number }), limit: 1 }, s), {
		enabled: compareOn && before !== undefined,
		staleTime: 60_000,
	});
	const vsTotals = compareOn && prev.data ? prev.data.totals : undefined;
	const chip = (now: number, then: number | undefined) => (then === undefined ? undefined : <ChangeChip change={change(now, then, true)} />);
	const bucketSeconds = list.data?.window.bucketSeconds ?? 3600;
	const kindColumns = useMemo<DataColumn<ErrorKind>[]>(
		() => [
			{
				id: "error",
				header: "Error",
				width: 230,
				accessor: (k) => k.template,
				searchText: (k) => `${k.topFrame ?? ""} ${k.fp}`,
				cell: (k) => (
					<View style={{ gap: 2 }}>
						<Txt variant="mono" numberOfLines={3} style={{ fontSize: 11 }}>
							{k.template}
						</Txt>
						{k.topFrame ? (
							<Txt variant="small" numberOfLines={1} style={{ fontFamily: "monospace", fontSize: 10 }}>
								{k.topFrame}
							</Txt>
						) : null}
					</View>
				),
			},
			{ id: "realm", header: "Where", type: "enum", width: 70, accessor: (k) => k.realm, cell: (k) => <Badge label={k.realm} tone={k.realm === "server" ? "brand" : "muted"} /> },
			{ id: "count", header: "Count", type: "number", width: 66, accessor: (k) => k.count, cell: (k) => compact(k.count) },
			{ id: "players", header: "Players", type: "number", width: 66, accessor: (k) => k.players },
			{
				id: "trend",
				header: "Trend",
				title: `Errors per ${bucketLabel(bucketSeconds)}; sorts by the newest step`,
				type: "number",
				width: 80,
				filter: false,
				accessor: (k) => k.spark[k.spark.length - 1] ?? 0,
				exportValue: (k) => k.spark.join(" "),
				cell: (k) => <Sparkline values={k.spark} color={p.destructive} />,
			},
			{ id: "firstAt", header: "First seen", type: "date", width: 84, accessor: (k) => k.firstAt, format: (_v, k) => fmtAgo(k.firstAt) },
			{ id: "lastAt", header: "Last seen", type: "date", width: 84, accessor: (k) => k.lastAt, format: (_v, k) => fmtAgo(k.lastAt) },
			{ id: "total", header: "All time", title: "Every report of this kind, not only this window", type: "number", width: 76, accessor: (k) => k.total, cell: (k) => compact(k.total), defaultHidden: true },
			{ id: "fp", header: "Fingerprint", width: 100, mono: true, accessor: (k) => k.fp, format: (_v, k) => shortId(k.fp, 8), defaultHidden: true },
		],
		[p.destructive, bucketSeconds],
	);
	const streamText = streamLabel(stream.status);
	const artifacts = artifactOptions(list.data?.builds, build);
	return (
		<>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Segmented options={[...ERROR_WINDOWS]} value={window} onChange={setWindow} style={{ flex: 1 }} />
				<Badge label={streamText.text} tone={streamText.tone} />
			</View>
			<SearchBar
				value={search}
				onChangeText={(t) => {
					setSearch(t);
					if (!t) setQ("");
				}}
				onSubmit={() => setQ(search.trim())}
				placeholder="Search messages"
			/>
			{search && search !== q ? <Button title={`Search for “${search}”`} small variant="ghost" icon="search" onPress={() => setQ(search.trim())} style={{ alignSelf: "flex-start" }} /> : null}
			<View>
				<Chips
					options={[
						{ value: "", label: "Server + client" },
						{ value: "server", label: "Server" },
						{ value: "client", label: "Client" },
					]}
					value={realm}
					onChange={setRealm}
				/>
			</View>
			<Field
				label="Branch"
				value={branchText}
				placeholder="any branch"
				onChangeText={(t) => {
					setBranchText(t);
					if (!t) setBranch("");
				}}
				onSubmitEditing={() => setBranch(branchText.trim())}
				onBlur={() => setBranch(branchText.trim())}
				returnKeyType="done"
			/>
			{artifacts.length ? (
				<View style={{ gap: 6 }}>
					<Txt variant="label">Artifact</Txt>
					<Chips options={[{ value: "", label: "Any artifact" }, ...artifacts.map((a) => ({ value: a, label: shortId(a, 10) }))]} value={build} onChange={setBuild} />
				</View>
			) : null}
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Switch value={compareOn} onValueChange={(on) => setVs(on ? "prev" : "")} />
				<Txt variant="small" style={{ flex: 1 }}>
					vs previous period: the change against the window before, of the same length
				</Txt>
			</View>
			{list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
			{!list.data && !list.error ? <SkeletonList rows={8} /> : null}
			{list.data ? (
				<>
					<StatGrid>
						<Stat label="Errors" value={compact(list.data.totals.count)} sub={<StatSub text={`in the last ${errorWindowLabel(window)}`} chip={chip(list.data.totals.count, vsTotals?.count)} />} />
						<Stat label="Kinds" value={compact(list.data.totals.kinds)} sub={<StatSub text={list.data.more ? `${compact(list.data.more)} more not shown` : ""} chip={chip(list.data.totals.kinds, vsTotals?.kinds)} />} />
						<Stat label="Players affected" value={compact(list.data.totals.players)} sub={<StatSub text="by days touched" chip={chip(list.data.totals.players, vsTotals?.players)} />} />
						<Stat label="Trend step" value={bucketLabel(list.data.window.bucketSeconds)} sub={`${list.data.window.buckets} steps`} />
					</StatGrid>
					{compareOn && prev.error ? <Txt variant="small">Couldn't load the window before: {prev.error.message}</Txt> : null}
					{list.data.kinds.length ? <TotalTrend backendId={backendId} data={list.data} branch={branch} /> : null}
					{list.data.kinds.length ? (
						<Section title={list.data.more ? `Top ${list.data.kinds.length} kinds (${list.data.more} more)` : "Error kinds"}>
							<DataTable
								id="errors-kinds"
								label="Error kinds"
								columns={kindColumns}
								data={list.data.kinds}
								rowId={(k) => k.fp}
								onRowPress={(k) => router.push(errorKindHref(backendId, k.fp, { window, realm, branch, build }) as never)}
								defaultSort={[{ id: "count", desc: true }]}
								serverSort={{ columns: KIND_SORT_COLUMNS, onChange: setSort }}
								density="compact"
							/>
						</Section>
					) : (
						<EmptyState icon="checkmark-circle-outline" title="No errors" body="Nothing in this window. Pick a longer one to see older errors." />
					)}
				</>
			) : null}
		</>
	);
}

/** Every listed kind's errors per step of the window (the kinds' trend column summed), with deploy marks. */
function TotalTrend({ backendId, data, branch }: { backendId: string; data: ErrorList; branch: string }) {
	const p = useTheme();
	const from = Date.parse(data.window.from);
	const to = Date.parse(data.window.to);
	const stepMs = data.window.bucketSeconds * 1000;
	const points = useMemo(() => {
		const n = Math.max(0, ...data.kinds.map((k) => k.spark.length));
		const sums = Array.from({ length: n }, (_, i) => data.kinds.reduce((s, k) => s + (k.spark[i] ?? 0), 0));
		// The spark's last bucket ends at the window's end.
		const first = to - n * stepMs;
		return sums.map((v, i) => ({ t: first + i * stepMs, v }));
	}, [data.kinds, to, stepMs]);
	const markRange = useMemo(() => ({ from, to }), [from, to]);
	const deploys = useDeployMarks(backendId, markRange, branch || undefined);
	const card = useMarkCard(backendId);
	const daily = data.window.bucketSeconds >= 86_400;
	if (!points.length) return null;
	return (
		<Section title="Trend">
			<Txt variant="small">
				Errors per {bucketLabel(data.window.bucketSeconds)}, every listed kind together{data.more ? ` (the ${compact(data.more)} kinds not shown are left out)` : ""}. Deploy marks: tap one for its card.
			</Txt>
			<DeployMarksToggle {...deploys} />
			<BarChart points={points} color={p.destructive} format={compact} marks={chartMarks(p, deploys.marks)} onMarkPress={card.open} timeLabel={(t) => (daily ? new Date(t).toISOString().slice(5, 10) : new Date(t).toISOString().slice(11, 16))} />
			{card.sheet}
		</Section>
	);
}

function StatSub({ text, chip }: { text: string; chip: ReactNode }) {
	if (!text && !chip) return null;
	return (
		<View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
			{text ? <Txt variant="small">{text}</Txt> : null}
			{chip}
		</View>
	);
}
