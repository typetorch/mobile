/**
 * Bans (Open Cloud user restrictions): who is banned, the change log, ban and unban (both confirm first; ban /
 * unban need universe.user-restriction:write).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { durationSeconds, idFromPath, type OpenCloud } from "@/api/opencloud";
import { headshots, userByName, usersByIds } from "@/api/roblox-public";
import { Image } from "expo-image";
import { Badge, Button, Card, Chips, confirm, EmptyState, ErrorState, Field, List, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtDate, fmtSeconds } from "@/lib/format";
import { useTheme } from "@/theme";

export default function BansScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Bans" scopes={["universe.user-restriction:read"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "bans"], type: "active" })}>
			{({ universeId, cloud, can }) => <Bans universeId={universeId} cloud={cloud} canWrite={can("universe.user-restriction:write")} />}
		</ToolScreen>
	);
}

const DURATIONS = [
	{ value: 0, label: "Permanent" },
	{ value: 3600, label: "1 hour" },
	{ value: 86_400, label: "1 day" },
	{ value: 7 * 86_400, label: "7 days" },
	{ value: 30 * 86_400, label: "30 days" },
];

function useNames(ids: number[]) {
	return useQuery({
		queryKey: ["users", ids.slice().sort().join(",")],
		enabled: ids.length > 0,
		staleTime: 3600_000,
		queryFn: async () => {
			const [users, heads] = await Promise.all([usersByIds(ids), headshots(ids).catch(() => ({}) as Record<number, string>)]);
			return { names: new Map(users.map((u) => [u.id, u])), heads };
		},
	});
}

function Bans({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [view, setView] = useState<"banned" | "log">("banned");
	const [who, setWho] = useState("");
	const [duration, setDuration] = useState(0);
	const [displayReason, setDisplayReason] = useState("");
	const [privateReason, setPrivateReason] = useState("");
	const [alts, setAlts] = useState(true);
	const [formError, setFormError] = useState<string | null>(null);

	const list = useInfiniteQuery({
		queryKey: ["oc", "bans", universeId, "list"],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => cloud.listRestrictions(universeId, pageParam),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const logs = useInfiniteQuery({
		queryKey: ["oc", "bans", universeId, "logs"],
		enabled: view === "log",
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => cloud.restrictionLogs(universeId, pageParam),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const active = (list.data?.pages.flatMap((pg) => pg.userRestrictions ?? []) ?? []).filter((r) => r.gameJoinRestriction?.active);
	const logRows = logs.data?.pages.flatMap((pg) => pg.logs ?? []) ?? [];
	const ids = Array.from(new Set([...active.map((r) => idFromPath(r.user)), ...logRows.map((l) => idFromPath(l.user))].filter((n): n is number => !!n)));
	const names = useNames(ids);

	const change = useMutation({
		mutationFn: (args: { userId: number; active: boolean }) =>
			cloud.setRestriction(universeId, args.userId, {
				active: args.active,
				...(args.active ? { durationSeconds: duration || undefined, displayReason, privateReason, excludeAltAccounts: !alts } : {}),
			}),
		onSuccess: () => {
			setWho("");
			setDisplayReason("");
			setPrivateReason("");
			queryClient.invalidateQueries({ queryKey: ["oc", "bans", universeId] });
		},
	});

	async function ban() {
		setFormError(null);
		const text = who.trim();
		let userId: number | null = /^\d+$/.test(text) ? Number(text) : null;
		let label = text;
		try {
			if (!userId) {
				const u = await userByName(text);
				if (!u) throw new Error(`No Roblox user is called “${text}”.`);
				userId = u.id;
				label = `@${u.name}`;
			}
		} catch (e) {
			setFormError((e as Error).message);
			return;
		}
		const len = DURATIONS.find((d) => d.value === duration)?.label.toLowerCase() ?? "";
		if (await confirm(`Ban ${label}?`, `${len} from every place of this experience${alts ? ", alt accounts included" : ""}. They see: “${displayReason || "(no reason)"}”.`, "Ban")) change.mutate({ userId, active: true });
	}

	const nameOf = (id: number | null) => (id ? names.data?.names.get(id) : undefined);

	return (
		<>
			{canWrite ? (
				<Card style={{ gap: 8 }}>
					<Txt variant="h3">Ban a player</Txt>
					<Field value={who} onChangeText={setWho} placeholder="Username or user ID" />
					<Chips options={DURATIONS} value={duration} onChange={setDuration} />
					<Field value={displayReason} onChangeText={setDisplayReason} placeholder="Reason shown to the player (400 chars)" maxLength={400} />
					<Field value={privateReason} onChangeText={setPrivateReason} placeholder="Private note (1000 chars)" maxLength={1000} />
					<Segmented options={[{ value: 1, label: "Ban alts too" }, { value: 0, label: "Only this account" }]} value={alts ? 1 : 0} onChange={(v) => setAlts(v === 1)} />
					<Button title="Ban" variant="destructive" icon="ban-outline" small loading={change.isPending} disabled={!who.trim()} onPress={ban} style={{ alignSelf: "flex-start" }} />
					{formError ? <Txt variant="small" color={p.destructive}>{formError}</Txt> : null}
					{change.error ? <Txt variant="small" color={p.destructive}>{(change.error as Error).message}</Txt> : null}
				</Card>
			) : (
				<Txt variant="small">Read only: add universe.user-restriction:write to ban and unban.</Txt>
			)}

			<Segmented options={[{ value: "banned", label: `Banned${list.data ? ` (${active.length}${list.hasNextPage ? "+" : ""})` : ""}` }, { value: "log", label: "Log" }]} value={view} onChange={setView} />

			{view === "banned" ? (
				list.error ? (
					<ErrorState error={list.error} onRetry={() => list.refetch()} />
				) : !list.data ? (
					<SkeletonList rows={5} />
				) : active.length ? (
					<Section>
						<List>
							{active.map((r) => {
								const id = idFromPath(r.user);
								const u = nameOf(id);
								const g = r.gameJoinRestriction!;
								const secs = durationSeconds(g.duration);
								const ends = secs && g.startTime ? Date.parse(g.startTime) + secs * 1000 : null;
								return (
									<Row
										key={r.path}
										left={id && names.data?.heads[id] ? <Image source={{ uri: names.data.heads[id] }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : undefined}
										title={u ? `${u.displayName} (@${u.name})` : `User ${id}`}
										subtitle={`${secs ? `${fmtSeconds(secs)}, ends ${fmtDate(ends)}` : "permanent"} · since ${fmtAgo(g.startTime)}${g.displayReason ? ` · “${g.displayReason}”` : ""}${g.inherited ? " · from the universe" : ""}`}
										numberOfLines={2}
										right={
											canWrite && id ? (
												<Button
													title="Unban"
													small
													loading={change.isPending && change.variables?.userId === id}
													onPress={async () => {
														if (await confirm(`Unban ${u ? `@${u.name}` : `user ${id}`}?`, "They can join every place of this experience again.", "Unban", false)) change.mutate({ userId: id, active: false });
													}}
												/>
											) : undefined
										}
									/>
								);
							})}
						</List>
						{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
					</Section>
				) : (
					<EmptyState icon="happy-outline" title="Nobody is banned" body="Bans made here, in Creator Hub or with BanAsync in game show up here." />
				)
			) : logs.error ? (
				<ErrorState error={logs.error} onRetry={() => logs.refetch()} />
			) : !logs.data ? (
				<SkeletonList rows={5} />
			) : logRows.length ? (
				<Section>
					<List>
						{logRows.map((l, i) => {
							const id = idFromPath(l.user);
							const u = nameOf(id);
							const mod = l.moderator?.robloxUser ? `by user ${idFromPath(l.moderator.robloxUser)}` : l.moderator?.gameServerScript ? "by a game script" : "";
							return (
								<Row
									key={i}
									left={<Badge label={l.active ? "ban" : "unban"} tone={l.active ? "critical" : "good"} />}
									title={u ? `@${u.name}` : `User ${id}`}
									subtitle={`${fmtAgo(l.createTime)} ${mod}${l.active ? ` · ${fmtSeconds(durationSeconds(l.duration))}` : ""}${l.displayReason ? ` · “${l.displayReason}”` : ""}${l.privateReason ? ` · note: ${l.privateReason}` : ""}`}
									numberOfLines={3}
								/>
							);
						})}
					</List>
					{logs.hasNextPage ? <Button title="Load more" small loading={logs.isFetchingNextPage} onPress={() => logs.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</Section>
			) : (
				<View>
					<Txt variant="muted">No ban changes logged.</Txt>
				</View>
			)}
		</>
	);
}
