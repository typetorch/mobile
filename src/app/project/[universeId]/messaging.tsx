/** MessagingService: publish one message to a topic on every live server (cloud/v2 :publishMessage, 1 KB max). */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, confirm, Field, Txt } from "@/components/ui";
import { ToolScreen } from "@/features/project/tool";
import { useTheme } from "@/theme";

export default function MessagingScreen() {
	return <ToolScreen title="Messaging" scopes={["universe-messaging-service:publish"]}>{({ universeId, cloud }) => <Publish universeId={universeId} cloud={cloud} />}</ToolScreen>;
}

function utf8Length(text: string): number {
	let n = 0;
	for (const ch of text) {
		const c = ch.codePointAt(0) ?? 0;
		n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
	}
	return n;
}

function Publish({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const [topic, setTopic] = useState("");
	const [message, setMessage] = useState("");
	const [sent, setSent] = useState<string | null>(null);
	const send = useMutation({ mutationFn: () => cloud.publishMessage(universeId, topic.trim(), message), onSuccess: () => setSent(`Sent to “${topic.trim()}” at ${new Date().toLocaleTimeString()}.`) });
	const bytes = utf8Length(message);
	return (
		<Card style={{ gap: 10 }}>
			<Txt variant="muted">Every live server subscribed to the topic (MessagingService:SubscribeAsync) gets the message.</Txt>
			<Field label="Topic" value={topic} onChangeText={setTopic} placeholder="Announcements" />
			<Field label="Message" value={message} onChangeText={setMessage} multiline placeholder='{"text":"Server restart in 5 minutes"}' hint={`${bytes} / 1024 bytes`} />
			<Button
				title="Publish"
				variant="brand"
				icon="megaphone-outline"
				loading={send.isPending}
				disabled={!topic.trim() || !message || bytes > 1024}
				onPress={async () => {
					setSent(null);
					if (await confirm("Publish to live servers?", `Topic “${topic.trim()}” on every running server of this experience.`, "Publish", false)) send.mutate();
				}}
			/>
			{send.error ? <Txt color={p.destructive}>{(send.error as Error).message}</Txt> : null}
			{sent ? <Txt color={p.good}>{sent}</Txt> : null}
		</Card>
	);
}
