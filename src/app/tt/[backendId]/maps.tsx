/**
 * Maps (web pages/Maps.tsx, plans/33): each map's real geometry, exported from the place through Open Cloud (no Studio,
 * no game code), as a top-down 2D minimap or a 3D map, with the positioned events (`px`/`py`/`pz` props) drawn on it.
 *
 *   - The export card: the last export (when, place version, parts), "out of date" when Roblox has a newer place
 *     version, the Export button for owners (its progress while it runs), the map names no model was found for.
 *   - The map picker, 2D / 3D, the Y band (detected floors or a free range: geometry above and below is cut away, so an
 *     indoor floor shows in 2D), and what's drawn: the collision geometry by default (maps.ts isDrawn), with toggles for
 *     decorative meshes, markers and textures.
 *   - Layers: one per positioned event; dots or heat cells of 0.5, 1 or 2 studs (the filter bar applies).
 *   - Alignment: whether the positioned events land on the geometry, else the recordings' positions on that map;
 *     owners apply the suggested offset, set a model path or remove the override.
 * The view (2D / 3D, band, toggles, cell, hidden layers) is one state per backend in memory, shared with the live maps;
 * the picked map is in the route (`map`) and "Copy link to this view" carries the view under the web's URL keys. The
 * map stays on top while the controls scroll under it, so drags move the map.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";

import { cleanFilters, type Api } from "@/api/backend";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Section, Segmented, Skeleton, Txt, confirm } from "@/components/ui";
import { BandControls, ToggleChip } from "@/features/maps/BandControls";
import { useMapGeometry, useMapsList, useMapView, useMapViewLink } from "@/features/maps/hooks";
import { bandFits, resolveBand } from "@/features/maps/map-view";
import {
	alignmentOf,
	CELL_SIZES,
	countKinds,
	detectFloors,
	eventLayers,
	LOBBY,
	MAPS_KEY,
	nameKey,
	partsText,
	recordingSamples,
	type GridFrame,
	type MapInfo,
	type MapLayer,
	type MapsView,
	type Vec3,
} from "@/features/maps/maps";
import { MapScene } from "@/features/maps/MapScene";
import { FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { usePageParam } from "@/features/typetorch/view-link";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, fmtBytes, fmtInt, fmtPct } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme, type Tone } from "@/theme";

const ALIGN_TEXT: Record<MapInfo["alignment"]["state"], { label: string; tone: Tone }> = {
	aligned: { label: "Aligned with where players are", tone: "good" },
	partial: { label: "Partly aligned", tone: "warning" },
	off: { label: "Not aligned: players are elsewhere", tone: "critical" },
	unknown: { label: "Alignment unknown (too few positions)", tone: "muted" },
};

export default function MapsScreen() {
	return <TTScreen title="Maps" scroll={false}>{({ backendId, account }) => <Maps backendId={backendId} owner={account.role === "admin"} />}</TTScreen>;
}

function Maps({ backendId, owner }: { backendId: string; owner: boolean }) {
	const client = useQueryClient();
	const { api } = useBackend(backendId);
	const list = useMapsList(backendId);
	// Owners only (the server says so too; a viewer's session never gets the Export button or the override form).
	const view = list.data && !owner ? { ...list.data, canExport: false } : list.data;
	// The picked map is in the route (`map`, the web's key), the rest of the view in links through useMapViewLink.
	const [picked, setPicked] = usePageParam("map");
	useMapViewLink(backendId);
	const maps = view?.maps ?? [];
	const map = maps.find((m) => m.name === picked) ?? maps[0] ?? null;

	const startExport = useMutation({
		mutationFn: () => (api as Api).exportMaps(),
		onSettled: () => client.invalidateQueries({ queryKey: ["tt", backendId, ...MAPS_KEY] }),
	});

	// When an export finishes, the geometry may have changed: refetch it.
	const exportState = view?.export.state;
	useEffect(() => {
		if (exportState === "done") void client.invalidateQueries({ queryKey: ["tt", backendId, "map-geometry"] });
	}, [exportState, client, backendId]);

	const exportCard = list.isLoading ? (
		<Skeleton height={90} />
	) : list.error ? (
		<ErrorState error={list.error} onRetry={() => list.refetch()} />
	) : view ? (
		<ExportCard view={view} onExport={() => startExport.mutate()} exportError={startExport.error} starting={startExport.isPending} refreshing={list.isFetching} onRefresh={() => list.refetch()} />
	) : null;

	if (!view || !maps.length || !map) {
		return (
			<ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
				{exportCard}
				{view && !list.isLoading ? <EmptyState icon="map-outline" title={view.latest ? "The last export found no maps." : "No maps yet"} body={view.latest ? undefined : "Export them from the place (owners)."} /> : null}
			</ScrollView>
		);
	}
	return (
		<MapPanel
			key={`${map.name}:${map.hash}`}
			backendId={backendId}
			map={map}
			view={view}
			picker={
				<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
					{maps.map((m) => (
						<ToggleChip key={m.name} label={`${m.name === LOBBY ? "Lobby" : m.name}${m.kind === "map" && m.alignment.state === "off" ? " (not aligned)" : ""}`} pressed={m.name === map.name} onPress={() => setPicked(m.name)} />
					))}
				</ScrollView>
			}
			exportCard={exportCard}
		/>
	);
}

function ExportCard({
	view,
	onExport,
	exportError,
	starting,
	refreshing,
	onRefresh,
}: {
	view: MapsView;
	onExport: () => void;
	exportError: unknown;
	starting: boolean;
	refreshing: boolean;
	onRefresh: () => void;
}) {
	const p = useTheme();
	const running = view.export.state === "running";
	const latest = view.latest;
	const pv = view.placeVersion;
	return (
		<Card style={{ gap: space.sm }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
				<Txt variant="h3" style={{ flex: 1 }}>
					Export
				</Txt>
				<Button title="Refresh" small variant="ghost" icon="refresh" onPress={onRefresh} loading={refreshing} />
				{view.canExport ? (
					<Button
						title={running ? "Exporting…" : latest ? "Export again" : "Export maps"}
						small
						variant="brand"
						icon="download-outline"
						onPress={async () => {
							if (await confirm("Export the maps?", "A read-only Luau Execution task runs on the place and reads its maps' geometry.", "Export", false)) onExport();
						}}
						disabled={running || starting || !view.configured}
						loading={starting}
					/>
				) : null}
			</View>
			<Txt variant="small">A read-only Luau Execution task on the place: maps are the models named like the events' map values, the lobby is the rest of Workspace.</Txt>
			{!view.configured ? <Txt variant="small">Export needs OPENCLOUD_API_KEY (with universe.place.luau-execution-session read and write) and TYPETORCH_UNIVERSE_ID on the backend.</Txt> : null}
			{running ? <Txt>{view.export.step || "starting"}…</Txt> : null}
			{view.export.state === "failed" && view.export.error ? (
				<Txt color={p.destructive}>
					The last export failed: {view.export.error}
				</Txt>
			) : null}
			{exportError ? <Txt color={p.destructive}>{(exportError as Error).message}</Txt> : null}
			{latest ? (
				<View style={{ gap: 4 }}>
					<Txt>
						Exported {fmtAgo(latest.at)} by {latest.by} · place version {latest.placeVersion ?? "?"}
					</Txt>
					<Txt variant="small">
						{fmtInt(latest.parts)} parts, {fmtBytes(latest.bytes)}, {latest.seconds} s
					</Txt>
					{pv.outOfDate ? (
						<Badge label={`Out of date: Roblox has place version ${pv.latest}${pv.source === "fleet" ? " (from the game servers)" : ""}. Export again.`} tone="warning" />
					) : pv.latest !== null ? (
						<View style={{ flexDirection: "row" }}>
							<Badge label="Up to date" tone="good" />
						</View>
					) : null}
				</View>
			) : (
				<Txt variant="muted">Not exported yet.</Txt>
			)}
			{pv.note ? <Txt variant="small">{pv.note}</Txt> : null}
			{latest?.truncated ? <Txt color={p.warning}>The place has more parts than one export takes: some are missing.</Txt> : null}
			{latest?.unmatched.length ? <Txt variant="small">No model found for: {latest.unmatched.join(", ")}. Owners can set a model path below (Alignment), then export again.</Txt> : null}
			{latest?.notes.map((n) => (
				<Txt key={n} variant="small">
					{n}
				</Txt>
			))}
			{view.history.length > 1 ? (
				<Txt variant="small">
					Earlier: {view.history
						.slice(1, 4)
						.map((h) => `${fmtAgo(h.at)} (v${h.placeVersion ?? "?"}, ${fmtInt(h.maps)} maps)`)
						.join(" · ")}
				</Txt>
			) : null}
		</Card>
	);
}

function MapPanel({ backendId, map, view, picker, exportCard }: { backendId: string; map: MapInfo; view: MapsView; picker: ReactNode; exportCard: ReactNode }) {
	const p = useTheme();
	const { height } = useWindowDimensions();
	const [state, set] = useMapView(backendId);
	const [big, setBig] = useState(false);
	const mode = state.mode;
	const cell = state.cell ?? 1;
	const heat = state.draw === "heat";
	const hidden = useMemo(() => new Set(state.hidden), [state.hidden]);
	const isMap = map.kind === "map";

	const geometry = useMapGeometry(backendId, map);
	const positions = useTTAnalytics(backendId, "map-positions", { cell, map: map.name }, { enabled: isMap, keepPrevious: true });
	const layers = useMemo(() => eventLayers(positions.data, map.name), [positions.data, map.name]);
	const shown: MapLayer[] = useMemo(() => layers.filter((l) => !hidden.has(l.id)).map((l) => (heat ? { ...l, points: [] } : { ...l, cells: [] })), [layers, hidden, heat]);
	const floors = useMemo(() => (geometry.data ? detectFloors(geometry.data, map.offset[1]) : []), [geometry.data, map.offset]);
	const kinds = useMemo(() => (geometry.data ? countKinds(geometry.data) : null), [geometry.data]);
	const lo = map.bounds ? Math.floor(map.bounds.min[1] + map.offset[1]) : 0;
	const hi = map.bounds ? Math.ceil(map.bounds.max[1] + map.offset[1]) : 100;
	const choice = state.band.kind === "player" ? ({ kind: "all" } as const) : state.band;
	const band = resolveBand(choice, floors, lo, hi);
	// A free range from another map that doesn't fit this one's heights: back to all (floors and the rest carry over).
	const misfit = state.band.kind === "range" && !bandFits(state.band, lo, hi);
	useEffect(() => {
		if (misfit) set({ band: { kind: "all" } });
	}, [misfit, set]);
	const toggleLayer = (id: string) => set({ hidden: hidden.has(id) ? state.hidden.filter((x) => x !== id) : [...state.hidden, id] });

	return (
		<View style={{ flex: 1, gap: space.sm }}>
			<View style={{ height: Math.round(height * (big ? 0.62 : 0.4)) }}>
				{geometry.error ? (
					<ErrorState error={geometry.error} onRetry={() => geometry.refetch()} />
				) : (
					<MapScene
						backendId={backendId}
						geometry={geometry.data ?? null}
						bounds={map.bounds}
						mode={mode}
						layers={shown}
						offset={map.offset}
						band={band}
						decorative={state.decorative}
						markers={state.markers}
						textures={state.textures}
						label={`Map ${map.name}`}
						style={{ flex: 1 }}
					/>
				)}
				{geometry.isLoading ? (
					<View pointerEvents="none" style={{ position: "absolute", top: 8, left: 8 }}>
						<Badge label="Loading the geometry…" />
					</View>
				) : null}
			</View>
			<ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
				{picker}
				<View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
					<Segmented
						options={[
							{ value: "2d", label: "2D" },
							{ value: "3d", label: "3D" },
						]}
						value={mode}
						onChange={(m) => set({ mode: m })}
						style={{ flex: 1 }}
					/>
					<Button title={big ? "Smaller" : "Bigger"} small variant="ghost" icon={big ? "contract-outline" : "expand-outline"} onPress={() => setBig((b) => !b)} />
				</View>
				<Txt variant="small">
					{map.name === LOBBY ? "Lobby" : map.name}: {partsText(map)} from {map.path}
					{map.via === "override" ? " (manual model path)" : ""}
					{map.alternatives.length ? `; also named like it: ${map.alternatives.join(", ")}` : ""}
				</Txt>

				<Section title="View">
					<Card style={{ gap: space.md }}>
						<BandControls choice={choice} band={band} floors={floors} lo={lo} hi={hi} onChange={(b) => set({ band: b })} />
						<View style={{ gap: 6 }}>
							<ToggleChip label={`Decorative meshes${kinds ? ` (${fmtInt(kinds.decorMesh)})` : ""}`} pressed={state.decorative} onPress={() => set({ decorative: !state.decorative })} />
							<ToggleChip label={`Markers and triggers${kinds ? ` (${fmtInt(kinds.marker)})` : ""}`} pressed={state.markers} onPress={() => set({ markers: !state.markers })} />
							<ToggleChip
								label={`Textures${map.textures ? ` (${fmtInt(map.textures.decals + map.textures.textures)} decals and textures, ${fmtInt(map.textures.images)} images)` : ""}`}
								pressed={state.textures}
								onPress={() => set({ textures: !state.textures })}
							/>
						</View>
						<Txt variant="small">
							Drawn: every part that collides ({kinds ? `${fmtInt(kinds.collide)}, ${fmtInt(kinds.collideInvisible)} of them invisible walls, see-through` : "invisible walls see-through"}) and small visible decoration
							{kinds ? ` (${fmtInt(kinds.decor)})` : ""}, in their own colors. Decorative meshes are meshes and unions that don't collide, drawn as their bounding boxes (outlined, often much bigger than the real shape); markers are invisible parts that don't collide.
						</Txt>
					</Card>
				</Section>

				{isMap ? (
					<Section title="Layers">
						<Txt variant="small">Events with px / pz props on this map; the filter bar applies.</Txt>
						<FilterBar backendId={backendId} />
						<Card style={{ gap: space.sm }}>
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
								<ToggleChip label="Heat cells" pressed={heat} onPress={() => set({ draw: "heat" })} />
								<ToggleChip label="Dots" pressed={!heat} onPress={() => set({ draw: "points" })} />
							</View>
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
								<Txt variant="small">Cell</Txt>
								{CELL_SIZES.map((c) => (
									<ToggleChip key={c} label={`${c} stud${c === 1 ? "" : "s"}`} pressed={cell === c} onPress={() => set({ cell: c === 1 ? null : c })} />
								))}
							</View>
							{positions.isLoading ? (
								<Skeleton height={40} />
							) : positions.error ? (
								<Txt variant="small" color={p.destructive}>
									{positions.error.message}
								</Txt>
							) : layers.length ? (
								<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
									{layers.map((l) => {
										const n = (l.cells ?? []).reduce((sum, c) => sum + c.n, 0);
										return <ToggleChip key={l.id} dot={l.color} label={`${l.label} (${fmtInt(n)})`} pressed={!hidden.has(l.id)} onPress={() => toggleLayer(l.id)} />;
									})}
								</View>
							) : (
								<Txt variant="small">No positioned events on this map in this range. Events with numeric px / pz props (and the map prop) show here.</Txt>
							)}
							{positions.data?.truncated ? <Txt variant="small">Only the busiest cells are shown.</Txt> : null}
						</Card>
					</Section>
				) : null}

				{isMap ? <AlignmentCard backendId={backendId} map={map} view={view} canEdit={view.canExport} /> : null}
				{exportCard}
			</ScrollView>
		</View>
	);
}

/** The recording-layers query's answer, the part the alignment check reads (web lib/types RecordingLayersResult). */
interface RecordedMaps {
	maps: { map: string; samples: number; confirmed?: number; sessions: number; events: number }[];
	zoned?: number;
	frame: (GridFrame & { cols: number; rows: number }) | null;
	background: [number, number, number, number?][];
}

/** The recording-layers query for one map name, through `raw` (its full result type belongs to the Recordings screens); its own cache key. */
/**
 * The recordings' maps (web useAnalytics("recording-layers", { map, layers: [] })): waits while the filter bar's saved
 * filters still load (`pending`), like every filtered query, and sends them cleaned, so a cold start doesn't first ask
 * for the default range and show its alignment or offset for a moment.
 */
function useRecordedMaps(backendId: string, name: string | undefined, enabled: boolean) {
	const { apiFilters, pending } = useTTFilters(backendId);
	const filters = useMemo(() => cleanFilters(apiFilters), [apiFilters]);
	return useTTQuery(backendId, ["maps-alignment", name, filters], (api, signal) => api.raw("recording-layers", { filters, options: { map: name, layers: [] } }, signal).then((r) => r.result as RecordedMaps), {
		enabled: enabled && !pending,
		staleTime: 60_000,
	});
}

/**
 * The map's alignment: the backend's (positioned events, last 30 days) when it has enough of them, else the recordings'
 * positions on that map (the recording-layers query's silhouette, the filter bar's range) through the same check.
 */
function useAlignment(backendId: string, map: MapInfo, view: Pick<MapsView, "names">): { alignment: MapInfo["alignment"]; source: "events" | "recordings"; loading: boolean; unconfirmed: boolean } {
	const { pending } = useTTFilters(backendId);
	const server = map.alignment;
	const needed = map.kind === "map" && server.state === "unknown";
	const guess = view.names.find((n) => nameKey(n.name) === nameKey(map.name))?.name ?? map.name;
	const first = useRecordedMaps(backendId, guess, needed);
	const recordedName = first.data?.maps.find((m) => nameKey(m.map) === nameKey(map.name))?.map;
	const second = useRecordedMaps(backendId, recordedName, needed && recordedName !== undefined && recordedName !== guess);
	const data = recordedName !== undefined && recordedName !== guess ? second.data : first.data;
	// The game names its places by analytics zone, yet no recorded sample stood in this map's zone: the samples were placed on it only
	// because the server ran it (a lobby or tutorial area). They say nothing about where the map is: no suggestion from them.
	const stat = data?.maps.find((m) => nameKey(m.map) === nameKey(map.name));
	const unconfirmed = (data?.zoned ?? 0) > 0 && stat !== undefined && stat.confirmed === 0;
	const computed = useMemo(() => (data?.frame && !unconfirmed ? alignmentOf(map.bounds, recordingSamples(data.frame, data.background), map.offset) : null), [data, map.bounds, map.offset, unconfirmed]);
	if (!needed || !computed || computed.state === "unknown") return { alignment: server, source: "events", loading: needed && (pending || first.isLoading || second.isLoading), unconfirmed };
	return { alignment: computed, source: "recordings", loading: false, unconfirmed: false };
}

function AlignmentCard({ backendId, map, view, canEdit }: { backendId: string; map: MapInfo; view: MapsView; canEdit: boolean }) {
	const p = useTheme();
	const client = useQueryClient();
	const { api } = useBackend(backendId);
	const { alignment: a, source, loading, unconfirmed } = useAlignment(backendId, map, view);
	const [path, setPath] = useState(map.override?.path ?? "");
	const [offset, setOffset] = useState<string[]>(map.offset.map(String));
	const invalidate = () => client.invalidateQueries({ queryKey: ["tt", backendId, ...MAPS_KEY] });
	const save = useMutation({ mutationFn: (body: { path?: string; offset?: Vec3 }) => (api as Api).setMapOverride(map.name, body), onSuccess: invalidate });
	const remove = useMutation({ mutationFn: () => (api as Api).removeMapOverride(map.name), onSuccess: invalidate });
	const parsed = offset.map(Number);
	const offsetOk = parsed.length === 3 && parsed.every((v) => Number.isFinite(v));
	const text = ALIGN_TEXT[a.state];
	return (
		<Section title="Alignment">
			<Card style={{ gap: space.sm }}>
				<View style={{ flexDirection: "row" }}>
					<Badge label={text.label} tone={text.tone} />
				</View>
				<Txt variant="small">
					{source === "recordings" ? `${fmtInt(a.samples)} recorded positions on this map (recordings, this range)` : `${fmtInt(a.samples)} positioned events (last 30 days)`}; {fmtPct(a.inside, 0)} inside the map's box.
					{loading ? " Checking the recordings…" : ""}
					{map.offset.some((v) => v !== 0) ? ` Offset ${map.offset.join(", ")} applied.` : ""}
				</Txt>
				{unconfirmed ? (
					<Txt variant="small">
						The recordings never show a player inside this map's zone (their samples were only credited to it because the server ran it: a lobby or tutorial area), so they can't tell where the map is. No offset is suggested from them.
					</Txt>
				) : null}
				{a.state === "off" && a.suggestedOffset ? (
					<View style={{ gap: 6 }}>
						<Txt>Suggested offset: {a.suggestedOffset.join(", ")}</Txt>
						{canEdit ? (
							<Button
								title="Use this offset"
								small
								onPress={async () => {
									if (await confirm("Use this offset?", `The map's geometry moves by ${a.suggestedOffset?.join(", ")} studs for everyone.`, "Use it", false))
										save.mutate({ offset: a.suggestedOffset as Vec3, ...(map.override?.path ? { path: map.override.path } : {}) });
								}}
								loading={save.isPending}
							/>
						) : null}
					</View>
				) : null}
				{canEdit ? (
					<View style={{ gap: space.sm, borderTopWidth: 1, borderTopColor: p.border, paddingTop: space.sm }}>
						<Txt variant="label">Override (owners)</Txt>
						<Field value={path} onChangeText={setPath} placeholder="Model path, e.g. ReplicatedStorage.assets.maps.Mall" accessibilityLabel="Model path" />
						<View style={{ flexDirection: "row", gap: 6 }}>
							{["x", "y", "z"].map((axis, i) => (
								<View key={axis} style={{ flex: 1 }}>
									<Field
										label={axis}
										value={offset[i] ?? ""}
										onChangeText={(t) => setOffset((o) => o.map((v, k) => (k === i ? t : v)))}
										keyboardType="numbers-and-punctuation"
										accessibilityLabel={`Offset ${axis}`}
									/>
								</View>
							))}
						</View>
						<View style={{ flexDirection: "row", gap: 6 }}>
							<Button
								title="Save"
								small
								variant="brand"
								loading={save.isPending}
								disabled={!offsetOk}
								onPress={() => save.mutate({ ...(path.trim() ? { path: path.trim() } : {}), ...(offsetOk && parsed.some((v) => v !== 0) ? { offset: parsed as Vec3 } : {}) })}
							/>
							{map.override ? (
								<Button
									title="Remove override"
									small
									variant="destructive"
									loading={remove.isPending}
									onPress={async () => {
										if (await confirm("Remove the override?", "The model path and the offset go; the map is matched by name again at the next export.", "Remove")) remove.mutate();
									}}
								/>
							) : null}
						</View>
						{save.error ? <Txt variant="small" color={p.destructive}>{save.error.message}</Txt> : null}
						{remove.error ? <Txt variant="small" color={p.destructive}>{remove.error.message}</Txt> : null}
						<Txt variant="small">A model path applies at the next export; an offset at once.</Txt>
					</View>
				) : null}
			</Card>
		</Section>
	);
}

