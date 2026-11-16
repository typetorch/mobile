/**
 * One notification string: its id (the messageId), name and text; edit (POST update), archive (confirm, can't be
 * undone), and send it to one player as a test (Create User Notification, user.user-notification:write; the player
 * must have opted in, and gets at most one notification a day from the experience).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { userByName } from "@/api/roblox-public";
import { Button, Card, confirm, Field, KV, notify, Skeleton, Txt } from "@/components/ui";
import {
	archiveNotificationString,
	ENG_SCOPES,
	getNotificationString,
	isUserIdParam,
	LAUNCH_DATA_MAX_BYTES,
	NOTIFICATION_CONTENT_MAX,
	notificationParams,
	sendUserNotification,
	updateNotificationString,
	utf8Bytes,
	validateNotification,
} from "@/features/project/api/engagement";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { useTheme } from "@/theme";

export default function NotificationScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Notification string" scopes={[ENG_SCOPES.notifRead]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "notification"], type: "active" })}>
			{({ universeId, cloud, can }) => <NotificationView universeId={universeId} cloud={cloud} id={String(id ?? "")} canWrite={can(ENG_SCOPES.notifWrite)} canSend={can(ENG_SCOPES.userNotify)} />}
		</ToolScreen>
	);
}

function NotificationView({ universeId, cloud, id, canWrite, canSend }: { universeId: number; cloud: OpenCloud; id: string; canWrite: boolean; canSend: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState("");
	const [content, setContent] = useState("");
	const [formError, setFormError] = useState<string | null>(null);

	const q = useQuery({ queryKey: ["oc", "notification", id], queryFn: () => getNotificationString(cloud, id), enabled: !!id, retry: false });
	useEffect(() => {
		if (q.data && !editing) {
			setName(q.data.name ?? "");
			setContent(q.data.content ?? "");
		}
	}, [q.data, editing]);

	const refresh = () => {
		queryClient.invalidateQueries({ queryKey: ["oc", "notification", id] });
		queryClient.invalidateQueries({ queryKey: ["oc", "notifications", universeId] });
	};
	const save = useMutation({
		mutationFn: () => updateNotificationString(cloud, id, name.trim(), content.trim()),
		onSuccess: () => {
			setEditing(false);
			refresh();
		},
		onError: (e) => notify("Save failed", cloudErrorText(e)),
	});
	const archive = useMutation({
		mutationFn: () => archiveNotificationString(cloud, id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "notifications", universeId] });
			router.back();
		},
		onError: (e) => notify("Archive failed", cloudErrorText(e)),
	});

	async function onSave() {
		const error = validateNotification(name, content.trim());
		setFormError(error);
		if (error) return;
		if (await confirm("Save this notification string?", "Notifications sent from now on use the new text (Roblox moderates it). Game code that sends this messageId keeps working.", "Save", false)) save.mutate();
	}

	async function onArchive() {
		if (await confirm("Archive this notification string?", `“${q.data?.name ?? id}” is archived for good: game code that sends this messageId stops working. This can't be undone.`, "Archive")) archive.mutate();
	}

	if (q.error) return <CloudError error={q.error} what="This notification string" onRetry={() => q.refetch()} />;
	if (!q.data) return <Skeleton height={160} />;
	const s = q.data;

	return (
		<>
			{editing ? (
				<Card style={{ gap: 8 }}>
					<Field label="Name" value={name} onChangeText={setName} autoCapitalize="sentences" maxLength={200} />
					<Field label="Text" value={content} onChangeText={setContent} autoCapitalize="sentences" maxLength={NOTIFICATION_CONTENT_MAX} hint={`${content.length} / ${NOTIFICATION_CONTENT_MAX}`} />
					{formError ? <Txt variant="small" color={p.destructive}>{formError}</Txt> : null}
					<View style={{ flexDirection: "row", gap: 8 }}>
						<Button title="Save" variant="brand" small loading={save.isPending} onPress={onSave} />
						<Button title="Cancel" small onPress={() => setEditing(false)} />
					</View>
				</Card>
			) : (
				<Card style={{ gap: 4 }}>
					<Txt variant="h3">{s.name || "(no name)"}</Txt>
					<Txt selectable>{s.content}</Txt>
					<KV label="Message id" value={s.id ?? id} mono />
					<Button title="Copy message id" icon="copy-outline" small onPress={() => Clipboard.setStringAsync(s.id ?? id)} style={{ alignSelf: "flex-start" }} />
				</Card>
			)}
			{canWrite && !editing ? (
				<View style={{ flexDirection: "row", gap: 8 }}>
					<Button title="Edit" icon="create-outline" onPress={() => setEditing(true)} />
					<Button title="Archive" icon="archive-outline" variant="destructive" loading={archive.isPending} onPress={onArchive} />
				</View>
			) : !canWrite ? (
				<Txt variant="small">Read only: add {ENG_SCOPES.notifWrite} to edit or archive.</Txt>
			) : null}
			{canSend ? <SendTest universeId={universeId} cloud={cloud} messageId={s.id ?? id} content={s.content ?? ""} /> : <Txt variant="small">Add {ENG_SCOPES.userNotify} to send a test notification to a player.</Txt>}
		</>
	);
}

function SendTest({ universeId, cloud, messageId, content }: { universeId: number; cloud: OpenCloud; messageId: string; content: string }) {
	const p = useTheme();
	const params = notificationParams(content);
	const [who, setWho] = useState("");
	const [values, setValues] = useState<Record<string, string>>({});
	const [launchData, setLaunchData] = useState("");
	const [category, setCategory] = useState("");
	const [error, setError] = useState<string | null>(null);

	const send = useMutation({
		mutationFn: (userId: number) => sendUserNotification(cloud, { userId, universeId, messageId, parameters: Object.fromEntries(params.map((k) => [k, values[k] ?? ""])), launchData: launchData || undefined, category: category.trim() || undefined }),
		onSuccess: () => notify("Sent", "Roblox accepted the notification. It shows up if the player opted in and hasn't had one from this experience today."),
		onError: (e) => notify("Send failed", cloudErrorText(e)),
	});

	async function onSend() {
		setError(null);
		const text = who.trim();
		if (!text) return setError("Enter a username or user id.");
		const missing = params.filter((k) => !(values[k] ?? "").trim());
		if (missing.length) return setError(`Fill in: ${missing.join(", ")}.`);
		const badIds = params.filter((k) => isUserIdParam(k) && !/^\d+$/.test((values[k] ?? "").trim()));
		if (badIds.length) return setError(`${badIds.map((k) => `{${k}}`).join(", ")} take${badIds.length === 1 ? "s" : ""} a user id (digits only).`);
		if (utf8Bytes(launchData) > LAUNCH_DATA_MAX_BYTES) return setError(`Launch data is ${utf8Bytes(launchData)} bytes; Roblox allows ${LAUNCH_DATA_MAX_BYTES}.`);
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
		let preview = content;
		for (const k of params) preview = preview.split(`{${k}}`).join(values[k] ?? "");
		if (await confirm(`Send to ${label}?`, `A real notification: “${preview}”. It uses their one notification a day from this experience.`, "Send", false)) send.mutate(userId);
	}

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">Send a test notification</Txt>
			<Field value={who} onChangeText={setWho} placeholder="Username or user id" />
			{params.map((k) => (
				<Field
					key={k}
					label={`{${k}}`}
					value={values[k] ?? ""}
					onChangeText={(t) => setValues((v) => ({ ...v, [k]: t }))}
					placeholder={isUserIdParam(k) ? "User id (shown as their name)" : "Value"}
					keyboardType={isUserIdParam(k) ? "number-pad" : undefined}
				/>
			))}
			<Field label="Launch data (optional)" value={launchData} onChangeText={setLaunchData} placeholder="Sent to the game when they join" hint={`${utf8Bytes(launchData)} / ${LAUNCH_DATA_MAX_BYTES} bytes`} />
			<Field label="Analytics category (optional)" value={category} onChangeText={setCategory} placeholder="Test" />
			{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
			<Button title="Send" icon="paper-plane-outline" small loading={send.isPending} onPress={onSend} style={{ alignSelf: "flex-start" }} />
		</Card>
	);
}
