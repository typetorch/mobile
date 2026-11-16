/**
 * The web explorer's frame pieces for the phone (web components/AppShell.tsx, PlaceCard.tsx, CommandPalette.tsx,
 * Identity.tsx FindPlayer; lib/commands.ts):
 *
 *   - HealthDot: the server status in every TypeTorch header (GET /healthz every 30 s; "server down" for 502 / 504 /
 *     unreachable, "no admin token" for 503); a tap says what it is.
 *   - PlaceCard: the game's icon, name and live players (GET /v1/place every minute), a tap opens it on roblox.com.
 *   - CommandPalette: the header's search button (the web's Ctrl+K): every page this role may see, the range presets,
 *     Clear filters, Copy link to this view (typetorch:// in Expo Go too), Refresh data, the theme, Sign out (this
 *     backend's token, behind a confirm), "Open player <id>" (and Find player: a pid, part of one or a UserId opens the
 *     Players page's `find`, which resolves a UserId through GET /v1/identity?uid=), and the page's own commands
 *     ("Copy this player's pid" on a player). Fuzzy matching and the recent list (kept on the phone) as the web's.
 */
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { router, usePathname } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { ApiError } from "@/api/backend";
import type { PlaceCardInfo } from "@/api/tt/types";
import { confirm, Dot, Field, Icon, Txt, type IconName } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import { useAccounts, type BackendAccount } from "@/store/accounts";
import { radius, space, useTheme } from "@/theme";

import { DEFAULT_RANGE, RANGE_LABELS, RANGE_PRESETS, setTTFilters, currentTTFilters, type FilterState } from "./filters";
import { useTTQuery } from "./hooks";
import { pageHref, TT_GROUPS, TT_PAGES } from "./pages";
import { readStoredJson, writeStored } from "./persist";
import { Sheet } from "./sheet";
import { toAppLink, useViewLink, type ViewLinkRegistry } from "./view-link";

// Health ---------------------------------------------------------------------------------------------------------------

export function useHealth(backendId: string) {
	return useTTQuery(backendId, ["health"], (api, s) => api.health(s), { refetchInterval: 30_000, retry: false });
}

/** The web's ServerStatus line: tone, text and the detail. */
export function healthText(health: ReturnType<typeof useHealth>): { tone: "good" | "critical" | "muted"; text: string; detail: string } {
	if (health.error) {
		const e = health.error;
		const text = e instanceof ApiError && e.status === 503 ? "no admin token" : e instanceof ApiError && (e.status === 502 || e.status === 504 || e.status === 0) ? "server down" : "error";
		return { tone: "critical", text, detail: e.message };
	}
	if (health.data) {
		const live = health.data.analytics?.live;
		return {
			tone: "good",
			text: live ? `connected · ${fmtInt(live.events)} live rows` : "connected",
			detail: [health.data.runtime, health.data.rssMb ? `${health.data.rssMb} MB` : ""].filter(Boolean).join(", "),
		};
	}
	return { tone: "muted", text: "connecting", detail: "" };
}

export function HealthDot({ backendId }: { backendId: string }) {
	const health = useHealth(backendId);
	const [open, setOpen] = useState(false);
	const h = healthText(health);
	return (
		<>
			<Pressable onPress={() => setOpen(true)} hitSlop={10} accessibilityLabel={`Server status: ${h.text}`} style={{ paddingHorizontal: 4, justifyContent: "center" }}>
				<Dot tone={h.tone} size={9} />
			</Pressable>
			<Sheet open={open} onClose={() => setOpen(false)} title="Server status">
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Dot tone={h.tone} />
					<Txt>{h.text}</Txt>
				</View>
				{h.detail ? <Txt variant="small">{h.detail}</Txt> : null}
				<Txt variant="small">Checked every 30 s (GET /healthz).</Txt>
			</Sheet>
		</>
	);
}

// Place card -----------------------------------------------------------------------------------------------------------

type Place = Extract<PlaceCardInfo, { configured: true }>;

function gameUrl(place: Place): string | undefined {
	return place.url && /^https:\/\/www\.roblox\.com\/games\/\d{1,20}$/.test(place.url) ? place.url : undefined;
}

function iconUrl(place: Place): string | undefined {
	if (!place.icon) return undefined;
	try {
		const u = new URL(place.icon);
		return u.protocol === "https:" && u.hostname.endsWith(".rbxcdn.com") ? u.toString() : undefined;
	} catch {
		return undefined;
	}
}

export function usePlace(backendId: string): Place | undefined {
	const q = useTTQuery(backendId, ["place"], (api, s) => api.place(s), { refetchInterval: 60_000, staleTime: 30_000, retry: false });
	return q.data?.configured ? q.data : undefined;
}

/** The game's icon, name and live players; a tap opens the game on roblox.com. Nothing while the backend knows no place. */
export function PlaceCard({ backendId }: { backendId: string }) {
	const p = useTheme();
	const place = usePlace(backendId);
	if (!place) return null;
	const name = place.name ?? "Your game";
	const href = gameUrl(place);
	const src = iconUrl(place);
	return (
		<Pressable
			disabled={!href}
			onPress={() => href && void Linking.openURL(href)}
			style={{ flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 1, borderColor: p.border, borderRadius: radius.lg, padding: 8, backgroundColor: p.card }}
			accessibilityLabel={`${name} on Roblox`}
		>
			{src ? (
				<Image source={{ uri: src }} style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: p.muted }} />
			) : (
				<View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
					<Icon name="game-controller-outline" size={22} color={p.mutedForeground} />
				</View>
			)}
			<View style={{ flex: 1, gap: 3 }}>
				<Txt style={{ fontWeight: "600" }} numberOfLines={2}>
					{name}
				</Txt>
				{place.playing !== null ? (
					<View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
						<Dot tone="good" size={6} />
						<Txt variant="small">
							{fmtInt(place.playing)} live{place.playingFrom === "fleet" ? " (from your servers' heartbeats)" : ""}
						</Txt>
					</View>
				) : null}
			</View>
			{href ? <Icon name="open-outline" size={16} color={p.mutedForeground} /> : null}
		</Pressable>
	);
}

// Commands -------------------------------------------------------------------------------------------------------------

export interface CommandContext {
	backendId: string;
	pageKey: string;
	/** The page's own route param (a player's pid). */
	pid?: string | undefined;
	admin: boolean;
	filtersOn: boolean;
	navigate(to: string): void;
	setFilters(patch: Partial<FilterState>): void;
	resetFilters(): void;
	appearance: "system" | "dark" | "light";
	resolved: "dark" | "light";
	setAppearance(a: "system" | "dark" | "light"): void;
	refresh(): void;
	copyLink(): Promise<void>;
	copy(text: string): Promise<void>;
	signOut(): Promise<void>;
}

export interface Command {
	id: string;
	title: string;
	group: string;
	keywords?: string[];
	icon?: IconName;
	when?(ctx: CommandContext): boolean;
	run(ctx: CommandContext): void | Promise<void>;
}

export const GROUP_ORDER = ["Recent", "Player", "This page", "Pages", "Date range", "Filters", "View", "Account"];

/** Pages without the shared filter bar (web nav `noFilters`): no range or Clear filters commands there. */
const NO_FILTERS = new Set(["notifications", "feedback", "live-events", "fleet", "server", "server-map", "bundle", "live", "deploys", "deploy", "errors", "error", "settings", "backend-stats", "audit", "server-history"]);

const UID = /^\d{1,16}$/;
const PID = /^[A-Za-z0-9_-]{8,64}$/;

/** A Roblox UserId (digits) or a pid (8+ characters with a digit, or 16+ long). */
export function looksLikePlayer(text: string): boolean {
	const t = text.trim();
	if (UID.test(t)) return true;
	return PID.test(t) && (/\d/.test(t) || t.length >= 16);
}

/** "Open player <text>" for text that looks like a player (the Players page's `find` resolves it). */
export function playerCommand(query: string): Command | undefined {
	const text = query.trim();
	if (!looksLikePlayer(text)) return undefined;
	return { id: "player:find", title: `Open player ${text}`, group: "Player", icon: "person-circle-outline", run: (ctx) => ctx.navigate(`/tt/${ctx.backendId}/players?find=${encodeURIComponent(text)}`) };
}

const groupLabel = new Map(TT_GROUPS.map((g) => [g.id, g.label ?? ""]));

export function builtinCommands(): Command[] {
	const pages: Command[] = TT_PAGES.filter((x) => x.status === "ready").map((x) => ({
		id: `nav:${x.key}`,
		title: x.title,
		group: "Pages",
		icon: x.icon,
		keywords: ["go", "open", "page", x.key, groupLabel.get(x.group) ?? "", x.description].filter(Boolean),
		when: (ctx) => !x.adminOnly || ctx.admin,
		run: (ctx) => ctx.navigate(pageHref(ctx.backendId, x.key)),
	}));
	const ranges: Command[] = RANGE_PRESETS.map((range) => ({
		id: `range:${range}`,
		title: RANGE_LABELS[range],
		group: "Date range",
		icon: "calendar-outline",
		keywords: ["date", "range", "time", range, ...(range === DEFAULT_RANGE ? ["default"] : [])],
		when: (ctx) => ctx.filtersOn,
		run: (ctx) => ctx.setFilters({ range, from: undefined, to: undefined }),
	}));
	return [
		...pages,
		...ranges,
		{ id: "filters:clear", title: "Clear filters", icon: "funnel-outline", group: "Filters", keywords: ["reset", "branch", "build", "device", "players", "variant"], when: (ctx) => ctx.filtersOn, run: (ctx) => ctx.resetFilters() },
		{ id: "view:copy-link", title: "Copy link to this view", icon: "link-outline", group: "View", keywords: ["share", "url", "clipboard", "address", "typetorch"], run: (ctx) => ctx.copyLink() },
		{ id: "view:refresh", title: "Refresh data", group: "View", icon: "refresh", keywords: ["reload", "fetch", "update"], run: (ctx) => ctx.refresh() },
		{ id: "view:theme-toggle", title: "Toggle theme", icon: "contrast-outline", group: "View", keywords: ["dark", "light", "mode", "appearance"], run: (ctx) => ctx.setAppearance(ctx.resolved === "dark" ? "light" : "dark") },
		{ id: "view:theme-system", title: "Use the system theme", icon: "phone-portrait-outline", group: "View", keywords: ["theme", "auto", "dark", "light", "mode"], when: (ctx) => ctx.appearance !== "system", run: (ctx) => ctx.setAppearance("system") },
		{ id: "account:sign-out", title: "Sign out", icon: "log-out-outline", group: "Account", keywords: ["log out", "logout", "session", "disconnect"], run: (ctx) => ctx.signOut() },
		// The web's Players page command (registered while a player is open).
		{ id: "players:copy-pid", title: "Copy this player's pid", group: "This page", icon: "copy-outline", keywords: ["clipboard", "player", "id"], when: (ctx) => ctx.pageKey === "player" && !!ctx.pid, run: (ctx) => ctx.copy(ctx.pid as string) },
	];
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_/&(]/.test(text[i - 1] ?? "");

/** How well `query` (one word) matches `text`: null for no match, higher is better (web lib/commands.ts). */
export function fuzzyScore(query: string, text: string): number | null {
	const q = query.trim().toLowerCase();
	const t = text.toLowerCase();
	if (!q) return 0;
	const at = t.indexOf(q);
	if (at >= 0) {
		let score = 1000 - at;
		if (at === 0) score += 300;
		else if (isBoundary(t, at)) score += 200;
		if (q.length === t.length) score += 100;
		return score;
	}
	let score = 0;
	let from = 0;
	let prev = -2;
	for (const ch of q) {
		const i = t.indexOf(ch, from);
		if (i < 0) return null;
		score += 10;
		if (i === prev + 1) score += 15;
		if (isBoundary(t, i)) score += 20;
		if (prev >= 0) score -= Math.min(i - prev - 1, 10);
		prev = i;
		from = i + 1;
	}
	return score;
}

export function scoreCommand(command: Pick<Command, "title" | "keywords" | "group">, query: string): number | null {
	const words = query.trim().split(/\s+/).filter(Boolean);
	if (!words.length) return 0;
	const other = [...(command.keywords ?? []), command.group].join(" ");
	let total = 0;
	for (const word of words) {
		const title = fuzzyScore(word, command.title);
		const rest = fuzzyScore(word, other);
		const best = Math.max(title ?? -Infinity, rest === null ? -Infinity : rest * 0.6);
		if (best === -Infinity) return null;
		total += best;
	}
	return total;
}

export interface CommandGroup {
	group: string;
	commands: Command[];
}

function byGroupOrder(a: string, b: string): number {
	const ia = GROUP_ORDER.indexOf(a);
	const ib = GROUP_ORDER.indexOf(b);
	return (ia < 0 ? GROUP_ORDER.length : ia) - (ib < 0 ? GROUP_ORDER.length : ib);
}

export function rankCommands(commands: readonly Command[], query: string, ctx: CommandContext, recent: readonly string[] = []): CommandGroup[] {
	const visible = commands.filter((c) => !c.when || c.when(ctx));
	const groups = new Map<string, Command[]>();
	const add = (group: string, c: Command) => {
		const list = groups.get(group);
		if (list) list.push(c);
		else groups.set(group, [c]);
	};
	if (!query.trim()) {
		const byId = new Map(visible.map((c) => [c.id, c]));
		const recentCommands = recent.map((id) => byId.get(id)).filter((c): c is Command => !!c);
		const taken = new Set(recentCommands.map((c) => c.id));
		for (const c of recentCommands) add("Recent", c);
		const rest = visible.filter((c) => !taken.has(c.id));
		const order = [...new Set(rest.map((c) => c.group))].sort(byGroupOrder);
		for (const g of order) for (const c of rest) if (c.group === g) add(g, c);
		return [...groups].map(([group, list]) => ({ group, commands: list }));
	}
	const scored = visible
		.map((c, i) => ({ c, i, score: scoreCommand(c, query) }))
		.filter((s): s is { c: Command; i: number; score: number } => s.score !== null)
		.sort((a, b) => b.score - a.score || a.i - b.i);
	for (const { c } of scored) add(c.group, c);
	return [...groups].map(([group, list]) => ({ group, commands: list }));
}

const RECENT_KEY = "tt.recent-commands.v1";
export const RECENT_MAX = 5;

/** The palette (a sheet behind the header's search button). */
export function CommandPalette({ account, registry }: { account: BackendAccount; registry: ViewLinkRegistry }) {
	const p = useTheme();
	const backendId = account.id;
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [recent, setRecent] = useState<string[]>([]);
	const [flash, setFlash] = useState("");
	const pathname = usePathname();
	const queryClient = useQueryClient();
	const { prefs, setPrefs, removeBackend } = useAccounts();
	const resolved = useTheme().scheme;
	const view = useViewLink(backendId, account.url, registry);
	useEffect(() => {
		if (!open) return;
		void readStoredJson<string[]>(RECENT_KEY).then((list) => setRecent(Array.isArray(list) ? list.filter((v) => typeof v === "string").slice(0, RECENT_MAX) : []));
	}, [open]);
	const parts = pathname.split("/");
	const pageKey = parts[3] ?? "overview";
	const ctx: CommandContext = {
		backendId,
		pageKey,
		pid: pageKey === "player" && parts[4] ? decodeURIComponent(parts[4]) : undefined,
		admin: account.role === "admin",
		filtersOn: !NO_FILTERS.has(pageKey),
		navigate: (to) => router.push(to as never),
		setFilters: (patch) => setTTFilters(backendId, { ...currentTTFilters(backendId), ...patch }),
		resetFilters: () => setTTFilters(backendId, { range: currentTTFilters(backendId).range }),
		appearance: prefs.appearance,
		resolved,
		setAppearance: (a) => void setPrefs({ appearance: a }),
		refresh: () => void queryClient.refetchQueries({ queryKey: ["tt", backendId], type: "active" }),
		copyLink: async () => {
			// In Expo Go the plain link is exp:// (this dev server only): the typetorch:// form opens in the installed app.
			const url = view.link();
			await Clipboard.setStringAsync(view.expoGo ? toAppLink(url) : url);
			setFlash(view.expoGo ? "Copied the typetorch:// link" : "Copied the link");
		},
		copy: async (text) => {
			await Clipboard.setStringAsync(text);
			setFlash("Copied");
		},
		signOut: async () => {
			if (!(await confirm("Sign out of this backend?", "The backend revokes this phone's token and the app forgets the backend. Connect it again to come back.", "Sign out"))) return;
			await removeBackend(backendId);
			router.replace("/backends");
		},
	};
	const commands = useMemo(() => builtinCommands(), []);
	const player = playerCommand(query);
	const groups = rankCommands(player ? [player, ...commands] : commands, query, ctx, recent);
	const run = async (c: Command) => {
		const next = [c.id, ...recent.filter((v) => v !== c.id)].slice(0, RECENT_MAX);
		setRecent(next);
		writeStored(RECENT_KEY, JSON.stringify(next));
		const keepOpen = c.id === "view:copy-link" || c.id === "players:copy-pid";
		if (!keepOpen) {
			setOpen(false);
			setQuery("");
		}
		await c.run(ctx);
		if (keepOpen) setTimeout(() => setOpen(false), 700);
	};
	const findPlayer = () => {
		const text = query.trim();
		if (!text) return;
		setOpen(false);
		setQuery("");
		router.push(`/tt/${backendId}/players?find=${encodeURIComponent(text)}` as never);
	};
	return (
		<>
			<Pressable onPress={() => setOpen(true)} hitSlop={10} accessibilityLabel="Command palette" style={{ paddingHorizontal: 4 }}>
				<Icon name="search" size={19} color={p.foreground} />
			</Pressable>
			<Sheet
				open={open}
				onClose={() => {
					setOpen(false);
					setFlash("");
				}}
				title="Go to, find, do"
				subtitle="Pages, date ranges, filters, the view, a player (pid or UserId)"
			>
				<Field value={query} onChangeText={setQuery} placeholder="Type a page, a command, a pid or a UserId" autoFocus returnKeyType="go" onSubmitEditing={() => (groups[0]?.commands[0] ? void run(groups[0].commands[0]) : findPlayer())} />
				{flash ? <Txt variant="small">{flash}</Txt> : null}
				{query.trim() && !player ? (
					<Pressable onPress={findPlayer} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 9 }}>
						<Icon name="person-circle-outline" size={18} />
						<Txt style={{ flex: 1 }}>Find player “{query.trim()}” (part of a pid or a UserId)</Txt>
					</Pressable>
				) : null}
				{groups.map((g) => (
					<View key={g.group} style={{ gap: 2 }}>
						<Txt variant="label">{g.group}</Txt>
						{g.commands.map((c) => (
							<Pressable
								key={`${g.group}:${c.id}`}
								onPress={() => void run(c)}
								android_ripple={{ color: p.accent }}
								style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 9, paddingHorizontal: 4, borderRadius: radius.md }, pressed && { backgroundColor: p.accent }]}
							>
								{c.icon ? <Icon name={c.icon} size={18} /> : <View style={{ width: 18 }} />}
								<Txt style={{ flex: 1 }}>{c.title}</Txt>
							</Pressable>
						))}
					</View>
				))}
				{!groups.length && !query.trim() ? null : !groups.length ? <Txt variant="muted">No command matches.</Txt> : null}
			</Sheet>
		</>
	);
}
