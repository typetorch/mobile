/**
 * Plans/34: the live map (port of the web explorer's pages/live/LiveMap.tsx), shared by the server live map and the Live
 * map screen. Players are dots on the exported map (MapScene, 2D / 3D, the shared height controls and view state), the
 * name on a tap, an optional short trail, the game's `points` streams as markers.
 *
 * The map comes from the positions: a player is on the exported map whose bounds plus 8 studs contain them, else the
 * lobby's export (live-map.ts mapForPosition). It shows the map most players are on, with a switcher; following a player
 * (a tap on their dot, in 2D or 3D, or Follow in the list) shows their map, keeps them in the middle and, like a replay's
 * "Follow player", cuts away everything well above them.
 *
 * Phone layout: the map on top (the screen doesn't scroll under it, so drags move the map), the controls and the player
 * list in a scroll view below.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { Button, Card, EmptyState, Segmented, Skeleton, Txt } from "@/components/ui";
import { radius, space, useTheme } from "@/theme";

import { BandControls, ToggleChip } from "./BandControls";
import { useMapExports, useMapGeometry, useMapView, useMapViewLink } from "./hooks";
import { liveLayers, mapCounts, mapForPosition, nearestDot, type LiveDot } from "./live-map";
import { resolveBand, type BandChoice } from "./map-view";
import { detectFloors, ROOT_HEIGHT, type MapLayer } from "./maps";
import { MapScene } from "./MapScene";

export interface LiveGroup {
	id: string;
	label: ReactNode;
	color: string;
}

export function LiveMap({
	backendId,
	dots,
	markers = [],
	groups,
	label,
	empty = "No players with a character right now.",
	header,
}: {
	backendId: string;
	dots: LiveDot[];
	markers?: MapLayer[];
	/** The list's sections (the Live map screen: one per server); none = one list. */
	groups?: LiveGroup[];
	label: string;
	empty?: ReactNode;
	/** Status lines shown above the controls (errors, counts). */
	header?: ReactNode;
}) {
	const p = useTheme();
	const maps = useMapExports(backendId);
	const [view, setView] = useMapView(backendId);
	useMapViewLink(backendId);
	const [picked, setPicked] = useState<string | null>(null);
	const [followed, setFollowed] = useState<string | null>(null);
	/** A free choice of band while following ("All" said out loud), else following cuts above the player. */
	const [followBand, setFollowBand] = useState<BandChoice | null>(null);
	const [tapped, setTapped] = useState<{ name: string; left: number; top: number } | null>(null);
	const list = maps ?? [];
	const { counts, top } = useMemo(() => mapCounts(list, dots), [list, dots]);
	const followedDot = followed ? dots.find((d) => d.key === followed) : undefined;
	const followedMap = followedDot ? mapForPosition(list, followedDot.x, followedDot.z)?.name : undefined;
	const lobby = list.find((m) => m.kind === "lobby")?.name;
	const name = followedMap ?? picked ?? top ?? lobby ?? list[0]?.name ?? null;
	const info = list.find((m) => m.name === name) ?? null;
	const geometry = useMapGeometry(backendId, info);
	const floors = useMemo(() => (geometry.data && info ? detectFloors(geometry.data, info.offset[1]) : []), [geometry.data, info]);
	const lo = info?.bounds ? Math.floor(info.bounds.min[1] + info.offset[1]) : 0;
	const hi = info?.bounds ? Math.ceil(info.bounds.max[1] + info.offset[1]) : 100;
	const following = followedDot !== undefined;
	// The web's bandChoiceFor: following = "Follow player" unless another band was picked; else the shared choice (never "player").
	const choice: BandChoice = following ? (followBand ?? { kind: "player" }) : view.band.kind === "player" ? { kind: "all" } : view.band;
	const feet = followedDot ? Math.round(followedDot.y - ROOT_HEIGHT) : undefined;
	const band = resolveBand(choice, floors, lo, hi, feet);
	const setBand = (b: BandChoice) => {
		if (following) setFollowBand(b.kind === "player" ? null : b);
		if (b.kind !== "player") setView({ band: b });
	};
	// Only this map's players are drawn on it (the others stand on another map's coordinates).
	const here = useMemo(() => (info ? dots.filter((d) => mapForPosition(list, d.x, d.z)?.name === info.name) : []), [dots, list, info]);
	const layers = useMemo(() => liveLayers(here, markers, followed), [here, markers, followed]);
	const follow = (key: string | null) => {
		setFollowed(key);
		setFollowBand(null);
		if (key) setPicked(null);
	};
	const focus = followedDot ? { x: followedDot.x, y: followedDot.y, z: followedDot.z } : null;

	const sections = groups ?? [{ id: "", label: null, color: "" }];
	return (
		<View style={{ flex: 1, gap: space.sm }}>
			<View style={{ flex: 1.3, minHeight: 260 }}>
				{maps === null ? (
					<Skeleton height={260} />
				) : info && !geometry.error ? (
					<MapScene
						backendId={backendId}
						geometry={geometry.data ?? null}
						bounds={info.bounds}
						mode={view.mode}
						layers={layers}
						offset={info.offset}
						band={band}
						focus={focus}
						label={label}
						style={{ flex: 1 }}
						onPick={(pt, at) => {
							const dot = nearestDot(here, pt.x, pt.z);
							setTapped(dot ? { name: dot.name, left: at.x, top: at.y } : null);
							follow(dot?.key ?? null);
						}}
					/>
				) : (
					<Card style={{ flex: 1, justifyContent: "center" }}>
						<EmptyState
							icon="map-outline"
							title={list.length ? (geometry.error ? "This map's geometry could not be read" : "No exported map to draw on") : "No exported maps yet"}
							body={list.length ? (geometry.error ? geometry.error.message : undefined) : "Export them on the Maps screen to see players on them. The list shows who is where."}
						/>
					</Card>
				)}
				{tapped ? (
					<View pointerEvents="none" style={{ position: "absolute", left: Math.max(4, tapped.left + 10), top: Math.max(4, tapped.top + 10), backgroundColor: p.card, borderColor: p.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 }}>
						<Txt variant="small" color={p.foreground}>
							{tapped.name}
						</Txt>
					</View>
				) : null}
			</View>
			<ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
				{header}
				{list.length ? (
					<>
						<ScrollView horizontal style={{ flexGrow: 0, flexShrink: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center" }}>
							<Txt variant="label">Map</Txt>
							{list.map((m) => (
								<ToggleChip
									key={m.name}
									label={`${m.name} ${counts.get(m.name) ?? 0}`}
									pressed={m.name === name}
									onPress={() => {
										setPicked(m.name);
										follow(null);
										setTapped(null);
									}}
								/>
							))}
						</ScrollView>
						<Segmented
							options={[
								{ value: "2d", label: "2D" },
								{ value: "3d", label: "3D" },
							]}
							value={view.mode}
							onChange={(mode) => setView({ mode })}
						/>
						{info ? <BandControls choice={choice} band={band} floors={floors} lo={lo} hi={hi} follow={following} onChange={setBand} /> : null}
						<Txt variant="small">Tap a dot for the name and to follow that player, or use Follow below. Positions are live and stay on this screen only.</Txt>
					</>
				) : null}
				{dots.length === 0 ? typeof empty === "string" ? <Txt variant="muted">{empty}</Txt> : empty : null}
				{sections.map((g) => {
					const mine = dots.filter((d) => (groups ? d.group === g.id : true));
					if (groups && !mine.length) return null;
					return (
						<View key={g.id} style={{ gap: 4 }}>
							{g.label ? (
								<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
									<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: g.color }} />
									{typeof g.label === "string" ? <Txt variant="small">{g.label}</Txt> : g.label}
								</View>
							) : null}
							{mine.map((d) => {
								const on = mapForPosition(list, d.x, d.z)?.name;
								const isFollowed = followed === d.key;
								return (
									<View key={d.key} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 }}>
										<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d.color }} />
										<View style={{ flex: 1 }}>
											<Txt numberOfLines={1}>{d.name}</Txt>
											{on ? <Txt variant="small">on {on}</Txt> : null}
										</View>
										<Button
											title={isFollowed ? "Following" : "Follow"}
											small
											variant={isFollowed ? "brand" : "ghost"}
											onPress={() => {
												setTapped(null);
												follow(isFollowed ? null : d.key);
											}}
										/>
									</View>
								);
							})}
						</View>
					);
				})}
			</ScrollView>
		</View>
	);
}
