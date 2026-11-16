/**
 * Creator Hub's Analytics Home side by side: up to 9 of the person's experiences with their users, revenue and
 * playtime over the range (one granularity-None query per experience and metric, so Roblox's own uniques / totals).
 * There is no multi-experience endpoint, and the 30 queries a minute are per key owner across all experiences, so
 * the table loads only on a tap.
 */
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { ANALYTICS_READ_SCOPE, hasScope, missingScopesOf } from "@/api/opencloud";
import { Badge, Button, Card, Skeleton, Txt } from "@/components/ui";
import { cloudErrorText } from "@/features/project/CloudError";
import { useAddedIds } from "@/features/project/pins";
import { useAddedProjects } from "@/features/project/projects";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

import { timeRange, type MetricFormat, type RangeSpec } from "../analytics";
import { fmtValue, useMetric } from "./shared";

const MAX = 9;
const COLUMNS: { metric: string; label: string; format: MetricFormat }[] = [
	{ metric: "DailyActiveUsers", label: "Users", format: "count" },
	{ metric: "DailyRevenue", label: "Revenue", format: "robux" },
	{ metric: "TotalPlayTimeHours", label: "Playtime", format: "hours" },
];

function Cell({ universeId, metric, format, startTime, endTime, label }: { universeId: number; metric: string; format: MetricFormat; startTime: string; endTime: string; label: string }) {
	const q = useMetric(universeId, { metric, granularity: "None", startTime, endTime });
	if (q.isLoading) return <Skeleton height={14} width={52} />;
	if (q.error) {
		// A cell is too small for the error view: a tap shows Roblox's message (or the missing scope) with a retry.
		const show = () =>
			Alert.alert(`${label} failed`, cloudErrorText(q.error), [
				{ text: "Close", style: "cancel" },
				{ text: "Try again", onPress: () => void q.refetch() },
			]);
		return (
			<Pressable onPress={show} accessibilityRole="button" accessibilityLabel={`${label} failed; show why`} hitSlop={8}>
				<Badge label={missingScopesOf(q.error) ? "no access" : "error"} tone="critical" icon="alert-circle-outline" />
			</Pressable>
		);
	}
	return (
		<Txt variant="small" style={{ fontWeight: "600" }} color={undefined}>
			{fmtValue(format, q.data?.[0]?.dataPoints[0]?.value ?? null)}
		</Txt>
	);
}

export function Compare({ universeId, range }: { universeId: number; range: RangeSpec }) {
	const p = useTheme();
	const { keyInfo } = useAccounts();
	// The person's own list (fast), not the whole discovery list.
	const projects = useAddedProjects(useAddedIds().ids);
	const [picked, setPicked] = useState<number[]>([universeId]);
	const [shown, setShown] = useState<number[] | null>(null);
	const tr = timeRange(range, {}, "None");
	const all = projects.data?.projects ?? [];
	const names = new Map(all.map((x) => [x.universeId, x.name]));
	const allowed = (id: number) => hasScope(keyInfo, ANALYTICS_READ_SCOPE, id);
	const toggle = (id: number) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX ? cur : [...cur, id]));
	return (
		<Card style={{ gap: 10 }}>
			<Txt style={{ fontWeight: "600" }}>Your experiences side by side</Txt>
			<Txt variant="small">Pick up to {MAX}. Each experience costs {COLUMNS.length} of Roblox's 30 analytics queries a minute.</Txt>
			{projects.isLoading ? <Skeleton height={60} /> : null}
			{projects.error ? <Txt variant="small">Couldn't list your experiences: {(projects.error as Error).message}</Txt> : null}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
				{(all.some((x) => x.universeId === universeId) ? all : [{ universeId, name: "This experience" }, ...all]).map((x) => {
					const on = picked.includes(x.universeId);
					const ok = allowed(x.universeId);
					return (
						<Pressable key={x.universeId} onPress={() => ok && toggle(x.universeId)} disabled={!ok}>
							<Badge label={ok ? x.name : `${x.name} (no access)`} tone={on ? "brand" : "muted"} icon={on ? "checkmark" : undefined} />
						</Pressable>
					);
				})}
			</View>
			<Button title={shown ? "Update table" : "Compare"} icon="git-compare-outline" small variant="primary" disabled={!picked.length} onPress={() => setShown(picked)} style={{ alignSelf: "flex-start" }} />
			{shown ? (
				<View style={{ gap: 0 }}>
					<View style={{ flexDirection: "row", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderColor: p.border }}>
						<Txt variant="label" style={{ flex: 1 }}>
							Experience
						</Txt>
						{COLUMNS.map((c) => (
							<Txt key={c.metric} variant="label" style={{ width: 70, textAlign: "right" }}>
								{c.label}
							</Txt>
						))}
					</View>
					{shown.map((id) => (
						<View key={id} style={{ flexDirection: "row", gap: 8, paddingVertical: 8, alignItems: "center", borderBottomWidth: 1, borderColor: p.border }}>
							<Txt variant="small" color={p.foreground} numberOfLines={1} style={{ flex: 1 }}>
								{names.get(id) ?? `Universe ${id}`}
							</Txt>
							{COLUMNS.map((c) => (
								<View key={c.metric} style={{ width: 70, alignItems: "flex-end" }}>
									<Cell universeId={id} metric={c.metric} format={c.format} startTime={tr.startTime} endTime={tr.endTime} label={`${c.label} for ${names.get(id) ?? `universe ${id}`}`} />
								</View>
							))}
						</View>
					))}
					<Txt variant="small" style={{ paddingTop: 6 }}>
						Totals Roblox computes for the whole range (the Total granularity), so users are counted once. Tap an error to see why it failed.
					</Txt>
				</View>
			) : null}
		</Card>
	);
}
