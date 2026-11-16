/**
 * The dashboard's navigation, like the web explorer's: a sidebar with the pages grouped as the web's nav (lib/nav.ts),
 * a project picker as the header title (switch backend or project, or go home) and a home button. Top-level pages get
 * the menu instead of a back arrow; detail pages (an error, a player, a server) keep their back arrow.
 */
import { router, useSegments } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameIcon } from "@/components/ProjectRow";
import { Icon, Txt } from "@/components/ui";
import { useAddedIds } from "@/features/project/pins";
import { useAddedProjects } from "@/features/project/projects";
import { useAccounts, type BackendAccount } from "@/store/accounts";
import { radius, space, useTheme } from "@/theme";

import { pageHref, TT_PAGES, visiblePages } from "./pages";
import { Sheet, SheetItem } from "./sheet";

/** Detail routes and the page they belong to (highlighted in the sidebar). */
const PARENT: Record<string, string> = { error: "errors", deploy: "deploys", server: "fleet", "server-map": "fleet", bundle: "fleet", player: "players" };

/** The current page's key and whether this is a detail screen (deeper than a page). */
export function useCurrentPage(): { key: string; detail: boolean } {
	const segments = useSegments() as string[];
	const i = segments.indexOf("[backendId]");
	const first = i >= 0 ? segments[i + 1] : undefined;
	if (!first || first === "index") return { key: "overview", detail: false };
	if (PARENT[first]) return { key: PARENT[first], detail: true };
	return { key: first, detail: segments.length > i + 2 };
}

export function goHome() {
	if (router.canDismiss()) router.dismissTo("/");
	else router.replace("/");
}

function HeaderIcon({ name, label, onPress }: { name: Parameters<typeof Icon>[0]["name"]; label: string; onPress(): void }) {
	const p = useTheme();
	return (
		<Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} style={{ padding: 2 }}>
			<Icon name={name} size={22} color={p.foreground} />
		</Pressable>
	);
}

/** headerLeft for a top-level page: the sidebar button and home. */
export function NavLeft({ account }: { account: BackendAccount }) {
	const [open, setOpen] = useState(false);
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginRight: 8 }}>
			<HeaderIcon name="menu" label="Open the page menu" onPress={() => setOpen(true)} />
			<HeaderIcon name="home-outline" label="Home: your projects" onPress={goHome} />
			<Sidebar account={account} open={open} onClose={() => setOpen(false)} />
		</View>
	);
}

/** The left drawer: the web's sidebar groups, the current page highlighted. */
function Sidebar({ account, open, onClose }: { account: BackendAccount; open: boolean; onClose(): void }) {
	const p = useTheme();
	const insets = useSafeAreaInsets();
	const { key } = useCurrentPage();
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
	const groups = visiblePages(account.role === "admin");
	const go = (href: string) => {
		onClose();
		router.replace(href as never);
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
					<Icon name="flame" size={20} color={p.brand} />
					<View style={{ flex: 1 }}>
						<Txt style={{ fontWeight: "700" }} numberOfLines={1}>
							{account.name}
						</Txt>
						<Txt variant="small" numberOfLines={1}>
							{account.url.replace(/^https?:\/\//, "")} · {account.role === "admin" ? "owner" : "read-only"}
						</Txt>
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
							{g.pages.map((page) => {
								const active = page.key === key;
								const todo = page.status !== "ready";
								return (
									<Pressable
										key={page.key}
										disabled={todo}
										onPress={() => go(pageHref(account.id, page.key))}
										android_ripple={{ color: p.accent }}
										style={({ pressed }) => [
											{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 9, paddingHorizontal: space.md, borderRadius: radius.md, opacity: todo ? 0.45 : 1 },
											(active || pressed) && { backgroundColor: p.accent },
										]}
									>
										<Icon name={page.icon} size={18} color={active ? p.brand : p.mutedForeground} />
										<Txt style={{ flex: 1, fontWeight: active ? "600" : "400" }} numberOfLines={1}>
											{page.title}
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

/** The header title: this project's name (and the page) as a button that opens the project picker. */
export function ProjectPickerTitle({ account, page }: { account: BackendAccount; page: string }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Pressable onPress={() => setOpen(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${account.name}, ${page}. Switch project`} style={{ maxWidth: 220 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
					<Txt style={{ fontWeight: "700", fontSize: 16, flexShrink: 1 }} numberOfLines={1}>
						{account.name}
					</Txt>
					<Icon name="chevron-down" size={14} color={p.mutedForeground} />
				</View>
				<Txt variant="small" numberOfLines={1}>
					{page}
				</Txt>
			</Pressable>
			<ProjectPicker current={account} open={open} onClose={() => setOpen(false)} />
		</>
	);
}

/** Switch to another backend (same page), another project, or home. */
function ProjectPicker({ current, open, onClose }: { current: BackendAccount; open: boolean; onClose(): void }) {
	const p = useTheme();
	const { backends } = useAccounts();
	const { key } = useCurrentPage();
	const added = useAddedIds();
	const projects = useAddedProjects(open ? added.ids : []);
	if (!open) return null;
	const backendUniverses = new Set(backends.map((b) => b.universeId).filter(Boolean));
	const others = (projects.data?.projects ?? []).filter((x) => !backendUniverses.has(x.universeId));
	const pageExists = (k: string) => TT_PAGES.some((x) => x.key === k);
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
			{backends.length ? (
				<Txt variant="small" style={{ paddingTop: space.sm }}>
					TypeTorch dashboards
				</Txt>
			) : null}
			{backends.map((b) => {
				const here = b.id === current.id;
				return (
					<Pressable
						key={b.id}
						onPress={() => {
							onClose();
							if (!here) router.replace(pageHref(b.id, pageExists(key) ? key : "overview") as never);
						}}
						android_ripple={{ color: p.accent }}
						style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 9, paddingHorizontal: 4, borderRadius: radius.md }, (pressed || here) && { backgroundColor: p.accent }]}
					>
						<Icon name="flame" size={18} color={here ? p.brand : p.mutedForeground} />
						<View style={{ flex: 1 }}>
							<Txt style={{ fontWeight: here ? "600" : "400" }} numberOfLines={1}>
								{b.name}
							</Txt>
							<Txt variant="small" numberOfLines={1}>
								{b.url.replace(/^https?:\/\//, "")}
								{b.signedOut ? " · signed out" : ""}
							</Txt>
						</View>
						{here ? <Icon name="checkmark" size={18} color={p.brand} /> : null}
					</Pressable>
				);
			})}
			{others.length ? (
				<Txt variant="small" style={{ paddingTop: space.sm }}>
					Your projects
				</Txt>
			) : null}
			{others.map((x) => (
				<Pressable
					key={x.universeId}
					onPress={() => {
						onClose();
						router.push(`/project/${x.universeId}`);
					}}
					android_ripple={{ color: p.accent }}
					style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 7, paddingHorizontal: 4, borderRadius: radius.md }, pressed && { backgroundColor: p.accent }]}
				>
					<GameIcon uri={x.icon} size={28} />
					<Txt style={{ flex: 1 }} numberOfLines={1}>
						{x.name}
					</Txt>
				</Pressable>
			))}
		</Sheet>
	);
}
