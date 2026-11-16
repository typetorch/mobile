/**
 * Small shared pieces of the phase 2 TypeTorch pages (the web's components/common, DataTable, ShareBar, PlayerLink,
 * ProductId, FunnelProgressBar), sized for a phone.
 */
import type { UseQueryResult } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { Api } from "@/api/backend";
import type { FunnelProgress, RobloxProductInfo } from "@/api/tt/types";
import { Badge, Button, Card, EmptyState, ErrorState, Icon, SkeletonList, Txt } from "@/components/ui";
import { compactJson, fmtPct, fmtTime, shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { radius, space, toneColor, useTheme, type Tone } from "@/theme";

import { useTTQuery } from "./hooks";

/** Loading, error and empty states around a query's data (the web's QueryState). */
export function QueryState<T>({
	q,
	isEmpty,
	empty,
	rows = 5,
	children,
}: {
	q: Pick<UseQueryResult<T, Error>, "data" | "error" | "refetch">;
	isEmpty?: (data: T) => boolean;
	empty?: string;
	rows?: number;
	children: (data: T) => ReactNode;
}) {
	if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (q.data === undefined) return <SkeletonList rows={rows} />;
	if (isEmpty?.(q.data)) return <EmptyState icon="file-tray-outline" title={empty ?? "Nothing here"} />;
	return <>{children(q.data)}</>;
}

/** A muted line of explanation under a heading. */
export function Note({ children }: { children: ReactNode }) {
	return <Txt variant="small">{children}</Txt>;
}

/** A share 0-1 as a thin bar. */
export function ShareBar({ share, tone, width }: { share: number; tone?: Tone; width?: number }) {
	const p = useTheme();
	const w = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
	return (
		<View style={{ height: 6, borderRadius: 3, backgroundColor: p.muted, width: width ?? "100%", overflow: "hidden" }}>
			<View style={{ height: 6, width: `${w * 100}%`, backgroundColor: tone ? toneColor(p, tone) : p.chart[0] }} />
		</View>
	);
}

/** A label / value / share row (a breakdown list). */
export function ShareRow({ label, value, share, sub, tone, onPress }: { label: ReactNode; value: ReactNode; share: number; sub?: ReactNode; tone?: Tone; onPress?: () => void }) {
	const p = useTheme();
	const body = (
		<View style={{ gap: 4, paddingVertical: 8, paddingHorizontal: space.md }}>
			<View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
				{typeof label === "string" ? (
					<Txt numberOfLines={2} style={{ flex: 1 }}>
						{label}
					</Txt>
				) : (
					<View style={{ flex: 1 }}>{label}</View>
				)}
				{typeof value === "string" ? <Txt style={{ fontWeight: "600" }}>{value}</Txt> : value}
			</View>
			<ShareBar share={share} {...(tone ? { tone } : {})} />
			{sub ? typeof sub === "string" ? <Txt variant="small">{sub}</Txt> : sub : null}
		</View>
	);
	if (!onPress) return body;
	return (
		<Pressable onPress={onPress} android_ripple={{ color: p.accent }} style={({ pressed }) => [pressed && { backgroundColor: p.accent }]}>
			{body}
		</Pressable>
	);
}

export interface Column<T> {
	key: string;
	header: string;
	width?: number;
	align?: "left" | "right" | "center";
	render: (row: T, index: number) => ReactNode;
	mono?: boolean;
}

/** A compact table that scrolls sideways (wide breakdowns, query results). Cells are text unless render gives a node. */
export function MiniTable<T>({
	columns,
	rows,
	rowKey,
	onRowPress,
	max,
	pinned,
}: {
	columns: Column<T>[];
	rows: readonly T[];
	rowKey?: (row: T, i: number) => string;
	onRowPress?: (row: T) => void;
	/** Show at most this many rows, with a "Show all" button. */
	max?: number;
	/** Rows drawn first, bold (an average or a total). */
	pinned?: readonly T[];
}) {
	const p = useTheme();
	const [all, setAll] = useState(false);
	const shown = max && !all ? rows.slice(0, max) : rows;
	const cell = (c: Column<T>, content: ReactNode, header = false, bold = false) => (
		<View key={c.key} style={{ width: c.width ?? 90, paddingHorizontal: 6, paddingVertical: 7, justifyContent: "center", alignItems: c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start" }}>
			{typeof content === "string" || typeof content === "number" ? (
				<Txt variant={header ? "label" : c.mono ? "mono" : "small"} color={header ? undefined : p.foreground} numberOfLines={header ? 2 : 3} style={bold ? { fontWeight: "700" } : undefined}>
					{content}
				</Txt>
			) : (
				content
			)}
		</View>
	);
	const line = (row: T, i: number, bold: boolean) => {
		const content = <View style={{ flexDirection: "row" }}>{columns.map((c) => cell(c, c.render(row, i), false, bold))}</View>;
		return (
			<View key={rowKey ? rowKey(row, i) : String(i)} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border, backgroundColor: bold ? p.muted : undefined }}>
				{onRowPress && !bold ? (
					<Pressable onPress={() => onRowPress(row)} android_ripple={{ color: p.accent }} style={({ pressed }) => [pressed && { backgroundColor: p.accent }]}>
						{content}
					</Pressable>
				) : (
					content
				)}
			</View>
		);
	};
	return (
		<View style={{ gap: space.sm }}>
			<View style={{ backgroundColor: p.card, borderColor: p.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: "hidden" }}>
				<ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
					<View>
						<View style={{ flexDirection: "row" }}>{columns.map((c) => cell(c, c.header, true))}</View>
						{(pinned ?? []).map((r, i) => line(r, -1 - i, true))}
						{shown.map((r, i) => line(r, i, false))}
					</View>
				</ScrollView>
			</View>
			{max && rows.length > max ? <Button title={all ? "Show fewer" : `Show all ${rows.length}`} small variant="ghost" onPress={() => setAll((a) => !a)} style={{ alignSelf: "flex-start" }} /> : null}
		</View>
	);
}

/** A retention-style heat cell: the share kept, darker = more; "–" while the day isn't over. */
export function HeatCell({ rate, kept }: { rate: number | null | undefined; kept?: number | null }) {
	const p = useTheme();
	if (rate === null || rate === undefined) return <Txt variant="small">–</Txt>;
	const alpha = 0.08 + Math.min(1, rate) * 0.82;
	const hex = Math.round(alpha * 255)
		.toString(16)
		.padStart(2, "0");
	return (
		<View style={{ backgroundColor: `${p.chart[0]}${hex}`, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, minWidth: 60, alignItems: "center" }}>
			<Txt variant="small" color={alpha > 0.5 ? "#ffffff" : p.foreground}>
				{fmtPct(rate, 0)}
				{kept !== undefined && kept !== null ? ` (${kept})` : ""}
			</Txt>
		</View>
	);
}

/** Opens a player's page (the web's PlayerLink to /players?pid=). */
export function openPlayer(backendId: string, pid: string) {
	router.push(`/tt/${backendId}/player/${encodeURIComponent(pid)}`);
}

export function PidLink({ backendId, pid, keep = 8 }: { backendId: string; pid: string; keep?: number }) {
	const p = useTheme();
	return (
		<Pressable onPress={() => openPlayer(backendId, pid)} hitSlop={6}>
			<Txt variant="mono" color={p.brand}>
				{shortId(pid, keep)}
			</Txt>
		</Pressable>
	);
}

/** Copies a text (Mermaid, SQL, a pid); the button says "Copied" for a moment. */
export function CopyButton({ text, title = "Copy" }: { text: string; title?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			title={copied ? "Copied" : title}
			small
			icon={copied ? "checkmark" : "copy-outline"}
			onPress={async () => {
				await Clipboard.setStringAsync(text);
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
		/>
	);
}

/** An event row (time, kind, name, side, state, props) as one list item. */
export function EventItem({ e, dateToo = true, extra }: { e: { time: string; kind: string; name: string; state: string | null; src: string | null; props: unknown }; dateToo?: boolean; extra?: ReactNode }) {
	const props = compactJson(e.props, 400);
	return (
		<View style={{ paddingVertical: 8, paddingHorizontal: space.md, gap: 3 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
				<Badge label={e.kind} />
				<Txt style={{ fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>
					{e.name}
				</Txt>
			</View>
			<Txt variant="small">
				{dateToo ? fmtTime(e.time) : fmtTime(e.time).slice(11)}
				{e.src ? ` · ${e.src}` : ""}
				{e.state ? ` · ${e.state}` : ""}
			</Txt>
			{props && props !== "{}" ? (
				<Txt variant="mono" numberOfLines={4} selectable style={{ fontSize: 11 }}>
					{props}
				</Txt>
			) : null}
			{extra}
		</View>
	);
}

/** A funnel progress bar with the percentage on it (the web's FunnelProgressBar). */
export function FunnelBar({ progress }: { progress: FunnelProgress | undefined }) {
	const p = useTheme();
	if (!progress)
		return (
			<View style={{ height: 18, borderRadius: 4, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
				<Txt variant="small" style={{ fontSize: 10 }}>
					not started
				</Txt>
			</View>
		);
	const done = progress.reached >= progress.of;
	return (
		<View style={{ height: 18, borderRadius: 4, backgroundColor: p.muted, overflow: "hidden", justifyContent: "center" }}>
			<View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(0, Math.min(1, progress.share)) * 100}%`, backgroundColor: done ? p.good : p.chart[0] }} />
			<Txt variant="small" color={p.foreground} style={{ textAlign: "center", fontSize: 10, fontWeight: "600" }}>
				{fmtPct(progress.share)}
			</Txt>
		</View>
	);
}

/** The steps of a funnel; with a player's progress, the reached ones checked. */
export function FunnelStepList({ steps, progress }: { steps: readonly { step: number; label: string | null }[] | undefined; progress?: FunnelProgress | null }) {
	const p = useTheme();
	if (!steps?.length) return <Note>No step of it logged by these players in this range.</Note>;
	return (
		<View style={{ gap: 2 }}>
			{steps.map((s) => {
				const reached = !!progress && s.step <= progress.step;
				const current = !!progress && s.step === progress.step;
				return (
					<View key={s.step} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2, paddingHorizontal: 4, borderRadius: 4, backgroundColor: current ? p.muted : undefined }}>
						{progress !== undefined ? <Icon name={reached ? "checkmark" : "ellipse-outline"} size={12} color={reached ? p.good : p.mutedForeground} /> : null}
						<Txt variant="small">{s.step}.</Txt>
						<Txt variant="small" color={p.foreground} numberOfLines={1} style={{ flex: 1, fontWeight: current ? "600" : "400" }}>
							{s.label ?? "(no name)"}
						</Txt>
					</View>
				);
			})}
		</View>
	);
}

// Products (the web's lib/products.ts) ---------------------------------------------------------------------------------

export type ProductType = RobloxProductInfo["type"];

export function productTypeOf(kind: string | null | undefined): ProductType | undefined {
	const k = (kind ?? "").toLowerCase().replace(/[\s_-]/g, "");
	if (k === "gamepass" || k === "pass") return "gamepass";
	if (k === "product" || k === "devproduct" || k === "developerproduct") return "product";
	return undefined;
}

export function parseProductId(value: unknown): number | undefined {
	const n = typeof value === "number" ? value : typeof value === "string" && /^[1-9]\d{0,18}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
	return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export const productKindLabel = (kind: string) => {
	const t = productTypeOf(kind);
	return t === "gamepass" ? "Game pass" : t === "product" ? "Developer product" : kind;
};

type Waiter = { type: ProductType; id: number; resolve(info: RobloxProductInfo): void };
const loaders = new Map<string, (type: ProductType, id: number) => Promise<RobloxProductInfo>>();

/** Collects the ids asked in one tick and asks them in batches of 50 (one loader per backend). */
function loaderFor(backendId: string, api: Api) {
	const existing = loaders.get(backendId);
	if (existing) return existing;
	let pending: Waiter[] = [];
	let scheduled = false;
	const flush = async () => {
		scheduled = false;
		const waiters = pending;
		pending = [];
		const keys = [...new Set(waiters.map((w) => `${w.type}:${w.id}`))];
		for (let i = 0; i < keys.length; i += 50) {
			const chunk = keys.slice(i, i + 50);
			const ids = { gamepass: [] as number[], product: [] as number[] };
			for (const k of chunk) {
				const [type, id] = k.split(":") as [ProductType, string];
				ids[type].push(Number(id));
			}
			let items: RobloxProductInfo[] = [];
			try {
				items = await api.robloxProducts(ids);
			} catch {
				// the bare id below
			}
			const found = new Map(items.map((it) => [`${it.type}:${it.id}`, it]));
			for (const w of waiters) {
				const key = `${w.type}:${w.id}`;
				if (!chunk.includes(key)) continue;
				w.resolve(found.get(key) ?? { type: w.type, id: w.id, status: "unavailable", name: null, price: null, forSale: null, icon: null });
			}
		}
	};
	const load = (type: ProductType, id: number) =>
		new Promise<RobloxProductInfo>((resolve) => {
			pending.push({ type, id, resolve });
			if (!scheduled) {
				scheduled = true;
				setTimeout(() => void flush(), 0);
			}
		});
	loaders.set(backendId, load);
	return load;
}

export function useProductInfo(backendId: string, type: ProductType | undefined, id: number | undefined) {
	const { api } = useBackend(backendId);
	return useTTQuery(backendId, ["roblox-product", type, id], () => loaderFor(backendId, api as Api)(type as ProductType, id as number), {
		enabled: type !== undefined && id !== undefined && !!api,
		staleTime: 30 * 60_000,
		gcTime: 60 * 60_000,
		retry: false,
	});
}

/** A product id with its Roblox name when known ("VIP pass · 1234"). */
export function ProductName({ backendId, id, kind, style }: { backendId: string; id: unknown; kind: string | null | undefined; style?: "small" | "body" }) {
	const type = productTypeOf(kind);
	const n = parseProductId(id);
	const info = useProductInfo(backendId, type, n);
	const name = info.data?.status === "ok" ? info.data.name : null;
	return (
		<Txt variant={style === "body" ? "body" : "small"} numberOfLines={1} color={style === "body" ? undefined : undefined}>
			{name ? `${name} · ` : ""}
			{id === null || id === undefined || id === "" ? "–" : String(id)}
		</Txt>
	);
}

/** A card with a heading row and a body (a web Section). */
export function Panel({ title, note, right, children }: { title: string; note?: string; right?: ReactNode; children: ReactNode }) {
	return (
		<Card style={{ gap: space.sm }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Txt variant="h3" style={{ flex: 1 }}>
					{title}
				</Txt>
				{right}
			</View>
			{note ? <Note>{note}</Note> : null}
			{children}
		</Card>
	);
}

export { shortId };

/** What a players list knows about one player: the pid, and the Roblox names when the server has them. */
export interface NamedPlayer {
	pid: string;
	uid?: number;
	name?: string;
	displayName?: string;
}

/** "Display (@name)", "@name", or the short pid when the server knows no name. */
export function playerLabel(x: NamedPlayer): string {
	if (!x.name) return shortId(x.pid, 10);
	return x.displayName && x.displayName !== x.name ? `${x.displayName} (@${x.name})` : `@${x.name}`;
}

/** One player in a list (Funnels, Experiments, Monetization): the name or pid, the UserId, a detail line; a tap opens them. */
export function NamedPlayerRow({ backendId, row, detail, right }: { backendId: string; row: NamedPlayer; detail?: string; right?: ReactNode }) {
	const p = useTheme();
	return (
		<Pressable onPress={() => openPlayer(backendId, row.pid)} android_ripple={{ color: p.accent }} style={({ pressed }) => [{ paddingVertical: 8, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: 8 }, pressed && { backgroundColor: p.accent }]}>
			<View style={{ flex: 1, gap: 2 }}>
				<Txt style={{ fontWeight: "600" }} numberOfLines={1}>
					{playerLabel(row)}
				</Txt>
				<Txt variant="small" numberOfLines={2}>
					{[row.name ? shortId(row.pid, 8) : null, row.uid !== undefined ? `UserId ${row.uid}` : "not linked", detail].filter(Boolean).join(" · ")}
				</Txt>
			</View>
			{right}
			<Icon name="chevron-forward" size={14} color={p.mutedForeground} />
		</Pressable>
	);
}
