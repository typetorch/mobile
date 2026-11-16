/**
 * Projects: only the experiences the person added (one details fetch for those ids, nothing else), pinned ones
 * first, in the chosen order. "Add projects" opens the full list of everything they can reach.
 */
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { PinStar, ProjectRow } from "@/components/ProjectRow";
import { Button, Card, Chips, confirm, EmptyState, ErrorState, Icon, List, Screen, SearchBar, Section, SkeletonList, Txt } from "@/components/ui";
import { compareProjects, removeProject, seedAdded, SORT_OPTIONS, togglePin, useAddedIds, usePins, useProjectSort, type ProjectSort } from "@/features/project/pins";
import { useAddedProjects, useTTLivePlayers, type Project } from "@/features/project/projects";
import { compact } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

export default function ProjectsScreen() {
	const p = useTheme();
	const { keyError, prefs, backends } = useAccounts();
	const added = useAddedIds();
	const pins = usePins();
	const [sortBy, setSortBy] = useProjectSort();
	const [search, setSearch] = useState("");

	// First start of this version: earlier pins and hand-added ids become the list.
	useEffect(() => {
		if (added.loaded && added.unset) seedAdded([...pins, ...prefs.extraUniverseIds]);
	}, [added.loaded, added.unset, pins, prefs.extraUniverseIds]);

	const list = useAddedProjects(added.ids);
	// Projects with a TypeTorch backend show its live CCU (every 15 s) instead of Roblox's lagging count.
	const ttPlayers = useTTLivePlayers();
	const ttUniverses = useMemo(() => new Set(backends.map((b) => b.universeId).filter((u): u is number => !!u)), [backends]);
	const q = search.trim().toLowerCase();

	const { pinned, rest, missing } = useMemo(() => {
		const onList = new Set(added.ids);
		// A removed id can still be in a kept previous answer for a moment: show only what is on the list now.
		const all = (list.data?.projects ?? [])
			.filter((x) => onList.has(x.universeId))
			.map((x) => (ttPlayers.has(x.universeId) ? { ...x, playing: ttPlayers.get(x.universeId) as number, playingFromTT: true } : x));
		const shown = all.filter((x) => !q || x.name.toLowerCase().includes(q) || String(x.universeId).includes(q) || x.creator.name.toLowerCase().includes(q)).sort(compareProjects(sortBy));
		const pinSet = new Set(pins);
		const found = new Set(all.map((x) => x.universeId));
		return {
			pinned: shown.filter((x) => pinSet.has(x.universeId)),
			rest: shown.filter((x) => !pinSet.has(x.universeId)),
			missing: list.data && !list.isPlaceholderData ? added.ids.filter((id) => !found.has(id)) : [],
		};
	}, [list.data, list.isPlaceholderData, added.ids, pins, q, sortBy, ttPlayers]);

	const playing = [...pinned, ...rest].reduce((n, x) => n + x.playing, 0);
	const empty = added.loaded && !added.unset && added.ids.length === 0;

	function askRemove(x: Project) {
		void confirm(`Remove ${x.name}?`, "It goes off your Projects list. Add it again any time from Add projects.", "Remove").then((ok) => {
			if (ok) removeProject(x.universeId);
		});
	}

	const row = (x: Project) => (
		<ProjectRow
			key={x.universeId}
			project={x}
			hasBackend={ttUniverses.has(x.universeId)}
			onPress={() => router.push(`/project/${x.universeId}`)}
			onLongPress={() => askRemove(x)}
			right={<PinStar pinned={pins.includes(x.universeId)} name={x.name} onPress={() => togglePin(x.universeId)} />}
		/>
	);

	return (
		<View style={{ flex: 1, backgroundColor: p.background }}>
			<Screen refreshing={list.isRefetching && !list.isPlaceholderData} onRefresh={() => list.refetch()}>
				{keyError ? <ErrorState title="The Open Cloud key was refused" error={keyError} onRetry={() => router.push("/settings")} /> : null}

				{empty ? (
					<EmptyState
						icon="albums-outline"
						title="No projects yet"
						body="Add the experiences you work on: from your Open Cloud key, your own and your groups' games, or by link. Only the ones you add load here."
						action={<Button title="Add projects" variant="brand" icon="add" onPress={() => router.push("/add-projects")} />}
					/>
				) : null}

				{added.ids.length ? (
					<>
						{added.ids.length > 6 ? <SearchBar value={search} onChangeText={setSearch} placeholder="Search your projects" /> : null}
						<Chips<ProjectSort> options={SORT_OPTIONS} value={sortBy} onChange={setSortBy} />
						{list.data ? (
							<Txt variant="small">
								{added.ids.length} project{added.ids.length === 1 ? "" : "s"} · {compact(playing)} playing now
							</Txt>
						) : null}
					</>
				) : null}

				{list.isLoading && added.ids.length ? <SkeletonList rows={Math.min(added.ids.length, 6)} /> : null}
				{list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
				{list.data?.warnings.length ? (
					<Card style={{ gap: 4 }}>
						<Txt variant="small" color={p.warning}>
							Some details didn't load:
						</Txt>
						{list.data.warnings.slice(0, 3).map((w, i) => (
							<Txt key={i} variant="small">
								{w}
							</Txt>
						))}
					</Card>
				) : null}

				{pinned.length ? (
					<Section title="Pinned">
						<List>{pinned.map(row)}</List>
					</Section>
				) : null}
				{rest.length ? (
					<Section title={pinned.length ? "Projects" : "Your projects"}>
						<List>{rest.map(row)}</List>
					</Section>
				) : null}
				{q && list.data && !pinned.length && !rest.length ? <EmptyState icon="search-outline" title="No project matches" body="Try another name or a universe ID." /> : null}

				{missing.length ? (
					<Card style={{ gap: 6 }}>
						<Txt variant="small">Roblox didn't answer for {missing.length === 1 ? "this one" : "these"} (private without a key scope, or deleted):</Txt>
						{missing.map((id) => (
							<View key={id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
								<Pressable onPress={() => router.push(`/project/${id}`)}>
									<Txt variant="mono">Universe {id}</Txt>
								</Pressable>
								<Button title="Remove" small variant="ghost" onPress={() => removeProject(id)} />
							</View>
						))}
					</Card>
				) : null}

				{added.ids.length ? (
					<Txt variant="small" style={{ textAlign: "center" }}>
						Tap the star to pin · long-press to remove
					</Txt>
				) : null}
				{/* Room for the floating button. */}
				<View style={{ height: 64 }} />
			</Screen>

			{!empty ? (
				<Pressable
					onPress={() => router.push("/add-projects")}
					accessibilityRole="button"
					accessibilityLabel="Add projects"
					style={({ pressed }) => ({
						position: "absolute",
						right: 16,
						bottom: 16,
						flexDirection: "row",
						alignItems: "center",
						gap: 6,
						paddingHorizontal: 18,
						paddingVertical: 12,
						borderRadius: 999,
						backgroundColor: p.brand,
						opacity: pressed ? 0.85 : 1,
						elevation: 4,
						shadowColor: "#000",
						shadowOpacity: 0.25,
						shadowRadius: 6,
						shadowOffset: { width: 0, height: 3 },
					})}
				>
					<Icon name="add" size={20} color="#fff" />
					<Txt style={{ color: "#fff", fontWeight: "600" }}>Add projects</Txt>
				</Pressable>
			) : null}
		</View>
	);
}
