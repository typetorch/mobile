/**
 * Navigation like the web explorer's, for the TypeTorch dashboard and for an experience's own pages: a sidebar (the
 * web's page groups; for an experience, its tabs and Creator Hub tools), a project picker as the header title (switch to
 * another project on the same kind of page, or go home) and a home button. Top-level pages get the menu instead of a
 * back arrow; detail pages (an error, a player, a server, a data store entry) keep their back arrow.
 */
import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Dimensions, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameIcon } from "@/components/ProjectRow";
import { Icon, Txt, type IconName } from "@/components/ui";
import { useAddedIds } from "@/features/project/pins";
import { useAddedProjects, useProject } from "@/features/project/projects";
import { TOOL_SECTIONS } from "@/features/project/tools";
import { useAccounts, type BackendAccount } from "@/store/accounts";
import { radius, space, useTheme } from "@/theme";

import { pageHref, TT_PAGES, visiblePages } from "./pages";
import { Sheet, SheetItem } from "./sheet";

// Where am I -----------------------------------------------------------------------------------------------------------

/** TypeTorch detail routes and the page they belong to (highlighted in the sidebar). */
const TT_PARENT: Record<string, string> = { error: "errors", deploy: "deploys", server: "fleet", "server-map": "fleet", bundle: "fleet", player: "players" };

/** The current dashboard page's key and whether this is a detail screen (deeper than a page). */
export function useCurrentPage(): { key: string; detail: boolean } {
	const segments = useSegments() as string[];
	const i = segments.indexOf("[backendId]");
	const first = i >= 0 ? segments[i + 1] : undefined;
	if (!first || first === "index") return { key: "overview", detail: false };
	if (TT_PARENT[first]) return { key: TT_PARENT[first], detail: true };
	return { key: first, detail: segments.length > i + 2 };
}

/** An experience's detail routes (one item of a list page) and the tool they belong to. */
export const PROJECT_DETAIL: Record<string, string> = {
	alert: "alerts",
	badge: "monetization",
	pass: "monetization",
	product: "monetization",
	dashboard: "dashboards",
	datastore: "datastores",
	entry: "datastores",
	error: "errors",
	event: "events",
	experiment: "experiments",
	notification: "notifications",
	place: "places",
	server: "servers",
};

type ProjectTab = "overview" | "analytics" | "tools" | "typetorch";

/** The experience page's key: a tab of its home ("tab:overview"), or a tool's route. */
function useProjectPageKey(): string {
	const segments = useSegments() as string[];
	const params = useGlobalSearchParams<{ tab?: string }>();
	const i = segments.indexOf("[universeId]");
	const first = i >= 0 ? segments[i + 1] : undefined;
	if (!first || first === "index") return `tab:${params.tab ?? "home"}`;
	return PROJECT_DETAIL[first] ?? first;
}

export function goHome() {
	if (router.canDismiss()) router.dismissTo("/");
	else router.replace("/");
}

// Header pieces --------------------------------------------------------------------------------------------------------

function HeaderIcon({ name, label, onPress }: { name: IconName; label: string; onPress(): void }) {
	const p = useTheme();
	return (
		<Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} style={{ padding: 2 }}>
			<Icon name={name} size={22} color={p.foreground} />
		</Pressable>
	);
}

/** headerLeft for a top-level page: the sidebar button and home. */
function NavLeft({ drawer }: { drawer: (open: boolean, close: () => void) => ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginRight: 8 }}>
			<HeaderIcon name="menu" label="Open the page menu" onPress={() => setOpen(true)} />
			<HeaderIcon name="home-outline" label="Home: your projects" onPress={goHome} />
			{drawer(open, () => setOpen(false))}
		</View>
	);
}

export function TTNavLeft({ account }: { account: BackendAccount }) {
	return <NavLeft drawer={(open, close) => <TTSidebar account={account} open={open} onClose={close} />} />;
}

export function ProjectNavLeft({ universeId }: { universeId: number }) {
	return <NavLeft drawer={(open, close) => <ProjectSidebar universeId={universeId} open={open} onClose={close} />} />;
}

// The drawer -----------------------------------------------------------------------------------------------------------

interface NavItem {
	key: string;
	title: string;
	icon: IconName;
	href: string;
	disabled?: boolean;
	/** Instead of navigating (a tab of the screen already open). */
	onPress?: () => void;
}

interface NavGroup {
	id: string;
	label?: string;
	items: NavItem[];
}

function Drawer({ open, onClose, title, subtitle, icon, groups, active }: { open: boolean; onClose(): void; title: string; subtitle?: string; icon: ReactNode; groups: NavGroup[]; active: string }) {
	const p = useTheme();
	const insets = useSafeAreaInsets();
	const width = Math.min(320, Dimensions.get("window").width * 0.82);
	const x = useRef(new Animated.Value(-width)).current;
	const [shown, setShown] = useState(open);
	useEffect(() => {
		if (open) setShown(true);
		Animated.timing(x, { toValue: open ? 0 : -width, duration: 180, useNativeDriver: true }).start(({ finished }) => {
			if (finished && !open) setShown(false);
		});
	}, [open, width, x]);
	if (!shown) return null;
	const go = (item: NavItem) => {
		onClose();
		if (item.onPress) item.onPress();
		else router.replace(item.href as never);
	};
	return (
		<Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
			<Pressable style={[StyleSheet.absoluteFill, { backgroundColor: "#00000066" }]} onPress={onClose} accessibilityLabel="Close the menu" />
			<Animated.View
				style={{
					position: "absolute",
					top: 0,
					bottom: 0,
					left: 0,
					width,
					backgroundColor: p.background,
					borderRightWidth: StyleSheet.hairlineWidth,
					borderColor: p.border,
					paddingTop: insets.top + space.md,
					paddingBottom: insets.bottom,
					transform: [{ translateX: x }],
				}}
			>
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
					{icon}
					<View style={{ flex: 1 }}>
						<Txt style={{ fontWeight: "700" }} numberOfLines={1}>
							{title}
						</Txt>
						{subtitle ? (
							<Txt variant="small" numberOfLines={1}>
								{subtitle}
							</Txt>
						) : null}
					</View>
				</View>
				<ScrollView contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: space.lg }}>
					{groups.map((g) => (
						<View key={g.id} style={{ marginBottom: space.sm }}>
							{g.label ? (
								<Txt variant="small" style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
									{g.label}
								</Txt>
							) : null}
							{g.items.map((item) => {
								const on = item.key === active;
								return (
									<Pressable
										key={item.key}
										disabled={item.disabled}
										onPress={() => go(item)}
										android_ripple={{ color: p.accent }}
										style={({ pressed }) => [
											{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 9, paddingHorizontal: space.md, borderRadius: radius.md, opacity: item.disabled ? 0.45 : 1 },
											(on || pressed) && { backgroundColor: p.accent },
										]}
									>
										<Icon name={item.icon} size={18} color={on ? p.brand : p.mutedForeground} />
										<Txt style={{ flex: 1, fontWeight: on ? "600" : "400" }} numberOfLines={1}>
											{item.title}
										</Txt>
									</Pressable>
								);
							})}
						</View>
					))}
				</ScrollView>
				<View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border, paddingHorizontal: space.sm, paddingTop: space.sm }}>
					<SheetItem
						icon="home-outline"
						label="Your projects"
						onPress={() => {
							onClose();
							goHome();
						}}
					/>
					<SheetItem
						icon="flame-outline"
						label="Backends"
						onPress={() => {
							onClose();
							router.navigate("/backends");
						}}
					/>
				</View>
			</Animated.View>
		</Modal>
	);
}

/** The dashboard's sidebar: the web's page groups, then the experience's own pages. */
function TTSidebar({ account, open, onClose }: { account: BackendAccount; open: boolean; onClose(): void }) {
	const p = useTheme();
	const { key } = useCurrentPage();
	const groups: NavGroup[] = visiblePages(account.role === "admin").map((g) => ({
		id: g.id,
		label: g.label,
		items: g.pages.map((page) => ({ key: page.key, title: page.title, icon: page.icon, href: pageHref(account.id, page.key), disabled: page.status !== "ready" })),
	}));
	if (account.universeId) {
		const u = account.universeId;
		groups.push({
			id: "experience",
			label: "Experience (Roblox)",
			items: [
				{ key: "x:overview", title: "Overview", icon: "information-circle-outline", href: `/project/${u}?tab=overview` },
				{ key: "x:analytics", title: "Analytics", icon: "stats-chart-outline", href: `/project/${u}?tab=analytics` },
				{ key: "x:tools", title: "Creator Hub tools", icon: "construct-outline", href: `/project/${u}?tab=tools` },
			],
		});
	}
	return (
		<Drawer
			open={open}
			onClose={onClose}
			title={account.name}
			subtitle={`${account.url.replace(/^https?:\/\//, "")} · ${account.role === "admin" ? "owner" : "read-only"}`}
			icon={<Icon name="flame" size={20} color={p.brand} />}
			groups={groups}
			active={key}
		/>
	);
}

/** An experience's sidebar: its home tabs, its TypeTorch dashboard, and every Creator Hub tool grouped like Creator Hub. */
function ProjectSidebar({ universeId, open, onClose }: { universeId: number; open: boolean; onClose(): void }) {
	const project = useProject(universeId);
	const { backends } = useAccounts();
	const active = useProjectPageKey();
	const segments = useSegments() as string[];
	const onHome = segments[segments.length - 1] === "index" || segments[segments.length - 1] === "[universeId]";
	const backend = backends.find((b) => b.universeId === universeId) ?? null;
	const tab = (t: ProjectTab): NavItem => ({
		key: `tab:${t}`,
		title: t === "overview" ? "Overview" : t === "analytics" ? "Analytics" : "Tools",
		icon: t === "overview" ? "information-circle-outline" : t === "analytics" ? "stats-chart-outline" : "construct-outline",
		href: `/project/${universeId}?tab=${t}`,
		// On the experience's home already: switch its tab in place.
		onPress: onHome ? () => router.setParams({ tab: t }) : undefined,
	});
	const groups: NavGroup[] = [
		{
			id: "home",
			items: [
				tab("overview"),
				tab("analytics"),
				tab("tools"),
				...(backend ? [{ key: "tt", title: "TypeTorch dashboard", icon: "flame-outline" as IconName, href: `/tt/${backend.id}` }] : []),
			],
		},
		...TOOL_SECTIONS.map((s) => ({
			id: s.title,
			label: s.title,
			items: s.tools.map((t) => ({ key: t.route.split("?")[0], title: t.title, icon: t.icon, href: `/project/${universeId}/${t.route}` })),
		})),
	];
	// The home's default tab has no param: highlight what it shows.
	const shown = active === "tab:home" ? (backend ? "tab:overview" : "tab:overview") : active;
	return (
		<Drawer
			open={open}
			onClose={onClose}
			title={project.data?.name ?? `Universe ${universeId}`}
			subtitle={project.data ? `${project.data.creator.name} · ${universeId}` : String(universeId)}
			icon={<GameIcon uri={project.data?.icon} size={28} />}
			groups={groups}
			active={shown}
		/>
	);
}

// The project picker ---------------------------------------------------------------------------------------------------

type PickerContext = { kind: "tt"; account: BackendAccount } | { kind: "project"; universeId: number };

function PickerTitle({ name, page, context }: { name: string; page: string; context: PickerContext }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Pressable onPress={() => setOpen(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${name}, ${page}. Switch project`} style={{ maxWidth: 220 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
					<Txt style={{ fontWeight: "700", fontSize: 16, flexShrink: 1 }} numberOfLines={1}>
						{name}
					</Txt>
					<Icon name="chevron-down" size={14} color={p.mutedForeground} />
				</View>
				<Txt variant="small" numberOfLines={1}>
					{page}
				</Txt>
			</Pressable>
			<ProjectPicker context={context} open={open} onClose={() => setOpen(false)} />
		</>
	);
}

/** The dashboard's header title: the backend's game, the page under it. */
export function ProjectPickerTitle({ account, page }: { account: BackendAccount; page: string }) {
	return <PickerTitle name={account.name} page={page} context={{ kind: "tt", account }} />;
}

/** An experience page's header title: the experience, the page under it. */
export function ProjectPagePickerTitle({ universeId, page }: { universeId: number; page: string }) {
	const project = useProject(universeId);
	return <PickerTitle name={project.data?.name ?? "Experience"} page={page} context={{ kind: "project", universeId }} />;
}

/** Your projects (current one ticked), and dashboards whose game isn't on the list; home on top. */
function ProjectPicker({ context, open, onClose }: { context: PickerContext; open: boolean; onClose(): void }) {
	const p = useTheme();
	const { backends } = useAccounts();
	const { key } = useCurrentPage();
	const added = useAddedIds();
	const projects = useAddedProjects(open ? added.ids : []);
	if (!open) return null;
	const currentUniverse = context.kind === "tt" ? context.account.universeId : context.universeId;
	const list = projects.data?.projects ?? [];
	const listed = new Set(list.map((x) => x.universeId));
	const looseBackends = backends.filter((b) => !b.universeId || !listed.has(b.universeId));
	const samePage = (backendId: string) => pageHref(backendId, TT_PAGES.some((x) => x.key === key) ? key : "overview");

	function pick(universeId: number) {
		onClose();
		if (universeId === currentUniverse) return;
		const backend = backends.find((b) => b.universeId === universeId);
		// In the dashboard: the other game's dashboard on the same page when it has one. Else the experience's page.
		if (context.kind === "tt" && backend) router.replace(samePage(backend.id) as never);
		else router.replace(`/project/${universeId}` as never);
	}

	const line = (k: string, here: boolean, left: ReactNode, title: string, subtitle: string | null, onPress: () => void, flame: boolean) => (
		<Pressable
			key={k}
			onPress={onPress}
			android_ripple={{ color: p.accent }}
			style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8, paddingHorizontal: 4, borderRadius: radius.md }, (pressed || here) && { backgroundColor: p.accent }]}
		>
			{left}
			<View style={{ flex: 1 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<Txt style={{ fontWeight: here ? "600" : "400", flexShrink: 1 }} numberOfLines={1}>
						{title}
					</Txt>
					{flame ? <Icon name="flame" size={12} color={p.brand} /> : null}
				</View>
				{subtitle ? (
					<Txt variant="small" numberOfLines={1}>
						{subtitle}
					</Txt>
				) : null}
			</View>
			{here ? <Icon name="checkmark" size={18} color={p.brand} /> : null}
		</Pressable>
	);

	return (
		<Sheet open onClose={onClose} title="Switch project">
			<SheetItem
				icon="home-outline"
				label="Home: your projects"
				onPress={() => {
					onClose();
					goHome();
				}}
			/>
			{list.length ? (
				<Txt variant="small" style={{ paddingTop: space.sm }}>
					Your projects
				</Txt>
			) : null}
			{projects.isLoading ? <Txt variant="small">Loading…</Txt> : null}
			{list.map((x) => {
				const hasBackend = backends.some((b) => b.universeId === x.universeId);
				return line(String(x.universeId), x.universeId === currentUniverse, <GameIcon uri={x.icon} size={28} />, x.name, x.creator.name, () => pick(x.universeId), hasBackend);
			})}
			{looseBackends.length ? (
				<Txt variant="small" style={{ paddingTop: space.sm }}>
					Other TypeTorch dashboards
				</Txt>
			) : null}
			{looseBackends.map((b) =>
				line(
					b.id,
					context.kind === "tt" && b.id === context.account.id,
					<Icon name="flame" size={18} color={p.mutedForeground} />,
					b.name,
					`${b.url.replace(/^https?:\/\//, "")}${b.signedOut ? " · signed out" : ""}`,
					() => {
						onClose();
						if (!(context.kind === "tt" && b.id === context.account.id)) router.replace(samePage(b.id) as never);
					},
					false,
				),
			)}
		</Sheet>
	);
}
