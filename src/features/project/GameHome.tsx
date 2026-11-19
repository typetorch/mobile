/**
 * Pieces of a game's home for the bottom-bar navigation (game-nav.tsx): the TypeTorch tab's page list (the web
 * dashboard's groups as tiles, with live hints from GET /v1/mobile/live) and the Overview tab's summary cards (TypeTorch
 * live numbers, ads over 7 days), each opening its page in the right tab.
 */
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { Card, Icon, Txt } from "@/components/ui";
import { pageHref, visiblePages } from "@/features/typetorch/pages";
import { fmtUsd } from "@/features/project/api/servers";
import { ctr, useAdReport } from "@/features/project/servers/ad-report";
import type { BackendAccount } from "@/store/accounts";
import { radius, space, useTheme } from "@/theme";

import { ROBLOX_BLUE, setHomeTab, TT_ORANGE, useGameLive } from "./game-nav";

const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : Math.round(n).toLocaleString());

/** The TypeTorch tab: every dashboard page this role may see, grouped like the web, as tiles. */
export function TTPagesGrid({ account }: { account: BackendAccount }) {
	const p = useTheme();
	const live = useGameLive(account.id);
	const h = live.data?.health;
	const hint: Record<string, { text: string; bad?: boolean } | undefined> = {
		overview: live.data?.ccu !== undefined ? { text: `${fmtInt(live.data.ccu)} playing` } : undefined,
		fleet: h ? { text: `${fmtInt(h.serversOk)}/${fmtInt(h.servers)} servers`, bad: (h.serversOk ?? 0) < (h.servers ?? 0) } : undefined,
		errors: h ? { text: `${fmtInt(h.errors1h)} in 1 h`, bad: (h.errors1h ?? 0) > 0 } : undefined,
		deploys: live.data?.releases?.lastProd ? { text: `prod ${live.data.releases.lastProd}` } : undefined,
	};
	return (
		<View style={{ gap: space.md }}>
			<Txt variant="small">
				{account.name} · {account.url.replace(/^https?:\/\//, "")}
			</Txt>
			{visiblePages(account.role === "admin").map((g) => (
				<View key={g.id} style={{ gap: 6 }}>
					<Txt variant="small" style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
						{g.label ?? "Dashboard"}
					</Txt>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
						{g.pages.map((page) => {
							const h2 = hint[page.key];
							const off = page.status !== "ready";
							return (
								<Pressable
									key={page.key}
									disabled={off}
									onPress={() => router.push(pageHref(account.id, page.key) as never)}
									style={({ pressed }) => ({
										flexBasis: "47%",
										flexGrow: 1,
										backgroundColor: pressed ? p.accent : p.card,
										borderRadius: radius.md,
										borderWidth: 1,
										borderColor: p.border,
										padding: 10,
										gap: 3,
										opacity: off ? 0.45 : 1,
									})}
								>
									<Icon name={page.icon} size={18} color={TT_ORANGE} />
									<Txt style={{ fontWeight: "600" }} numberOfLines={1}>
										{page.title}
									</Txt>
									<Txt variant="small" numberOfLines={1} color={h2?.bad ? p.destructive : undefined}>
										{h2?.text ?? page.description}
									</Txt>
								</Pressable>
							);
						})}
					</View>
				</View>
			))}
		</View>
	);
}

function SummaryCard({ title, color, onPress, children }: { title: string; color: string; onPress(): void; children: React.ReactNode }) {
	const p = useTheme();
	return (
		<Card onPress={onPress} style={{ gap: 4 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
				<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
				<Txt variant="label" style={{ flex: 1 }}>
					{title}
				</Txt>
				<Icon name="chevron-forward" size={14} color={p.mutedForeground} />
			</View>
			{children}
		</Card>
	);
}

/** The Overview tab's top: the game's TypeTorch live numbers (with a backend) and its ads over 7 days. */
export function GameSummary({ universeId, backend }: { universeId: number; backend: BackendAccount | null }) {
	const p = useTheme();
	const live = useGameLive(backend?.id ?? null);
	const ads = useAdReport(universeId, 7);
	const h = live.data?.health;
	const open = (href: string) => router.push(href as never);
	return (
		<View style={{ gap: space.sm }}>
			{backend ? (
				<SummaryCard
					title="TypeTorch · live"
					color={TT_ORANGE}
					onPress={() => {
						setHomeTab(universeId, "typetorch");
						open(`/tt/${backend.id}/fleet`);
					}}
				>
					<View style={{ flexDirection: "row", gap: space.lg, alignItems: "baseline" }}>
						<Txt style={{ fontSize: 26, fontWeight: "700" }}>{fmtInt(live.data?.ccu)}</Txt>
						<Txt variant="small">playing now</Txt>
					</View>
					{h ? (
						<Txt variant="small">
							<Txt variant="small" color={(h.serversOk ?? 0) < (h.servers ?? 0) ? p.warning : p.good}>
								{fmtInt(h.serversOk)}/{fmtInt(h.servers)} servers
							</Txt>
							{" · "}
							<Txt variant="small" color={(h.errors1h ?? 0) > 0 ? p.destructive : undefined}>
								{fmtInt(h.errors1h)} errors in 1 h
							</Txt>
							{" · "}
							{fmtInt(h.alertsOpen)} alerts open
						</Txt>
					) : null}
					{live.data?.releases?.lastProd ? (
						<Txt variant="small">
							Last prod release {live.data.releases.lastProd}
							{live.data.releases.lastProdLabel ? ` (${live.data.releases.lastProdLabel})` : ""}
						</Txt>
					) : null}
				</SummaryCard>
			) : null}
			{ads.can && (ads.totals.impressions ?? 0) > 0 ? (
				<SummaryCard
					title="Ads · last 7 days"
					color={ROBLOX_BLUE}
					onPress={() => {
						setHomeTab(universeId, "tools");
						open(`/project/${universeId}/ads`);
					}}
				>
					<Txt variant="small">
						{fmtUsd(ads.totals.spend)} spent · {fmtInt(ads.totals.impressions)} impressions · {fmtInt(ads.totals.clicks)} clicks ·{" "}
						{ctr(ads.totals) === null ? "–" : `${((ctr(ads.totals) ?? 0) * 100).toFixed(2)}%`} CTR
					</Txt>
				</SummaryCard>
			) : null}
		</View>
	);
}
