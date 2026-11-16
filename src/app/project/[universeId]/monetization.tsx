/**
 * Game passes, developer products and badges. Passes and products use Open Cloud's creator lists when the key has
 * game-pass:read / developer-product:read (prices, sale state, price optimization, private ones); passes and badges
 * fall back to the public lists. Tapping an item opens its editor (pass / product / badge screens); "New …" creates one.
 * Also links the player lookup and private servers (Configure), and grants the experience use of assets.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { badgeIcons, gamePassIcons, productIcons, publicGamePasses, universeBadges } from "@/api/roblox-public";
import { GameIcon } from "@/components/ProjectRow";
import { Badge, Button, EmptyState, List, Row, ScopeNotice, Segmented, SkeletonList, Txt } from "@/components/ui";
import { featureLabels } from "@/features/project/api/monetization";
import { CloudError } from "@/features/project/CloudError";
import { AssetPermissions } from "@/features/project/monetization/AssetPermissions";
import { ToolScreen } from "@/features/project/tool";
import { compact, fmtRobux } from "@/lib/format";

type Tab = "passes" | "products" | "badges";

export default function MonetizationScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Passes, products & badges" scopes={[]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["monetization"], type: "active" })}>
			{({ universeId, cloud, can }) => <Monetization universeId={universeId} cloud={cloud} can={can} />}
		</ToolScreen>
	);
}

async function allPages<T>(page: (token?: string) => Promise<{ items: T[]; next?: string }>, max = 10): Promise<T[]> {
	const out: T[] = [];
	let token: string | undefined;
	for (let i = 0; i < max; i++) {
		const r = await page(token);
		out.push(...r.items);
		if (!r.next) break;
		token = r.next;
	}
	return out;
}

/** Sale state and pricing features on the right of a row. */
function PriceTags({ forSale, price, features }: { forSale: boolean; price: number | null | undefined; features: string[] }) {
	return (
		<View style={{ alignItems: "flex-end", gap: 3 }}>
			{forSale ? <Txt style={{ fontWeight: "600" }}>{fmtRobux(price ?? null)}</Txt> : <Badge label="off sale" />}
			{features.map((f) => (
				<Badge key={f} label={f} tone="brand" />
			))}
		</View>
	);
}

function Monetization({ universeId, cloud, can }: { universeId: number; cloud: OpenCloud; can: (scope: string) => boolean }) {
	const canPasses = can("game-pass:read");
	const canProducts = can("developer-product:read");
	const [tab, setTab] = useState<Tab>("passes");
	const open = (kind: "pass" | "product" | "badge", id: number | "new") => router.push(`/project/${universeId}/${kind}?id=${id}`);
	const passes = useQuery({
		queryKey: ["monetization", "passes", universeId, canPasses],
		enabled: tab === "passes",
		queryFn: async () => {
			const rows = canPasses
				? (await allPages((t) => cloud.gamePasses(universeId, t).then((r) => ({ items: r.gamePasses ?? [], next: r.nextPageToken })))).map((g) => ({
						id: g.gamePassId,
						name: g.name,
						price: g.priceInformation?.defaultPriceInRobux ?? null,
						forSale: g.isForSale,
						features: featureLabels(g.priceInformation),
					}))
				: (await publicGamePasses(universeId)).map((g) => ({ id: g.id, name: g.displayName ?? g.name, price: g.price, forSale: g.price !== null, features: [] as string[] }));
			const icons = await gamePassIcons(rows.map((r) => r.id)).catch(() => ({}) as Record<number, string>);
			return rows.map((r) => ({ ...r, icon: icons[r.id] ?? null }));
		},
	});
	const products = useQuery({
		queryKey: ["monetization", "products", universeId],
		enabled: tab === "products" && canProducts,
		queryFn: async () => {
			const rows = await allPages((t) => cloud.developerProducts(universeId, t).then((r) => ({ items: r.developerProducts ?? [], next: r.nextPageToken })));
			const icons = await productIcons(rows.map((r) => r.productId)).catch(() => ({}) as Record<number, string>);
			return rows.map((r) => ({ ...r, icon: icons[r.productId] ?? null }));
		},
	});
	const badges = useQuery({
		queryKey: ["monetization", "badges", universeId],
		enabled: tab === "badges",
		queryFn: async () => {
			const rows = await universeBadges(universeId);
			const icons = await badgeIcons(rows.map((b) => b.id)).catch(() => ({}) as Record<number, string>);
			return rows.map((b) => ({ ...b, icon: icons[b.id] ?? null }));
		},
	});

	return (
		<>
			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				<Button title="Player lookup" icon="person-circle-outline" small onPress={() => router.push(`/project/${universeId}/player`)} />
				<Button title="Private servers" icon="server-outline" small onPress={() => router.push(`/project/${universeId}/configure`)} />
			</View>
			<Segmented options={[{ value: "passes", label: "Passes" }, { value: "products", label: "Products" }, { value: "badges", label: "Badges" }]} value={tab} onChange={setTab} />
			{tab === "passes" ? (
				<>
					{can("game-pass:write") ? <Button title="New game pass" variant="brand" icon="add" small onPress={() => open("pass", "new")} style={{ alignSelf: "flex-start" }} /> : null}
					{!canPasses ? <Txt variant="small">Public list (add game-pass:read for prices of off-sale and private passes and to edit them).</Txt> : null}
					{passes.error ? <CloudError error={passes.error} what="Game passes" onRetry={() => passes.refetch()} /> : null}
					{passes.isLoading ? <SkeletonList rows={5} /> : null}
					{passes.data && !passes.data.length ? <EmptyState icon="ticket-outline" title="No game passes" /> : null}
					{passes.data?.length ? (
						<List>
							{passes.data.map((g) => (
								<Row
									key={g.id}
									left={<GameIcon uri={g.icon} size={36} />}
									title={g.name}
									subtitle={`ID ${g.id}`}
									right={<PriceTags forSale={g.forSale} price={g.price} features={g.features} />}
									onPress={canPasses ? () => open("pass", g.id) : undefined}
									chevron={canPasses}
								/>
							))}
						</List>
					) : null}
				</>
			) : null}
			{tab === "products" ? (
				!canProducts ? (
					<ScopeNotice what="Developer products" scopes={["developer-product:read"]} />
				) : (
					<>
						{can("developer-product:write") ? <Button title="New developer product" variant="brand" icon="add" small onPress={() => open("product", "new")} style={{ alignSelf: "flex-start" }} /> : null}
						{products.error ? <CloudError error={products.error} what="Developer products" onRetry={() => products.refetch()} /> : null}
						{products.isLoading ? <SkeletonList rows={5} /> : null}
						{products.data && !products.data.length ? <EmptyState icon="pricetag-outline" title="No developer products" /> : null}
						{products.data?.length ? (
							<List>
								{products.data.map((d) => (
									<Row
										key={d.productId}
										left={<GameIcon uri={d.icon} size={36} />}
										title={d.name}
										subtitle={`ID ${d.productId}${d.description ? ` · ${d.description}` : ""}`}
										right={<PriceTags forSale={d.isForSale} price={d.priceInformation?.defaultPriceInRobux} features={featureLabels(d.priceInformation)} />}
										onPress={() => open("product", d.productId)}
										chevron
									/>
								))}
							</List>
						) : null}
					</>
				)
			) : null}
			{tab === "badges" ? (
				<>
					{can("legacy-universe.badge:manage-and-spend-robux") ? <Button title="New badge" variant="brand" icon="add" small onPress={() => open("badge", "new")} style={{ alignSelf: "flex-start" }} /> : null}
					{badges.error ? <CloudError error={badges.error} what="Badges" onRetry={() => badges.refetch()} /> : null}
					{badges.isLoading ? <SkeletonList rows={5} /> : null}
					{badges.data && !badges.data.length ? <EmptyState icon="ribbon-outline" title="No badges" /> : null}
					{badges.data?.length ? (
						<List>
							{badges.data.map((b) => (
								<Row
									key={b.id}
									left={<GameIcon uri={b.icon} size={36} />}
									title={b.name}
									subtitle={b.statistics ? `${compact(b.statistics.awardedCount)} awarded · ${compact(b.statistics.pastDayAwardedCount)} yesterday · ${(b.statistics.winRatePercentage <= 1 ? b.statistics.winRatePercentage * 100 : b.statistics.winRatePercentage).toFixed(1)}% win rate` : `ID ${b.id}`}
									right={b.enabled ? undefined : <Badge label="disabled" />}
									onPress={() => open("badge", b.id)}
									chevron
								/>
							))}
						</List>
					) : null}
				</>
			) : null}
			<AssetPermissions universeId={universeId} cloud={cloud} canWrite={can("asset-permissions:write")} />
		</>
	);
}
