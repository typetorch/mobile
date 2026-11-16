/**
 * The map view's height (Y band) controls (port of the web explorer's components/maps/BandControls.tsx), shared by the
 * Maps screen, the live maps and the Recordings screens' real map: All, the map's detected floors, "Follow player" (cut
 * away everything well above the followed player, so roofs don't hide them) and a free from / to range on a two-thumb
 * slider. Geometry above and below the band is cut away by the renderer's clipping planes; layer marks outside it are
 * left out.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { Txt } from "@/components/ui";
import { font, space, useTheme } from "@/theme";

import type { BandChoice } from "./map-view";
import type { Floor } from "./maps";

/** A small on / off chip (the web's ToggleChip). */
export function ToggleChip({ pressed, onPress, label, dot, disabled }: { pressed: boolean; onPress: () => void; label: string; dot?: string; disabled?: boolean }) {
	const p = useTheme();
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			accessibilityRole="button"
			accessibilityState={{ selected: pressed, disabled: !!disabled }}
			style={({ pressed: down }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: 5,
				paddingVertical: 5,
				paddingHorizontal: 10,
				borderRadius: 999,
				borderWidth: StyleSheet.hairlineWidth,
				borderColor: pressed ? p.brand : p.border,
				backgroundColor: pressed ? `${p.brand}26` : p.card,
				opacity: disabled ? 0.5 : down ? 0.7 : 1,
			})}
		>
			{dot ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot }} /> : null}
			<Txt variant="small" color={pressed ? p.foreground : p.mutedForeground} style={{ fontWeight: pressed ? "600" : "500" }}>
				{label}
			</Txt>
		</Pressable>
	);
}

const THUMB = 22;

type SliderState = { from: number; to: number; width: number; lo: number; hi: number; onChange: (band: [number, number]) => void };

/** One thumb's drag: whole studs, never past the other thumb. */
function thumbResponder(which: "from" | "to", state: { current: SliderState }) {
	let start = 0;
	return PanResponder.create({
		onStartShouldSetPanResponder: () => true,
		onMoveShouldSetPanResponder: () => true,
		onPanResponderTerminationRequest: () => false,
		onPanResponderGrant: () => {
			start = state.current[which];
		},
		onPanResponderMove: (_e, g) => {
			const s = state.current;
			const perPx = (s.hi - s.lo) / Math.max(1, s.width - THUMB);
			const v = Math.round(start + g.dx * perPx);
			if (which === "from") s.onChange([Math.max(s.lo, Math.min(v, s.to - 1)), s.to]);
			else s.onChange([s.from, Math.min(s.hi, Math.max(v, s.from + 1))]);
		},
	});
}

/** A from / to range on one track (whole studs). */
export function BandSlider({ lo, hi, band, onChange }: { lo: number; hi: number; band: [number, number] | null; onChange: (band: [number, number]) => void }) {
	const p = useTheme();
	const [width, setWidth] = useState(1);
	const [a, b] = band ?? [lo, hi];
	const span = Math.max(1, hi - lo);
	const from = Math.max(lo, Math.min(hi, a));
	const to = Math.max(lo, Math.min(hi, b));
	const state = useRef<SliderState>({ from, to, width, lo, hi, onChange });
	state.current = { from, to, width, lo, hi, onChange };
	const toX = (v: number) => ((v - lo) / span) * Math.max(1, width - THUMB);

	const fromThumb = useMemo(() => thumbResponder("from", state), []);
	const toThumb = useMemo(() => thumbResponder("to", state), []);

	return (
		<View style={{ gap: 4 }}>
			<View style={{ height: THUMB + 8, justifyContent: "center" }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
				<View style={{ position: "absolute", left: THUMB / 2, right: THUMB / 2, height: 4, borderRadius: 2, backgroundColor: p.muted }} />
				<View style={{ position: "absolute", left: toX(from) + THUMB / 2, width: Math.max(0, toX(to) - toX(from)), height: 4, borderRadius: 2, backgroundColor: p.brand }} />
				{(
					[
						["from", from, fromThumb],
						["to", to, toThumb],
					] as const
				).map(([key, v, r]) => (
					<View
						key={key}
						{...r.panHandlers}
						hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
						accessibilityLabel={key === "from" ? "Band bottom" : "Band top"}
						style={{ position: "absolute", left: toX(v), width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: p.background, borderWidth: 2, borderColor: p.brand }}
					/>
				))}
			</View>
			<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
				<Txt variant="small" style={{ fontVariant: ["tabular-nums"] }}>
					from {Math.round(from)}
				</Txt>
				<Txt variant="small" style={{ fontVariant: ["tabular-nums"] }}>
					to {Math.round(to)}
				</Txt>
			</View>
		</View>
	);
}

export function BandControls({
	choice,
	band,
	floors,
	lo,
	hi,
	onChange,
	follow = false,
	style,
}: {
	/** What the view asks for. */
	choice: BandChoice;
	/** What is drawn (resolved against this map). */
	band: [number, number] | null;
	floors: readonly Floor[];
	lo: number;
	hi: number;
	onChange: (choice: BandChoice) => void;
	/** Offer "Follow player" (a replay, a followed live player). */
	follow?: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<View style={[{ gap: space.sm }, style]}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
				<Txt variant="label" style={{ fontSize: font.xs }}>
					Height (Y)
				</Txt>
				<ToggleChip label="All" pressed={choice.kind === "all" || (band === null && choice.kind !== "player")} onPress={() => onChange({ kind: "all" })} />
				{follow ? <ToggleChip label="Follow player" pressed={choice.kind === "player"} onPress={() => onChange({ kind: "player" })} /> : null}
				{floors.length > 1
					? floors.map((f, i) => <ToggleChip key={f.y} label={`Floor ${i + 1}`} pressed={choice.kind === "floor" && choice.index === i} onPress={() => onChange({ kind: "floor", index: i })} />)
					: null}
			</View>
			{floors.length > 1 ? (
				<Txt variant="small">{floors.map((f, i) => `Floor ${i + 1}: walkable at y ${f.y}`).join(" · ")}</Txt>
			) : null}
			<BandSlider lo={lo} hi={hi} band={band} onChange={(b) => onChange({ kind: "range", lo: b[0], hi: b[1] })} />
		</View>
	);
}

/** A row of chips with a caption (a group of on / off choices). */
export function ChipRow({ label, children }: { label?: string; children: ReactNode }) {
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
			{label ? <Txt variant="label">{label}</Txt> : null}
			{children}
		</View>
	);
}

