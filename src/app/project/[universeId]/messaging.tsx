/**
 * MessagingService: publish one message to a topic on every live server (cloud/v2 :publishMessage). MessagingService
 * limits: topic up to 80 characters, message up to 1 KB. Extras: a JSON check / pretty-print for structured messages,
 * the topics used on this experience during this app session as chips, and the messages sent this session (send
 * again asks first, like any publish).
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, Chips, confirm, Field, List, notify, Row, Section, Txt } from "@/components/ui";
import { utf8Length } from "@/features/project/api/servers";
import { cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtTime } from "@/lib/format";
import { useTheme } from "@/theme";

export default function MessagingScreen() {
	return <ToolScreen title="Messaging" scopes={["universe-messaging-service:publish"]}>{({ universeId, cloud }) => <Publish universeId={universeId} cloud={cloud} />}</ToolScreen>;
}

const TOPIC_MAX = 80;
const MESSAGE_MAX = 1024;

interface Sent {
	topic: string;
	message: string;
	at: number;
}

/** Messages sent this app session, per universe (kept in memory only). */
const sentLog = new Map<number, Sent[]>();

function Publish({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const [topic, setTopic] = useState("");
	const [message, setMessage] = useState("");
	const [sent, setSent] = useState<Sent[]>(() => sentLog.get(universeId) ?? []);
	const [jsonNote, setJsonNote] = useState<string | null>(null);

	const send = useMutation({
		mutationFn: (m: { topic: string; message: string }) => cloud.publishMessage(universeId, m.topic, m.message),
		onSuccess: (_r, m) => {
			const next = [{ ...m, at: Date.now() }, ...(sentLog.get(universeId) ?? [])].slice(0, 20);
			sentLog.set(universeId, next);
			setSent(next);
		},
		onError: (e) => notify("Couldn't publish", cloudErrorText(e)),
	});

	const t = topic.trim();
	const bytes = utf8Length(message);
	const topics = Array.from(new Set(sent.map((s) => s.topic))).slice(0, 8);

	async function publish(m: { topic: string; message: string }) {
		if (await confirm("Publish to live servers?", `Topic “${m.topic}” on every running server of this experience.`, "Publish", false)) send.mutate(m);
	}

	function checkJson(pretty: boolean) {
		try {
			const v = JSON.parse(message);
			const text = pretty ? JSON.stringify(v, null, 2) : JSON.stringify(v);
			setMessage(text);
			setJsonNote(`Valid JSON (${utf8Length(text)} bytes ${pretty ? "pretty" : "compact"}).`);
		} catch (e) {
			setJsonNote(`Not JSON: ${(e as Error).message}. Plain text is fine too.`);
		}
	}

	return (
		<>
			<Card style={{ gap: 10 }}>
				<Txt variant="muted">Every live server subscribed to the topic (MessagingService:SubscribeAsync) gets the message.</Txt>
				<Field label="Topic" value={topic} onChangeText={setTopic} placeholder="Announcements" maxLength={TOPIC_MAX} hint={`${t.length} / ${TOPIC_MAX} characters`} />
				{topics.length ? <Chips options={topics.map((x) => ({ value: x, label: x }))} value={t} onChange={setTopic} /> : null}
				<Field
					label="Message"
					value={message}
					onChangeText={(v) => {
						setMessage(v);
						setJsonNote(null);
					}}
					multiline
					placeholder='{"text":"Server restart in 5 minutes"}'
					hint={`${bytes} / ${MESSAGE_MAX} bytes`}
				/>
				<View style={{ flexDirection: "row", gap: 8 }}>
					<Button title="Compact JSON" small disabled={!message.trim()} onPress={() => checkJson(false)} />
					<Button title="Pretty JSON" small disabled={!message.trim()} onPress={() => checkJson(true)} />
				</View>
				{jsonNote ? <Txt variant="small">{jsonNote}</Txt> : null}
				{bytes > MESSAGE_MAX ? <Txt variant="small" color={p.destructive}>The message is over 1 KB; MessagingService would refuse it.</Txt> : null}
				<Button title="Publish" variant="brand" icon="megaphone-outline" loading={send.isPending} disabled={!t || t.length > TOPIC_MAX || !message || bytes > MESSAGE_MAX} onPress={() => publish({ topic: t, message })} />
				{sent[0] && !send.isPending && !send.error ? <Txt color={p.good}>Sent to “{sent[0].topic}” at {fmtTime(sent[0].at)}.</Txt> : null}
			</Card>

			{sent.length ? (
				<Section title="Sent this session">
					<List>
						{sent.map((s, i) => (
							<Row
								key={`${s.at}-${i}`}
								title={s.topic}
								subtitle={`${fmtTime(s.at)} · ${s.message.length > 120 ? `${s.message.slice(0, 119)}…` : s.message}`}
								numberOfLines={2}
								onPress={() => {
									setTopic(s.topic);
									setMessage(s.message);
								}}
								right={<Button title="Send again" small loading={send.isPending && send.variables?.topic === s.topic && send.variables?.message === s.message} onPress={() => publish({ topic: s.topic, message: s.message })} />}
							/>
						))}
					</List>
					<Txt variant="small">Tap a row to edit it; this list is kept until the app closes.</Txt>
				</Section>
			) : null}
		</>
	);
}
