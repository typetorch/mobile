/**
 * Bans (Open Cloud user restrictions, BETA) for the whole experience or one place: check one player's ban, who is
 * banned, the change log (filterable by player and place), ban and unban (both confirm first and send an idempotency
 * key; they need universe.user-restriction:write). A place-level ban shows "from the experience" when it is inherited.
 * Opens on a player when the route has ?user=<id> (from the server screen).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { durationSeconds, idFromPath, type OpenCloud, type UserRestriction } from "@/api/opencloud";
import { headshots, userByName, usersByIds, type RobloxUser } from "@/api/roblox-public";
import { Badge, Button, Card, Chips, confirm, EmptyState, Field, KV, List, notify, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { getRestriction, listRestrictionsAt, restrictionLogsFiltered, setRestrictionAt } from "@/features/project/api/servers";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { placeName, usePlaces } from "@/features/project/servers/shared";
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
		queryKey: ["users", "with-heads", ids.slice().sort().join(",")],
		enabled: ids.length > 0,
		staleTime: 3600_000,
		queryFn: async () => {
			const [users, heads] = await Promise.all([usersByIds(ids), headshots(ids).catch(() => ({}) as Record<number, string>)]);
			return { names: new Map(users.map((u) => [u.id, u])), heads };
		},
	});
}

/** "123" or "name" -> the user; throws a readable error. */
async function resolveUser(text: string): Promise<{ id: number; label: string }> {
	const t = text.trim().replace(/^@/, "");
	if (/^\d{1,20}$/.test(t)) return { id: Number(t), label: `user ${t}` };
	if (!/^[A-Za-z0-9_]{3,20}$/.test(t)) throw new Error("Type a username (3-20 letters, digits or _) or a user ID.");
	const u = await userByName(t);
	if (!u) throw new Error(`No Roblox user is called “${t}”.`);
	return { id: u.id, label: `@${u.name}` };
}

function restrictionLine(g: NonNullable<UserRestriction["gameJoinRestriction"]>): string {
	const secs = durationSeconds(g.duration);
	const ends = secs && g.startTime ? Date.parse(g.startTime) + secs * 1000 : null;
	return `${secs ? `${fmtSeconds(secs)}, ends ${fmtDate(ends)}` : "permanent"} · since ${fmtAgo(g.startTime)}${g.displayReason ? ` · “${g.displayReason}”` : ""}${g.inherited ? " · from the experience" : ""}`;
}

function Bans({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const params = useLocalSearchParams<{ user?: string }>();
	const places = usePlaces(universeId);
	const [where, setWhere] = useState(0); // 0 = the whole experience, else a place id
	const placeId = where || null;
	const [view, setView] = useState<"banned" | "log">("banned");
	const [who, setWho] = useState("");
	const [duration, setDuration] = useState(0);
	const [displayReason, setDisplayReason] = useState("");
	const [privateReason, setPrivateReason] = useState("");
	const [alts, setAlts] = useState(true);
	const [formError, setFormError] = useState<string | null>(null);
	const [checkText, setCheckText] = useState(params.user ?? "");
	const [checked, setChecked] = useState<{ id: number; label: string } | null>(null);
	const [checkError, setCheckError] = useState<string | null>(null);
	const [logUser, setLogUser] = useState<{ id: number; label: string } | null>(null);
	const [logUserText, setLogUserText] = useState("");

	const scopeLabel = placeId ? `the place ${placeName(places.data, placeId)}` : "every place of this experience";

	const list = useInfiniteQuery({
		queryKey: ["oc", "bans", universeId, "list", placeId],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listRestrictionsAt(cloud, universeId, placeId, pageParam),
		getNextPageParam: (last) => last.nextPageToken || undefined,
		retry: false,
	});
	const logs = useInfiniteQuery({
		queryKey: ["oc", "bans", universeId, "logs", placeId, logUser?.id ?? null],
		enabled: view === "log",
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => restrictionLogsFiltered(cloud, universeId, { userId: logUser?.id, placeId }, pageParam),
		getNextPageParam: (last) => last.nextPageToken || undefined,
		retry: false,
	});
	const check = useQuery({
		queryKey: ["oc", "bans", universeId, "check", placeId, checked?.id ?? null],
		enabled: !!checked,
		queryFn: () => getRestriction(cloud, universeId, placeId, checked!.id),
		retry: false,
	});

	// Opened from a server's player list: check that player at once.
	useEffect(() => {
		if (params.user && /^\d+$/.test(params.user)) setChecked({ id: Number(params.user), label: `user ${params.user}` });
	}, [params.user]);

	const active = (list.data?.pages.flatMap((pg) => pg.userRestrictions ?? []) ?? []).filter((r) => r.gameJoinRestriction?.active);
	const logRows = logs.data?.pages.flatMap((pg) => pg.logs ?? []) ?? [];
	const ids = Array.from(
		new Set([...active.map((r) => idFromPath(r.user)), ...logRows.map((l) => idFromPath(l.user)), ...logRows.map((l) => idFromPath(l.moderator?.robloxUser)), checked?.id ?? null].filter((n): n is number => !!n)),
	);
	const names = useNames(ids);
	const nameOf = (id: number | null): RobloxUser | undefined => (id ? names.data?.names.get(id) : undefined);

	const change = useMutation({
		mutationFn: (args: { userId: number; active: boolean }) =>
			setRestrictionAt(cloud, universeId, placeId, args.userId, args.active ? { active: true, durationSeconds: duration || undefined, displayReason, privateReason, excludeAltAccounts: !alts } : { active: false }),
		onSuccess: (_r, args) => {
			if (args.active) {
				setWho("");
				setDisplayReason("");
				setPrivateReason("");
			}
			queryClient.invalidateQueries({ queryKey: ["oc", "bans", universeId] });
		},
		onError: (e) => notify("Couldn't change the ban", cloudErrorText(e)),
	});

	async function ban() {
		setFormError(null);
		let user: { id: number; label: string };
		try {
			if (displayReason.length > 400) throw new Error("The reason shown to the player is at most 400 characters.");
			if (privateReason.length > 1000) throw new Error("The private note is at most 1000 characters.");
			user = await resolveUser(who);
		} catch (e) {
			setFormError((e as Error).message);
			return;
		}
		const len = DURATIONS.find((d) => d.value === duration)?.label.toLowerCase() ?? "";
		if (await confirm(`Ban ${user.label}?`, `${len} from ${scopeLabel}${alts ? ", alt accounts included" : ""}. They see: “${displayReason || "(no reason)"}”.`, "Ban")) change.mutate({ userId: user.id, active: true });
	}

	async function unban(id: number) {
		const u = nameOf(id);
		if (await confirm(`Unban ${u ? `@${u.name}` : `user ${id}`}?`, `They can join ${scopeLabel} again.`, "Unban", false)) change.mutate({ userId: id, active: false });
	}

	async function runCheck() {
		setCheckError(null);
		try {
			setChecked(await resolveUser(checkText));
		} catch (e) {
			setCheckError((e as Error).message);
		}
	}

	const g = check.data?.gameJoinRestriction;
	const checkedUser = nameOf(checked?.id ?? null);

	return (
		<>
			<Section title="Where">
				<Chips options={[{ value: 0, label: "Whole experience" }, ...(places.data ?? []).map((pl) => ({ value: pl.id, label: pl.name }))]} value={where} onChange={setWhere} />
				{placeId ? <Txt variant="small">Place-level bans only block this place. Experience bans apply here too and show as inherited.</Txt> : null}
			</Section>

			<Card style={{ gap: 8 }}>
				<Txt variant="h3">Check a player</Txt>
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<View style={{ flex: 1 }}>
						<Field value={checkText} onChangeText={setCheckText} placeholder="Username or user ID" onSubmitEditing={runCheck} />
					</View>
					<Button title="Check" small disabled={!checkText.trim()} onPress={runCheck} />
				</View>
				{checkError ? <Txt variant="small" color={p.destructive}>{checkError}</Txt> : null}
				{checked ? (
					check.error ? (
						<CloudError error={check.error} what="Bans" onRetry={() => check.refetch()} />
					) : !check.data ? (
						<SkeletonList rows={1} />
					) : (
						<View style={{ gap: 2 }}>
							<KV label="Player" value={checkedUser ? `${checkedUser.displayName} (@${checkedUser.name})` : checked.label} />
							<KV label="Status" value={<Badge label={g?.active ? "banned" : "not banned"} tone={g?.active ? "critical" : "good"} />} />
							{g?.active ? (
								<>
									<KV label="Ban" value={restrictionLine(g)} />
									{g.privateReason ? <KV label="Private note" value={g.privateReason} /> : null}
									<KV label="Alt accounts" value={g.excludeAltAccounts ? "not included" : "included"} />
								</>
							) : null}
							<View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
								{canWrite && g?.active && !g.inherited ? <Button title="Unban" small loading={change.isPending} onPress={() => unban(checked.id)} /> : null}
								{canWrite && !g?.active ? <Button title="Ban…" small onPress={() => setWho(String(checked.id))} /> : null}
								<Button
									title="Ban history"
									small
									onPress={() => {
										setLogUser(checked);
										setView("log");
									}}
								/>
							</View>
						</View>
					)
				) : null}
			</Card>

			{canWrite ? (
				<Card style={{ gap: 8 }}>
					<Txt variant="h3">Ban a player</Txt>
					<Field value={who} onChangeText={setWho} placeholder="Username or user ID" />
					<Chips options={DURATIONS} value={duration} onChange={setDuration} />
					<Field value={displayReason} onChangeText={setDisplayReason} placeholder="Reason shown to the player (400 chars)" maxLength={400} />
					<Field value={privateReason} onChangeText={setPrivateReason} placeholder="Private note (1000 chars)" maxLength={1000} />
					<Segmented options={[{ value: 1, label: "Ban alts too" }, { value: 0, label: "Only this account" }]} value={alts ? 1 : 0} onChange={(v) => setAlts(v === 1)} />
					<Txt variant="small">Applies to {scopeLabel}.</Txt>
					<Button title="Ban" variant="destructive" icon="ban-outline" small loading={change.isPending} disabled={!who.trim()} onPress={ban} style={{ alignSelf: "flex-start" }} />
					{formError ? <Txt variant="small" color={p.destructive}>{formError}</Txt> : null}
				</Card>
			) : (
				<Txt variant="small">Read only: add universe.user-restriction:write to ban and unban.</Txt>
			)}

			<Segmented options={[{ value: "banned", label: `Banned${list.data ? ` (${active.length}${list.hasNextPage ? "+" : ""})` : ""}` }, { value: "log", label: "Log" }]} value={view} onChange={setView} />

			{view === "banned" ? (
				list.error ? (
					<CloudError error={list.error} what="Bans" onRetry={() => list.refetch()} />
				) : !list.data ? (
					<SkeletonList rows={5} />
				) : active.length ? (
					<Section>
						<List>
							{active.map((r) => {
								const id = idFromPath(r.user);
								const u = nameOf(id);
								const gj = r.gameJoinRestriction!;
								return (
									<Row
										key={r.path}
										left={id && names.data?.heads[id] ? <Image source={{ uri: names.data.heads[id] }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : undefined}
										title={u ? `${u.displayName} (@${u.name})` : `User ${id}`}
										subtitle={restrictionLine(gj)}
										numberOfLines={2}
										right={canWrite && id && !gj.inherited ? <Button title="Unban" small loading={change.isPending && change.variables?.userId === id} onPress={() => unban(id)} /> : undefined}
									/>
								);
							})}
						</List>
						{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
					</Section>
				) : (
					<EmptyState icon="happy-outline" title="Nobody is banned" body={`Bans made here, in Creator Hub or with BanAsync in game show up here${placeId ? " (for this place)" : ""}.`} />
				)
			) : (
				<>
					<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
						<View style={{ flex: 1 }}>
							{logUser ? (
								<Row title={`Only ${nameOf(logUser.id) ? `@${nameOf(logUser.id)!.name}` : logUser.label}`} right={<Button title="All players" small onPress={() => setLogUser(null)} />} />
							) : (
								<Field
									value={logUserText}
									onChangeText={setLogUserText}
									placeholder="Filter by username or user ID"
									onSubmitEditing={async () => {
										try {
											setLogUser(await resolveUser(logUserText));
										} catch (e) {
											notify("Can't filter", (e as Error).message);
										}
									}}
								/>
							)}
						</View>
					</View>
					{logs.error ? (
						<CloudError error={logs.error} what="Ban log" onRetry={() => logs.refetch()} />
					) : !logs.data ? (
						<SkeletonList rows={5} />
					) : logRows.length ? (
						<Section>
							<List>
								{logRows.map((l, i) => {
									const id = idFromPath(l.user);
									const u = nameOf(id);
									const modId = idFromPath(l.moderator?.robloxUser);
									const mod = modId ? `by ${nameOf(modId) ? `@${nameOf(modId)!.name}` : `user ${modId}`}` : l.moderator?.gameServerScript ? "by a game script" : "";
									const pl = idFromPath(l.place);
									return (
										<Row
											key={i}
											left={<Badge label={l.active ? "ban" : "unban"} tone={l.active ? "critical" : "good"} />}
											title={u ? `@${u.name}` : `User ${id}`}
											subtitle={`${fmtAgo(l.createTime)} ${mod}${pl ? ` · ${placeName(places.data, pl)}` : ""}${l.active ? ` · ${fmtSeconds(durationSeconds(l.duration))}` : ""}${l.excludeAltAccounts === false && l.active ? " · alts too" : ""}${l.displayReason ? ` · “${l.displayReason}”` : ""}${l.privateReason ? ` · note: ${l.privateReason}` : ""}`}
											numberOfLines={3}
										/>
									);
								})}
							</List>
							{logs.hasNextPage ? <Button title="Load more" small loading={logs.isFetchingNextPage} onPress={() => logs.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
						</Section>
					) : (
						<Txt variant="muted">No ban changes logged{logUser || placeId ? " for this filter" : ""}.</Txt>
					)}
				</>
			)}
		</>
	);
}
