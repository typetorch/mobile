/** Errors: the error kinds seen in a window (GET /v1/errors), searchable, by realm, with their trend. */
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Sparkline } from "@/charts/LineChart";
import { Badge, Button, Chips, EmptyState, ErrorState, List, Row, SearchBar, Section, Segmented, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { compact, fmtAgo } from "@/lib/format";
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
	const [window, setWindow] = useState("24h");
	const [realm, setRealm] = useState("");
	const [search, setSearch] = useState("");
	const [q, setQ] = useState("");
	const list = useTTQuery(backendId, ["errors", window, realm, q], (api, s) => api.errors({ window, limit: 100, ...(realm ? { realm } : {}), ...(q ? { q } : {}) }, s), { staleTime: 30_000 });
	return (
		<>
			<Segmented options={WINDOWS} value={window} onChange={setWindow} />
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
							<List>
								{list.data.kinds.map((k) => (
									<Row
										key={k.fp}
										chevron
										onPress={() => router.push(`/tt/${backendId}/error/${encodeURIComponent(k.fp)}?window=${window}`)}
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
