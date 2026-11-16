/**
 * Notifications: the experience's notification strings (the messageIds that in-game OpenCloud / ExperienceNotification
 * and Create User Notification send), a form to create one, and the notification analytics over a period. Tap a
 * string to edit, archive or test-send it.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, Chips, EmptyState, Field, List, notify, Row, Section, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import {
	createNotificationString,
	ENG_SCOPES,
	listNotificationStrings,
	NOTIFICATION_CONTENT_MAX,
	notificationAnalytics,
	notificationParams,
	validateNotification,
} from "@/features/project/api/engagement";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { useTheme } from "@/theme";

export default function NotificationsScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Notifications" scopes={[ENG_SCOPES.notifRead]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "notifications"], type: "active" })}>
			{({ universeId, cloud, can }) => <Notifications universeId={universeId} cloud={cloud} canWrite={can(ENG_SCOPES.notifWrite)} canAnalytics={can(ENG_SCOPES.analyticsRead)} />}
		</ToolScreen>
	);
}

function Notifications({ universeId, cloud, canWrite, canAnalytics }: { universeId: number; cloud: OpenCloud; canWrite: boolean; canAnalytics: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [content, setContent] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [showForm, setShowForm] = useState(false);

	const list = useInfiniteQuery({
		queryKey: ["oc", "notifications", universeId, "list"],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listNotificationStrings(cloud, universeId, pageParam),
		getNextPageParam: (last) => last.nextPageCursor || undefined,
		retry: false,
	});
	const strings = list.data?.pages.flatMap((pg) => pg.notificationStringConfigs ?? []) ?? [];

	const create = useMutation({
		mutationFn: () => createNotificationString(cloud, universeId, name.trim(), content.trim()),
		onSuccess: (r) => {
			setName("");
			setContent("");
			setShowForm(false);
			queryClient.invalidateQueries({ queryKey: ["oc", "notifications", universeId] });
			if (r?.id) router.push(`/project/${universeId}/notification?id=${encodeURIComponent(r.id)}`);
		},
		onError: (e) => notify("Couldn't create it", cloudErrorText(e)),
	});

	function onCreate() {
		const error = validateNotification(name, content.trim());
		setFormError(error);
		if (!error) create.mutate();
	}

	const params = notificationParams(content);
	return (
		<>
			{canWrite ? (
				showForm ? (
					<Card style={{ gap: 8 }}>
						<Txt variant="h3">New notification string</Txt>
						<Field label="Name (only you see it)" value={name} onChangeText={setName} placeholder="Quest done" autoCapitalize="sentences" maxLength={200} />
						<Field
							label="Text"
							value={content}
							onChangeText={setContent}
							placeholder="{userId-friend} beat your score in {experienceName}!"
							autoCapitalize="sentences"
							maxLength={NOTIFICATION_CONTENT_MAX}
							hint={`${content.length} / ${NOTIFICATION_CONTENT_MAX}. {experienceName} is filled in by Roblox; other {parameters} are sent with each notification.${params.length ? ` Parameters: ${params.join(", ")}.` : ""} Roblox moderates the text.`}
						/>
						{formError ? <Txt variant="small" color={p.destructive}>{formError}</Txt> : null}
						<Button title="Create" variant="brand" icon="add" small loading={create.isPending} onPress={onCreate} style={{ alignSelf: "flex-start" }} />
					</Card>
				) : (
					<Button title="New notification string" icon="add" variant="brand" onPress={() => setShowForm(true)} style={{ alignSelf: "flex-start" }} />
				)
			) : (
				<Txt variant="small">Read only: add {ENG_SCOPES.notifWrite} to create, edit and archive notification strings.</Txt>
			)}

			{list.error ? (
				<CloudError error={list.error} what="Notification strings" onRetry={() => list.refetch()} />
			) : !list.data ? (
				<SkeletonList rows={4} />
			) : strings.length ? (
				<Section title="Notification strings">
					<List>
						{strings.map((s) => (
							<Row
								key={s.id ?? s.name}
								title={s.name || "(no name)"}
								subtitle={s.content ?? ""}
								numberOfLines={2}
								chevron
								onPress={() => s.id && router.push(`/project/${universeId}/notification?id=${encodeURIComponent(s.id)}`)}
							/>
						))}
					</List>
					{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</Section>
			) : (
				<EmptyState icon="notifications-outline" title="No notification strings" body="Create one, then send it from a game server or with Create User Notification." />
			)}

			{canAnalytics ? <Analytics universeId={universeId} cloud={cloud} /> : <Txt variant="small">Add {ENG_SCOPES.analyticsRead} to see notification analytics.</Txt>}
		</>
	);
}

const PERIODS = [
	{ value: 7, label: "7 days" },
	{ value: 28, label: "28 days" },
	{ value: 90, label: "90 days" },
];

function label(key: string): string {
	return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function show(value: unknown): string {
	if (value === null || value === undefined) return "–";
	if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3);
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** The untyped analytics answer: the overview map as stats, each campaign as a row of its fields. */
function Analytics({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const [days, setDays] = useState(28);
	const q = useQuery({
		queryKey: ["oc", "notifications", universeId, "analytics", days],
		queryFn: () => {
			const end = new Date();
			const start = new Date(end.getTime() - days * 86_400_000);
			return notificationAnalytics(cloud, universeId, start.toISOString(), end.toISOString());
		},
		retry: false,
		staleTime: 300_000,
	});
	const overview = Object.entries(q.data?.overview ?? {}).filter(([, v]) => typeof v !== "object" || v === null);
	const campaigns = q.data?.campaigns ?? [];
	return (
		<Section title="Analytics">
			<Chips options={PERIODS} value={days} onChange={setDays} />
			{q.error ? (
				<CloudError error={q.error} what="Notification analytics" onRetry={() => q.refetch()} />
			) : !q.data ? (
				<SkeletonList rows={2} />
			) : overview.length || campaigns.length ? (
				<>
					{overview.length ? (
						<StatGrid>
							{overview.map(([k, v]) => (
								<Stat key={k} label={label(k)} value={show(v)} />
							))}
						</StatGrid>
					) : null}
					{campaigns.length ? (
						<List>
							{campaigns.map((c, i) => {
								const entries = Object.entries(c);
								const title = entries.find(([k]) => /name|category|title/i.test(k))?.[1];
								return <Row key={i} title={show(title ?? `Campaign ${i + 1}`)} subtitle={entries.map(([k, v]) => `${label(k)}: ${show(v)}`).join(" · ")} numberOfLines={4} />;
							})}
						</List>
					) : null}
				</>
			) : (
				<Txt variant="muted">No numbers yet. Roblox shows them after 100 impressions.</Txt>
			)}
		</Section>
	);
}
