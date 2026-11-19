/**
 * Inside a game, a bottom bar replaces both sidebars (design "C", agreed 2026-11-20): Overview · TypeTorch · Analytics ·
 * Roblox. The tabs' roots are the game's home screen (/project/{id}, its `tab` here in a small store), and every page
 * of a tab is pushed over it: TypeTorch pages are the /tt/{backendId}/… screens, Roblox pages the experience's tools
 * (/project/{id}/{tool}). The bar stays on all of them; the lit tab, its colour (orange TypeTorch, blue Roblox) on the
 * header's label and a thin line under the header say which side you're on.
 *
 * Tapping another tab goes back to the game's home on that tab and, when you left that tab on a page, opens that page
 * again. Tapping the lit tab goes to its list. Long-press: All projects, Settings, Backends. The TypeTorch tab's badge
 * counts what's new since you last looked (errors of the last hour and open alerts from GET /v1/mobile/live, above what
 * they were when you were last on a TypeTorch screen of this game, or their lowest since); being on one marks it read.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, Txt, type IconName } from "@/components/ui";
import { useTTQuery } from "@/features/typetorch/hooks";
import { Sheet, SheetItem } from "@/features/typetorch/sheet";
import { useAccounts } from "@/store/accounts";
import { useTheme, type Palette } from "@/theme";

export type GameTab = "overview" | "typetorch" | "analytics" | "tools";

export const TT_ORANGE = "#f97316";
export const ROBLOX_BLUE = "#3b82f6";

/** The tab's colour: TypeTorch orange, Roblox blue, the text colour for the shared ones. */
export function tabColor(p: Palette, tab: GameTab): string {
	return tab === "typetorch" ? TT_ORANGE : tab === "tools" ? ROBLOX_BLUE : p.foreground;
}

/** The side a tab belongs to, for the header label (null: shared). */
export function tabSide(tab: GameTab): "typetorch" | "roblox" | null {
	return tab === "typetorch" ? "typetorch" : tab === "tools" ? "roblox" : null;
}

const TABS: { tab: GameTab; label: string; icon: IconName; iconOn: IconName }[] = [
	{ tab: "overview", label: "Overview", icon: "home-outline", iconOn: "home" },
	{ tab: "typetorch", label: "TypeTorch", icon: "flame-outline", iconOn: "flame" },
	{ tab: "analytics", label: "Analytics", icon: "stats-chart-outline", iconOn: "stats-chart" },
	{ tab: "tools", label: "Roblox", icon: "construct-outline", iconOn: "construct" },
];

// The home's tab per game, and where each tab was left --------------------------------------------------------------

const homeTab = new Map<number, GameTab>();
const lastPage = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
	version++;
	for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function setHomeTab(universeId: number, tab: GameTab) {
	if (homeTab.get(universeId) === tab) return;
	homeTab.set(universeId, tab);
	emit();
}

/** The game's home tab (the route's `tab` param wins once, when it changes). */
export function useHomeTab(universeId: number, fromRoute: GameTab | undefined, fallback: GameTab): GameTab {
	useSyncExternalStore(subscribe, () => version);
	useEffect(() => {
		if (fromRoute) setHomeTab(universeId, fromRoute === ("roblox" as GameTab) ? "tools" : fromRoute);
	}, [universeId, fromRoute]);
	return homeTab.get(universeId) ?? (fromRoute === ("roblox" as GameTab) ? "tools" : fromRoute) ?? fallback;
}

/** Go to a tab of the game: back to its home on that tab, then the page that tab was left on (if any). */
export function goGameTab(universeId: number, tab: GameTab, current: GameTab) {
	const key = `${universeId}:${tab}`;
	const again = tab === current;
	const page = again ? undefined : lastPage.get(key);
	if (again) lastPage.delete(key);
	setHomeTab(universeId, tab);
	router.dismissTo(`/project/${universeId}?tab=${tab}` as never);
	if (page) router.push(page as never);
}

// What the badge has shown as read, per game ---------------------------------------------------------------------------

const SEEN_KEY = "tt.game-badge.seen.v1";
type Seen = { errors: number; alerts: number };
const seen = new Map<number, Seen>();
let seenLoaded = false;
void AsyncStorage.getItem(SEEN_KEY)
	.then((raw) => {
		const obj = raw ? (JSON.parse(raw) as Record<string, Seen>) : {};
		for (const [k, v] of Object.entries(obj)) if (!seen.has(Number(k))) seen.set(Number(k), v);
	})
	.catch(() => undefined)
	.finally(() => {
		seenLoaded = true;
		emit();
	});
const saveSeen = () => void AsyncStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(seen))).catch(() => undefined);

/**
 * The badge for these live numbers: what rose above the read baseline. The baseline follows the numbers down (an
 * error leaving the hour, an alert resolved), and `read` moves it to now. A game seen for the first time starts read.
 */
function badgeOf(universeId: number, errors: number, alerts: number, read: boolean): number {
	const b = seen.get(universeId);
	if (!b || read || errors < b.errors || alerts < b.alerts) {
		const next = read || !b ? { errors, alerts } : { errors: Math.min(errors, b.errors), alerts: Math.min(alerts, b.alerts) };
		if (!b || next.errors !== b.errors || next.alerts !== b.alerts) {
			seen.set(universeId, next);
			saveSeen();
		}
		return Math.max(0, errors - next.errors) + Math.max(0, alerts - next.alerts);
	}
	return Math.max(0, errors - b.errors) + Math.max(0, alerts - b.alerts);
}

/** The game's TypeTorch backend (the first connected one for this universe), or null. */
export function useGameBackend(universeId: number) {
	const { backendForUniverse } = useAccounts();
	return backendForUniverse(universeId)[0] ?? null;
}

interface LiveHealth {
	errors1h?: number;
	servers?: number;
	serversOk?: number;
	alertsOpen?: number;
}

/** The backend's live numbers for the game's bar and home (CCU, health, last release); a minute fresh. */
export function useGameLive(backendId: string | null) {
	return useTTQuery(backendId ?? "", ["mobile-live", "nav"], (api, signal) => api.mobileLive(30, signal), { enabled: !!backendId, refetchInterval: 60_000, staleTime: 30_000 }) as {
		data?: { ccu?: number; health?: LiveHealth | null; releases?: { lastProd?: string | null; lastProdLabel?: string | null } | null } & Record<string, unknown>;
	};
}

/** The bottom bar of a game's screens. `active`: the tab this screen belongs to. Records the page for the tab's memory. */
export function GameBar({ universeId, active, isHome }: { universeId: number; active: GameTab; isHome?: boolean }) {
	const p = useTheme();
	const insets = useSafeAreaInsets();
	const backend = useGameBackend(universeId);
	const live = useGameLive(backend?.id ?? null);
	const pathname = usePathname();
	const params = useGlobalSearchParams<Record<string, string | string[]>>();
	const [menu, setMenu] = useState(false);

	// Remember this page as where its tab was left (the home itself is the tab's list, nothing to remember).
	useEffect(() => {
		if (isHome) return;
		// A screen under another (the game's stack while a TypeTorch page is on top) sees the top one's path: skip it.
		if (active === "tools" && !pathname.startsWith(`/project/${universeId}/`)) return;
		if (active === "typetorch" && !pathname.startsWith("/tt/")) return;
		const query = Object.entries(params)
			.filter(([k]) => k !== "universeId" && k !== "backendId" && !pathname.includes(`/${String(params[k])}`))
			.flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${encodeURIComponent(k)}=${encodeURIComponent(String(x))}`));
		lastPage.set(`${universeId}:${active}`, `${pathname}${query.length ? `?${query.join("&")}` : ""}`);
	}, [universeId, active, isHome, pathname, params]);

	const h = live.data?.health;
	useSyncExternalStore(subscribe, () => version);
	// On a TypeTorch screen of this game everything counts as read.
	const badge = h && seenLoaded ? badgeOf(universeId, h.errors1h ?? 0, h.alertsOpen ?? 0, active === "typetorch") : 0;
	const tabs = TABS.filter((t) => t.tab !== "typetorch" || backend);
	return (
		<View style={{ flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border, backgroundColor: p.background, paddingBottom: insets.bottom }}>
			{tabs.map((t) => {
				const on = t.tab === active;
				const color = on ? tabColor(p, t.tab) : p.mutedForeground;
				return (
					<Pressable
						key={t.tab}
						onPress={() => goGameTab(universeId, t.tab, active)}
						onLongPress={() => setMenu(true)}
						accessibilityRole="tab"
						accessibilityState={{ selected: on }}
						accessibilityLabel={t.label}
						style={{ flex: 1, alignItems: "center", paddingTop: 7, paddingBottom: 6, gap: 2 }}
					>
						<View>
							<Icon name={on ? t.iconOn : t.icon} size={21} color={color} />
							{t.tab === "typetorch" && badge > 0 ? (
								<View style={{ position: "absolute", top: -4, left: 13, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: p.destructive, alignItems: "center", justifyContent: "center" }}>
									<Txt style={{ color: "#fff", fontSize: 10, fontWeight: "700", lineHeight: 13 }}>{badge > 99 ? "99+" : String(badge)}</Txt>
								</View>
							) : null}
						</View>
						<Txt style={{ fontSize: 11, fontWeight: on ? "700" : "500", color }}>{t.label}</Txt>
					</Pressable>
				);
			})}
			<Sheet open={menu} onClose={() => setMenu(false)} title="Go to">
				<SheetItem
					icon="grid-outline"
					label="All projects"
					onPress={() => {
						setMenu(false);
						if (router.canDismiss()) router.dismissTo("/");
						else router.replace("/");
					}}
				/>
				<SheetItem
					icon="settings-outline"
					label="Settings"
					onPress={() => {
						setMenu(false);
						router.push("/app-settings");
					}}
				/>
				<SheetItem
					icon="flame-outline"
					label="Backends"
					onPress={() => {
						setMenu(false);
						router.push("/app-backends");
					}}
				/>
			</Sheet>
		</View>
	);
}

/** The header's background: the page colour with a thin line in the tab's colour (none for the shared tabs). */
export function headerLine(p: Palette, tab: GameTab) {
	const side = tabSide(tab);
	return () => <View style={{ flex: 1, backgroundColor: p.background, borderBottomWidth: side ? 2 : 0, borderColor: side ? tabColor(p, tab) : "transparent" }} />;
}

/** "TypeTorch" / "Roblox" as a small coloured label before the page name in the header. */
export function SideLabel({ tab }: { tab: GameTab }) {
	const side = tabSide(tab);
	if (!side) return null;
	const color = side === "typetorch" ? TT_ORANGE : ROBLOX_BLUE;
	return (
		<View style={{ backgroundColor: `${color}26`, borderRadius: 999, paddingHorizontal: 6, marginRight: 5 }}>
			<Txt style={{ color: side === "typetorch" ? TT_ORANGE : "#60a5fa", fontSize: 10, fontWeight: "700" }}>{side === "typetorch" ? "TypeTorch" : "Roblox"}</Txt>
		</View>
	);
}
