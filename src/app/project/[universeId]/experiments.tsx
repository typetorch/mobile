/**
 * Experiments (A/B tests on experience configs, EXPERIMENTAL): the list by state with search and offset paging (Roblox
 * pages these with maxPageSize + skip and returns the total), a way to create one, and the minimum detectable effect
 * calculator for planning exposure and duration.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, Chips, EmptyState, Field, List, notify, Row, SearchBar, Section, SkeletonList, Txt } from "@/components/ui";
import { calculateMde, CONFIG_READ, CONFIG_WRITE, EXPERIMENT_METRICS, listExperiments, type ExperimentState, type MdeResult, type UniverseExperimentMetric } from "@/features/project/api/analytics-tools";
import { EXPERIMENT_STATES, stateLabel, stateTone } from "@/features/project/analytics-tools/experiments-model";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtInt } from "@/lib/format";
import { useTheme } from "@/theme";
import { splitList } from "@/features/project/analytics-tools/dashboard-model";

export default function ExperimentsScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Experiments" scopes={[CONFIG_READ]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "experiments"], type: "active" })}>
			{({ universeId, cloud, can }) => <Experiments universeId={universeId} cloud={cloud} canWrite={can(CONFIG_WRITE)} />}
		</ToolScreen>
	);
}

const PAGE = 20;

function Experiments({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const [state, setState] = useState<"all" | ExperimentState>("all");
	const [text, setText] = useState("");
	const [search, setSearch] = useState("");
	const [mde, setMde] = useState(false);

	const list = useInfiniteQuery({
		queryKey: ["oc", "experiments", universeId, "list", state, search],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			listExperiments(cloud, universeId, {
				maxPageSize: PAGE,
				skip: pageParam,
				searchKey: search || undefined,
				stateFilters: state === "all" ? undefined : [state],
				sortKey: "LIST_EXPERIMENT_SORT_KEY_LAST_MODIFIED_TIME",
				sortOrder: "SORT_ORDER_DESCENDING",
			}),
		getNextPageParam: (last, pages) => {
			const loaded = pages.reduce((n, pg) => n + (pg.experiments?.length ?? 0), 0);
			return (last.experiments?.length ?? 0) > 0 && loaded < (last.total ?? 0) ? loaded : undefined;
		},
	});
	const rows = list.data?.pages.flatMap((pg) => pg.experiments ?? []) ?? [];
	const total = list.data?.pages[0]?.total ?? rows.length;

	return (
		<>
			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				{canWrite ? <Button title="New experiment" icon="add" small onPress={() => router.push(`/project/${universeId}/experiment?new=1`)} /> : null}
				<Button title={mde ? "Hide calculator" : "Sample size calculator"} icon="calculator-outline" small onPress={() => setMde(!mde)} />
			</View>
			{!canWrite ? <Txt variant="small">Read only: add {CONFIG_WRITE} to create, start and stop experiments.</Txt> : null}
			{mde ? <MdeCalculator universeId={universeId} cloud={cloud} /> : null}
			<SearchBar value={text} onChangeText={setText} placeholder="Search experiments" onSubmit={() => setSearch(text.trim())} />
			<Chips options={[{ value: "all" as const, label: "All" }, ...EXPERIMENT_STATES]} value={state} onChange={setState} />
			{list.error ? (
				<CloudError error={list.error} what="Experiments" onRetry={() => list.refetch()} />
			) : !list.data ? (
				<SkeletonList rows={4} />
			) : rows.length ? (
				<Section title={`${fmtInt(total)} experiment${total === 1 ? "" : "s"}`}>
					<List>
						{rows.map((e) => (
							<Row
								key={e.id ?? e.name}
								title={e.name || "Untitled"}
								subtitle={[
									e.experimentConfigKey ? `key ${e.experimentConfigKey}` : e.productType === "EXPERIMENT_PRODUCT_TYPE_MATCHMAKING" ? "matchmaking" : "",
									e.startedTime ? `started ${fmtAgo(e.startedTime)}` : e.scheduledTime ? `starts ${fmtAgo(e.scheduledTime)}` : e.createdTime ? `created ${fmtAgo(e.createdTime)}` : "",
									e.durationSeconds ? `${Math.round(e.durationSeconds / 86_400)} d` : "",
								]
									.filter(Boolean)
									.join(" · ")}
								numberOfLines={2}
								right={e.state ? <Badge label={stateLabel(e.state)} tone={stateTone(e.state)} /> : undefined}
								onPress={() => e.id && router.push(`/project/${universeId}/experiment?id=${encodeURIComponent(e.id)}`)}
								chevron
							/>
						))}
					</List>
					{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</Section>
			) : (
				<EmptyState icon="flask-outline" title="No experiments" body={search || state !== "all" ? "Nothing matches." : "Experiments test config values on a share of players and compare a goal metric."} />
			)}
		</>
	);
}

function MdeCalculator({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const [exposure, setExposure] = useState("100");
	const [days, setDays] = useState("14");
	const [baseline, setBaseline] = useState("50");
	const [weights, setWeights] = useState("50");
	const [goal, setGoal] = useState<UniverseExperimentMetric>("UNIVERSE_EXPERIMENT_METRIC_AVERAGE_SESSION_TIME");
	const [error, setError] = useState<string | null>(null);
	const calc = useMutation({
		mutationFn: (body: Parameters<typeof calculateMde>[2]) => calculateMde(cloud, universeId, body),
		onError: (e) => notify("Couldn't calculate", cloudErrorText(e)),
	});
	const result: MdeResult | undefined = calc.data;

	function run() {
		const exp = Number(exposure);
		const d = Number(days);
		const b = Number(baseline);
		const ws = splitList(weights).map(Number);
		if (!Number.isInteger(exp) || exp < 1 || exp > 100) return setError("Exposure is a whole percent from 1 to 100.");
		if (!Number.isInteger(d) || d < 1 || d > 365) return setError("Duration is whole days (1-365).");
		if (!Number.isFinite(b) || b <= 0 || b > 100) return setError("The baseline weight is from 0 to 100.");
		if (!ws.length || ws.some((w) => !Number.isFinite(w) || w <= 0 || w > 100)) return setError("Variant weights are numbers from 0 to 100, comma separated.");
		setError(null);
		calc.mutate({ exposurePercent: exp, durationSeconds: d * 86_400, baselineWeight: b, variantWeights: ws, universeGoalMetric: goal });
	}

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">Minimum detectable effect</Txt>
			<Txt variant="small">The smallest change in the goal metric an experiment like this can reliably detect, from your recent traffic.</Txt>
			<View style={{ flexDirection: "row", gap: 8 }}>
				<View style={{ flex: 1 }}>
					<Field label="Exposure %" value={exposure} onChangeText={setExposure} keyboardType="number-pad" />
				</View>
				<View style={{ flex: 1 }}>
					<Field label="Days" value={days} onChangeText={setDays} keyboardType="number-pad" />
				</View>
			</View>
			<View style={{ flexDirection: "row", gap: 8 }}>
				<View style={{ flex: 1 }}>
					<Field label="Baseline weight" value={baseline} onChangeText={setBaseline} keyboardType="decimal-pad" />
				</View>
				<View style={{ flex: 1 }}>
					<Field label="Variant weights" value={weights} onChangeText={setWeights} keyboardType="numbers-and-punctuation" />
				</View>
			</View>
			<Chips options={EXPERIMENT_METRICS} value={goal} onChange={setGoal} />
			<Button title="Calculate" variant="primary" small icon="calculator-outline" loading={calc.isPending} onPress={run} style={{ alignSelf: "flex-start" }} />
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error}
				</Txt>
			) : null}
			{result ? (
				<View style={{ gap: 4 }}>
					{(result.mdeRelativePercentages ?? []).map((m, i) => (
						<Txt key={i}>
							Variant {i + 1}: ±{m.toFixed(2)}%
						</Txt>
					))}
					<Txt variant="small">
						Sample: {fmtInt(result.totalSampleSize ?? 0)} players
						{result.minimumSampleSizeThreshold && (result.totalSampleSize ?? 0) < result.minimumSampleSizeThreshold ? ` (below ${fmtInt(result.minimumSampleSizeThreshold)}: the estimate is unreliable)` : ""}
					</Txt>
				</View>
			) : null}
		</Card>
	);
}
