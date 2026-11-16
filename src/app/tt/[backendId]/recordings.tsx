/**
 * Recordings (web pages/Recordings.tsx): new players' first-session recordings without Roblox Studio. Four tabs:
 *   Map layers    pick a map, toggle layers (path density, idle spots, deaths, screens, buttons, quits, positioned
 *                 events), filter by values, zone and screen; tap a cell for the sessions there
 *                 (POST /v1/query/recording-layers, recording-sessions)
 *   Replay        a session list (also reached from a cell, a quit, the First session screen's signals; session or
 *                 player id search), then a replay (recording-replay): map or Player view, timeline, scrubber
 *   Quit autopsy  the last seconds before quitting, classified, against the players who stayed (quit-autopsy)
 *   First actions seconds from spawn to the first move, screen, button, prompt and round, by device and build
 *                 (first-action)
 * A map with an export (the Maps screen) is drawn on its real geometry, 2D or 3D (features/recordings/RealMap); without
 * one, the SVG silhouette of the recorded positions (MapView). The tab, map, layers, view (mode, draw, cell, band),
 * session, the replay list's filters, the camera and the autopsy window live in the route params (the web's URL), next
 * to the shared filter bar.
 *
 * Phone layout: the map (and a replay's view with its transport) stays on top while the controls scroll under it, so
 * drags move the map, like the Maps screen.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";

import type { FirstActionSplit, FirstActionStat, QuitAutopsyRow, RecFrame, RecordingLayersResult, RecSampling } from "@/api/tt/types";
import { Badge, Button, Chips, EmptyState, ErrorState, Field, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { ChipRow, ToggleChip } from "@/features/maps/BandControls";
import { MapView, type ToView } from "@/features/recordings/MapView";
import { ACTION_LABELS, REASON_LABELS, RECORDING_LAYERS, cellBox, layerColor, layerName, mapName } from "@/features/recordings/map";
import { RealLayersMap, RealReplayMap, REAL_MAP_CELL, useExportFor, useRecView, ViewSwitches, type SceneParts } from "@/features/recordings/RealMap";
import { ReplayPlayer, type ReplayCamera, type ReplayScene } from "@/features/recordings/ReplayPlayer";
import { Note, Panel, QueryState, ShareBar } from "@/features/typetorch/bits";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { usePageParams } from "@/features/typetorch/view-link";
import { fmtInt, fmtNum, fmtPct, fmtTime, shortId } from "@/lib/format";
import { font, radius, space, useTheme } from "@/theme";

const TABS = ["layers", "replay", "autopsy", "first"] as const;
type Tab = (typeof TABS)[number];
const DEFAULT_LAYERS = ["path", "quit"];

const TAB_LABELS: Record<Tab, string> = { layers: "Map layers", replay: "Replay", autopsy: "Quit autopsy", first: "First actions" };

export default function RecordingsScreen() {
	return <TTScreen title="Recordings" scroll={false}>{({ backendId }) => <Recordings backendId={backendId} />}</TTScreen>;
}

function Recordings({ backendId }: { backendId: string }) {
	const [params, set] = usePageParams();
	const tab: Tab = (TABS as readonly string[]).includes(params.tab ?? "") ? (params.tab as Tab) : "layers";
	const openReplay = useCallback((sid: string) => set({ tab: "replay", sid }), [set]);
	return (
		<View style={{ flex: 1, gap: space.sm }}>
			<Chips options={TABS.map((v) => ({ value: v, label: TAB_LABELS[v] }))} value={tab} onChange={(v) => set({ tab: v === "layers" ? null : v })} />
			{tab === "layers" ? <LayersTab backendId={backendId} openReplay={openReplay} /> : null}
			{tab === "replay" ? <ReplayTab backendId={backendId} openReplay={openReplay} /> : null}
			{tab === "autopsy" ? <AutopsyTab backendId={backendId} openReplay={openReplay} /> : null}
			{tab === "first" ? <FirstActionsTab backendId={backendId} openReplay={openReplay} /> : null}
		</View>
	);
}

/** The web's PageHeader description: what a recording covers, which every tab's numbers depend on. */
const DESCRIPTION = "New players' first sessions, recorded from spawn until a minute after their first input: where they went, a replay, why they quit, how soon they acted.";

/** A tab's scrolling body (the page description, then the filter bar, like the web's shell). */
function Body({ backendId, children }: { backendId: string; children: ReactNode }) {
	return (
		<ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.xl * 2 }} keyboardShouldPersistTaps="handled">
			<Note>{DESCRIPTION}</Note>
			<FilterBar backendId={backendId} />
			{children}
		</ScrollView>
	);
}

function SamplingNote({ sampling, notes = [] }: { sampling: RecSampling; notes?: string[] }) {
	const lines = [...notes];
	if (sampling.sampled && !notes.some((n) => n.startsWith("Sampled"))) lines.push(`Sampled ${fmtInt(sampling.used)} of ${fmtInt(sampling.recorded)} recorded sessions.`);
	if (sampling.failed) lines.push(`${fmtInt(sampling.failed)} sessions did not decode.`);
	if (sampling.eventsCapped) lines.push("Some sessions' events hit a row cap: zone, screen and tutorial details may be missing for them.");
	if (!lines.length) return null;
	return (
		<View style={{ gap: 2 }} testID="sampling-note">
			{lines.map((l) => (
				<Txt key={l} variant="small">
					{l}
				</Txt>
			))}
		</View>
	);
}

/** A text filter applied on submit or when the field loses focus (the web's FilterInput / SplitInput). */
function FilterInput({ label, value, onChange, placeholder, small }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; small?: boolean }) {
	const p = useTheme();
	const [text, setText] = useState(value);
	const apply = () => text.trim() !== value && onChange(text.trim());
	if (small)
		return (
			<TextInput
				accessibilityLabel={label}
				placeholder={placeholder ?? label}
				placeholderTextColor={p.mutedForeground}
				autoCapitalize="none"
				autoCorrect={false}
				value={text}
				onChangeText={setText}
				onBlur={apply}
				onSubmitEditing={apply}
				returnKeyType="done"
				style={{ minWidth: 170, flexGrow: 1, color: p.foreground, borderColor: p.input, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, fontSize: font.sm }}
			/>
		);
	return <Field accessibilityLabel={label} placeholder={placeholder ?? label} value={text} onChangeText={setText} onBlur={apply} onSubmitEditing={apply} returnKeyType="search" style={{ paddingVertical: 7, fontSize: font.sm }} />;
}

function pick<T>(record: Record<string, T>, keys: readonly string[], keep: (v: T) => boolean): Record<string, T> {
	return Object.fromEntries(Object.entries(record).filter(([k, v]) => keys.includes(k) && keep(v)));
}

// Map layers --------------------------------------------------------------------------------------------------------------

/** The layer toggles, value chips and split inputs. Pure props: the tab owns the state. */
function LayerControls({
	data,
	active,
	onToggle,
	values,
	onValues,
	split,
	onSplit,
}: {
	data: Pick<RecordingLayersResult, "layers" | "catalog">;
	active: string[];
	onToggle: (id: string) => void;
	values: Record<string, string[]>;
	onValues: (id: string, values: string[]) => void;
	split: Record<string, string>;
	onSplit: (id: string, key: string) => void;
}) {
	const p = useTheme();
	const positioned = data.catalog.map((c) => ({ id: `ev:${c.kind}:${c.name}`, count: c.count }));
	const all = [...RECORDING_LAYERS.map((id) => ({ id, count: undefined as number | undefined })), ...positioned];
	return (
		<View style={{ gap: space.md }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessibilityLabel="Layers">
				{all.map(({ id, count }, i) => {
					const shown = data.layers.find((l) => l.id === id);
					const n = shown ? shown.count : count;
					return <ToggleChip key={id} pressed={active.includes(id)} onPress={() => onToggle(id)} dot={layerColor(id, i - RECORDING_LAYERS.length)} label={`${layerName(id)}${n !== undefined ? ` ${fmtInt(n)}` : ""}`} />;
				})}
			</View>
			{positioned.length === 0 ? <Txt variant="small">No positioned events (props px / pz) in this range.</Txt> : null}
			{data.layers
				.filter((l) => active.includes(l.id) && (l.values.length > 0 || l.source === "events"))
				.map((l) => {
					const picked = values[l.id] ?? [];
					return (
						<View key={l.id} style={{ gap: 6 }} testID={`values-${l.id}`}>
							<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
								<Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>
									{layerName(l.id)}
								</Txt>
								{l.source === "events" ? <FilterInput small label={`Split ${layerName(l.id)} by a prop`} placeholder="split by prop, e.g. cause" value={split[l.id] ?? ""} onChange={(key) => onSplit(l.id, key)} /> : null}
								{picked.length ? (
									<Pressable onPress={() => onValues(l.id, [])} hitSlop={6}>
										<Txt variant="small" style={{ textDecorationLine: "underline" }}>
											show all
										</Txt>
									</Pressable>
								) : null}
							</View>
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
								{l.values.slice(0, 16).map((v) => (
									<ToggleChip key={v.value} pressed={picked.includes(v.value)} label={`${v.value} ${fmtInt(v.count)}`} onPress={() => onValues(l.id, picked.includes(v.value) ? picked.filter((x) => x !== v.value) : [...picked, v.value])} />
								))}
							</View>
						</View>
					);
				})}
		</View>
	);
}

function Legend({ layers }: { layers: RecordingLayersResult["layers"] }) {
	const p = useTheme();
	if (!layers.length) return null;
	return (
		<View style={{ gap: 4 }} accessibilityLabel="Legend">
			{layers.map((l, i) => (
				<View key={l.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: layerColor(l.id, i) }} />
					<Txt variant="small" color={p.foreground} style={{ flex: 1 }} numberOfLines={1}>
						{layerName(l.id)}
					</Txt>
					<Txt variant="small" color={p.foreground} style={{ fontVariant: ["tabular-nums"] }}>
						{fmtInt(l.count)}
					</Txt>
					{l.sessions ? <Txt variant="small">{fmtInt(l.sessions)} sessions</Txt> : null}
					{l.cellsCut ? <Txt variant="small">({fmtInt(l.cellsCut)} small cells left out)</Txt> : null}
				</View>
			))}
		</View>
	);
}

function LayersTab({ backendId, openReplay }: { backendId: string; openReplay: (sid: string) => void }) {
	const window = useWindowDimensions();
	const [params, set] = usePageParams();
	const map = params.map;
	const rawLayers = params.layers ?? DEFAULT_LAYERS.join(",");
	const active = rawLayers === "none" ? [] : rawLayers.split(",").filter(Boolean);
	const [viewState] = useRecView(backendId);
	const [values, setValues] = useState<Record<string, string[]>>({});
	const [split, setSplit] = useState<Record<string, string>>({});
	const [zone, setZone] = useState("");
	const [screen, setScreen] = useState("");
	// The picked cell: column, row and the cell size they're in (a pick from another cell size is dropped).
	const [cell, setCell] = useState<[number, number, number] | null>(null);
	// The real map (an export of the shown map) takes finer cells and no silhouette. The shown map is the route's, else
	// the last answer's (the query's default map): its first answer can come back at the query's own grid.
	const [lastMap, setLastMap] = useState<string | null>(null);
	const exp = useExportFor(backendId, map ?? lastMap);
	const real = exp.info !== null;
	const cellSize = viewState.cell ?? REAL_MAP_CELL;
	const options = useMemo(
		() => ({
			...(map !== undefined ? { map } : {}),
			...(real ? { cell: cellSize, background: false } : {}),
			layers: active,
			values: pick(values, active, (v) => v.length > 0),
			split: pick(
				split,
				active.filter((id) => id.startsWith("ev:")),
				(v) => v !== "",
			),
			...(zone ? { zone } : {}),
			...(screen ? { screen } : {}),
		}),
		[map, active.join(","), values, split, zone, screen, real, cellSize],
	);
	const q = useTTAnalytics(backendId, "recording-layers", options, { keepPrevious: true, enabled: !exp.loading });
	if (q.data && q.data.map !== lastMap && map === undefined) setLastMap(q.data.map);
	const toggle = (id: string) => set({ layers: (active.includes(id) ? active.filter((x) => x !== id) : [...active, id]).join(",") || "none" });
	const mapHeight = Math.round(window.height * 0.4);
	const data = q.data;
	if (!data || (q.error && !q.data) || (data.sampling.recorded === 0 && data.catalog.length === 0)) {
		return (
			<Body backendId={backendId}>
				{q.error && !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !data ? <SkeletonList rows={6} /> : <EmptyState icon="videocam-outline" title="No recorded first sessions or positioned events in this range." />}
			</Body>
		);
	}
	// Cells are drawn from the answer's own frame (origin and cell size), so an answer at another cell size (the previous
	// one, while the next loads) still lands in the right place.
	const frame = data.frame;
	const picked: [number, number] | null = frame && cell && cell[2] === frame.cell ? [cell[0], cell[1]] : null;
	const pickCell = (c: number, r: number) => frame && setCell([c, r, frame.cell]);
	const drawn = data.layers.map((l, i) => ({ id: l.id, label: layerName(l.id), color: layerColor(l.id, i), cells: l.cells }));
	const svg = frame ? <MapView frame={frame} background={data.background} layers={drawn} mode={viewState.draw === "points" ? "dots" : "heat"} selected={picked} onCellPress={pickCell} label={`Map ${mapName(data.map ?? "")}`} maxHeight={mapHeight} /> : null;
	const cellLayer = active.find((id) => (RECORDING_LAYERS as readonly string[]).includes(id) && id !== "path") ?? "path";
	const box = frame && picked ? cellBox(frame, picked[0], picked[1]) : null;

	const controls = (sceneControls: ReactNode, note: ReactNode) => (
		<>
			<ScrollView horizontal style={{ flexGrow: 0, flexShrink: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityLabel="Maps">
				{data.maps.map((m) => (
					<ToggleChip
						key={m.map}
						label={`${mapName(m.map)} ${fmtInt(m.sessions)}`}
						pressed={data.map === m.map}
						onPress={() => {
							setCell(null);
							set({ map: m.map });
						}}
					/>
				))}
			</ScrollView>
			<LayerControls
				data={data}
				active={active}
				onToggle={toggle}
				values={values}
				onValues={(id, v) => setValues({ ...values, [id]: v })}
				split={split}
				onSplit={(id, key) => {
					setSplit({ ...split, [id]: key });
					setValues({ ...values, [id]: [] });
				}}
			/>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
				<View style={{ flex: 1, minWidth: 140 }}>
					<FilterInput label="Zone" value={zone} onChange={setZone} />
				</View>
				<View style={{ flex: 1, minWidth: 140 }}>
					<FilterInput label="Screen" value={screen} onChange={setScreen} />
				</View>
			</View>
			<ViewSwitches backendId={backendId} real={real} cell {...(data.frame && !real ? { autoCell: data.frame.cell } : {})} />
			{sceneControls}
			<SamplingNote sampling={data.sampling} notes={data.notes} />
			{note}
			<Legend layers={data.layers} />
			{box ? (
				<Panel title="Sessions in this cell" note={`With a ${layerName(cellLayer).toLowerCase()} point at x ${box[0]} to ${box[2]}, z ${box[1]} to ${box[3]}.`}>
					<SessionList backendId={backendId} options={{ map: data.map, box, layer: cellLayer, limit: 20 }} openReplay={openReplay} compact />
				</Panel>
			) : null}
		</>
	);
	const layout = (scene: ReactNode, sceneControls: ReactNode, note: ReactNode) => (
		<View style={{ flex: 1, gap: space.sm }}>
			{scene}
			<Body backendId={backendId}>{controls(sceneControls, note)}</Body>
		</View>
	);

	if (!frame) return <Body backendId={backendId}>{controls(null, <Txt variant="muted">Nothing to draw on this map.</Txt>)}</Body>;
	if (real && exp.info) {
		const info = exp.info;
		return (
			<RealLayersMap backendId={backendId} info={info} frame={frame} layers={data.layers} selected={picked} onCellPress={pickCell} label={`Map ${mapName(data.map ?? "")}`} fallback={svg} height={mapHeight}>
				{(parts: SceneParts) =>
					layout(
						parts.scene,
						parts.controls,
						<Note>
							The real map (its export, {info.name === "(lobby)" ? "the lobby" : info.name}). Recorded positions are binned at {fmtNum(frame.cell, 1)} stud cells (the picker) and sit at their recorded height in 3D
							{data.layers.some((l) => l.cell !== undefined) ? "; positioned events stay in the 4-stud cells they are counted in" : ""}. Tap a cell (2D) or a dot / heat cell (3D) for its sessions.
						</Note>,
					)
				}
			</RealLayersMap>
		);
	}
	return layout(
		svg,
		null,
		<Note>Top-down: x to the right, z down; one cell is {fmtNum(frame.cell, 0)} studs. No export of this map (the Maps screen), so the grey silhouette is every recorded position on it. Tap a cell for its sessions.</Note>,
	);
}

// Sessions and replay ---------------------------------------------------------------------------------------------------

function SessionList({ backendId, options, openReplay, compact = false }: { backendId: string; options: Record<string, unknown>; openReplay: (sid: string) => void; compact?: boolean }) {
	const p = useTheme();
	const q = useTTAnalytics(backendId, "recording-sessions", options, { keepPrevious: true });
	return (
		<QueryState q={q} isEmpty={(d) => d.total === 0} empty="No recorded sessions match.">
			{(data) => (
				<View style={{ gap: space.sm }}>
					<Txt variant="small">
						{fmtInt(data.total)} sessions{data.total > data.sessions.length ? `, the latest ${data.sessions.length} shown` : ""}.
					</Txt>
					<SamplingNote sampling={data.sampling} />
					<View style={{ borderTopWidth: 1, borderColor: p.border }}>
						{data.sessions.map((s) => {
							const signals = [s.signals.idle ? `idle ${s.signals.idle}` : "", s.signals.camera_spin ? `spin ${s.signals.camera_spin}` : "", s.signals.repeated_clicks ? `clicks ${s.signals.repeated_clicks}` : ""].filter(Boolean).join(", ");
							return (
								<View key={s.sid} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 8, borderBottomWidth: 1, borderColor: p.border }}>
									<View style={{ flex: 1, gap: 3 }}>
										<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
											<Txt variant="mono">{shortId(s.sid)}</Txt>
											{s.extended ? <Badge label="Extended" tone="brand" /> : null}
											{s.why === "left" ? <Badge label="left" tone="critical" /> : <Txt variant="small">{s.why ?? "unknown"}</Txt>}
											<Txt variant="small" style={{ fontVariant: ["tabular-nums"] }}>
												{fmtNum(s.seconds, 0)} s
											</Txt>
										</View>
										{compact ? null : (
											<Txt variant="small" numberOfLines={2}>
												{[fmtTime(s.start), s.dev, s.maps.map(mapName).join(", "), signals].filter(Boolean).join(" · ")}
											</Txt>
										)}
									</View>
									<Button small title="Replay" icon="play" onPress={() => openReplay(s.sid)} />
								</View>
							);
						})}
					</View>
				</View>
			)}
		</QueryState>
	);
}

const WHY_CHOICES = [
	{ value: "", label: "All" },
	{ value: "left", label: "Quit" },
	{ value: "window", label: "Played on" },
];

function ReplayTab({ backendId, openReplay }: { backendId: string; openReplay: (sid: string) => void }) {
	const [params, set] = usePageParams();
	const sid = params.sid;
	if (sid) return <ReplayView backendId={backendId} sid={sid} back={() => set({ sid: null, cam: null })} />;
	const why = params.why ?? "";
	const signal = params.signal;
	const zone = params.zone;
	const target = params.target;
	const search = params.q;
	return (
		<Body backendId={backendId}>
			<ChipRow label="How it ended">
				{WHY_CHOICES.map((c) => (
					<ToggleChip key={c.label} label={c.label} pressed={why === c.value} onPress={() => set({ why: c.value })} />
				))}
			</ChipRow>
			<FilterInput key={search ?? ""} label="Session or player id" value={search ?? ""} onChange={(v) => set({ q: v })} />
			{signal ? (
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<Badge label={`${signal.replace("_", " ")}${zone ? ` in ${zone}` : ""}${target ? ` on ${target}` : ""}`} tone="brand" />
					<Pressable accessibilityLabel="Clear the signal filter" hitSlop={8} onPress={() => set({ signal: null, zone: null, target: null })}>
						<Txt variant="small" style={{ textDecorationLine: "underline" }}>
							clear
						</Txt>
					</Pressable>
				</View>
			) : null}
			<SessionList backendId={backendId} options={{ ...(why ? { why } : {}), ...(signal ? { signal } : {}), ...(zone ? { zone } : {}), ...(target ? { target } : {}), ...(search ? { search } : {}), limit: 100 }} openReplay={openReplay} />
		</Body>
	);
}

/**
 * The replay's map: the real map when it has an export; else the map layer's frame and silhouette when the session fits
 * in it, else the session's own frame.
 */
function ReplayMap({ backendId, map, overlay, fallback, scene, height, layout }: { backendId: string; map: string; overlay: (toView: ToView) => ReactNode; fallback: RecFrame | null; scene: ReplayScene; height: number; layout: (parts: SceneParts) => ReactNode }) {
	const exp = useExportFor(backendId, map);
	if (exp.loading) return <>{layout({ scene: <Txt variant="muted">Loading the map…</Txt>, controls: null })}</>;
	const svg = <SvgReplayMap backendId={backendId} map={map} overlay={overlay} fallback={fallback} height={height} />;
	const info = exp.info;
	if (!info) return <>{layout({ scene: svg, controls: null })}</>;
	return (
		<RealReplayMap backendId={backendId} info={info} scene={scene} label={`Replay on ${mapName(map)}`} fallback={svg} height={height}>
			{(parts) =>
				layout({
					scene: parts.scene,
					controls: (
						<View style={{ gap: space.sm }}>
							<ViewSwitches backendId={backendId} real draw={false} />
							{parts.controls}
						</View>
					),
				})
			}
		</RealReplayMap>
	);
}

function SvgReplayMap({ backendId, map, overlay, fallback, height }: { backendId: string; map: string; overlay: (toView: ToView) => ReactNode; fallback: RecFrame | null; height: number }) {
	const q = useTTAnalytics(backendId, "recording-layers", { map, layers: [] });
	const shared = q.data?.map === map ? q.data.frame : null;
	const fits = shared && fallback && fallback.minX >= shared.minX - shared.cell && fallback.maxX <= shared.maxX + shared.cell && fallback.minZ >= shared.minZ - shared.cell && fallback.maxZ <= shared.maxZ + shared.cell;
	const frame = fits ? shared : fallback;
	if (!frame) return <Txt variant="muted">No positions on this map.</Txt>;
	return <MapView frame={frame} background={fits ? (q.data?.background ?? []) : []} overlay={overlay} label={`Replay on ${mapName(map)}`} maxHeight={height} />;
}

function ReplayView({ backendId, sid, back }: { backendId: string; sid: string; back: () => void }) {
	const q = useTTAnalytics(backendId, "recording-replay", { sid });
	const [params, set] = usePageParams();
	// cam=map|player in the route; absent: the Player view for extended sessions, else the map
	const camParam = params.cam;
	const camera: ReplayCamera = camParam === "map" || camParam === "player" ? camParam : q.data?.extended ? "player" : "map";
	const backButton = <Button small variant="ghost" icon="arrow-back" title="All sessions" onPress={back} style={{ alignSelf: "flex-start" }} />;
	const data = q.data;
	if (!data || !data.found || data.failed) {
		return (
			<Body backendId={backendId}>
				{backButton}
				{q.error && !data ? (
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				) : !data ? (
					<SkeletonList rows={6} />
				) : !data.found ? (
					<EmptyState icon="videocam-off-outline" title="This session has no recording in the selected range (widen the date range)." />
				) : (
					<Txt variant="muted">The recording did not decode: {data.failed}</Txt>
				)}
			</Body>
		);
	}
	return (
		<ReplayPlayer
			key={data.sid}
			backendId={backendId}
			replay={data}
			camera={camera}
			onCameraChange={(c) => set({ cam: c })}
			header={
				<View style={{ gap: 4 }}>
					{backButton}
					<Txt variant="h3">Session {shortId(data.sid)}</Txt>
					<Txt variant="small">
						Player {data.pid ?? "?"}, {fmtTime(data.start ?? 0)}, {fmtNum((data.duration ?? 0) / 1000, 1)} s recorded.
					</Txt>
					<FilterBar backendId={backendId} />
				</View>
			}
			renderMap={(map, overlay, fallback, scene, height, layout) => <ReplayMap backendId={backendId} map={map} overlay={overlay} fallback={fallback} scene={scene} height={height} layout={layout} />}
		/>
	);
}

// Quit autopsy ----------------------------------------------------------------------------------------------------------

function reasonLabel(row: Pick<QuitAutopsyRow, "reason" | "value">): string {
	if (row.value === undefined) return REASON_LABELS[row.reason] ?? row.reason;
	return row.value;
}

function Lift({ lift }: { lift: number | null }) {
	const p = useTheme();
	if (lift === null) return <Badge label="only quitters" tone="critical" />;
	return (
		<Txt variant="small" color={lift >= 1.5 ? p.critical : lift < 1 ? p.mutedForeground : p.foreground} style={{ fontWeight: lift >= 1.5 ? "700" : "500", fontVariant: ["tabular-nums"] }}>
			{fmtNum(lift, 1)}x
		</Txt>
	);
}

function SidLinks({ ids, openReplay, label }: { ids: readonly string[]; openReplay: (sid: string) => void; label?: string }) {
	if (!ids.length) return null;
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
			{label ? <Txt variant="small">{label}</Txt> : null}
			{ids.map((sid) => (
				<Pressable key={sid} onPress={() => openReplay(sid)} accessibilityLabel={`Replay ${sid}`} hitSlop={6}>
					<Txt variant="mono" style={{ textDecorationLine: "underline", fontSize: 12 }}>
						{shortId(sid, 6)}
					</Txt>
				</Pressable>
			))}
		</View>
	);
}

function AutopsyTable({ rows, openReplay, caption }: { rows: QuitAutopsyRow[]; openReplay: (sid: string) => void; caption: string }) {
	const p = useTheme();
	return (
		<View accessibilityLabel={caption}>
			<View style={{ flexDirection: "row", gap: space.sm, paddingBottom: 4, borderBottomWidth: 1, borderColor: p.border }}>
				<Txt variant="label" style={{ flex: 1 }}>
					{caption}
				</Txt>
				<Txt variant="label">Quitters · others · lift</Txt>
			</View>
			{rows.map((r) => (
				<View key={`${r.reason}-${r.value ?? ""}`} style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderColor: p.border }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
						<Txt style={{ flex: 1 }}>{reasonLabel(r)}</Txt>
						<Txt variant="small" color={p.foreground} style={{ fontVariant: ["tabular-nums"] }}>
							{fmtInt(r.left)}
						</Txt>
						<Lift lift={r.lift} />
					</View>
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
						<View style={{ flex: 1 }}>
							<ShareBar share={r.leftShare} tone={(r.lift ?? 99) >= 1.5 ? "critical" : undefined} />
						</View>
						<Txt variant="small" style={{ fontVariant: ["tabular-nums"] }}>
							{fmtPct(r.leftShare)} of quitters · {fmtPct(r.stayedShare)} of the others
						</Txt>
					</View>
					<SidLinks ids={r.examples} openReplay={openReplay} />
				</View>
			))}
		</View>
	);
}

const WINDOWS = [5, 10, 20, 30];

function AutopsyTab({ backendId, openReplay }: { backendId: string; openReplay: (sid: string) => void }) {
	const [params, set] = usePageParams();
	const windowSeconds = WINDOWS.includes(Number(params.win)) ? Number(params.win) : 10;
	const q = useTTAnalytics(backendId, "quit-autopsy", { windowSeconds }, { keepPrevious: true });
	return (
		<Body backendId={backendId}>
			<ChipRow label="Last">
				{WINDOWS.map((w) => (
					<ToggleChip key={w} label={`${w} s`} pressed={windowSeconds === w} onPress={() => set({ win: w === 10 ? null : String(w) })} />
				))}
				<Txt variant="small">before the recording ended</Txt>
			</ChipRow>
			<QueryState q={q} isEmpty={(d) => d.left + d.stayed === 0} empty="No recorded first sessions in this range.">
				{(data) => {
					const main = data.rows.filter((r) => r.value === undefined && r.reason !== "place");
					const by = (reason: string) => data.rows.filter((r) => r.reason === reason && r.value !== undefined);
					return (
						<View style={{ gap: space.md }}>
							<StatGrid>
								<Stat label="Quit in their first minute" value={fmtInt(data.left)} sub={`${fmtPct(data.left / Math.max(1, data.left + data.stayed))} of recordings`} />
								<Stat label="Played on" value={fmtInt(data.stayed)} sub="the comparison" />
								<Stat label="Recordings" value={fmtInt(data.left + data.stayed)} sub={data.byWhy.map((w) => `${w.why} ${fmtInt(w.sessions)}`).join(", ")} />
							</StatGrid>
							<SamplingNote sampling={data.sampling} />
							<Panel
								title="What the last seconds looked like"
								note={`Each quit can have several reasons. "Of the others": the same over the last ${data.windowSeconds} s of the recordings that didn't end with a quit (their 60 s window ran out). Lift over 1 = more common among quitters.`}
							>
								<AutopsyTable rows={main} openReplay={openReplay} caption="Reason" />
							</Panel>
							{by("screen").length ? (
								<Panel title="Screen open when they quit">
									<AutopsyTable rows={by("screen")} openReplay={openReplay} caption="Screen" />
								</Panel>
							) : null}
							{by("tutorial").length ? (
								<Panel title="Tutorial step they stopped at">
									<AutopsyTable rows={by("tutorial")} openReplay={openReplay} caption="Step" />
								</Panel>
							) : null}
							{by("place").length ? (
								<Panel title="Where they stood" note="Each map split into 6 x 6 parts (columns A-F left to right, rows 1-6 top to bottom).">
									<AutopsyTable rows={by("place")} openReplay={openReplay} caption="Map part" />
								</Panel>
							) : null}
						</View>
					);
				}}
			</QueryState>
		</Body>
	);
}

// First actions -------------------------------------------------------------------------------------------------------

function Histogram({ stat }: { stat: FirstActionStat }) {
	const p = useTheme();
	const max = Math.max(1, ...stat.histogram.map((h) => h.count));
	return (
		<View style={{ gap: 2 }}>
			<View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 32 }} accessibilityLabel={`${ACTION_LABELS[stat.action] ?? stat.action} distribution`}>
				{stat.histogram.map((h) => (
					<View key={h.label} style={{ flex: 1, maxWidth: 14, borderRadius: 2, backgroundColor: p.chart[0], opacity: 0.75, height: `${Math.max(h.count ? 8 : 2, (h.count / max) * 100)}%` }} />
				))}
			</View>
			<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
				<Txt variant="small" style={{ fontSize: 10 }}>
					{stat.histogram[0]?.label ?? ""}
				</Txt>
				<Txt variant="small" style={{ fontSize: 10 }}>
					{stat.histogram[stat.histogram.length - 1]?.label ?? ""}
				</Txt>
			</View>
		</View>
	);
}

const sec = (v: number | null) => (v === null ? "-" : `${fmtNum(v, 1)} s`);

/** Rows by a split value, one column per action (median seconds, share reached): sideways scrolling. */
function SplitTable({ title, rows }: { title: string; rows: FirstActionSplit[] }) {
	const p = useTheme();
	const actions = rows[0]?.stats.map((s) => s.action) ?? [];
	const cell = { width: 76, textAlign: "right" as const };
	return (
		<ScrollView horizontal style={{ flexGrow: 0, flexShrink: 0 }} showsHorizontalScrollIndicator={false} accessibilityLabel={title}>
			<View>
				<View style={{ flexDirection: "row", gap: space.sm, paddingBottom: 4, borderBottomWidth: 1, borderColor: p.border }}>
					<Txt variant="label" style={{ width: 120 }}>
						{title}
					</Txt>
					<Txt variant="label" style={cell}>
						Sessions
					</Txt>
					{actions.map((a) => (
						<Txt key={a} variant="label" style={cell}>
							{ACTION_LABELS[a]?.replace("First ", "") ?? a}
						</Txt>
					))}
				</View>
				{rows.map((r) => (
					<View key={r.value} style={{ flexDirection: "row", gap: space.sm, paddingVertical: 6, borderBottomWidth: 1, borderColor: p.border }}>
						<Txt variant="mono" style={{ width: 120 }} numberOfLines={2}>
							{r.value}
						</Txt>
						<Txt variant="small" color={p.foreground} style={[cell, { fontVariant: ["tabular-nums"] }]}>
							{fmtInt(r.sessions)}
						</Txt>
						{r.stats.map((s) => (
							<View key={s.action} style={{ width: cell.width, alignItems: "flex-end" }}>
								<Txt variant="small" color={p.foreground} style={{ fontVariant: ["tabular-nums"] }}>
									{sec(s.median)}
								</Txt>
								<Txt variant="small" style={{ fontSize: 10 }}>
									{fmtPct(s.share, 0)} reached
								</Txt>
							</View>
						))}
					</View>
				))}
			</View>
		</ScrollView>
	);
}

function FirstActionsTab({ backendId, openReplay }: { backendId: string; openReplay: (sid: string) => void }) {
	const p = useTheme();
	const q = useTTAnalytics(backendId, "first-action");
	return (
		<Body backendId={backendId}>
			<QueryState q={q} isEmpty={(d) => d.sessions === 0} empty="No recorded first sessions in this range.">
				{(data) => (
					<View style={{ gap: space.md }}>
						<SamplingNote sampling={data.sampling} />
						<Panel
							title="Seconds from spawn"
							note="Move = 3 studs from the spawn point. A screen counts when it opens just after a player input (not HUDs the game opens). Move, screen, button and prompt are only seen inside the recording (until 60 s after the first input); round start comes from the events."
						>
							<View accessibilityLabel="Time to first action">
								{data.stats.map((s) => (
									<View key={s.action} style={{ gap: 6, paddingVertical: 10, borderTopWidth: 1, borderColor: p.border }}>
										<View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
											<Txt style={{ flex: 1, fontWeight: "600" }}>{ACTION_LABELS[s.action] ?? s.action}</Txt>
											<Txt style={{ fontWeight: "700", fontVariant: ["tabular-nums"] }}>{sec(s.median)}</Txt>
										</View>
										<Txt variant="small">
											Reached {fmtInt(s.reached)} ({fmtPct(s.share)}) · middle half {s.p25 === null ? "-" : `${fmtNum(s.p25, 1)}-${fmtNum(s.p75, 1)} s`}
										</Txt>
										<Histogram stat={s} />
										<SidLinks ids={s.examples?.slowest ?? []} openReplay={openReplay} label="slowest" />
										<SidLinks ids={s.examples?.never ?? []} openReplay={openReplay} label="never" />
									</View>
								))}
							</View>
							<Txt variant="small">Distribution: &lt;1 s ... 2 min+.</Txt>
						</Panel>
						<Panel title="By build" note="Median seconds, and the share that reached it. Did a new tutorial make players act sooner?">
							<SplitTable title="Build" rows={data.byBuild} />
						</Panel>
						<Panel title="By device">
							<SplitTable title="Device" rows={data.byDevice} />
						</Panel>
					</View>
				)}
			</QueryState>
		</Body>
	);
}

