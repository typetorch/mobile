/**
 * Settings → Notifications: per signed-in backend, the CCU milestone pushes (with a test) and the live watch; and the
 * phone settings that keep them working on Xiaomi / HyperOS and other battery-strict phones.
 */
import { useState } from "react";
import { Linking, Switch, View } from "react-native";

import { Button, Card, Icon, notify, Txt } from "@/components/ui";
import { liveAvailable, setWatching, useWatching } from "@/features/live/watch";
import { useAccounts, type BackendAccount } from "@/store/accounts";
import { space, useTheme } from "@/theme";

import { PushNotSetUp, setMilestones, usePushPrefs } from "./push";

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
	const p = useTheme();
	return <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: p.brand, false: p.muted }} thumbColor="#ffffff" />;
}

function BackendNotifications({ account }: { account: BackendAccount }) {
	const p = useTheme();
	const { backendApi } = useAccounts();
	const prefs = usePushPrefs();
	const watching = useWatching();
	const [busy, setBusy] = useState<"" | "push" | "test" | "watch">("");
	const [problem, setProblem] = useState<string | null>(null);
	const api = backendApi(account.id);
	const on = !!prefs[account.id]?.on;
	const watched = watching.includes(account.id);

	const run = async (what: "push" | "test" | "watch", work: () => Promise<void>) => {
		setBusy(what);
		setProblem(null);
		try {
			await work();
		} catch (error) {
			setProblem(error instanceof PushNotSetUp ? error.message : error instanceof Error ? error.message : String(error));
		} finally {
			setBusy("");
		}
	};

	return (
		<Card style={{ gap: space.sm }}>
			<Txt style={{ fontWeight: "600" }} numberOfLines={1}>
				{account.name}
			</Txt>
			{account.signedOut ? <Txt variant="small" color={p.warning}>Signed out: sign in again to get notifications.</Txt> : null}
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
				<View style={{ flex: 1 }}>
					<Txt>CCU milestones</Txt>
					<Txt variant="small">A push at 10, 20, 40, 80… players, even with the app closed</Txt>
				</View>
				<Toggle value={on} disabled={!api || account.signedOut || busy !== ""} onChange={(v) => api && void run("push", () => setMilestones(account, api, v))} />
			</View>
			{on && api ? (
				<Button
					title="Send a test push"
					small
					variant="ghost"
					icon="paper-plane-outline"
					loading={busy === "test"}
					onPress={() =>
						void run("test", async () => {
							const r = await api.pushTest();
							if (r.ticket && r.ticket.status !== "ok") throw new Error(`Expo refused it: ${r.ticket.message ?? r.ticket.status}`);
							notify("Test sent", "It should show up in a few seconds.");
						})
					}
					style={{ alignSelf: "flex-start" }}
				/>
			) : null}
			{liveAvailable() ? (
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
					<View style={{ flex: 1 }}>
						<Txt>Live watch</Txt>
						<Txt variant="small">CCU and the last hour's sessions in a notification that stays until you tap Stop</Txt>
					</View>
					<Toggle value={watched} disabled={account.signedOut || busy !== ""} onChange={(v) => void run("watch", () => setWatching(account.id, v))} />
				</View>
			) : null}
			{problem ? (
				<View style={{ flexDirection: "row", gap: 6 }}>
					<Icon name="alert-circle-outline" size={14} color={p.destructive} />
					<Txt variant="small" color={p.destructive} style={{ flex: 1 }}>
						{problem}
					</Txt>
				</View>
			) : null}
		</Card>
	);
}

export function NotificationsSection() {
	const { backends } = useAccounts();
	if (!backends.length) return <Txt variant="small">Connect a TypeTorch backend to get milestone pushes, the live watch and widgets.</Txt>;
	return (
		<View style={{ gap: space.sm }}>
			{backends.map((b) => (
				<BackendNotifications key={b.id} account={b} />
			))}
			<Card style={{ gap: 6 }}>
				<Txt variant="small">
					Widgets: long-press the home screen → Widgets → TypeTorch, then pick the game; choose each widget's stats in Settings → Widgets. On Xiaomi / HyperOS the live watch and widgets keep
					updating only with Autostart on and Battery saver set to No restrictions.
				</Txt>
				<Button title="Open TypeTorch's phone settings" small variant="ghost" icon="settings-outline" onPress={() => void Linking.openSettings()} style={{ alignSelf: "flex-start" }} />
			</Card>
		</View>
	);
}
