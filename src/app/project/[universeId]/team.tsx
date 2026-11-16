/**
 * Collaboration (legacy-develop Team Create, EXPERIMENTAL): Team Create on / off, who is editing a place in Studio
 * right now, remove someone's Team Create membership, and close a Team Test server by its game id. Every change asks
 * first. Listing or adding collaborators has no API.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { headshots, userByName } from "@/api/roblox-public";
import { Image } from "expo-image";
import { Badge, Button, Card, confirm, Field, List, notify, Row, Section, SkeletonList, Txt } from "@/components/ui";
import { activeSessionMembers, closeTeamTest, GUID_RE, removeTeamCreateMember, setTeamCreate, teamCreate } from "@/features/project/api/configure";
import { PlacePicker, SwitchRow, useUniversePlaces } from "@/features/project/configure/shared";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { useTheme } from "@/theme";

export default function TeamScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Collaboration" scopes={["legacy-team-collaboration:manage"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "team"], type: "active" })}>
			{({ universeId, cloud }) => <Team universeId={universeId} cloud={cloud} />}
		</ToolScreen>
	);
}

function Team({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const queryClient = useQueryClient();
	const settings = useQuery({ queryKey: ["oc", "team", universeId, "settings"], queryFn: () => teamCreate(cloud, universeId), retry: false });
	const toggle = useMutation({
		mutationFn: (on: boolean) => setTeamCreate(cloud, universeId, on),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oc", "team", universeId] }),
		onError: (e) => notify("Couldn't change Team Create", cloudErrorText(e)),
	});
	const enabled = !!settings.data?.isEnabled;
	return (
		<>
			<Section title="Team Create">
				{settings.error ? (
					<CloudError error={settings.error} what="Team Create" onRetry={() => settings.refetch()} />
				) : !settings.data ? (
					<SkeletonList rows={1} />
				) : (
					<Card>
						<SwitchRow
							label="Collaborative editing"
							hint="Lets collaborators edit the places together in Studio."
							value={enabled}
							disabled={toggle.isPending}
							onChange={async (on) => {
								const ok = on
									? await confirm("Turn on Team Create?", "Collaborators can open and edit the places together in Studio.", "Turn on", false)
									: await confirm("Turn off Team Create?", "People editing in Studio are disconnected from the shared session.", "Turn off");
								if (ok) toggle.mutate(on);
							}}
						/>
					</Card>
				)}
			</Section>
			{enabled ? <ActiveSession universeId={universeId} cloud={cloud} /> : null}
			<RemoveMember universeId={universeId} cloud={cloud} />
			<CloseTeamTest universeId={universeId} cloud={cloud} />
		</>
	);
}

function ActiveSession({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const queryClient = useQueryClient();
	const { places, rootId, loading } = useUniversePlaces(universeId, cloud);
	const [placeId, setPlaceId] = useState<number | null>(null);
	const pid = placeId ?? rootId;
	const members = useInfiniteQuery({
		queryKey: ["oc", "team", universeId, "session", pid],
		enabled: !!pid,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => activeSessionMembers(cloud, pid!, pageParam),
		getNextPageParam: (last) => last.nextPageCursor || undefined,
		retry: false,
	});
	const rows = members.data?.pages.flatMap((pg) => pg.data ?? []) ?? [];
	const heads = useQuery({ queryKey: ["heads", rows.map((r) => r.id).join(",")], enabled: rows.length > 0, staleTime: 3600_000, queryFn: () => headshots(rows.map((r) => r.id)) });
	const remove = useMutation({
		mutationFn: (userId: number) => removeTeamCreateMember(cloud, universeId, userId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oc", "team", universeId] }),
		onError: (e) => notify("Couldn't remove them", cloudErrorText(e)),
	});
	return (
		<Section title="In Studio now">
			<PlacePicker places={places} rootId={rootId} value={pid} onChange={setPlaceId} loading={loading} />
			{members.error ? (
				<CloudError error={members.error} what="Team Create session" onRetry={() => members.refetch()} />
			) : !members.data ? (
				<SkeletonList rows={2} />
			) : rows.length ? (
				<>
					<List>
						{rows.map((m) => (
							<Row
								key={m.id}
								left={heads.data?.[m.id] ? <Image source={{ uri: heads.data[m.id] }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : undefined}
								title={`${m.displayName} (@${m.name})`}
								subtitle={String(m.id)}
								right={
									<Button
										title="Remove"
										small
										variant="destructive"
										loading={remove.isPending && remove.variables === m.id}
										onPress={async () => {
											if (await confirm(`Remove @${m.name} from Team Create?`, "They lose Team Create access to this experience and are dropped from the session.", "Remove")) remove.mutate(m.id);
										}}
									/>
								}
							/>
						))}
					</List>
					{members.hasNextPage ? <Button title="Load more" small loading={members.isFetchingNextPage} onPress={() => members.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</>
			) : (
				<Txt variant="muted">Nobody is editing this place right now.</Txt>
			)}
		</Section>
	);
}

function RemoveMember({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [who, setWho] = useState("");
	const [error, setError] = useState<string | null>(null);
	const remove = useMutation({
		mutationFn: (userId: number) => removeTeamCreateMember(cloud, universeId, userId),
		onSuccess: () => {
			setWho("");
			queryClient.invalidateQueries({ queryKey: ["oc", "team", universeId] });
			notify("Removed", "Their Team Create membership is gone.");
		},
		onError: (e) => notify("Couldn't remove them", cloudErrorText(e)),
	});
	async function submit() {
		setError(null);
		const text = who.trim();
		let userId: number | null = /^\d+$/.test(text) ? Number(text) : null;
		let label = `user ${text}`;
		if (!userId) {
			try {
				const u = await userByName(text);
				if (!u) return setError(`No Roblox user is called “${text}”.`);
				userId = u.id;
				label = `@${u.name}`;
			} catch (e) {
				return setError((e as Error).message);
			}
		}
		if (await confirm(`Remove ${label} from Team Create?`, "They lose Team Create access to this experience.", "Remove")) remove.mutate(userId);
	}
	return (
		<Section title="Remove a collaborator">
			<Card style={{ gap: 8 }}>
				<Field value={who} onChangeText={setWho} placeholder="Username or user ID" />
				{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
				<Button title="Remove" small variant="destructive" loading={remove.isPending} disabled={!who.trim()} onPress={submit} style={{ alignSelf: "flex-start" }} />
				<Txt variant="small">Roblox has no API to list or add collaborators; add them on Creator Hub.</Txt>
			</Card>
		</Section>
	);
}

function CloseTeamTest({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const { places, rootId, loading } = useUniversePlaces(universeId, cloud);
	const [placeId, setPlaceId] = useState<number | null>(null);
	const [gameId, setGameId] = useState("");
	const pid = placeId ?? rootId;
	const close = useMutation({
		mutationFn: () => closeTeamTest(cloud, pid!, gameId.trim().toLowerCase()),
		onSuccess: () => {
			setGameId("");
			notify("Closed", "The Team Test server is shutting down.");
		},
		onError: (e) => notify("Couldn't close it", cloudErrorText(e)),
	});
	const valid = GUID_RE.test(gameId.trim());
	return (
		<Section title="Close a Team Test server">
			<Card style={{ gap: 8 }}>
				<PlacePicker places={places} rootId={rootId} value={pid} onChange={setPlaceId} loading={loading} />
				<Field value={gameId} onChangeText={setGameId} placeholder="Game id (server GUID)" />
				{gameId.trim() && !valid ? <Txt variant="small" color={p.destructive}>A game id looks like 1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f.</Txt> : null}
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Button
						title="Close server"
						small
						variant="destructive"
						loading={close.isPending}
						disabled={!valid || !pid}
						onPress={async () => {
							if (await confirm("Close this Team Test server?", "Everyone testing in it is disconnected.", "Close")) close.mutate();
						}}
					/>
					<Badge label="needs the job id" />
				</View>
				<Txt variant="small">Roblox doesn't list Team Test servers; copy the job id from Studio or the Servers tool.</Txt>
			</Card>
		</Section>
	);
}
