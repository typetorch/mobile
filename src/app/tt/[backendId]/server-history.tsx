/**
 * Server history: closed and lost servers (GET /v1/fleet/servers?gone=1, rows kept 30 days), by state and branch,
 * searchable by JobId. A server opens its page: offline badge, timeline, debug bundles and whole-life charts.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import type { Api } from "@/api/backend";
import { Chips, Dot, SearchBar, Stat, StatGrid, Txt } from "@/components/ui";
import { Note, QueryState } from "@/features/typetorch/bits";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { fmtAgo, fmtDuration, fmtInt, fmtTime, shortId } from "@/lib/format";
import { space } from "@/theme";

type Gone = NonNullable<Awaited<ReturnType<Api["fleetGoneServers"]>>>[number];
const wentAt = (s: Gone) => s.closedAt ?? s.lostAt ?? s.lastSeen ?? null;

const GONE_COLUMNS: DataColumn<Gone>[] = [
	{ id: "job", header: "JobId", width: 110, mono: true, accessor: (s) => s.job, format: (_v, s) => shortId(s.job, 8), cell: (s) => (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
			<Dot tone={s.state === "lost" ? "critical" : "muted"} />
			<Txt variant="mono" style={{ fontSize: 11 }}>
				{shortId(s.job, 8)}
			</Txt>
		</View>
	) },
	{ id: "state", header: "State", type: "enum", width: 70, order: ["lost", "closed"], accessor: (s) => s.state },
	{ id: "went", header: "Gone", type: "date", width: 96, accessor: (s) => wentAt(s), format: (_v, s) => fmtAgo(wentAt(s)), searchText: (s) => (wentAt(s) ? fmtTime(wentAt(s)) : "") },
	{ id: "branch", header: "Branch", type: "enum", width: 80, accessor: (s) => s.branch },
	{ id: "artifact", header: "Build", width: 96, mono: true, accessor: (s) => s.artifact, format: (_v, s) => shortId(s.artifact, 6) },
	{ id: "kernel", header: "Kernel", type: "enum", width: 70, accessor: (s) => s.kernel },
	{
		id: "ran",
		header: "Ran",
		type: "number",
		width: 80,
		accessor: (s) => {
			const went = wentAt(s);
			return s.startedAt && went ? Date.parse(went) - Date.parse(s.startedAt) : null;
		},
		format: (v) => (typeof v === "number" && v >= 0 ? fmtDuration(v) : "–"),
	},
	{ id: "health", header: "Health", type: "enum", width: 80, accessor: (s) => s.health },
];

export default function ServerHistoryScreen() {
	return <TTScreen title="Server history">{({ backendId }) => <ServerHistory backendId={backendId} />}</TTScreen>;
}

function ServerHistory({ backendId }: { backendId: string }) {
	const [state, setState] = useState<"" | "closed" | "lost">("");
	const [branch, setBranch] = useState("");
	const [search, setSearch] = useState("");
	const gone = useTTQuery(backendId, ["fleet", "gone"], (api, s) => api.fleetGoneServers(undefined, s), { staleTime: 30_000 });
	const branches = useMemo(() => [...new Set((gone.data ?? []).map((s) => s.branch ?? "–"))].sort(), [gone.data]);
	const list = useMemo(
		() =>
			(gone.data ?? []).filter(
				(s) => (!state || s.state === state) && (!branch || (s.branch ?? "–") === branch) && (!search.trim() || s.job.toLowerCase().includes(search.trim().toLowerCase())),
			),
		[gone.data, state, branch, search],
	);
	return (
		<>
			<Note>Closed and lost servers, the most recently gone first (at most 200; rows are kept 30 days). Lost = no heartbeat for 90 s and no closing message.</Note>
			<QueryState q={gone} isEmpty={(d) => d.length === 0} empty="No gone servers kept.">
				{(all) => (
					<>
						<StatGrid>
							<Stat label="Gone" value={fmtInt(all.length)} />
							<Stat label="Lost" value={fmtInt(all.filter((s) => s.state === "lost").length)} tone={all.some((s) => s.state === "lost") ? "warning" : undefined} />
						</StatGrid>
						<SearchBar value={search} onChangeText={setSearch} placeholder="JobId or part of one" />
						<Chips
							options={[
								{ value: "", label: "Closed and lost" },
								{ value: "closed", label: "Closed" },
								{ value: "lost", label: "Lost" },
							]}
							value={state}
							onChange={setState}
						/>
						{branches.length > 1 ? <Chips options={[{ value: "", label: "All branches" }, ...branches.map((b) => ({ value: b, label: b }))]} value={branch} onChange={setBranch} /> : null}
						{list.length ? (
							<DataTable
								id="fleet-gone"
								label="Recently gone"
								columns={GONE_COLUMNS}
								data={list}
								rowId={(s) => s.job}
								onRowPress={(s) => router.push(`/tt/${backendId}/server/${encodeURIComponent(s.job)}`)}
								defaultSort={[{ id: "went", desc: true }]}
								density="compact"
								search={false}
							/>
						) : (
							<Txt variant="muted" style={{ paddingHorizontal: space.xs }}>
								No server matches.
							</Txt>
						)}
					</>
				)}
			</QueryState>
		</>
	);
}
