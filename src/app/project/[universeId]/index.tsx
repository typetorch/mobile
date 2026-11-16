/**
 * One experience: Overview, Analytics, Tools (Open Cloud), and TypeTorch (the full backend dashboard, when a
 * TypeTorch backend is connected for this universe).
 */
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { GameIcon } from "@/components/ProjectRow";
import { Badge, Button, Card, Chips, ErrorState, Icon, Screen, Segmented, Skeleton, Txt } from "@/components/ui";
import { togglePin, usePins } from "@/features/project/pins";
import { AnalyticsTab } from "@/features/project/AnalyticsTab";
import { OverviewTab } from "@/features/project/OverviewTab";
import { useProject } from "@/features/project/projects";
import { ToolsTab } from "@/features/project/ToolsTab";
import { BackendHeader, TTHome, useUniverseBackends } from "@/features/typetorch/components";
import { compact } from "@/lib/format";
import { useTheme } from "@/theme";

type Tab = "overview" | "analytics" | "tools" | "typetorch";

export default function ProjectScreen() {
	const { universeId, tab: initialTab } = useLocalSearchParams<{ universeId: string; tab?: Tab }>();
	const id = Number(universeId);
	const theme = useTheme();
	const pinned = usePins().includes(id);
	const project = useProject(id);
	const backends = useUniverseBackends(id);
	const [tab, setTab] = useState<Tab>(initialTab ?? (backends.length ? "typetorch" : "overview"));
	const [backendId, setBackendId] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const [refreshing, setRefreshing] = useState(false);
	const backend = backends.find((b) => b.id === backendId) ?? backends[0] ?? null;

	const tabs: { value: Tab; label: string }[] = [
		{ value: "overview", label: "Overview" },
		{ value: "analytics", label: "Analytics" },
		{ value: "tools", label: "Tools" },
		...(backends.length ? [{ value: "typetorch" as const, label: "TypeTorch" }] : []),
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
					title: project.data?.name ?? "Experience",
					headerRight: () => (
						<Pressable onPress={() => togglePin(id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={pinned ? "Unpin this experience" : "Pin this experience"}>
							<Icon name={pinned ? "star" : "star-outline"} size={22} color={pinned ? theme.warning : theme.mutedForeground} />
						</Pressable>
					),
				}}
			/>
			{project.error ? <ErrorState error={project.error} onRetry={() => project.refetch()} /> : null}
			{project.data ? (
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

			<Segmented options={tabs} value={tab} onChange={setTab} />

			{tab === "overview" && project.data ? <OverviewTab project={project.data} /> : null}
			{tab === "analytics" ? <AnalyticsTab universeId={id} /> : null}
			{tab === "tools" ? <ToolsTab universeId={id} name={project.data?.name ?? `universe ${id}`} /> : null}
			{tab === "typetorch" && backend ? (
				<View style={{ gap: 12 }}>
					{backends.length > 1 ? <Chips options={backends.map((b) => ({ value: b.id, label: b.name }))} value={backend.id} onChange={setBackendId} /> : null}
					<BackendHeader account={backend} />
					<TTHome backendId={backend.id} />
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
