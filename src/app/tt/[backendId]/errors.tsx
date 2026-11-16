/** Errors: the error kinds seen in a window (GET /v1/errors), searchable, by realm, with their trend; new errors refetch the list live (SSE GET /v1/live?topics=error, features/typetorch/live-feeds.ts). */
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { Sparkline } from "@/charts/LineChart";
import { Badge, Button, Chips, EmptyState, ErrorState, List, Row, SearchBar, Section, Segmented, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { useTTQuery } from "@/features/typetorch/hooks";
import { streamLabel, useErrorStream } from "@/features/typetorch/live-feeds";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParam } from "@/features/typetorch/view-link";
import type { ErrorKind } from "@/api/tt/types";
import { compact, fmtAgo, shortId } from "@/lib/format";
import { useTheme } from "@/theme";

const WINDOWS = [
	{ value: "1h", label: "1 h" },
	{ value: "24h", label: "24 h" },
	{ value: "7d", label: "7 d" },
	{ value: "30d", label: "30 d" },
];

export default function ErrorsScreen() {
	return <TTScreen title="Errors">{({ backendId }) => <Errors backendId={backendId} />}</TTScreen>;
}

function Errors({ backendId }: { backendId: string }) {
	const p = useTheme();
	// The web's URL parameters: window, realm, q (the error kind itself is its own page, error/<fp>).
	const [windowParam, setWindow] = usePageParam("window", "24h");
	const window = WINDOWS.some((w) => w.value === windowParam) ? windowParam : "24h";
	const [realm, setRealm] = usePageParam("realm");
	const [q, setQ] = usePageParam("q");
	const [search, setSearch] = useState(q);
	useEffect(() => setSearch(q), [q]);
	const stream = useErrorStream(backendId);
	const kindColumns = useMemo<DataColumn<ErrorKind>[]>(
		() => [
			{
				id: "template",
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
			{ id: "realm", header: "Side", type: "enum", width: 70, accessor: (k) => k.realm, cell: (k) => <Badge label={k.realm} tone={k.realm === "server" ? "brand" : "muted"} /> },
			{ id: "count", header: "Count", type: "number", width: 66, accessor: (k) => k.count, cell: (k) => compact(k.count) },
			{ id: "players", header: "Players", type: "number", width: 66, accessor: (k) => k.players },
			{ id: "trend", header: "Trend", title: "Sorts by the errors in the newest step", type: "number", width: 80, filter: false, accessor: (k) => k.spark[k.spark.length - 1] ?? 0, exportValue: (k) => k.spark.join(" "), cell: (k) => <Sparkline values={k.spark} color={p.destructive} /> },
			{ id: "lastAt", header: "Last", type: "date", width: 84, accessor: (k) => k.lastAt, format: (_v, k) => fmtAgo(k.lastAt) },
			{ id: "firstAt", header: "First", type: "date", width: 84, accessor: (k) => k.firstAt, format: (_v, k) => fmtAgo(k.firstAt), defaultHidden: true },
			{ id: "total", header: "All time", type: "number", width: 76, accessor: (k) => k.total, cell: (k) => compact(k.total), defaultHidden: true },
			{ id: "fp", header: "Fingerprint", width: 100, mono: true, accessor: (k) => k.fp, format: (_v, k) => shortId(k.fp, 8), defaultHidden: true },
		],
		[p.destructive],
	);
	const streamText = streamLabel(stream.status);
	const list = useTTQuery(backendId, ["errors", window, realm, q], (api, s) => api.errors({ window, limit: 100, ...(realm ? { realm } : {}), ...(q ? { q } : {}) }, s), { staleTime: 30_000 });
	return (
		<>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Segmented options={WINDOWS} value={window} onChange={setWindow} style={{ flex: 1 }} />
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
			<View>
				<Chips
					options={[
						{ value: "", label: "All realms" },
						{ value: "server", label: "Server" },
						{ value: "client", label: "Client" },
					]}
					value={realm}
					onChange={setRealm}
				/>
			</View>
			{search && search !== q ? <Button title={`Search for “${search}”`} small variant="ghost" icon="search" onPress={() => setQ(search.trim())} style={{ alignSelf: "flex-start" }} /> : null}
			{list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
			{!list.data && !list.error ? <SkeletonList rows={8} /> : null}
			{list.data ? (
				<>
					<StatGrid>
						<Stat label="Errors" value={compact(list.data.totals.count)} />
						<Stat label="Kinds" value={compact(list.data.totals.kinds)} />
						<Stat label="Players hit" value={compact(list.data.totals.players)} />
					</StatGrid>
					{list.data.kinds.length ? (
						<Section title={list.data.more ? `Top ${list.data.kinds.length} kinds (${list.data.more} more)` : "Kinds"}>
							<DataTable
								id="errors-kinds"
								label="Error kinds"
								columns={kindColumns}
								data={list.data.kinds}
								rowId={(k) => k.fp}
								onRowPress={(k) => router.push(`/tt/${backendId}/error/${encodeURIComponent(k.fp)}?window=${window}`)}
								defaultSort={[{ id: "count", desc: true }]}
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
