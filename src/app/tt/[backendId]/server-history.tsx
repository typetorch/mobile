/**
 * Server history: closed and lost servers (GET /v1/fleet/servers?gone=1, rows kept 30 days), by state and branch,
 * searchable by JobId. A server opens its page: offline badge, timeline, debug bundles and whole-life charts.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { Chips, Dot, List, Row, SearchBar, Stat, StatGrid, Txt } from "@/components/ui";
import { Note, QueryState } from "@/features/typetorch/bits";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, fmtDuration, fmtInt, fmtTime, shortId } from "@/lib/format";
import { space } from "@/theme";

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
							<List>
								{list.map((s) => {
									const went = s.closedAt ?? s.lostAt ?? s.lastSeen ?? null;
									const life = s.startedAt && went ? Date.parse(went) - Date.parse(s.startedAt) : null;
									return (
										<Row
											key={s.job}
											chevron
											onPress={() => router.push(`/tt/${backendId}/server/${encodeURIComponent(s.job)}`)}
											left={<Dot tone={s.state === "lost" ? "critical" : "muted"} />}
											title={<Txt variant="mono">{shortId(s.job, 6)}</Txt>}
											subtitle={
												<View style={{ gap: 1 }}>
													<Txt variant="small">
														{s.state} {fmtAgo(went)} · {s.branch ?? "–"} · {shortId(s.artifact, 6)}
														{s.kernel ? ` · kernel ${s.kernel}` : ""}
													</Txt>
													<Txt variant="small">
														{went ? fmtTime(went) : "–"}
														{life !== null && life >= 0 ? ` · ran ${fmtDuration(life)}` : ""}
														{s.health && s.health !== "ok" ? ` · ${s.health}` : ""}
													</Txt>
												</View>
											}
										/>
									);
								})}
							</List>
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
