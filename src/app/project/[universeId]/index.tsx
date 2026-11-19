/**
 * One game's home: the list of the tab the bottom bar has lit (features/project/game-nav): Overview (TypeTorch live
 * numbers, ads, the Roblox overview), TypeTorch (the dashboard's pages as tiles, when a backend is connected for this
 * universe), Analytics (Roblox analytics) and Roblox (the Creator Hub tools). The tab comes from the bar (a store) or
 * the route's `tab` (links: `?tab=typetorch`; `roblox` = `tools`).
 */
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { GameIcon } from "@/components/ProjectRow";
import { Badge, Button, Card, Chips, ErrorState, Icon, Screen, Skeleton, Txt } from "@/components/ui";
import { createExportRegistry, ExportProvider } from "@/features/export/context";
import { ExportButton, slug } from "@/features/export/ExportButton";
import { togglePin, usePins } from "@/features/project/pins";
import { AnalyticsTab } from "@/features/project/AnalyticsTab";
import { OverviewTab } from "@/features/project/OverviewTab";
import { useProject } from "@/features/project/projects";
import { ToolsTab } from "@/features/project/ToolsTab";
import { GameSummary, TTPagesGrid } from "@/features/project/GameHome";
import { useHomeTab } from "@/features/project/game-nav";
import { useUniverseBackends } from "@/features/typetorch/components";
import { compact } from "@/lib/format";
import { useTheme } from "@/theme";

type Tab = "overview" | "analytics" | "tools" | "typetorch";

export default function ProjectScreen() {
	const { universeId, tab: initialTab, group: analyticsGroup, view: analyticsView } = useLocalSearchParams<{ universeId: string; tab?: Tab; group?: string; view?: "cards" | "gallery" }>();
	const id = Number(universeId);
	const theme = useTheme();
	const pinned = usePins().includes(id);
	const project = useProject(id);
	const backends = useUniverseBackends(id);
	const wanted = useHomeTab(id, initialTab, "overview");
	const tab: Tab = wanted === "typetorch" && !backends.length ? "overview" : wanted;
	const [backendId, setBackendId] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const [refreshing, setRefreshing] = useState(false);
	const backend = backends.find((b) => b.id === backendId) ?? backends[0] ?? null;
	const exports = useMemo(() => createExportRegistry(), []);
	const tabLabel = (t: Tab) => (t === "overview" ? "Overview" : t === "analytics" ? "Analytics" : t === "tools" ? "Creator Hub tools" : "Dashboard pages");
	const projectName = project.data?.name ?? `Universe ${id}`;

	const tabs: { value: Tab; label: string }[] = [
		{ value: "overview", label: "Overview" },
		{ value: "analytics", label: "Analytics" },
		{ value: "tools", label: "Creator Hub tools" },
		...(backends.length ? [{ value: "typetorch" as const, label: "Dashboard pages" }] : []),
	];

	async function onRefresh() {
		setRefreshing(true);
		try {
			const keys: unknown[][] =
				tab === "typetorch" && backend ? [["tt", backend.id]] : tab === "analytics" ? [["oc", "analytics", id]] : [["project", id], ["banner", id], ["places", id], ["servers"], ["oc", "universe", id]];
			await Promise.all(keys.map((queryKey) => queryClient.refetchQueries({ queryKey, type: "active" })));
		} finally {
			setRefreshing(false);
		}
	}

	return (
		<Screen refreshing={refreshing} onRefresh={onRefresh}>
			<Stack.Screen
				options={{
					// The header shows the experience as the picker; this is the line under it.
					title: tabs.find((t) => t.value === tab)?.label ?? "Overview",
					headerRight: () => (
						<View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
							{tab === "overview" || tab === "analytics" ? (
								<ExportButton
									registry={exports}
									fileBase={() => `${slug(projectName)}-${tab}`}
									header={() => ({
										title: `${tabLabel(tab)} · ${projectName}`,
										lines: [`Universe ${id} · exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, ...exports.lines()],
									})}
								/>
							) : null}
							<Pressable onPress={() => togglePin(id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={pinned ? "Unpin this experience" : "Pin this experience"}>
								<Icon name={pinned ? "star" : "star-outline"} size={22} color={pinned ? theme.warning : theme.mutedForeground} />
							</Pressable>
							<Pressable onPress={() => router.push("/app-settings")} hitSlop={10} accessibilityRole="button" accessibilityLabel="App settings">
								<Icon name="settings-outline" size={21} color={theme.mutedForeground} />
							</Pressable>
						</View>
					),
				}}
			/>
			{project.error ? <ErrorState error={project.error} onRetry={() => project.refetch()} /> : null}
			{tab !== "overview" ? null : project.data ? (
				<View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
					<GameIcon uri={project.data.icon} size={56} />
					<View style={{ flex: 1, gap: 4 }}>
						<Txt variant="h2" numberOfLines={2}>
							{project.data.name}
						</Txt>
						<View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
							<Txt variant="small">{project.data.creator.name}</Txt>
							<Badge label={`${compact(project.data.playing)} playing`} tone={project.data.playing ? "good" : "muted"} />
							{backends.length ? <Badge label="TypeTorch" tone="brand" icon="flame" /> : null}
						</View>
					</View>
				</View>
			) : !project.error ? (
				<Skeleton height={56} />
			) : null}

			{tab === "overview" ? <GameSummary universeId={id} backend={backend} /> : null}

			<ExportProvider registry={exports}>
				{tab === "overview" && project.data ? <OverviewTab project={project.data} /> : null}
				{tab === "analytics" ? <AnalyticsTab universeId={id} initialGroup={analyticsGroup} initialView={analyticsView} /> : null}
			</ExportProvider>
			{tab === "tools" ? <ToolsTab universeId={id} name={project.data?.name ?? `universe ${id}`} /> : null}
			{tab === "typetorch" && backend ? (
				<View style={{ gap: 12 }}>
					{backends.length > 1 ? <Chips options={backends.map((b) => ({ value: b.id, label: b.name }))} value={backend.id} onChange={setBackendId} /> : null}
					<TTPagesGrid account={backend} />
				</View>
			) : null}
			{tab === "overview" && !backends.length && project.data ? (
				<Card style={{ gap: 6 }}>
					<Txt variant="small">Run TypeTorch in this experience? Connect its backend to get the live fleet, deploys and errors here.</Txt>
					<Button title="Connect a backend" small icon="flame-outline" onPress={() => router.push("/backend/connect")} style={{ alignSelf: "flex-start" }} />
				</Card>
			) : null}
		</Screen>
	);
}
