/**
 * Errors: the error kinds seen in a window (GET /v1/errors), searchable, by realm, branch and build (artifact), in the
 * order picked, with their trend. A kind opens with the same window and filters.
 */
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Sparkline } from "@/charts/LineChart";
import { Badge, Button, Chips, EmptyState, ErrorState, Field, List, Row, SearchBar, Section, Segmented, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { ERROR_WINDOWS, useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { compact, fmtAgo, shortId } from "@/lib/format";
import { useTheme } from "@/theme";

/** The server's sort (`-` = largest / newest first). */
const SORTS = [
	{ value: "-count", label: "Most" },
	{ value: "-lastAt", label: "Latest" },
	{ value: "-firstAt", label: "Newest kinds" },
	{ value: "-total", label: "All time" },
];

export default function ErrorsScreen() {
	return <TTScreen title="Errors">{({ backendId }) => <Errors backendId={backendId} />}</TTScreen>;
}

function Errors({ backendId }: { backendId: string }) {
	const p = useTheme();
	const [window, setWindow] = useState("24h");
	const [realm, setRealm] = useState("");
	const [search, setSearch] = useState("");
	const [q, setQ] = useState("");
	const [branchText, setBranchText] = useState("");
	const [branch, setBranch] = useState("");
	const [build, setBuild] = useState("");
	const [sort, setSort] = useState("-count");
	const filters = { ...(realm ? { realm } : {}), ...(branch ? { branch } : {}), ...(build ? { build } : {}) };
	const list = useTTQuery(backendId, ["errors", window, filters, q, sort], (api, s) => api.errors({ window, limit: 100, ...filters, ...(q ? { q } : {}), sort }, s), { staleTime: 30_000 });
	// The builds with errors under the other filters (the web's artifact picker), the picked one kept.
	const builds = (list.data?.builds ?? []).slice(0, 12).map((b) => b.build);
	if (build && !builds.includes(build)) builds.unshift(build);
	const kindLink = (fp: string) => `/tt/${backendId}/error/${encodeURIComponent(fp)}?${new URLSearchParams({ window, ...(branch ? { branch } : {}), ...(build ? { build } : {}) }).toString()}`;
	return (
		<>
			<Segmented options={ERROR_WINDOWS} value={window} onChange={setWindow} />
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
			<Field
				value={branchText}
				onChangeText={(t) => {
					setBranchText(t);
					if (!t.trim()) setBranch("");
				}}
				onSubmitEditing={() => setBranch(branchText.trim())}
				onBlur={() => setBranch(branchText.trim())}
				returnKeyType="done"
				placeholder="Any branch"
			/>
			{builds.length ? (
				<View>
					<Chips options={[{ value: "", label: "Any build" }, ...builds.map((b) => ({ value: b, label: shortId(b, 8) }))]} value={build} onChange={setBuild} />
				</View>
			) : null}
			<View>
				<Chips options={SORTS} value={sort} onChange={setSort} />
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
							<List>
								{list.data.kinds.map((k) => (
									<Row
										key={k.fp}
										chevron
										onPress={() => router.push(kindLink(k.fp))}
										title={k.template}
										numberOfLines={2}
										subtitle={
											<View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
												<Badge label={k.realm} tone={k.realm === "server" ? "brand" : "muted"} />
												<Txt variant="small">
													{compact(k.count)}× · {k.players} players · {fmtAgo(k.lastAt)}
												</Txt>
											</View>
										}
										right={<Sparkline values={k.spark} color={p.destructive} />}
									/>
								))}
							</List>
						</Section>
					) : (
						<EmptyState icon="checkmark-circle-outline" title="No errors" body="Nothing in this window. Pick a longer one to see older errors." />
					)}
				</>
			) : null}
		</>
	);
}
