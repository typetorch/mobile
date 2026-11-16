/**
 * Game passes, developer products and badges. Passes and products use Open Cloud's creator lists when the key has
 * game-pass:read / developer-product:read (prices, sale state, private ones); passes and badges fall back to the
 * public lists.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { badgeIcons, gamePassIcons, productIcons, publicGamePasses, universeBadges } from "@/api/roblox-public";
import { GameIcon } from "@/components/ProjectRow";
import { Badge, EmptyState, ErrorState, List, Row, ScopeNotice, Segmented, SkeletonList, Txt } from "@/components/ui";
import { ToolScreen } from "@/features/project/tool";
import { compact, fmtRobux } from "@/lib/format";

type Tab = "passes" | "products" | "badges";

export default function MonetizationScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Passes, products & badges" scopes={[]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["monetization"], type: "active" })}>
			{({ universeId, cloud, can }) => <Monetization universeId={universeId} cloud={cloud} canPasses={can("game-pass:read")} canProducts={can("developer-product:read")} />}
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

function Monetization({ universeId, cloud, canPasses, canProducts }: { universeId: number; cloud: OpenCloud; canPasses: boolean; canProducts: boolean }) {
	const [tab, setTab] = useState<Tab>("passes");
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
					}))
				: (await publicGamePasses(universeId)).map((g) => ({ id: g.id, name: g.displayName ?? g.name, price: g.price, forSale: g.price !== null }));
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
			<Segmented options={[{ value: "passes", label: "Passes" }, { value: "products", label: "Products" }, { value: "badges", label: "Badges" }]} value={tab} onChange={setTab} />
			{tab === "passes" ? (
				<>
					{!canPasses ? <Txt variant="small">Public list (add game-pass:read for prices of off-sale and private passes).</Txt> : null}
					{passes.error ? <ErrorState error={passes.error} onRetry={() => passes.refetch()} /> : null}
					{passes.isLoading ? <SkeletonList rows={5} /> : null}
					{passes.data && !passes.data.length ? <EmptyState icon="ticket-outline" title="No game passes" /> : null}
					{passes.data?.length ? (
						<List>
							{passes.data.map((g) => (
								<Row key={g.id} left={<GameIcon uri={g.icon} size={36} />} title={g.name} subtitle={`ID ${g.id}`} right={g.forSale ? <Txt style={{ fontWeight: "600" }}>{fmtRobux(g.price)}</Txt> : <Badge label="off sale" />} />
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
						{products.error ? <ErrorState error={products.error} onRetry={() => products.refetch()} /> : null}
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
										right={d.isForSale ? <Txt style={{ fontWeight: "600" }}>{fmtRobux(d.priceInformation?.defaultPriceInRobux ?? null)}</Txt> : <Badge label="off sale" />}
									/>
								))}
							</List>
						) : null}
					</>
				)
			) : null}
			{tab === "badges" ? (
				<>
					{badges.error ? <ErrorState error={badges.error} onRetry={() => badges.refetch()} /> : null}
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
								/>
							))}
						</List>
					) : null}
				</>
			) : null}
		</>
	);
}
