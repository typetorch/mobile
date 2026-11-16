import { Image } from "expo-image";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { placeUniverse } from "@/api/roblox-public";
import { ProjectRow } from "@/components/ProjectRow";
import { Button, Card, EmptyState, ErrorState, Field, Icon, List, Screen, SearchBar, Section, SkeletonList, Txt } from "@/components/ui";
import { useProjects } from "@/features/project/projects";
import { compact } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

export default function ProjectsScreen() {
	const p = useTheme();
	const { hasKey, keyInfo, keyError, prefs, setPrefs, backends } = useAccounts();
	const projects = useProjects();
	const [search, setSearch] = useState("");
	const [adding, setAdding] = useState(false);
	const [addText, setAddText] = useState("");
	const [addError, setAddError] = useState<string | null>(null);
	const [addBusy, setAddBusy] = useState(false);

	const ttUniverses = useMemo(() => new Set(backends.map((b) => b.universeId).filter((u): u is number => !!u)), [backends]);
	const q = search.trim().toLowerCase();
	const sections = useMemo(
		() =>
			(projects.data?.sections ?? [])
				.map((s) => ({ ...s, projects: s.projects.filter((x) => !q || x.name.toLowerCase().includes(q) || String(x.universeId).includes(q) || s.title.toLowerCase().includes(q)) }))
				.filter((s) => s.projects.length),
		[projects.data, q],
	);
	const totals = useMemo(() => {
		const all = projects.data?.all ?? [];
		return { count: all.length, playing: all.reduce((n, x) => n + x.playing, 0) };
	}, [projects.data]);

	const noSource = !hasKey && !prefs.userId;

	async function addExperience() {
		setAddError(null);
		const text = addText.trim();
		const m = /(\d{3,})/.exec(text);
		if (!m) {
			setAddError("Paste a place link, place ID or universe ID.");
			return;
		}
		setAddBusy(true);
		try {
			const n = Number(m[1]);
			// A games link or a big number is most likely a place id; try that first, then treat it as a universe.
			const universe = (await placeUniverse(n).catch(() => null)) ?? n;
			if (!prefs.extraUniverseIds.includes(universe)) await setPrefs({ extraUniverseIds: [...prefs.extraUniverseIds, universe] });
			setAddText("");
			setAdding(false);
		} catch (e) {
			setAddError((e as Error).message);
		} finally {
			setAddBusy(false);
		}
	}

	return (
		<Screen refreshing={projects.isRefetching} onRefresh={() => projects.refetch()}>
			{noSource ? (
				<EmptyState
					icon="key-outline"
					title="Add your Open Cloud key"
					body="Paste an Open Cloud API key in Settings to see every experience it reaches, plus your own and your groups' experiences. The key stays on this phone."
					action={<Button title="Open Settings" variant="brand" icon="settings-outline" onPress={() => router.push("/settings")} />}
				/>
			) : null}
			{keyError ? <ErrorState title="The Open Cloud key was refused" error={keyError} onRetry={() => router.push("/settings")} /> : null}

			{!noSource ? (
				<>
					<SearchBar value={search} onChangeText={setSearch} placeholder="Search experiences" />
					{projects.data ? (
						<Txt variant="small">
							{totals.count} experiences · {compact(totals.playing)} playing now{keyInfo ? ` · key “${keyInfo.name}”` : ""}
						</Txt>
					) : null}
				</>
			) : null}

			{projects.isLoading && !noSource ? <SkeletonList rows={6} /> : null}
			{projects.error ? <ErrorState error={projects.error} onRetry={() => projects.refetch()} /> : null}
			{projects.data?.warnings.length ? (
				<Card style={{ gap: 4 }}>
					<Txt variant="small" color={p.warning}>
						Some sources didn't answer:
					</Txt>
					{projects.data.warnings.slice(0, 4).map((w, i) => (
						<Txt key={i} variant="small">
							{w}
						</Txt>
					))}
				</Card>
			) : null}

			{projects.data && !sections.length && !noSource ? (
				<EmptyState
					icon="cube-outline"
					title={q ? "No experience matches" : "No experiences yet"}
					body={
						q
							? "Try another name or a universe ID."
							: "Roblox lists only public experiences without a key. Add universes to your Open Cloud key on Creator Hub, or add one below by its place link."
					}
				/>
			) : null}

			{sections.map((s) => (
				<Section
					key={s.key}
					title={s.title}
					right={
						<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
							{s.icon ? <Image source={{ uri: s.icon }} style={{ width: 16, height: 16, borderRadius: 4 }} /> : null}
							{s.subtitle ? <Txt variant="small">{s.subtitle}</Txt> : null}
						</View>
					}
				>
					<List>
						{s.projects.map((x) => (
							<ProjectRow key={x.universeId} project={x} hasBackend={ttUniverses.has(x.universeId)} onPress={() => router.push(`/project/${x.universeId}`)} />
						))}
					</List>
				</Section>
			))}

			{!noSource && projects.data ? (
				adding ? (
					<Card style={{ gap: 8 }}>
						<Field label="Add an experience" value={addText} onChangeText={setAddText} placeholder="roblox.com/games/123… or a place / universe ID" keyboardType="default" onSubmitEditing={addExperience} />
						{addError ? <Txt variant="small" color={p.destructive}>{addError}</Txt> : null}
						<View style={{ flexDirection: "row", gap: 8 }}>
							<Button title="Add" variant="brand" loading={addBusy} onPress={addExperience} />
							<Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} />
						</View>
					</Card>
				) : (
					<Button title="Add an experience by link or ID" variant="ghost" icon="add-circle-outline" onPress={() => setAdding(true)} />
				)
			) : null}
			{prefs.extraUniverseIds.length ? (
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" }}>
					<Icon name="information-circle-outline" size={14} color={p.mutedForeground} />
					<Txt variant="small">{prefs.extraUniverseIds.length} added by hand (remove them in Settings)</Txt>
				</View>
			) : null}
		</Screen>
	);
}
