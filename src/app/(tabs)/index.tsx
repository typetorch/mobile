import { Image } from "expo-image";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { developUniverses, gameDetails, placeUniverse } from "@/api/roblox-public";
import { GameIcon, ProjectRow } from "@/components/ProjectRow";
import { Badge, Button, Card, Chips, EmptyState, ErrorState, Field, Icon, List, Row, Screen, SearchBar, Section, SkeletonList, Txt } from "@/components/ui";
import { CloudError } from "@/features/project/CloudError";
import { compareProjects, sectionRank, SORT_OPTIONS, togglePin, usePins, useProjectSort, type ProjectSort } from "@/features/project/pins";
import { useGroupProjects, useProjects, type GroupInfo, type Project } from "@/features/project/projects";
import { compact } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

type Filter = "active" | "public" | "private" | "archived";

/** One reading of a typed number in "Add an experience": as a universe id or as a place id (its universe). */
interface AddChoice {
	universeId: number;
	name: string;
	label: string;
}

/** A universe's name: games v1 (public), then develop v1 multiget (also private ones); null when neither knows it. */
async function universeName(universeId: number): Promise<string | null> {
	const [d] = await gameDetails([universeId]).catch(() => []);
	if (d) return d.name;
	const [u] = await developUniverses([universeId]).catch(() => []);
	return u?.name ?? null;
}

function matchesFilter(x: Project, filter: Filter): boolean {
	if (filter === "archived") return x.archived;
	if (x.archived) return false;
	if (filter === "public") return x.privacy !== "private";
	if (filter === "private") return x.privacy === "private";
	return true;
}

export default function ProjectsScreen() {
	const p = useTheme();
	const { hasKey, keyInfo, keyError, prefs, setPrefs, backends } = useAccounts();
	const projects = useProjects();
	const [search, setSearch] = useState("");
	const [adding, setAdding] = useState(false);
	const [addText, setAddText] = useState("");
	const [addError, setAddError] = useState<string | null>(null);
	const [addBusy, setAddBusy] = useState(false);
	const [addChoices, setAddChoices] = useState<AddChoice[] | null>(null);
	const [filter, setFilter] = useState<Filter>("active");
	const [showGroups, setShowGroups] = useState(false);

	const ttUniverses = useMemo(() => new Set(backends.map((b) => b.universeId).filter((u): u is number => !!u)), [backends]);
	const q = search.trim().toLowerCase();
	const pins = usePins();
	const [sortBy, setSortBy] = useProjectSort();
	const sections = useMemo(() => {
		const pinned = new Set(pins);
		const cmp = compareProjects(sortBy);
		const keep = (x: Project, title: string) => matchesFilter(x, filter) && (!q || x.name.toLowerCase().includes(q) || String(x.universeId).includes(q) || title.toLowerCase().includes(q));
		const grouped = (projects.data?.sections ?? [])
			.map((s) => ({ ...s, projects: s.projects.filter((x) => !pinned.has(x.universeId) && keep(x, s.title)).sort(cmp) }))
			.filter((s) => s.projects.length);
		// "My experiences" first, then the groups in the same order as their rows.
		grouped.sort((a, b) => {
			if (a.key === "me" || b.key === "me") return a.key === "me" ? -1 : 1;
			const ra = sectionRank(sortBy, a.projects);
			const rb = sectionRank(sortBy, b.projects);
			return typeof ra === "string" && typeof rb === "string" ? ra.localeCompare(rb) : (ra as number) - (rb as number);
		});
		const pinnedRows = (projects.data?.all ?? []).filter((x) => pinned.has(x.universeId) && keep(x, "")).sort(cmp);
		return pinnedRows.length ? [{ key: "pinned", title: `Pinned (${pinnedRows.length})`, icon: null, subtitle: "Long-press or tap the star to unpin", projects: pinnedRows }, ...grouped] : grouped;
	}, [projects.data, q, filter, pins, sortBy]);
	const totals = useMemo(() => {
		const all = projects.data?.all ?? [];
		const live = all.filter((x) => !x.archived);
		return {
			count: live.length,
			playing: live.reduce((n, x) => n + x.playing, 0),
			publicCount: live.filter((x) => x.privacy !== "private").length,
			privateCount: live.filter((x) => x.privacy === "private").length,
			archivedCount: all.length - live.length,
		};
	}, [projects.data]);
	const otherGroups = useMemo(() => (projects.data?.otherGroups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q) || String(g.id).includes(q)), [projects.data, q]);

	const noSource = !hasKey && !prefs.userId;

	async function saveUniverse(universe: number) {
		if (!prefs.extraUniverseIds.includes(universe)) await setPrefs({ extraUniverseIds: [...prefs.extraUniverseIds, universe] });
		setAddText("");
		setAddChoices(null);
		setAdding(false);
	}

	/**
	 * Place ids and universe ids are separate number spaces, so a bare number can be both. A games link (or placeId=)
	 * is a place; a bare number is checked both ways, and when both exist the user picks.
	 */
	async function addExperience() {
		setAddError(null);
		setAddChoices(null);
		const text = addText.trim();
		const link = /games\/(\d+)|placeId=(\d+)/i.exec(text);
		const m = /(\d{3,})/.exec(text);
		if (!link && !m) {
			setAddError("Paste a place link, place ID or universe ID.");
			return;
		}
		setAddBusy(true);
		try {
			if (link) {
				const placeId = Number(link[1] ?? link[2]);
				const universe = await placeUniverse(placeId).catch(() => null);
				if (!universe) throw new Error(`Roblox doesn't know place ${placeId}.`);
				await saveUniverse(universe);
				return;
			}
			const n = Number(m![1]);
			const [asUniverse, placeUni] = await Promise.all([universeName(n), placeUniverse(n).catch(() => null)]);
			const asPlace = placeUni ? await universeName(placeUni) : null;
			const choices: AddChoice[] = [];
			if (asUniverse !== null) choices.push({ universeId: n, name: asUniverse, label: `Universe ${n}` });
			if (placeUni && placeUni !== n) choices.push({ universeId: placeUni, name: asPlace ?? `Universe ${placeUni}`, label: `Place ${n} (universe ${placeUni})` });
			if (choices.length === 1) await saveUniverse(choices[0].universeId);
			else if (choices.length > 1) setAddChoices(choices);
			// Neither public API knows it: keep it as a universe id (a private one the Open Cloud key may reach).
			else await saveUniverse(n);
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
					{/* Also while a filter is on, so it can be turned back to All after its bucket empties. */}
					{projects.data && (totals.privateCount || totals.archivedCount || filter !== "active") ? (
						<Chips<Filter>
							options={[
								{ value: "active", label: `All ${totals.count}` },
								{ value: "public", label: `Public ${totals.publicCount}` },
								{ value: "private", label: `Private ${totals.privateCount}` },
								{ value: "archived", label: `Archived ${totals.archivedCount}` },
							]}
							value={filter}
							onChange={setFilter}
						/>
					) : null}
					{projects.data ? <Chips<ProjectSort> options={SORT_OPTIONS} value={sortBy} onChange={setSortBy} /> : null}
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
					title={q || filter !== "active" ? "No experience matches" : "No experiences yet"}
					body={
						q || filter !== "active"
							? "Try another name, a universe ID or another filter."
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
							<ProjectRow
								key={x.universeId}
								project={x}
								hasBackend={ttUniverses.has(x.universeId)}
								onPress={() => router.push(`/project/${x.universeId}`)}
								pinned={pins.includes(x.universeId)}
								onTogglePin={() => togglePin(x.universeId)}
							/>
						))}
					</List>
				</Section>
			))}

			{otherGroups.length ? (
				<Section
					title={`Your other groups (${otherGroups.length})`}
					right={<Button title={showGroups ? "Hide" : "Show"} variant="ghost" onPress={() => setShowGroups((v) => !v)} />}
				>
					{showGroups ? (
						<List>
							{otherGroups.map((g) => (
								<GroupRow key={g.id} group={g} filter={filter} ttUniverses={ttUniverses} />
							))}
						</List>
					) : (
						<Txt variant="small">
							Groups where your rank is below {prefs.groupMinRank} and that you can't manage. Tap Show, then a group, to load its experiences.
						</Txt>
					)}
				</Section>
			) : null}

			{projects.data?.sources.length ? (
				<Txt variant="small" style={{ textAlign: "center" }}>
					Sources: {projects.data.sources.map((x) => `${x.label} ${x.count}`).join(" · ")}
				</Txt>
			) : null}

			{!noSource && projects.data ? (
				adding ? (
					<Card style={{ gap: 8 }}>
						<Field label="Add an experience" value={addText} onChangeText={(t) => { setAddText(t); setAddChoices(null); }} placeholder="roblox.com/games/123… or a place / universe ID" keyboardType="default" onSubmitEditing={addExperience} />
						{addError ? <Txt variant="small" color={p.destructive}>{addError}</Txt> : null}
						{addChoices ? (
							<View style={{ gap: 6 }}>
								<Txt variant="small">This number is both a universe ID and a place ID. Which one did you mean?</Txt>
								<List>
									{addChoices.map((c) => (
										<Row key={c.label} title={c.name} subtitle={c.label} onPress={() => saveUniverse(c.universeId).catch((e) => setAddError((e as Error).message))} right={<Icon name="add-circle-outline" size={18} />} />
									))}
								</List>
							</View>
						) : null}
						<View style={{ flexDirection: "row", gap: 8 }}>
							<Button title="Add" variant="brand" loading={addBusy} onPress={addExperience} />
							<Button
									title="Cancel"
									variant="ghost"
									onPress={() => {
										setAdding(false);
										setAddChoices(null);
									}}
								/>
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

/** A group below the rank threshold: tap to load its experiences (games v2 + develop v1 lists, resolved like the home list). */
function GroupRow({ group, filter, ttUniverses }: { group: GroupInfo; filter: Filter; ttUniverses: Set<number> }) {
	const [open, setOpen] = useState(false);
	const pins = usePins();
	const list = useGroupProjects(group.id, open);
	const shown = (list.data?.projects ?? []).filter((x) => matchesFilter(x, filter));
	return (
		<View>
			<Row
				onPress={() => setOpen((v) => !v)}
				left={<GameIcon uri={group.icon} size={32} />}
				title={group.name}
				subtitle={group.roleName ? `${group.roleName}${group.rank !== null ? ` · rank ${group.rank}` : ""}` : group.rank !== null ? `Rank ${group.rank}` : `Group ${group.id}`}
				right={group.viaKey ? <Badge label="Key" icon="key-outline" /> : <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />}
			/>
			{open ? (
				<View style={{ paddingLeft: 12 }}>
					{list.isLoading ? <SkeletonList rows={2} /> : null}
					{list.error ? <CloudError error={list.error} what="this group's experiences" onRetry={() => list.refetch()} /> : null}
					{list.data && !shown.length ? <Txt variant="small" style={{ padding: 12 }}>{filter === "active" ? "No experiences Roblox shows for this group." : `No ${filter} experiences.`}</Txt> : null}
					{shown.map((x) => (
						<ProjectRow
							key={x.universeId}
							project={x}
							hasBackend={ttUniverses.has(x.universeId)}
							onPress={() => router.push(`/project/${x.universeId}`)}
							pinned={pins.includes(x.universeId)}
							onTogglePin={() => togglePin(x.universeId)}
						/>
					))}
					{list.data?.warnings.length ? <Txt variant="small" style={{ paddingHorizontal: 12, paddingBottom: 8 }}>{list.data.warnings.join("\n")}</Txt> : null}
				</View>
			) : null}
		</View>
	);
}
