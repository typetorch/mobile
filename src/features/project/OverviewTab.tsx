/**
 * An experience's overview, like Creator Hub's: banner, stats, settings (Open Cloud universe, when the key reaches
 * it), public details (games v1: genre, price, avatar type, copying…), places (open the place screen), public servers,
 * and Follow / Unfollow for the key's owner (legacy-followings).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";

import { hasScope } from "@/api/opencloud";
import { gameBanner, gameDetails, publicServers, universePlaces } from "@/api/roblox-public";
import { Badge, Button, Card, KV, List, notify, Row, Section, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { compact, fmtAgo, fmtDate, fmtInt } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { radius, useTheme } from "@/theme";

import { avatarTypeLabel, followedUniverses, followStatus, gameDetailFull, SCOPES, setFollowing } from "./api/configure";
import { cloudErrorText } from "./CloudError";
import type { Project } from "./projects";

export function OverviewTab({ project }: { project: Project }) {
	const p = useTheme();
	const { cloud } = useAccounts();
	const [more, setMore] = useState(false);
	const id = project.universeId;
	const banner = useQuery({ queryKey: ["banner", id], queryFn: () => gameBanner(id), staleTime: 3600_000 });
	const universe = useQuery({ queryKey: ["oc", "universe", id], queryFn: () => cloud!.universe(id), enabled: !!cloud, retry: false, staleTime: 300_000 });
	const places = useQuery({ queryKey: ["places", id], queryFn: () => universePlaces(id), staleTime: 300_000, retry: false });
	const servers = useQuery({ queryKey: ["servers", project.rootPlaceId], queryFn: () => publicServers(project.rootPlaceId), staleTime: 15_000, retry: false });
	const detail = useQuery({ queryKey: ["project", id, "detail"], queryFn: () => gameDetailFull(id), staleTime: 300_000, retry: false });
	const d = detail.data;

	const votes = (project.upVotes ?? 0) + (project.downVotes ?? 0);
	const u = universe.data;
	const devices = u ? [u.desktopEnabled && "Desktop", u.mobileEnabled && "Phone", u.tabletEnabled && "Tablet", u.consoleEnabled && "Console", u.vrEnabled && "VR"].filter(Boolean).join(", ") : null;
	const serverList = servers.data?.servers ?? [];

	return (
		<View style={{ gap: 12 }}>
			{banner.data ? <Image source={{ uri: banner.data }} style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.lg, backgroundColor: p.muted }} contentFit="cover" transition={200} /> : null}
			<StatGrid>
				<Stat label="Playing now" value={fmtInt(project.playing)} tone={project.playing ? "good" : undefined} />
				<Stat label="Visits" value={compact(project.visits)} />
				<Stat label="Favorites" value={compact(project.favorites)} />
				<Stat label="Likes" value={votes ? `${Math.round(((project.upVotes ?? 0) / votes) * 100)}%` : "–"} sub={votes ? `${compact(project.upVotes)} up · ${compact(project.downVotes)} down` : undefined} />
			</StatGrid>

			{project.description ? (
				<Card style={{ gap: 6 }}>
					<Txt variant="label">Description</Txt>
					<Txt numberOfLines={more ? undefined : 4} selectable>
						{project.description}
					</Txt>
					{project.description.length > 200 ? <Button title={more ? "Less" : "More"} small variant="ghost" onPress={() => setMore((v) => !v)} style={{ alignSelf: "flex-start" }} /> : null}
				</Card>
			) : null}

			<Section title="Details">
				<Card>
					<KV label="Creator" value={`${project.creator.name} (${project.creator.type})`} />
					<KV label="Universe ID" value={String(id)} mono />
					<KV label="Root place" value={String(project.rootPlaceId)} mono />
					<KV label="Created" value={fmtDate(project.created)} />
					<KV label="Updated" value={`${fmtDate(project.updated)} (${fmtAgo(project.updated)})`} />
					{d ? (
						<>
							<KV label="Genre" value={[d.genre_l1 || d.genre, d.genre_l2].filter(Boolean).join(" · ") || (d.isAllGenre ? "All" : "–")} />
							<KV label="Paid access" value={d.price ? `R$ ${fmtInt(d.price)}` : "free"} />
							<KV label="Max players" value={d.maxPlayers ? fmtInt(d.maxPlayers) : "–"} />
							<KV label="Avatar" value={avatarTypeLabel(d.universeAvatarType)} />
							<KV label="Copying" value={d.copyingAllowed ? "allowed" : "off"} />
							<KV label="Studio API access" value={d.studioAccessToApisAllowed ? "on" : "off"} />
							<KV label="Private servers allowed" value={d.createVipServersAllowed ? "yes" : "no"} />
							{d.sourceName && d.sourceName !== d.name ? <KV label="Source name" value={d.sourceName} /> : null}
						</>
					) : null}
					{u ? (
						<>
							<KV label="Visibility" value={<Badge label={(u.visibility ?? "–").toLowerCase()} tone={u.visibility === "PUBLIC" ? "good" : "muted"} />} />
							{u.ageRating ? <KV label="Maturity" value={u.ageRating.replace(/^AGE_RATING_/, "").replace(/_/g, " ").toLowerCase()} /> : null}
							{devices ? <KV label="Devices" value={devices} /> : null}
							<KV label="Voice chat" value={u.voiceChatEnabled ? "on" : "off"} />
							<KV label="Private servers" value={u.privateServerPriceRobux !== undefined && u.privateServerPriceRobux !== null ? `R$ ${u.privateServerPriceRobux}` : "off"} />
						</>
					) : null}
				</Card>
				{d?.sourceDescription && d.sourceDescription !== d.description ? (
					<Card style={{ gap: 6 }}>
						<Txt variant="label">Source-language description</Txt>
						<Txt numberOfLines={4} selectable>
							{d.sourceDescription}
						</Txt>
					</Card>
				) : null}
				<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
					<Button title="Settings" small icon="settings-outline" onPress={() => router.push(`/project/${id}/configure`)} />
					<FollowButton universeId={id} />
					<Button title="Open on Roblox" small icon="open-outline" onPress={() => WebBrowser.openBrowserAsync(`https://www.roblox.com/games/${project.rootPlaceId}`)} />
					<Button title="Creator Hub" small icon="open-outline" onPress={() => WebBrowser.openBrowserAsync(`https://create.roblox.com/dashboard/creations/experiences/${id}/overview`)} />
				</View>
				<FollowedList universeId={id} />
			</Section>

			<Section title={places.data ? `Places (${places.data.length})` : "Places"}>
				{places.isLoading ? (
					<Skeleton height={60} />
				) : places.data?.length ? (
					<List>
						{places.data.map((pl) => (
							<Row
								key={pl.id}
								title={pl.name}
								subtitle={`${pl.id}${pl.id === project.rootPlaceId ? " · start place" : ""}`}
								right={pl.id === project.rootPlaceId ? <Badge label="root" tone="brand" /> : undefined}
								chevron
								onPress={() => router.push(`/project/${id}/place?placeId=${pl.id}`)}
							/>
						))}
					</List>
				) : (
					<Txt variant="muted">{places.error ? `Roblox didn't list the places: ${(places.error as Error).message}` : "No places listed."}</Txt>
				)}
			</Section>

			<Section title={`Public servers${serverList.length ? ` (${serverList.length}${servers.data?.next ? "+" : ""})` : ""}`}>
				{servers.isLoading ? (
					<Skeleton height={60} />
				) : serverList.length ? (
					<List>
						{serverList.slice(0, 25).map((s) => (
							<Row
								key={s.id}
								title={<Txt variant="mono">{s.id.slice(0, 8)}…</Txt>}
								subtitle={`${s.fps !== undefined ? `${Math.round(s.fps)} FPS` : ""}${s.ping !== undefined ? ` · ${Math.round(s.ping)} ms ping` : ""}`}
								right={
									<Txt style={{ fontWeight: "600" }}>
										{s.playing ?? 0}
										<Txt variant="small">/{s.maxPlayers}</Txt>
									</Txt>
								}
							/>
						))}
					</List>
				) : (
					<Txt variant="muted">{servers.error ? (servers.error as Error).message : "No public servers running."}</Txt>
				)}
			</Section>
		</View>
	);
}

/** Follow / Unfollow this experience as the key's owner (needs legacy-universe.following:read and :write). */
function FollowButton({ universeId }: { universeId: number }) {
	const { cloud, keyInfo } = useAccounts();
	const queryClient = useQueryClient();
	const userId = keyInfo?.authorizedUserId ?? null;
	const canRead = !!cloud && !!userId && hasScope(keyInfo, SCOPES.followRead);
	const canWrite = canRead && hasScope(keyInfo, SCOPES.followWrite);
	const status = useQuery({ queryKey: ["oc", "follow", userId, universeId], queryFn: () => followStatus(cloud!, userId!, universeId), enabled: canRead, retry: false, staleTime: 60_000 });
	const change = useMutation({
		mutationFn: (follow: boolean) => setFollowing(cloud!, userId!, universeId, follow),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oc", "follow", userId] }),
		onError: (e) => notify("Couldn't change following", cloudErrorText(e)),
	});
	if (!canWrite || !status.data) return null;
	const following = !!status.data.IsFollowing;
	if (!following && status.data.CanFollow === false) return <Badge label="Follow limit reached" tone="warning" />;
	return (
		<Button
			title={following ? "Following" : "Follow"}
			small
			icon={following ? "notifications" : "notifications-outline"}
			variant={following ? "secondary" : "brand"}
			loading={change.isPending}
			onPress={() => change.mutate(!following)}
		/>
	);
}

/** The experiences the key's owner follows (legacy-followings v2), by name. */
function FollowedList({ universeId }: { universeId: number }) {
	const { cloud, keyInfo } = useAccounts();
	const [open, setOpen] = useState(false);
	const userId = keyInfo?.authorizedUserId ?? null;
	const canRead = !!cloud && !!userId && hasScope(keyInfo, SCOPES.followRead);
	const followed = useQuery({ queryKey: ["oc", "follow", userId, "list"], queryFn: () => followedUniverses(cloud!, userId!), enabled: canRead && open, retry: false, staleTime: 60_000 });
	const ids = Object.keys(followed.data?.followedSources ?? {})
		.map(Number)
		.filter((n) => n > 0);
	const names = useQuery({ queryKey: ["followed-names", ids.join(",")], enabled: ids.length > 0, staleTime: 600_000, queryFn: () => gameDetails(ids.slice(0, 50)) });
	if (!canRead) return null;
	return (
		<View style={{ gap: 6 }}>
			<Button title={open ? "Hide followed experiences" : "Experiences you follow"} small variant="ghost" icon="list-outline" onPress={() => setOpen((v) => !v)} style={{ alignSelf: "flex-start" }} />
			{open ? (
				followed.error ? (
					<Txt variant="small">{cloudErrorText(followed.error)}</Txt>
				) : !followed.data ? (
					<Skeleton height={40} />
				) : ids.length ? (
					<List>
						{ids.map((uid) => {
							const g = names.data?.find((x) => x.id === uid);
							const since = followed.data?.followedSources?.[String(uid)];
							return (
								<Row
									key={uid}
									title={g?.name ?? `Universe ${uid}`}
									subtitle={`${uid}${since ? ` · since ${fmtDate(since)}` : ""}`}
									right={uid === universeId ? <Badge label="this one" tone="brand" /> : undefined}
									chevron={uid !== universeId}
									onPress={uid !== universeId ? () => router.push(`/project/${uid}`) : undefined}
								/>
							);
						})}
					</List>
				) : (
					<Txt variant="muted">You don't follow any experience.</Txt>
				)
			) : null}
		</View>
	);
}
