/**
 * An experience's overview, like Creator Hub's: banner, stats, settings (Open Cloud universe, when the key reaches
 * it), places and public servers.
 */
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";

import { gameBanner, publicServers, universePlaces } from "@/api/roblox-public";
import { Badge, Button, Card, KV, List, Row, Section, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { compact, fmtAgo, fmtDate, fmtInt } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { radius, useTheme } from "@/theme";

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
				<View style={{ flexDirection: "row", gap: 8 }}>
					<Button title="Open on Roblox" small icon="open-outline" onPress={() => WebBrowser.openBrowserAsync(`https://www.roblox.com/games/${project.rootPlaceId}`)} />
					<Button title="Creator Hub" small icon="open-outline" onPress={() => WebBrowser.openBrowserAsync(`https://create.roblox.com/dashboard/creations/experiences/${id}/overview`)} />
				</View>
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
								onPress={() => WebBrowser.openBrowserAsync(`https://create.roblox.com/dashboard/creations/experiences/${id}/places/${pl.id}/configure`)}
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
