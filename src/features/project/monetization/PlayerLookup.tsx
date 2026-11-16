/**
 * Player lookup for purchase support, refund disputes and ban appeals: who the player is (public users v1 + the Open
 * Cloud profile), their ban status here, which of this experience's passes and badges they have, one item check, a
 * subscription's state and their past usernames. All reads; bans themselves are changed on the Bans screen.
 */
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { chunk, HttpError, mapLimit } from "@/api/http";
import { durationSeconds, type OpenCloud } from "@/api/opencloud";
import { getUser, headshots, publicGamePasses, universeBadges, userByName, type RobloxUser } from "@/api/roblox-public";
import { Badge, Button, Card, Chips, EmptyState, ErrorState, Field, KV, List, notify, Row, Section, Skeleton, SkeletonList, Txt } from "@/components/ui";
import {
	allGamePasses,
	canViewInventory,
	getCloudUser,
	getSubscription,
	getUserRestriction,
	isOwned,
	ITEM_TYPES,
	ownedItems,
	SUBSCRIPTION_PRODUCT_ID,
	usernameHistory,
	type Subscription,
} from "@/features/project/api/monetization";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { fmtAgo, fmtDate, fmtSeconds } from "@/lib/format";
import { useTheme } from "@/theme";

type Can = (scope: string) => boolean;

async function resolveUser(text: string): Promise<RobloxUser> {
	const t = text.trim().replace(/^@/, "");
	if (/^\d+$/.test(t)) return getUser(Number(t));
	const u = await userByName(t);
	if (!u) throw new Error(`No Roblox user is called “${t}”.`);
	return u;
}

export function PlayerLookup({ universeId, cloud, can, hasKey, initial }: { universeId: number; cloud: OpenCloud; can: Can; hasKey: boolean; initial?: string }) {
	const p = useTheme();
	const [text, setText] = useState(initial ?? "");
	const [query, setQuery] = useState(initial?.trim() ?? "");
	const user = useQuery({ queryKey: ["player", "resolve", query.toLowerCase()], enabled: !!query, queryFn: () => resolveUser(query), retry: false, staleTime: 300_000 });
	const head = useQuery({ queryKey: ["player", "head", user.data?.id], enabled: !!user.data, staleTime: 3600_000, queryFn: async () => (await headshots([user.data!.id]))[user.data!.id] ?? null });

	return (
		<>
			<Card style={{ gap: 8 }}>
				<Field value={text} onChangeText={setText} placeholder="Username or user ID" returnKeyType="search" onSubmitEditing={() => setQuery(text.trim())} />
				<Button title="Look up" icon="search" small disabled={!text.trim()} loading={user.isFetching} onPress={() => setQuery(text.trim())} style={{ alignSelf: "flex-start" }} />
			</Card>
			{!query ? <EmptyState icon="person-circle-outline" title="Find a player" body="Their passes, badges, subscription, ban status, profile and past usernames for this experience." /> : null}
			{user.error ? <ErrorState error={user.error} title="Player not found" onRetry={() => user.refetch()} /> : null}
			{user.isLoading ? <SkeletonList rows={2} /> : null}
			{user.data ? (
				<>
					<Card style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
						{head.data ? <Image source={{ uri: head.data }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: p.muted }} /> : <Skeleton width={56} height={56} style={{ borderRadius: 28 }} />}
						<View style={{ flex: 1, gap: 2 }}>
							<Txt variant="h3">{user.data.displayName}</Txt>
							<Txt variant="small" selectable>
								@{user.data.name} · ID {user.data.id}
								{user.data.created ? ` · joined ${fmtDate(user.data.created)}` : ""}
							</Txt>
						</View>
					</Card>
					<BanStatus key={`ban-${user.data.id}`} universeId={universeId} cloud={cloud} userId={user.data.id} can={can} />
					<Owned key={`own-${user.data.id}`} universeId={universeId} cloud={cloud} userId={user.data.id} can={can} hasKey={hasKey} />
					<OneItem key={`one-${user.data.id}`} userId={user.data.id} />
					<SubscriptionCheck key={`sub-${user.data.id}`} universeId={universeId} cloud={cloud} userId={user.data.id} can={can} />
					<Profile key={`prof-${user.data.id}`} cloud={cloud} userId={user.data.id} hasKey={hasKey} can={can} />
					<PastNames key={`names-${user.data.id}`} userId={user.data.id} />
				</>
			) : null}
		</>
	);
}

// Ban status -------------------------------------------------------------------------------------------------------------

function BanStatus({ universeId, cloud, userId, can }: { universeId: number; cloud: OpenCloud; userId: number; can: Can }) {
	const allowed = can("universe.user-restriction:read");
	const q = useQuery({
		queryKey: ["oc", "bans", universeId, "user", userId],
		enabled: allowed,
		queryFn: async () => {
			try {
				return await getUserRestriction(cloud, universeId, userId);
			} catch (e) {
				if (e instanceof HttpError && e.status === 404) return null;
				throw e;
			}
		},
	});
	const g = q.data?.gameJoinRestriction;
	const secs = durationSeconds(g?.duration);
	const ends = secs && g?.startTime ? Date.parse(g.startTime) + secs * 1000 : null;
	return (
		<Section title="Ban status" right={<Button title="Bans" small icon="ban-outline" onPress={() => router.push(`/project/${universeId}/bans`)} />}>
			{!allowed ? (
				<Txt variant="small">Add universe.user-restriction:read to see whether this player is banned here.</Txt>
			) : q.error ? (
				<CloudError error={q.error} what="Ban status" onRetry={() => q.refetch()} />
			) : q.isLoading ? (
				<Skeleton height={40} />
			) : g?.active ? (
				<Card style={{ gap: 2 }}>
					<View style={{ flexDirection: "row", gap: 6 }}>
						<Badge label="banned" tone="critical" />
						{g.inherited ? <Badge label="from the universe" /> : null}
						{g.excludeAltAccounts === false ? <Badge label="alts too" /> : null}
					</View>
					<KV label="Length" value={secs ? `${fmtSeconds(secs)}, ends ${fmtDate(ends)}` : "permanent"} />
					<KV label="Since" value={fmtAgo(g.startTime)} />
					{g.displayReason ? <KV label="Shown reason" value={g.displayReason} /> : null}
					{g.privateReason ? <KV label="Private note" value={g.privateReason} /> : null}
				</Card>
			) : (
				<Card>
					<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
						<Badge label="not banned" tone="good" />
						<Txt variant="small">Can join this experience.</Txt>
					</View>
				</Card>
			)}
		</Section>
	);
}

// Passes and badges they have --------------------------------------------------------------------------------------------

interface OwnedRow {
	kind: "pass" | "badge";
	id: number;
	name: string;
	owned: boolean | null;
	addTime?: string | null;
}

/** Without a key the public is-owned check runs per item, so it covers at most this many. */
const PUBLIC_CHECK_MAX = 60;

function Owned({ universeId, cloud, userId, can, hasKey }: { universeId: number; cloud: OpenCloud; userId: number; can: Can; hasKey: boolean }) {
	const visible = useQuery({ queryKey: ["player", "can-view", userId], queryFn: () => canViewInventory(userId), retry: false, staleTime: 300_000 });
	const q = useQuery({
		queryKey: ["player", "owned", universeId, userId, hasKey, can("game-pass:read")],
		queryFn: async (): Promise<{ rows: OwnedRow[]; partial: boolean }> => {
			const [passes, badges] = await Promise.all([
				can("game-pass:read") ? allGamePasses(cloud, universeId) : publicGamePasses(universeId).then((r) => r.map((g) => ({ id: g.id, name: g.displayName ?? g.name }))),
				universeBadges(universeId).then((r) => r.map((b) => ({ id: b.id, name: b.name }))),
			]);
			const items = [...passes.map((g) => ({ kind: "pass" as const, ...g })), ...badges.map((b) => ({ kind: "badge" as const, ...b }))];
			if (hasKey) {
				// Open Cloud inventory-items filtered by ID, 50 of each kind per request.
				const passIds = chunk(passes.map((g) => g.id), 50);
				const badgeIds = chunk(badges.map((b) => b.id), 50);
				const batches = Array.from({ length: Math.max(passIds.length, badgeIds.length) }, (_, i) => ({ gamePassIds: passIds[i] ?? [], badgeIds: badgeIds[i] ?? [] }));
				const found = (await mapLimit(batches, 2, (b) => ownedItems(cloud, userId, b))).flat();
				const have = new Map<string, string | null>();
				for (const it of found) {
					if (it.gamePassDetails) have.set(`pass:${it.gamePassDetails.gamePassId}`, it.addTime ?? null);
					if (it.badgeDetails) have.set(`badge:${it.badgeDetails.badgeId}`, it.addTime ?? null);
				}
				return { rows: items.map((it) => ({ ...it, owned: have.has(`${it.kind}:${it.id}`), addTime: have.get(`${it.kind}:${it.id}`) })), partial: false };
			}
			const checked = items.slice(0, PUBLIC_CHECK_MAX);
			const owned = await mapLimit(checked, 4, (it) => isOwned(userId, it.kind === "pass" ? 1 : 2, it.id).catch(() => null));
			return { rows: checked.map((it, i) => ({ ...it, owned: owned[i] ?? null })), partial: items.length > checked.length };
		},
	});
	const rows = q.data?.rows ?? [];
	const yes = rows.filter((r) => r.owned);
	const hidden = visible.data && !visible.data.canView;
	return (
		<Section title={`Passes & badges${q.data ? ` (${yes.length} of ${rows.length})` : ""}`}>
			{hidden ? <Txt variant="small">This player's inventory is private, so Roblox may hide what they own: "not owned" isn't proof.</Txt> : null}
			{q.error ? <CloudError error={q.error} what="Inventory" onRetry={() => q.refetch()} /> : null}
			{q.isLoading ? <SkeletonList rows={3} /> : null}
			{q.data && !rows.length ? <Txt variant="muted">This experience has no passes or badges.</Txt> : null}
			{rows.length ? (
				<List>
					{[...yes, ...rows.filter((r) => !r.owned)].map((r) => (
						<Row
							key={`${r.kind}-${r.id}`}
							title={r.name}
							subtitle={`${r.kind === "pass" ? "Game pass" : "Badge"} ${r.id}${r.addTime ? ` · since ${fmtDate(r.addTime)}` : ""}`}
							right={r.owned ? <Badge label={r.kind === "pass" ? "owns" : "has"} tone="good" icon="checkmark" /> : r.owned === null ? <Badge label="unknown" /> : <Badge label="no" />}
							onPress={r.kind === "badge" || can("game-pass:read") ? () => router.push(`/project/${universeId}/${r.kind}?id=${r.id}`) : undefined}
							chevron={r.kind === "badge" || can("game-pass:read")}
						/>
					))}
				</List>
			) : null}
			{q.data?.partial ? <Txt variant="small">Checked the first {PUBLIC_CHECK_MAX} items. Add an Open Cloud key to check them all at once.</Txt> : null}
		</Section>
	);
}

function OneItem({ userId }: { userId: number }) {
	const p = useTheme();
	const [type, setType] = useState<number>(0);
	const [id, setId] = useState("");
	const check = useMutation({ mutationFn: (itemId: number) => isOwned(userId, type, itemId), onError: (e) => notify("Check failed", cloudErrorText(e)) });
	const valid = /^\d+$/.test(id.trim()) && Number(id.trim()) > 0;
	return (
		<Section title="Check one item">
			<Card style={{ gap: 8 }}>
				<Chips options={ITEM_TYPES.map((t) => ({ value: t.value as number, label: t.label }))} value={type} onChange={(v) => { setType(v); check.reset(); }} />
				<Field value={id} onChangeText={(t) => { setId(t); check.reset(); }} placeholder="Item ID (asset, pass, badge or bundle)" keyboardType="number-pad" />
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Button title="Check" small icon="help-circle-outline" disabled={!valid} loading={check.isPending} onPress={() => check.mutate(Number(id.trim()))} />
					{check.data === true ? <Badge label="owns it" tone="good" icon="checkmark" /> : null}
					{check.data === false ? <Badge label="doesn't own it" /> : null}
				</View>
				{id.trim() && !valid ? (
					<Txt variant="small" color={p.destructive}>
						An item ID is a number.
					</Txt>
				) : null}
			</Card>
		</Section>
	);
}

// Subscription -----------------------------------------------------------------------------------------------------------

const STATE_LABEL: Record<NonNullable<Subscription["state"]>, string> = {
	STATE_UNSPECIFIED: "unknown",
	SUBSCRIBED_WILL_RENEW: "active, renews",
	SUBSCRIBED_WILL_NOT_RENEW: "active, cancelled",
	SUBSCRIBED_RENEWAL_PAYMENT_PENDING: "active, payment pending",
	EXPIRED: "expired",
};

function SubscriptionCheck({ universeId, cloud, userId, can }: { universeId: number; cloud: OpenCloud; userId: number; can: Can }) {
	const p = useTheme();
	const [productId, setProductId] = useState("");
	const id = productId.trim().toUpperCase();
	const valid = SUBSCRIPTION_PRODUCT_ID.test(id);
	const check = useMutation({
		mutationFn: async (pid: string) => {
			try {
				return await getSubscription(cloud, universeId, pid, userId);
			} catch (e) {
				// A 404 also means a wrong product ID (or one from another experience): keep Roblox's message to tell them apart.
				if (e instanceof HttpError && e.status === 404) return { missing: e.message };
				throw e;
			}
		},
	});
	const s = check.data && !("missing" in check.data) ? check.data : null;
	const missing = check.data && "missing" in check.data ? check.data.missing : null;
	return (
		<Section title="Subscription">
			{!can("universe:write") ? (
				<Txt variant="small">Reading another player's subscription needs universe:write for this experience (Roblox's read-only subscription scope only reads the key owner's own).</Txt>
			) : (
				<Card style={{ gap: 8 }}>
					<Field value={productId} onChangeText={(t) => { setProductId(t); check.reset(); }} placeholder="Subscription product ID (EXP-…)" autoCapitalize="characters" hint="Creator Hub > Monetization > Subscriptions shows the ID; the API can't list them." />
					<Button title="Check" small icon="search" disabled={!valid} loading={check.isPending} onPress={() => check.mutate(id)} style={{ alignSelf: "flex-start" }} />
					{productId.trim() && !valid ? (
						<Txt variant="small" color={p.destructive}>
							The ID looks like EXP-1234567890.
						</Txt>
					) : null}
					{check.error ? <CloudError error={check.error} what="Subscriptions" /> : null}
					{missing !== null ? (
						<Txt variant="muted">
							No subscription found for this player and {id}. Check that the product ID is right and belongs to this experience.{missing ? ` Roblox said: ${missing}` : ""}
						</Txt>
					) : null}
					{s ? (
						<View>
							<View style={{ flexDirection: "row", gap: 6 }}>
								<Badge label={s.state ? STATE_LABEL[s.state] : s.active ? "active" : "inactive"} tone={s.active ? "good" : "muted"} />
							</View>
							<KV label="Since" value={fmtDate(s.createTime)} />
							{s.lastBillingTime ? <KV label="Last billed" value={fmtDate(s.lastBillingTime)} /> : null}
							{s.nextRenewTime ? <KV label="Renews" value={fmtDate(s.nextRenewTime)} /> : null}
							{s.expireTime ? <KV label={s.state === "EXPIRED" ? "Expired" : "Expires"} value={fmtDate(s.expireTime)} /> : null}
							{s.expirationDetails?.reason && s.expirationDetails.reason !== "EXPIRATION_REASON_UNSPECIFIED" ? <KV label="Why it ended" value={s.expirationDetails.reason.toLowerCase().replace(/_/g, " ")} /> : null}
							{s.paymentProvider && s.paymentProvider !== "PAYMENT_PROVIDER_UNSPECIFIED" ? <KV label="Paid with" value={s.paymentProvider.toLowerCase().replace(/_/g, " ")} /> : null}
							{s.purchasePlatform && s.purchasePlatform !== "PURCHASE_PLATFORM_UNSPECIFIED" ? <KV label="Bought on" value={s.purchasePlatform.toLowerCase()} /> : null}
						</View>
					) : null}
				</Card>
			)}
		</Section>
	);
}

// Open Cloud profile -----------------------------------------------------------------------------------------------------

function Profile({ cloud, userId, hasKey, can }: { cloud: OpenCloud; userId: number; hasKey: boolean; can: Can }) {
	const q = useQuery({ queryKey: ["player", "cloud-user", userId], enabled: hasKey, staleTime: 300_000, queryFn: () => getCloudUser(cloud, userId) });
	const u = q.data;
	const social = u?.socialNetworkProfiles;
	const links = social ? (["twitter", "youtube", "twitch", "guilded", "facebook"] as const).filter((k) => social[k]) : [];
	return (
		<Section title="Profile">
			{!hasKey ? (
				<Txt variant="small">Add an Open Cloud key to see Premium, locale and ID verification.</Txt>
			) : q.error ? (
				<CloudError error={q.error} what="The Open Cloud profile" onRetry={() => q.refetch()} />
			) : !u ? (
				<Skeleton height={60} />
			) : (
				<Card style={{ gap: 0 }}>
					<KV label="Premium" value={u.premium ? "yes" : "no"} />
					{u.locale ? <KV label="Locale" value={u.locale} /> : null}
					<KV label="ID verified" value={u.idVerified === undefined || u.idVerified === null ? (can("user.advanced:read") ? "–" : "needs user.advanced:read") : u.idVerified ? "yes" : "no"} />
					{links.map((k) => (
						<KV key={k} label={k[0]!.toUpperCase() + k.slice(1)} value={social![k] ?? ""} />
					))}
					{!social && !can("user.social:read") ? <KV label="Social links" value="needs user.social:read" /> : null}
					{u.about ? (
						<View style={{ paddingTop: 6, gap: 2 }}>
							<Txt variant="label">About</Txt>
							<Txt variant="small" selectable>
								{u.about}
							</Txt>
						</View>
					) : null}
				</Card>
			)}
		</Section>
	);
}

// Username history -------------------------------------------------------------------------------------------------------

function PastNames({ userId }: { userId: number }) {
	const q = useInfiniteQuery({
		queryKey: ["player", "names", userId],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => usernameHistory(userId, pageParam),
		getNextPageParam: (last) => last.nextPageCursor || undefined,
	});
	const names = q.data?.pages.flatMap((pg) => pg.data ?? []) ?? [];
	return (
		<Section title="Past usernames">
			{q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
			{q.isLoading ? <Skeleton height={40} /> : null}
			{q.data && !names.length ? <Txt variant="muted">Never renamed.</Txt> : null}
			{names.length ? (
				<List>
					{names.map((n, i) => (
						<Row key={`${n.name}-${i}`} title={`@${n.name}`} />
					))}
				</List>
			) : null}
			{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
		</Section>
	);
}
