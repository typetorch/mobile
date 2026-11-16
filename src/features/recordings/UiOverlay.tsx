/**
 * The recorded UI drawn over the Player view (port of the web explorer's pages/recordings/UiOverlay.tsx, plans/36 phase
 * 4): every visible GuiObject as an absolutely placed view at the rectangle Roblox laid it out at, scaled from the
 * recorded viewport to this view's width (the parent keeps the recorded aspect). No layout is re-done here: the rects
 * are AbsolutePosition / AbsoluteSize after Roblox's own layout.
 *
 * Best-effort choices (the web's, in React Native terms):
 *   - Coordinates: AbsolutePosition is measured below the top bar inset, so a node's top is `rect.y + inset`.
 *   - Clipping (ClipsDescendants, ScrollingFrame, CanvasGroup): rects are absolute and drawn flat, so a node is cut to
 *     the intersection of its clipping ancestors' rects: a view at that rect with overflow hidden holds it (the web's
 *     clip-path; rotation is ignored for the cut).
 *   - UIGradient multiplies the object's colour in Roblox: drawn as a linear-gradient background in place of the
 *     background colour (React Native's backgroundImage).
 *   - ImageColor3 (tint): a second copy of the image filled with the colour (tintColor), multiplied over it
 *     (mixBlendMode), the web's multiply layer masked by the image. ImageRect is in the image's pixels, assumed to be the
 *     thumbnail's (the backend's thumbnails keep the aspect, up to 700 px: big sprite sheets may be off). Slice (9-slice),
 *     Tile, Fit and Crop are drawn from cut-out pieces of the image (no CSS border-image / background-size here).
 *   - Fonts: only the phone's own fonts exist, so FontFace.Family picks monospace, serif or the system sans-serif (the
 *     web maps to web fonts with fallbacks).
 *   - Rich text: parsed into spans (ui-state.ts richText), drawn as nested Text, never markup.
 * Only nodes that draw something take a tap (an invisible full-screen container would block the 3D view): a tap
 * selects a node, a tap on the selected node clears it (the web's Escape has no phone twin).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Image, Pressable, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";

import type { ExtUiFields, ExtUiNode } from "@/api/tt/types";
import { Txt } from "@/components/ui";
import { radius, space, useTheme } from "@/theme";

import { assetIdOf, useAssetImage } from "./assets";
import { alwaysClips, fieldsAt, isImageClass, isTextClass, richText, uiClassName, uiPath, uiStateAt, type RichSpan, type UiNodeState } from "./ui-state";

/** React Native's style types are read-only: these are built up field by field. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface UiViewport {
	w: number;
	h: number;
	inset: number;
}

/** "#rrggbb" + transparency (0..1) as rgba(). */
export function rgba(hex: string | undefined, transparency = 0): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
	const v = m ? Number.parseInt(m[1] as string, 16) : 0xffffff;
	const a = Math.max(0, Math.min(1, 1 - transparency));
	return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${Number(a.toFixed(3))})`;
}

const MONO = /^(robotomono|inconsolata|code|ubuntumono|jetbrains|sourcecode|courier)/i;
const SERIF = /^(merriweather|garamond|crimson|antique|playfair|times|georgia)/i;

/** The phone font for a FontFace.Family (or a rich text face): monospace, serif, else the system font (undefined). */
export function fontFamilyOf(family: string | undefined): string | undefined {
	const name = (/([\w-]+)\.json$/i.exec(family ?? "")?.[1] ?? family ?? "").replace(/[^\w -]/g, "");
	if (MONO.test(name)) return "monospace";
	if (SERIF.test(name)) return "serif";
	return undefined;
}

const ALIGN = ["flex-start", "center", "flex-end"] as const;
const TEXT_ALIGN = ["left", "center", "right"] as const;

/** UIGradient as a CSS linear-gradient (React Native's backgroundImage reads it). */
export function gradientCss(g: NonNullable<ExtUiFields["gradient"]>, transparency: number): string | undefined {
	if (!g.keys.length) return undefined;
	const stops = g.keys.length === 1 ? [...g.keys, [1, g.keys[0]?.[1] ?? "#ffffff"] as [number, string]] : g.keys;
	return `linear-gradient(${90 + g.rotation}deg, ${stops.map(([at, color]) => `${rgba(color, transparency)} ${Math.round(at * 1000) / 10}%`).join(", ")})`;
}

/** Draws something (takes a tap): a visible background, text, an image, a stroke, or a box class. */
function drawsSomething(s: UiNodeState): boolean {
	const f = s.fields;
	if (f.background && f.background.transparency < 1) return true;
	if (f.stroke && f.stroke.transparency < 1) return true;
	if (isTextClass(s.cls) && f.text) return true;
	if (isImageClass(s.cls) && f.image) return true;
	return s.cls === 8 || s.cls === 10;
}

export function UiOverlay({
	backendId,
	ui,
	t,
	viewport,
	width,
	selected = null,
	onSelect,
}: {
	backendId: string;
	ui: ExtUiNode[];
	t: number;
	viewport: UiViewport;
	/** The overlay's laid-out width (dp): the recorded viewport is scaled to it. */
	width: number;
	selected?: number | null;
	onSelect?: (i: number | null) => void;
}) {
	const scale = width > 0 && viewport.w > 0 ? width / viewport.w : 1;
	const nodes = useMemo(() => uiStateAt(ui, t), [ui, t]);
	const byI = useMemo(() => new Map(nodes.map((n) => [n.i, n])), [nodes]);
	return (
		<View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, overflow: "hidden" }} testID="ui-overlay">
			{nodes.map((s, z) =>
				s.cls === 0 || !s.fields.rect ? null : (
					<UiBox key={s.i} backendId={backendId} state={s} z={z + 1} scale={scale} inset={viewport.inset} clip={clipRect(s, byI)} selected={selected === s.i} onSelect={onSelect} />
				),
			)}
		</View>
	);
}

/** The intersection of the clipping ancestors' rects (recorded px, inset applied later), or null. */
function clipRect(s: UiNodeState, byI: Map<number, UiNodeState>): [number, number, number, number] | null {
	let box: [number, number, number, number] | null = null;
	const seen = new Set<number>([s.i]);
	let up = s.parent === null ? undefined : byI.get(s.parent);
	while (up && !seen.has(up.i)) {
		seen.add(up.i);
		if (up.cls !== 0 && up.fields.rect && (up.fields.clip || alwaysClips(up.cls))) {
			const [x, y, w, h] = up.fields.rect;
			box = box ? [Math.max(box[0], x), Math.max(box[1], y), Math.min(box[2], x + w), Math.min(box[3], y + h)] : [x, y, x + w, y + h];
		}
		up = up.parent === null ? undefined : byI.get(up.parent);
	}
	return box;
}

function UiBox({
	backendId,
	state,
	z,
	scale,
	inset,
	clip,
	selected,
	onSelect,
}: {
	backendId: string;
	state: UiNodeState;
	z: number;
	scale: number;
	inset: number;
	clip: [number, number, number, number] | null;
	selected: boolean;
	onSelect?: ((i: number | null) => void) | undefined;
}) {
	const f = state.fields;
	const [x, y, w, h] = f.rect as [number, number, number, number];
	// the clipping box (recorded px): the node's own position is relative to it
	let ox = 0;
	let oy = 0;
	let holder: ViewStyle | null = null;
	if (clip) {
		const [cx0, cy0, cx1, cy1] = clip;
		if (cx1 <= cx0 || cy1 <= cy0) return null;
		if (cx0 > x || cy0 > y || cx1 < x + w || cy1 < y + h) {
			holder = { position: "absolute", left: cx0 * scale, top: (cy0 + inset) * scale, width: (cx1 - cx0) * scale, height: (cy1 - cy0) * scale, overflow: "hidden", zIndex: z };
			ox = cx0;
			oy = cy0 + inset;
		}
	}
	const style: Mutable<ViewStyle> = {
		position: "absolute",
		left: (x - ox) * scale,
		top: (y + inset - oy) * scale,
		width: Math.max(0, w * scale),
		height: Math.max(0, h * scale),
		zIndex: z,
		overflow: "hidden",
	};
	if (f.rotation) style.transform = [{ rotate: `${f.rotation}deg` }];
	const bg = f.background;
	if (bg && bg.transparency < 1) style.backgroundColor = rgba(bg.color, bg.transparency);
	if (f.gradient && bg && bg.transparency < 1) {
		const g = gradientCss(f.gradient, bg.transparency);
		if (g) {
			style.experimental_backgroundImage = g;
			style.backgroundColor = "transparent";
		}
	}
	if (f.corner) style.borderRadius = f.corner * scale;
	if (f.stroke && f.stroke.transparency < 1 && f.stroke.thickness > 0) {
		style.boxShadow = `0px 0px 0px ${Math.max(0.5, f.stroke.thickness * scale)}px ${rgba(f.stroke.color, f.stroke.transparency)}`;
		style.overflow = "visible";
	}
	if (selected) {
		style.outlineWidth = 2;
		style.outlineColor = "#f59e0b";
		style.outlineOffset = 1;
		style.outlineStyle = "solid";
	}
	const interactive = onSelect !== undefined && drawsSomething(state);
	let inner: ReactNode = null;
	if (isImageClass(state.cls) && f.image) inner = <UiImage backendId={backendId} fields={f} scale={scale} />;
	else if (state.cls === 8 || state.cls === 10) inner = <Placeholder label={uiClassName(state.cls)} />;
	if (isTextClass(state.cls) && f.text) inner = <UiText fields={f} scale={scale} />;
	const box = interactive ? (
		<Pressable
			style={style}
			onPress={() => onSelect?.(selected ? null : state.i)}
			accessibilityRole="button"
			accessibilityLabel={uiClassName(state.cls)}
			testID={`ui-node-${state.i}`}
		>
			{inner}
		</Pressable>
	) : (
		<View pointerEvents="none" style={style}>
			{inner}
		</View>
	);
	return holder ? (
		<View pointerEvents="box-none" style={holder}>
			{box}
		</View>
	) : (
		box
	);
}

function Placeholder({ label }: { label: string }) {
	return (
		<View style={{ flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(148,163,184,0.6)", backgroundColor: "rgba(148,163,184,0.12)" }}>
			<Text numberOfLines={1} style={{ fontSize: 9, color: "rgba(148,163,184,0.95)", paddingHorizontal: 2 }}>
				{label}
			</Text>
		</View>
	);
}

function UiText({ fields, scale }: { fields: ExtUiFields; scale: number }) {
	const s = fields.textStyle;
	const spans = useMemo<RichSpan[]>(() => (s?.rich ? richText(fields.text ?? "") : [{ text: fields.text ?? "" }]), [fields.text, s?.rich]);
	const size = Math.max(1, (s?.size ?? 14) * scale);
	const text: Mutable<TextStyle> = {
		textAlign: TEXT_ALIGN[s?.xAlign ?? 1],
		color: rgba(s?.color ?? "#000000", s?.transparency ?? 0),
		fontSize: size,
		lineHeight: size * 1.1,
		fontWeight: String(s?.weight ?? 400) as TextStyle["fontWeight"],
		includeFontPadding: false,
	};
	const family = fontFamilyOf(s?.family);
	if (family) text.fontFamily = family;
	if (s && s.strokeTransparency < 1) {
		text.textShadowColor = rgba(s.strokeColor, s.strokeTransparency);
		text.textShadowRadius = Math.max(1, scale * 1.5);
		text.textShadowOffset = { width: 0, height: 0 };
	}
	const lines = spans.reduce((n, sp) => n + (sp.br ? 1 : 0), 0) + (fields.text ?? "").split("\n").length;
	return (
		<View style={{ flex: 1, justifyContent: ALIGN[s?.yAlign ?? 1], alignItems: ALIGN[s?.xAlign ?? 1] }} testID="ui-text">
			<Text style={text} {...(s?.wrapped ? {} : { numberOfLines: lines, ellipsizeMode: "clip" as const })}>
				{spans.map((rs, k) => {
					if (rs.br) return "\n";
					const css: Mutable<TextStyle> = {};
					if (rs.bold) css.fontWeight = "700";
					if (rs.weight) css.fontWeight = String(rs.weight) as TextStyle["fontWeight"];
					if (rs.italic) css.fontStyle = "italic";
					const deco = rs.underline && rs.strike ? "underline line-through" : rs.underline ? "underline" : rs.strike ? "line-through" : null;
					if (deco) css.textDecorationLine = deco;
					if (rs.color) css.color = rs.color;
					if (rs.size) css.fontSize = rs.size * scale;
					if (rs.face) {
						const face = fontFamilyOf(rs.face);
						if (face) css.fontFamily = face;
					}
					if (rs.uppercase) css.textTransform = "uppercase";
					if (rs.smallcaps) css.fontVariant = ["small-caps"];
					return Object.keys(css).length ? (
						<Text key={k} style={css}>
							{rs.text}
						</Text>
					) : (
						rs.text
					);
				})}
			</Text>
		</View>
	);
}

/** One drawn piece of an image: the whole image at `size`, moved by `at`, tinted (multiply) when a colour is given. */
function Pic({ uri, at, size, tint }: { uri: string; at: [number, number]; size: [number, number]; tint: string | null }) {
	const base: ImageStyle = { position: "absolute", left: at[0], top: at[1], width: size[0], height: size[1] };
	return (
		<>
			<Image source={{ uri }} style={base} resizeMode="stretch" fadeDuration={0} />
			{tint ? <Image source={{ uri }} style={[base, { tintColor: tint, mixBlendMode: "multiply" }]} resizeMode="stretch" fadeDuration={0} /> : null}
		</>
	);
}

/** A source rectangle of the image (image px) drawn into a destination rectangle (dp): a clipped, scaled copy. */
function Region({ uri, natural, src, dst, tint }: { uri: string; natural: [number, number]; src: [number, number, number, number]; dst: [number, number, number, number]; tint: string | null }) {
	const [sx, sy, sw, sh] = src;
	const [dx, dy, dw, dh] = dst;
	if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return null;
	const kx = dw / sw;
	const ky = dh / sh;
	return (
		<View style={{ position: "absolute", left: dx, top: dy, width: dw, height: dh, overflow: "hidden" }}>
			<Pic uri={uri} at={[-sx * kx, -sy * ky]} size={[natural[0] * kx, natural[1] * ky]} tint={tint} />
		</View>
	);
}

/** Tiles at most this many copies (a tiny tile over a big frame draws as one stretched copy instead). */
const MAX_TILES = 400;

function UiImage({ backendId, fields, scale }: { backendId: string; fields: ExtUiFields; scale: number }) {
	const image = useAssetImage(backendId, fields.image);
	const [box, setBox] = useState<[number, number] | null>(null);
	if (!image || image.state !== "ready") {
		const label = image === null ? (fields.image?.startsWith("rbxasset://") ? "engine image" : "image") : image.state === "missing" ? "image unavailable" : "image loading";
		const id = assetIdOf(fields.image);
		return <Placeholder label={`${label}${id ? ` ${id}` : ""}`} />;
	}
	const st = fields.imageStyle;
	const opacity = 1 - (st?.transparency ?? 0);
	const tint = st && st.color.toLowerCase() !== "#ffffff" ? st.color : null;
	const natural: [number, number] = [image.width, image.height];
	const [, , rw, rh] = fields.rect ?? [0, 0, 0, 0];
	const W = box?.[0] ?? rw * scale;
	const H = box?.[1] ?? rh * scale;
	const r = fields.imageRect;
	const scaleType = st?.scaleType ?? 0;
	const pieces: ReactNode[] = [];
	const uri = image.uri;
	// the part of the image used: ImageRect when set, else all of it
	const src: [number, number, number, number] = r && r.size[0] > 0 && r.size[1] > 0 ? [r.offset[0], r.offset[1], r.size[0], r.size[1]] : [0, 0, natural[0], natural[1]];
	if (scaleType === 1 && r && (r.slice[2] > r.slice[0] || r.slice[3] > r.slice[1])) {
		// 9-slice: the corners at the screen scale, the edges stretched one way, the centre both
		const [x0, y0, x1, y1] = r.slice;
		const [nw, nh] = natural;
		const cols: [number, number][] = [
			[0, x0],
			[x0, x1],
			[x1, nw],
		];
		const rows: [number, number][] = [
			[0, y0],
			[y0, y1],
			[y1, nh],
		];
		const left = x0 * scale;
		const right = (nw - x1) * scale;
		const top = y0 * scale;
		const bottom = (nh - y1) * scale;
		const dCols: [number, number][] = [
			[0, left],
			[left, Math.max(left, W - right)],
			[Math.max(left, W - right), W],
		];
		const dRows: [number, number][] = [
			[0, top],
			[top, Math.max(top, H - bottom)],
			[Math.max(top, H - bottom), H],
		];
		for (let i = 0; i < 3; i++)
			for (let j = 0; j < 3; j++) {
				const [sx0, sx1] = cols[i] as [number, number];
				const [sy0, sy1] = rows[j] as [number, number];
				const [dx0, dx1] = dCols[i] as [number, number];
				const [dy0, dy1] = dRows[j] as [number, number];
				pieces.push(<Region key={`${i}-${j}`} uri={uri} natural={natural} src={[sx0, sy0, sx1 - sx0, sy1 - sy0]} dst={[dx0, dy0, dx1 - dx0, dy1 - dy0]} tint={tint} />);
			}
	} else if (scaleType === 2 && !(r && r.size[0] > 0)) {
		// Tile: copies at the image's own size (screen scale)
		const tw = natural[0] * scale;
		const th = natural[1] * scale;
		const n = tw > 0 && th > 0 ? Math.ceil(W / tw) * Math.ceil(H / th) : Infinity;
		if (n <= MAX_TILES) {
			for (let yy = 0; yy < H; yy += th) for (let xx = 0; xx < W; xx += tw) pieces.push(<Pic key={`${xx}-${yy}`} uri={uri} at={[xx, yy]} size={[tw, th]} tint={tint} />);
		} else pieces.push(<Pic key="all" uri={uri} at={[0, 0]} size={[W, H]} tint={tint} />);
	} else if ((scaleType === 3 || scaleType === 4) && !(r && r.size[0] > 0)) {
		// Fit (contain) / Crop (cover), centred
		const k = scaleType === 3 ? Math.min(W / natural[0], H / natural[1]) : Math.max(W / natural[0], H / natural[1]);
		const dw = natural[0] * k;
		const dh = natural[1] * k;
		pieces.push(<Pic key="all" uri={uri} at={[(W - dw) / 2, (H - dh) / 2]} size={[dw, dh]} tint={tint} />);
	} else pieces.push(<Region key="all" uri={uri} natural={natural} src={src} dst={[0, 0, W, H]} tint={tint} />);
	return (
		<View
			style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, overflow: "hidden", opacity, isolation: "isolate" }}
			onLayout={(e) => {
				const { width, height } = e.nativeEvent.layout;
				if (!box || Math.abs(box[0] - width) > 0.5 || Math.abs(box[1] - height) > 0.5) setBox([width, height]);
			}}
			testID="ui-image"
		>
			{pieces}
		</View>
	);
}

// Properties ----------------------------------------------------------------------------------------------------------------

function Swatch({ color, transparency }: { color: string; transparency?: number }) {
	const p = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
			<View style={{ width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: p.border, backgroundColor: rgba(color, transparency ?? 0) }} />
			<Txt variant="mono" style={{ fontSize: 11 }}>
				{color}
			</Txt>
			{transparency ? <Txt variant="small">({Math.round(transparency * 100)}% transparent)</Txt> : null}
		</View>
	);
}

const fmtS = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** A light "Properties" for one recorded UI node at `t`: path, class, lifetime and every recorded field. */
export function UiProperties({ ui, i, t }: { ui: ExtUiNode[]; i: number; t: number }) {
	const p = useTheme();
	const node = ui.find((n) => n.i === i);
	const f = fieldsAt(ui, i, t);
	if (!node || !f) return null;
	const rows: [string, ReactNode][] = [
		["Path", <Txt variant="mono" style={{ fontSize: 11 }} selectable>{uiPath(ui, i)}</Txt>],
		["Class", uiClassName(node.cls)],
		["Visible", `${fmtS(node.from)} to ${node.to === null ? "the end" : fmtS(node.to)}`],
	];
	if (f.rect) rows.push(["Rect", `${f.rect[0]}, ${f.rect[1]} · ${f.rect[2]} x ${f.rect[3]} px`]);
	if (f.rotation) rows.push(["Rotation", `${f.rotation} deg`]);
	if (f.order !== undefined) rows.push([node.cls === 0 ? "DisplayOrder" : "Draw order", String(f.order)]);
	if (f.background) rows.push(["Background", <Swatch color={f.background.color} transparency={f.background.transparency} />]);
	if (f.text !== undefined) rows.push(["Text", f.text]);
	if (f.textStyle) {
		const s = f.textStyle;
		rows.push(["Text colour", <Swatch color={s.color} transparency={s.transparency} />]);
		rows.push(["Font", `${(/([\w-]+)\.json$/i.exec(s.family)?.[1] ?? s.family) || "?"} ${s.weight}, ${s.size} px`]);
		rows.push(["Alignment", `${TEXT_ALIGN[s.xAlign] ?? s.xAlign} / ${["top", "centre", "bottom"][s.yAlign] ?? s.yAlign}`]);
		const flags = [s.scaled && "scaled", s.wrapped && "wrapped", s.rich && "rich text"].filter(Boolean).join(", ");
		if (flags) rows.push(["Text flags", flags]);
		if (s.strokeTransparency < 1) rows.push(["Text stroke", <Swatch color={s.strokeColor} transparency={s.strokeTransparency} />]);
	}
	if (f.image !== undefined) rows.push(["Image", <Txt variant="mono" style={{ fontSize: 11 }} selectable>{f.image || "(none)"}</Txt>]);
	if (f.imageStyle) {
		rows.push(["Image colour", <Swatch color={f.imageStyle.color} transparency={f.imageStyle.transparency} />]);
		rows.push(["Scale type", String(["Stretch", "Slice", "Tile", "Fit", "Crop"][f.imageStyle.scaleType] ?? f.imageStyle.scaleType)]);
	}
	if (f.imageRect) {
		const r = f.imageRect;
		if (r.size[0] || r.size[1]) rows.push(["Image rect", `offset ${r.offset.join(", ")} · size ${r.size.join(" x ")}`]);
		if (r.slice.some((v) => v !== 0)) rows.push(["Slice centre", r.slice.join(", ")]);
	}
	if (f.stroke)
		rows.push([
			"Stroke",
			<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
				<Swatch color={f.stroke.color} transparency={f.stroke.transparency} />
				<Txt variant="small">{f.stroke.thickness} px</Txt>
			</View>,
		]);
	if (f.corner) rows.push(["Corner", `${f.corner} px`]);
	if (f.clip) rows.push(["Clips descendants", "yes"]);
	if (f.gradient)
		rows.push([
			"Gradient",
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
				{f.gradient.keys.map(([at, c], k) => (
					<View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
						<Txt variant="small">{Math.round(at * 100)}%</Txt>
						<Swatch color={c} />
					</View>
				))}
				<Txt variant="small">· {f.gradient.rotation} deg</Txt>
			</View>,
		]);
	return (
		<View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md, padding: space.sm, gap: 4, backgroundColor: p.card }} testID="ui-properties">
			<Txt style={{ fontWeight: "600" }}>Properties</Txt>
			{rows.map(([label, value]) => (
				<View key={label} style={{ flexDirection: "row", gap: space.sm }}>
					<Txt variant="small" style={{ width: 104 }}>
						{label}
					</Txt>
					<View style={{ flex: 1, minWidth: 0 }}>{typeof value === "string" ? <Txt variant="small" color={p.foreground} selectable>{value}</Txt> : value}</View>
				</View>
			))}
		</View>
	);
}
