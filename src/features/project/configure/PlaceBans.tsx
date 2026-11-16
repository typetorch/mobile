/**
 * Bans for one place (place-level user restrictions, BETA): who is banned here, ban and unban (confirm first).
 * Experience-wide bans take precedence and show as inherited; they're managed on the Bans screen.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { durationSeconds, idFromPath, type OpenCloud } from "@/api/opencloud";
import { userByName, usersByIds } from "@/api/roblox-public";
import { Badge, Button, Card, Chips, confirm, Field, List, notify, Row, Section, SkeletonList, Txt } from "@/components/ui";
import { fmtAgo, fmtSeconds } from "@/lib/format";
import { useTheme } from "@/theme";

import { placeRestrictions, setPlaceRestriction } from "../api/configure";
import { CloudError, cloudErrorText } from "../CloudError";

const DURATIONS = [
	{ value: 0, label: "Permanent" },
	{ value: 3600, label: "1 hour" },
	{ value: 86_400, label: "1 day" },
	{ value: 7 * 86_400, label: "7 days" },
	{ value: 30 * 86_400, label: "30 days" },
];

export function PlaceBans({ universeId, placeId, cloud, canWrite }: { universeId: number; placeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [who, setWho] = useState("");
	const [duration, setDuration] = useState(0);
	const [reason, setReason] = useState("");
	const [note, setNote] = useState("");
	const [formError, setFormError] = useState<string | null>(null);

	const list = useInfiniteQuery({
		queryKey: ["oc", "bans", universeId, "place", placeId],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => placeRestrictions(cloud, universeId, placeId, pageParam),
		getNextPageParam: (last) => last.nextPageToken || undefined,
		retry: false,
	});
	const active = (list.data?.pages.flatMap((pg) => pg.userRestrictions ?? []) ?? []).filter((r) => r.gameJoinRestriction?.active);
	const ids = Array.from(new Set(active.map((r) => idFromPath(r.user)).filter((n): n is number => !!n)));
	// Own key shape: bans.tsx / server.tsx cache { names, heads } under ["users", ids], VersionHistory a name map.
	const names = useQuery({ queryKey: ["users", "byId", ids.slice().sort().join(",")], enabled: ids.length > 0, staleTime: 3600_000, queryFn: async () => new Map((await usersByIds(ids)).map((u) => [u.id, u])) });

	const change = useMutation({
		mutationFn: (a: { userId: number; active: boolean }) =>
			setPlaceRestriction(cloud, universeId, placeId, a.userId, a.active ? { active: true, durationSeconds: duration || undefined, displayReason: reason, privateReason: note } : { active: false }),
		onSuccess: (_r, a) => {
			if (a.active) {
				setWho("");
				setReason("");
				setNote("");
			}
			queryClient.invalidateQueries({ queryKey: ["oc", "bans", universeId] });
		},
		onError: (e) => notify("Couldn't change the ban", cloudErrorText(e)),
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
		if (await confirm(`Ban ${label} from this place?`, `${len}, this place only. They see: “${reason || "(no reason)"}”.`, "Ban")) change.mutate({ userId, active: true });
	}

	return (
		<Section title="Place bans">
			{canWrite ? (
				<Card style={{ gap: 8 }}>
					<Field value={who} onChangeText={setWho} placeholder="Username or user ID" />
					<Chips options={DURATIONS} value={duration} onChange={setDuration} />
					<Field value={reason} onChangeText={setReason} placeholder="Reason shown to the player (400 chars)" maxLength={400} />
					<Field value={note} onChangeText={setNote} placeholder="Private note (1000 chars)" maxLength={1000} />
					<Button title="Ban from this place" variant="destructive" icon="ban-outline" small loading={change.isPending && change.variables?.active} disabled={!who.trim()} onPress={ban} style={{ alignSelf: "flex-start" }} />
					{formError ? <Txt variant="small" color={p.destructive}>{formError}</Txt> : null}
				</Card>
			) : null}
			{list.error ? (
				<CloudError error={list.error} what="Place bans" onRetry={() => list.refetch()} />
			) : !list.data ? (
				<SkeletonList rows={2} />
			) : active.length ? (
				<>
					<List>
						{active.map((r) => {
							const id = idFromPath(r.user);
							const u = id ? names.data?.get(id) : undefined;
							const g = r.gameJoinRestriction!;
							const secs = durationSeconds(g.duration);
							return (
								<Row
									key={r.path}
									title={u ? `${u.displayName} (@${u.name})` : `User ${id}`}
									subtitle={`${secs ? fmtSeconds(secs) : "permanent"} · since ${fmtAgo(g.startTime)}${g.displayReason ? ` · “${g.displayReason}”` : ""}`}
									right={
										g.inherited ? (
											<Badge label="experience" />
										) : canWrite && id ? (
											<Button
												title="Unban"
												small
												loading={change.isPending && change.variables?.userId === id && !change.variables.active}
												onPress={async () => {
													if (await confirm(`Unban ${u ? `@${u.name}` : `user ${id}`} from this place?`, "They can join this place again (an experience-wide ban still applies).", "Unban", false))
														change.mutate({ userId: id, active: false });
												}}
											/>
										) : undefined
									}
								/>
							);
						})}
					</List>
					{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</>
			) : (
				<Txt variant="muted">Nobody is banned from this place.</Txt>
			)}
		</Section>
	);
}
