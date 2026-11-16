/**
 * The web's hover cards for the phone, opened by a tap or a long press:
 *
 *  - PlayerHover (web components/PlayerHover.tsx): long-press any pid (a tap still opens the player) for the Roblox
 *    headshot, display name, username, UserId and pid (GET /v1/identity/<pid>/profile, asked only once a card opens).
 *  - ProductId (web components/ProductId.tsx): a game pass or developer product id; a tap opens its card (icon, name,
 *    type, Robux price) and, inside a DataTable with `filterColumn`, "Show only this" narrows the table to that id.
 *    ProductKind: a purchase kind that narrows the table to that kind.
 */
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import type { PlayerProfile, RobloxProductInfo } from "@/api/tt/types";
import { Button, Icon, Txt } from "@/components/ui";
import { fmtInt, shortId } from "@/lib/format";
import { radius, space, useTheme } from "@/theme";

import { openPlayer, parseProductId, productTypeOf, useProductInfo, type ProductType } from "./bits";
import { useTTQuery } from "./hooks";
import { Sheet } from "./sheet";
import { useTableFilter, type DataColumn } from "./table";

// Players -----------------------------------------------------------------------------------------------------------------

export interface KnownPlayer {
	uid?: number | undefined;
	name?: string | undefined;
	displayName?: string | undefined;
}

export function usePlayerProfile(backendId: string, pid: string, enabled = true) {
	return useTTQuery<PlayerProfile>(backendId, ["player-profile", pid], (api, signal) => api.playerProfile(pid, signal), { enabled: enabled && !!pid, retry: false, staleTime: 5 * 60_000 });
}

/** The card's body: headshot, names, UserId, pid, and why something is missing. */
export function PlayerCard({ backendId, pid, known = {} }: { backendId: string; pid: string; known?: KnownPlayer }) {
	const p = useTheme();
	const q = usePlayerProfile(backendId, pid);
	const prof = q.data;
	const uid = prof?.linked ? prof.uid : known.uid;
	const name = prof?.name ?? known.name;
	const displayName = prof?.displayName ?? known.displayName;
	const note = q.isPending
		? "Asking Roblox..."
		: q.isError
			? "Profile unavailable."
			: !prof?.linked && uid === undefined
				? "No UserId known for this pid."
				: prof?.roblox === "unavailable"
					? "Roblox didn't answer."
					: prof?.roblox === "not-found"
						? "Not found on Roblox."
						: null;
	return (
		<View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
			{prof?.avatar ? (
				<Image source={{ uri: prof.avatar }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: p.muted }} contentFit="cover" />
			) : (
				<View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
					<Icon name="person-outline" size={24} color={p.mutedForeground} />
				</View>
			)}
			<View style={{ flex: 1, gap: 2 }}>
				<Txt style={{ fontWeight: "600" }} numberOfLines={1}>
					{displayName ?? name ?? "Unknown player"}
				</Txt>
				{name ? <Txt variant="small">@{name}</Txt> : null}
				<Txt variant="small" color={uid !== undefined ? p.foreground : undefined}>
					{uid !== undefined ? `UserId ${uid}` : "UserId not linked"}
				</Txt>
				<Txt variant="mono" selectable style={{ fontSize: 11, color: p.mutedForeground }}>
					{pid}
				</Txt>
				{note ? <Txt variant="small">{note}</Txt> : null}
			</View>
		</View>
	);
}

export function PlayerCardSheet({ backendId, pid, known, open, onClose }: { backendId: string; pid: string; known?: KnownPlayer; open: boolean; onClose(): void }) {
	const q = usePlayerProfile(backendId, pid, open);
	const uid = q.data?.linked ? q.data.uid : known?.uid;
	return (
		<Sheet open={open} onClose={onClose} title="Player">
			<PlayerCard backendId={backendId} pid={pid} {...(known ? { known } : {})} />
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm }}>
				<Button
					title="Open player"
					small
					variant="brand"
					icon="person-outline"
					onPress={() => {
						onClose();
						openPlayer(backendId, pid);
					}}
				/>
				<Button title="Copy pid" small icon="copy-outline" onPress={() => void Clipboard.setStringAsync(pid).then(onClose)} />
				{uid !== undefined ? <Button title="Copy UserId" small icon="copy-outline" onPress={() => void Clipboard.setStringAsync(String(uid)).then(onClose)} /> : null}
			</View>
		</Sheet>
	);
}

/**
 * Wraps a player link: a long press opens the player card (the web's hover). `onPress` keeps the link's own tap
 * (default: open the player).
 */
export function PlayerHover({ backendId, pid, uid, name, displayName, children, onPress }: { backendId: string; pid: string; children: ReactNode; onPress?: () => void } & KnownPlayer) {
	const [open, setOpen] = useState(false);
	const known: KnownPlayer = { ...(uid !== undefined ? { uid } : {}), ...(name ? { name } : {}), ...(displayName ? { displayName } : {}) };
	return (
		<>
			<Pressable onPress={onPress ?? (() => openPlayer(backendId, pid))} onLongPress={() => setOpen(true)} delayLongPress={350} hitSlop={6} accessibilityHint="Long-press for the player card">
				{children}
			</Pressable>
			<PlayerCardSheet backendId={backendId} pid={pid} known={known} open={open} onClose={() => setOpen(false)} />
		</>
	);
}

/** A player list's first columns (the web's PlayerPageLink + UserIdLink): the name or pid (tap: open, long-press: card) and the UserId. */
export function playerColumns<T extends { pid: string; uid?: number | undefined; name?: string | undefined; displayName?: string | undefined }>(backendId: string): DataColumn<T>[] {
	return [
		{
			id: "player",
			header: "Player",
			width: 150,
			accessor: (r) => r.name ?? r.pid,
			searchText: (r) => `${r.pid} ${r.displayName ?? ""} ${r.uid ?? ""}`,
			filter: false,
			cell: (r) => <PlayerCell backendId={backendId} row={r} />,
		},
		{
			id: "uid",
			header: "UserId",
			width: 100,
			type: "number",
			filter: false,
			accessor: (r) => r.uid ?? null,
			format: (v) => (v === null || v === undefined ? "not linked" : String(v)),
			exportValue: (r) => (r.uid !== undefined ? String(r.uid) : ""),
		},
	];
}

function PlayerCell({ backendId, row }: { backendId: string; row: { pid: string; uid?: number | undefined; name?: string | undefined; displayName?: string | undefined } }) {
	const p = useTheme();
	const label = row.name ? (row.displayName && row.displayName !== row.name ? `${row.displayName} (@${row.name})` : `@${row.name}`) : shortId(row.pid, 10);
	return (
		<PlayerHover backendId={backendId} pid={row.pid} uid={row.uid} name={row.name} displayName={row.displayName}>
			<View>
				<Txt variant="small" color={p.brand} numberOfLines={1} style={{ fontWeight: "600" }}>
					{label}
				</Txt>
				{row.name ? (
					<Txt variant="mono" numberOfLines={1} style={{ fontSize: 10, color: p.mutedForeground }}>
						{shortId(row.pid, 10)}
					</Txt>
				) : null}
			</View>
		</PlayerHover>
	);
}

// Products ----------------------------------------------------------------------------------------------------------------

/** Only Roblox's CDN (https, *.rbxcdn.com) is shown as an icon. */
export function productIconUrl(icon: string | null | undefined): string | undefined {
	if (!icon) return undefined;
	const m = /^https:\/\/([^/@:]+)(\/.*)?$/.exec(icon);
	return m && (m[1] as string).endsWith(".rbxcdn.com") ? icon : undefined;
}

export const productTypeLabel = (type: ProductType) => (type === "gamepass" ? "Game pass" : "Developer product");

function ProductCard({ type, id, info, loading }: { type: ProductType; id: number; info: RobloxProductInfo | undefined; loading: boolean }) {
	const p = useTheme();
	const icon = productIconUrl(info?.icon);
	const name = info?.status === "ok" ? info.name : null;
	const note = loading ? "Asking Roblox..." : info?.status === "not_found" ? "Roblox doesn't know this id." : info?.status === "unavailable" || !info ? "Roblox didn't answer." : null;
	const price = info?.status === "ok" ? (info.price !== null ? `${fmtInt(info.price)} Robux` : info.forSale === false ? "Off sale" : "No price") : null;
	return (
		<View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
			{icon ? (
				<Image source={{ uri: icon }} style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: p.muted }} contentFit="cover" />
			) : (
				<View style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
					<Icon name={type === "gamepass" ? "ticket-outline" : "cube-outline"} size={24} color={p.mutedForeground} />
				</View>
			)}
			<View style={{ flex: 1, gap: 2 }}>
				<Txt style={{ fontWeight: "600" }} numberOfLines={2}>
					{name ?? `${productTypeLabel(type)} ${id}`}
				</Txt>
				<Txt variant="small">{productTypeLabel(type)}</Txt>
				{price ? <Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>{price}</Txt> : null}
				{note ? <Txt variant="small">{note}</Txt> : null}
				<Txt variant="mono" selectable style={{ fontSize: 11, color: p.mutedForeground }}>
					{id}
				</Txt>
			</View>
		</View>
	);
}

/**
 * A product id that says what it is: the id (with the name beside it when `showName`); a tap opens the card. With
 * `filterColumn`, inside a DataTable, the card has "Show only this" (that column's checklist with just this id).
 */
export function ProductId({ backendId, id, kind, showName = false, filterColumn }: { backendId: string; id: unknown; kind: string | null | undefined; showName?: boolean; filterColumn?: string }) {
	const p = useTheme();
	const type = productTypeOf(kind);
	const n = parseProductId(id);
	const table = useTableFilter();
	const [open, setOpen] = useState(false);
	const info = useProductInfo(backendId, type, n);
	if (id === null || id === undefined || id === "") return <Txt variant="small">–</Txt>;
	if (!type || n === undefined) {
		return (
			<Txt variant="mono" style={{ fontSize: 12 }}>
				{String(id)}
			</Txt>
		);
	}
	const name = info.data?.status === "ok" ? info.data.name : null;
	const filter = table && filterColumn ? () => table.filterBy(filterColumn, id) : undefined;
	return (
		<>
			<Pressable onPress={() => setOpen(true)} onLongPress={filter} hitSlop={4} accessibilityLabel={`${productTypeLabel(type)} ${n}${name ? `: ${name}` : ""}`} style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexShrink: 1 }}>
				<Txt variant="mono" color={p.foreground} style={{ fontSize: 12, textDecorationLine: "underline", textDecorationStyle: filter ? "solid" : "dotted" }}>
					{n}
				</Txt>
				{showName && name ? (
					<Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
						{name}
					</Txt>
				) : null}
			</Pressable>
			<Sheet open={open} onClose={() => setOpen(false)} title={productTypeLabel(type)}>
				<ProductCard type={type} id={n} info={info.data} loading={info.isPending && info.fetchStatus !== "idle"} />
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm }}>
					{filter ? (
						<Button
							title="Show only this"
							small
							variant="brand"
							icon="filter"
							onPress={() => {
								filter();
								setOpen(false);
							}}
						/>
					) : null}
					<Button title="Copy id" small icon="copy-outline" onPress={() => void Clipboard.setStringAsync(String(n)).then(() => setOpen(false))} />
				</View>
			</Sheet>
		</>
	);
}

/** "Game pass" / "Developer product" (other kinds as logged); inside a DataTable with `filterColumn`, a tap narrows the table to that kind. */
export function ProductKind({ kind, filterColumn }: { kind: string; filterColumn?: string }) {
	const p = useTheme();
	const table = useTableFilter();
	const type = productTypeOf(kind);
	const label = type ? productTypeLabel(type) : kind;
	if (!table || !filterColumn) return <Txt variant="small" color={p.foreground}>{label}</Txt>;
	return (
		<Pressable onPress={() => table.filterBy(filterColumn, kind)} hitSlop={4} accessibilityLabel={`Show only ${label.toLowerCase()} purchases`}>
			<Txt variant="small" color={p.foreground} style={{ textDecorationLine: "underline" }}>
				{label}
			</Txt>
		</Pressable>
	);
}

export { shortId };
