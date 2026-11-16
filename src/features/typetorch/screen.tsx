/**
 * The frame of every TypeTorch screen: the title, pull to refresh (refetches this backend's queries), missing backend,
 * the header's server status dot and command palette (features/typetorch/shell.tsx), the "link to this view" button, and links opened on the phone (a link's filter keys set the filter bar; a
 * link made on another phone finds the backend by its URL).
 */
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, Stack, useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import type { Api } from "@/api/backend";
import { Button, EmptyState, Icon, Screen } from "@/components/ui";
import { useAccounts, useBackend, type BackendAccount } from "@/store/accounts";
import { useTheme } from "@/theme";

import { SignedOutNotice } from "./components";
import { FILTER_KEYS, hasFilterParams, readFilters, refreshFilterNow, setTTFilters } from "./filters";
import { ProjectPickerTitle, TTNavLeft, useCurrentPage } from "./nav";
import { TT_PAGES } from "./pages";
import { Sheet, SheetItem } from "./sheet";
import { CommandPalette, HealthDot } from "./shell";
import { BACKEND_PARAM, createViewLinkRegistry, useViewLink, ViewLinkProvider } from "./view-link";

export function useBackendParam(): string {
	const { backendId } = useLocalSearchParams<{ backendId: string }>();
	return String(backendId ?? "");
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

/** A link from another phone names the backend by URL: open the same page on this phone's account for it. */
function useForeignBackendLink(backendId: string, known: boolean) {
	const { backends } = useAccounts();
	const params = useLocalSearchParams<Record<string, string | string[]>>();
	const pathname = usePathname();
	const url = typeof params[BACKEND_PARAM] === "string" ? (params[BACKEND_PARAM] as string) : "";
	const match = !known && url ? backends.find((b) => sameUrl(b.url, url)) : undefined;
	useEffect(() => {
		if (!match) return;
		const rest = pathname.split("/").slice(3).join("/");
		const query = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) if (k !== "backendId" && typeof v === "string" && !pathname.split("/").includes(v)) query.set(k, v);
		router.replace(`/tt/${match.id}${rest ? `/${rest}` : ""}${query.toString() ? `?${query.toString()}` : ""}` as never);
	}, [match, pathname, params]);
	return { url, waiting: !!match };
}

/**
 * A link's filter keys go into the filter bar once, then leave the route (the bar owns them from there). A view link
 * (it always carries `backend=`) is the whole filter state, like a web URL: a key it leaves out is that key's default,
 * so a link made with the default bar resets the recipient's saved bar instead of keeping it.
 */
function useLinkFilters(backendId: string, known: boolean) {
	const params = useLocalSearchParams<Record<string, string | string[]>>();
	const has = known && (hasFilterParams(params) || (typeof params[BACKEND_PARAM] === "string" && params[BACKEND_PARAM] !== ""));
	useEffect(() => {
		if (!has) return;
		setTTFilters(
			backendId,
			readFilters((k) => {
				const v = params[k];
				return Array.isArray(v) ? v[0] : v;
			}),
		);
		const clear: Record<string, undefined> = {};
		for (const k of FILTER_KEYS) clear[k] = undefined;
		clear[BACKEND_PARAM] = undefined;
		router.setParams(clear);
	}, [has, backendId, params]);
}

function LinkButton({ backendId, backendUrl, registry }: { backendId: string; backendUrl: string; registry: ReturnType<typeof createViewLinkRegistry> }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState<"" | "link" | "app">("");
	const view = useViewLink(backendId, backendUrl, registry);
	const copy = async (which: "link" | "app") => {
		await view.copy(which === "app");
		setCopied(which);
		setTimeout(() => {
			setCopied("");
			setOpen(false);
		}, 900);
	};
	return (
		<>
			<Pressable onPress={() => setOpen(true)} hitSlop={10} accessibilityLabel="Link to this view" style={{ paddingHorizontal: 4 }}>
				<Icon name="link-outline" size={20} color={p.foreground} />
			</Pressable>
			<Sheet
				open={open}
				onClose={() => setOpen(false)}
				title="Link to this view"
				subtitle={
					view.expoGo
						? "The page, its filters, its picks and every table's sort and filters. In Expo Go the link is exp:// and opens only in Expo Go on a phone that reaches this same dev server; the typetorch:// form opens in the installed app."
						: "The page, its filters, its picks and every table's sort and filters"
				}
			>
				<SheetItem icon={copied === "link" ? "checkmark" : "copy-outline"} label={copied === "link" ? "Copied" : view.expoGo ? "Copy link (exp://, this dev server)" : "Copy link to this view"} onPress={() => void copy("link")} />
				<SheetItem
					icon="share-outline"
					label={view.expoGo ? "Share link (exp://)" : "Share link"}
					onPress={() => {
						setOpen(false);
						void view.share();
					}}
				/>
				{view.expoGo ? (
					<>
						<SheetItem icon={copied === "app" ? "checkmark" : "phone-portrait-outline"} label={copied === "app" ? "Copied" : "Copy typetorch:// link (installed app)"} onPress={() => void copy("app")} />
						<SheetItem
							icon="paper-plane-outline"
							label="Share typetorch:// link (installed app)"
							onPress={() => {
								setOpen(false);
								void view.share(true);
							}}
						/>
					</>
				) : null}
				<SheetItem icon="globe-outline" label="Copy the backend URL" detail={backendUrl.replace(/^https?:\/\//, "")} onPress={() => void Clipboard.setStringAsync(backendUrl).then(() => setOpen(false))} />
			</Sheet>
		</>
	);
}

export function TTScreen({
	title,
	children,
	refreshKeys,
	scroll = true,
	notice = true,
}: {
	title: string | ((account: BackendAccount) => string);
	children: (ctx: { account: BackendAccount; api: Api; backendId: string }) => ReactNode;
	/** Which of this backend's queries a pull refreshes (default: all of them). */
	refreshKeys?: readonly unknown[];
	scroll?: boolean;
	/** Show the signed-out notice (off where the body shows it itself). */
	notice?: boolean;
}) {
	const backendId = useBackendParam();
	const { account, api } = useBackend(backendId);
	const queryClient = useQueryClient();
	const [refreshing, setRefreshing] = useState(false);
	const registry = useMemo(() => createViewLinkRegistry(), []);
	const foreign = useForeignBackendLink(backendId, !!account);
	const current = useCurrentPage();
	useLinkFilters(backendId, !!account);
	// A screen opening moves the filter bar's "now" forward (when a minute has passed), so "1 h" means the last hour.
	useEffect(() => {
		if (backendId) refreshFilterNow(backendId, 60_000);
	}, [backendId]);
	if (!account || !api) {
		return (
			<Screen>
				<Stack.Screen options={{ title: "Backend" }} />
				{foreign.waiting ? null : (
					<EmptyState
						icon="flame-outline"
						title="This backend isn't connected"
						body={foreign.url ? `The link is for ${foreign.url.replace(/^https?:\/\//, "")}. Connect it on this phone, then open the link again.` : "It was removed from this phone."}
						action={<Button title={foreign.url ? "Connect it" : "Backends"} onPress={() => router.replace(foreign.url ? `/backend/connect?url=${encodeURIComponent(foreign.url)}` : "/backends")} />}
					/>
				)}
			</Screen>
		);
	}
	const onRefresh = async () => {
		setRefreshing(true);
		// Hour presets end "now": move it, so the pull shows the last 1 h / 6 h, not a window that kept growing.
		refreshFilterNow(backendId);
		try {
			await queryClient.refetchQueries({ queryKey: ["tt", backendId, ...(refreshKeys ?? [])], type: "active" });
		} finally {
			setRefreshing(false);
		}
	};
	return (
		<ViewLinkProvider registry={registry}>
			<Screen refreshing={refreshing} onRefresh={scroll ? onRefresh : undefined} scroll={scroll}>
				<Stack.Screen
					options={{
						title: typeof title === "function" ? title(account) : title,
						// Like the web: the project as a picker, the page under it; a menu and home instead of a back arrow
						// (detail screens keep theirs).
						headerTitle: () => (
							<ProjectPickerTitle
								account={account}
								page={typeof title === "function" ? (TT_PAGES.find((x) => x.key === current.key)?.title ?? title(account)) : title}
							/>
						),
						headerBackVisible: current.detail,
						headerLeft: current.detail ? undefined : () => <TTNavLeft account={account} />,
						headerRight: () => (
							<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
								<HealthDot backendId={backendId} />
								<CommandPalette account={account} registry={registry} />
								<LinkButton backendId={backendId} backendUrl={account.url} registry={registry} />
							</View>
						),
					}}
				/>
				{notice ? <SignedOutNotice account={account} /> : null}
				{children({ account, api, backendId })}
			</Screen>
		</ViewLinkProvider>
	);
}
