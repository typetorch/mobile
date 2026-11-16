/**
 * Custom dashboards (Creator Hub > Analytics > Custom dashboards, BETA): the list with pinned ones first, what the key
 * may do and the limits Roblox enforces, pin / unpin, and creating a dashboard (name + description; tiles are added on
 * the dashboard's own screen). Writes need universe.analytics.dashboard:write.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, EmptyState, Field, Icon, List, notify, Row, Section, SkeletonList, Txt } from "@/components/ui";
import { createDashboard, DASHBOARD_READ, DASHBOARD_WRITE, listDashboards, patchDashboardMetadata, type DashboardMetadata } from "@/features/project/api/analytics-tools";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo } from "@/lib/format";
import { useTheme } from "@/theme";

export default function DashboardsScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Custom dashboards" scopes={[DASHBOARD_READ]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "dashboards"], type: "active" })}>
			{({ universeId, cloud, can }) => <Dashboards universeId={universeId} cloud={cloud} canWrite={can(DASHBOARD_WRITE)} />}
		</ToolScreen>
	);
}

function Dashboards({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [formError, setFormError] = useState<string | null>(null);

	const list = useInfiniteQuery({
		queryKey: ["oc", "dashboards", universeId],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listDashboards(cloud, universeId, pageParam),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const dashboards = (list.data?.pages.flatMap((pg) => pg.dashboards ?? []) ?? []).slice().sort((a, b) => Number(!!b.isPinned) - Number(!!a.isPinned));
	const caps = list.data?.pages[0]?.capabilities ?? null;
	const limits = caps?.limits ?? null;
	const maxName = limits?.maxDashboardNameLength || 100;
	const maxDescription = limits?.maxDashboardDescriptionLength || 500;

	const open = (d: DashboardMetadata) => d.dashboardId && router.push(`/project/${universeId}/dashboard?id=${encodeURIComponent(d.dashboardId)}`);

	const create = useMutation({
		mutationFn: () => createDashboard(cloud, universeId, { name: name.trim(), description: description.trim() }),
		onSuccess: (r) => {
			setName("");
			setDescription("");
			setCreating(false);
			queryClient.invalidateQueries({ queryKey: ["oc", "dashboards", universeId] });
			const id = r.dashboard?.metadata?.dashboardId;
			if (id) router.push(`/project/${universeId}/dashboard?id=${encodeURIComponent(id)}`);
		},
		onError: (e) => notify("Couldn't create the dashboard", cloudErrorText(e)),
	});
	const pin = useMutation({
		mutationFn: (d: DashboardMetadata) => patchDashboardMetadata(cloud, universeId, d.dashboardId!, d.headEtag ?? "", { isPinned: !d.isPinned }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oc", "dashboards", universeId] }),
		onError: (e) => notify("Couldn't change the pin", cloudErrorText(e)),
	});

	function submit() {
		setFormError(null);
		const n = name.trim();
		if (!n) return setFormError("Give the dashboard a name.");
		if (n.length > maxName) return setFormError(`The name is at most ${maxName} characters.`);
		if (description.trim().length > maxDescription) return setFormError(`The description is at most ${maxDescription} characters.`);
		if (limits?.maxDashboardsPerUniverse && dashboards.length >= limits.maxDashboardsPerUniverse && !list.hasNextPage) return setFormError(`This experience already has the most dashboards Roblox allows (${limits.maxDashboardsPerUniverse}).`);
		create.mutate();
	}

	const writable = canWrite && caps?.canCreate !== false;

	return (
		<>
			{writable ? (
				creating ? (
					<Card style={{ gap: 8 }}>
						<Txt variant="h3">New dashboard</Txt>
						<Field value={name} onChangeText={setName} placeholder={`Name (${maxName} chars)`} maxLength={maxName} autoCapitalize="sentences" />
						<Field value={description} onChangeText={setDescription} placeholder={`Description (optional, ${maxDescription} chars)`} maxLength={maxDescription} autoCapitalize="sentences" />
						<Txt variant="small">It starts empty: add chart tiles on its page, or build it on Creator Hub.</Txt>
						<View style={{ flexDirection: "row", gap: 8 }}>
							<Button title="Create" variant="primary" small icon="add" loading={create.isPending} onPress={submit} />
							<Button title="Cancel" small onPress={() => setCreating(false)} />
						</View>
						{formError ? (
							<Txt variant="small" color={p.destructive}>
								{formError}
							</Txt>
						) : null}
					</Card>
				) : (
					<Button title="New dashboard" icon="add" small onPress={() => setCreating(true)} style={{ alignSelf: "flex-start" }} />
				)
			) : (
				<Txt variant="small">{canWrite ? "Roblox says this key can't create dashboards here." : `Read only: add ${DASHBOARD_WRITE} to create, pin and edit dashboards.`}</Txt>
			)}

			{list.error ? (
				<CloudError error={list.error} what="Custom dashboards" onRetry={() => list.refetch()} />
			) : !list.data ? (
				<SkeletonList rows={4} />
			) : dashboards.length ? (
				<Section title={`Dashboards (${dashboards.length}${list.hasNextPage ? "+" : ""})`}>
					<List>
						{dashboards.map((d) => (
							<Row
								key={d.dashboardId}
								left={<Icon name={d.isPinned ? "pin" : "grid-outline"} color={d.isPinned ? p.brand : p.mutedForeground} />}
								title={d.name || "Untitled"}
								subtitle={[d.description, d.updatedTime ? `updated ${fmtAgo(d.updatedTime)}` : "", d.latestPublishedVersion && d.latestPublishedVersion !== "0" ? `v${d.latestPublishedVersion}` : "no tiles published"].filter(Boolean).join(" · ")}
								numberOfLines={2}
								onPress={() => open(d)}
								chevron
								right={
									canWrite && caps?.canEdit !== false ? (
										<Button title={d.isPinned ? "Unpin" : "Pin"} small variant="ghost" loading={pin.isPending && pin.variables?.dashboardId === d.dashboardId} onPress={() => pin.mutate(d)} />
									) : d.isPinned ? (
										<Badge label="pinned" tone="brand" />
									) : undefined
								}
							/>
						))}
					</List>
					{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</Section>
			) : (
				<EmptyState icon="grid-outline" title="No custom dashboards" body="Dashboards made here or on Creator Hub (Analytics > Custom dashboards) show up here." />
			)}

			{limits ? (
				<Txt variant="small">
					Limits: {limits.maxDashboardsPerUniverse ?? "?"} dashboards, {limits.maxPinnedDashboardsPerUniverse ?? "?"} pinned, {limits.maxChartTilesPerDashboard ?? "?"} charts and {limits.maxSummaryCardsPerDashboard ?? "?"} summary cards each.
				</Txt>
			) : null}
		</>
	);
}
