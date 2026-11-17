import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { scopeList } from "@/api/opencloud";
import { getUser, userByName } from "@/api/roblox-public";
import { NotificationsSection } from "@/features/notifications/NotificationsSection";
import { Badge, Button, Card, confirm, ErrorState, Field, Icon, KV, List, Row, Screen, Section, Segmented, Txt } from "@/components/ui";
import { AppUpdatesCard } from "@/features/app-updates";
import { FEATURES, missingScopes } from "@/lib/features";
import { daysLeft, fmtDate } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme, type Appearance } from "@/theme";

export default function SettingsScreen() {
	const p = useTheme();
	const { hasKey, keyInfo, keyLoading, keyError, saveKey, removeKey, prefs, setPrefs } = useAccounts();
	const [keyText, setKeyText] = useState("");
	const [editingKey, setEditingKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [keyMessage, setKeyMessage] = useState<string | null>(null);
	const [showScopes, setShowScopes] = useState(false);
	const [userText, setUserText] = useState("");
	const [userBusy, setUserBusy] = useState(false);
	const [userMessage, setUserMessage] = useState<string | null>(null);

	const effectiveUserId = prefs.userId ?? keyInfo?.authorizedUserId ?? null;
	const owner = useQuery({ queryKey: ["user", effectiveUserId], queryFn: () => getUser(effectiveUserId as number), enabled: !!effectiveUserId, staleTime: 3600_000 });

	async function onSaveKey() {
		setSaving(true);
		setKeyMessage(null);
		try {
			const info = await saveKey(keyText);
			setKeyText("");
			setEditingKey(false);
			setKeyMessage(`Saved “${info.name}”: ${scopeList(info).length} scopes.`);
		} catch (e) {
			setKeyMessage((e as Error).message);
		} finally {
			setSaving(false);
		}
	}

	async function onRemoveKey() {
		if (!(await confirm("Remove the Open Cloud key?", "It is deleted from this phone. Experiences that only the key could see disappear from Projects.", "Remove"))) return;
		await removeKey();
	}

	async function onSetUser() {
		const text = userText.trim();
		setUserMessage(null);
		if (!text) {
			await setPrefs({ userId: null });
			return;
		}
		setUserBusy(true);
		try {
			if (/^\d+$/.test(text)) await setPrefs({ userId: Number(text) });
			else {
				const u = await userByName(text);
				if (!u) throw new Error(`No Roblox user is called “${text}”.`);
				await setPrefs({ userId: u.id });
			}
			setUserText("");
		} catch (e) {
			setUserMessage((e as Error).message);
		} finally {
			setUserBusy(false);
		}
	}

	const expires = keyInfo?.expirationTimeUtc ? Date.parse(keyInfo.expirationTimeUtc) : null;

	return (
		<Screen>
			<Section title="Open Cloud API key">
				{!hasKey || editingKey ? (
					<Card style={{ gap: 10 }}>
						<Txt variant="muted">
							Create a key on Creator Hub (create.roblox.com → Open Cloud → API Keys) with the experiences and scopes you want to see here. It is kept in this
							phone's secure storage and only ever sent to apis.roblox.com.
						</Txt>
						<Field value={keyText} onChangeText={setKeyText} placeholder="Paste the API key" secureTextEntry autoComplete="off" />
						<View style={{ flexDirection: "row", gap: 8 }}>
							<Button title="Check and save" variant="brand" icon="checkmark" loading={saving} disabled={!keyText.trim()} onPress={onSaveKey} />
							{editingKey ? <Button title="Cancel" variant="ghost" onPress={() => setEditingKey(false)} /> : null}
						</View>
						{keyMessage ? <Txt variant="small" color={p.destructive}>{keyMessage}</Txt> : null}
					</Card>
				) : (
					<Card style={{ gap: 2 }}>
						{keyLoading ? <Txt variant="muted">Checking the key with Roblox…</Txt> : null}
						{keyError ? <ErrorState title="Roblox refused the key" error={keyError} /> : null}
						{keyInfo ? (
							<>
								<View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
									<Icon name="key" size={16} color={p.brand} />
									<Txt variant="h3" style={{ flex: 1 }} numberOfLines={1}>
										{keyInfo.name}
									</Txt>
									<Badge label={keyInfo.enabled && !keyInfo.expired ? "Active" : keyInfo.expired ? "Expired" : "Disabled"} tone={keyInfo.enabled && !keyInfo.expired ? "good" : "critical"} />
								</View>
								<KV label="Created by" value={owner.data ? `@${owner.data.name}` : keyInfo.authorizedUserId ? `user ${keyInfo.authorizedUserId}` : "–"} />
								<KV label="Expires" value={expires ? `${fmtDate(expires)} (${daysLeft(expires)} d)` : "never"} />
								<KV label="Scopes" value={String(scopeList(keyInfo).length)} />
							</>
						) : null}
						<View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
							<Button title="Replace" small icon="swap-horizontal" onPress={() => setEditingKey(true)} />
							<Button title={showScopes ? "Hide scopes" : "Show scopes"} small icon="list" onPress={() => setShowScopes((v) => !v)} />
							<Button title="Remove" small variant="destructive" icon="trash-outline" onPress={onRemoveKey} />
						</View>
						{keyMessage ? <Txt variant="small">{keyMessage}</Txt> : null}
					</Card>
				)}
			</Section>

			{keyInfo && showScopes ? (
				<Section title="Scopes on this key">
					<Card style={{ gap: 6 }}>
						{keyInfo.scopes.map((s, i) => {
							const where = s.universeIds?.length ? `universes ${s.universeIds.join(", ")}` : s.universeDatastores?.length ? s.universeDatastores.map((d) => `${d.universeId}/${d.datastoreName}`).join(", ") : s.groupIds?.length ? `groups ${s.groupIds.join(", ")}` : s.userIds?.length ? `users ${s.userIds.join(", ")}` : "all";
							return (
								<View key={i}>
									<Txt variant="mono">
										{s.name}:{s.operations.join(",")}
									</Txt>
									<Txt variant="small">{where}</Txt>
								</View>
							);
						})}
					</Card>
				</Section>
			) : null}

			{hasKey ? (
				<Section title="What the key can do">
					<List>
						{FEATURES.map((f) => {
							const missing = missingScopes(keyInfo, f.scopes);
							const missingWrite = missingScopes(keyInfo, f.writeScopes ?? []);
							return (
								<Row
									key={f.key}
									left={<Icon name={f.icon} size={18} color={missing.length ? p.mutedForeground : p.foreground} />}
									title={f.title}
									subtitle={missing.length ? `Add: ${missing.join(", ")}` : missingWrite.length ? `Read only. For changes add: ${missingWrite.join(", ")}` : f.description}
									right={<Badge label={missing.length ? "Missing" : missingWrite.length ? "Read" : "Ready"} tone={missing.length ? "warning" : "good"} />}
									numberOfLines={1}
								/>
							);
						})}
					</List>
					<Txt variant="small">Scopes are per experience on Creator Hub; a feature shows as ready when any experience has it.</Txt>
				</Section>
			) : null}

			<Section title="Roblox account">
				<Card style={{ gap: 8 }}>
					<KV label="Listing experiences of" value={owner.data ? `${owner.data.displayName} (@${owner.data.name})` : effectiveUserId ? String(effectiveUserId) : "nobody yet"} />
					<Txt variant="small">{prefs.userId ? "Set by hand." : keyInfo?.authorizedUserId ? "The key's creator." : "Add a key or enter your user."}</Txt>
					<Field value={userText} onChangeText={setUserText} placeholder="Username or user ID (empty = the key's creator)" onSubmitEditing={onSetUser} />
					<Button title="Use this user" small loading={userBusy} onPress={onSetUser} style={{ alignSelf: "flex-start" }} />
					{userMessage ? <Txt variant="small" color={p.destructive}>{userMessage}</Txt> : null}
					<Txt variant="label" style={{ marginTop: 6 }}>
						Group experiences
					</Txt>
					<Segmented
						options={[
							{ value: 255, label: "Groups I own" },
							{ value: 200, label: "Rank 200+" },
							{ value: 1, label: "All my groups" },
						]}
						value={prefs.groupMinRank >= 255 ? 255 : prefs.groupMinRank >= 200 ? 200 : 1}
						onChange={(v) => setPrefs({ groupMinRank: v })}
					/>
				</Card>
			</Section>

			{prefs.extraUniverseIds.length ? (
				<Section title="Added by hand">
					<List>
						{prefs.extraUniverseIds.map((id) => (
							<Row
								key={id}
								title={`Universe ${id}`}
								right={<Button title="Remove" small variant="ghost" onPress={() => setPrefs({ extraUniverseIds: prefs.extraUniverseIds.filter((x) => x !== id) })} />}
							/>
						))}
					</List>
				</Section>
			) : null}

			<Section title="Notifications">
				<NotificationsSection />
			</Section>

			<Section title="Widgets">
				<List>
					<Row
						left={<Icon name="apps-outline" size={18} color={p.foreground} />}
						title="Home-screen widgets"
						subtitle="Pick the stats each widget shows"
						chevron
						onPress={() => router.push("/widgets")}
					/>
				</List>
			</Section>

			<Section title="Appearance">
				<Segmented<Appearance>
					options={[
						{ value: "system", label: "System" },
						{ value: "dark", label: "Dark" },
						{ value: "light", label: "Light" },
					]}
					value={prefs.appearance}
					onChange={(v) => setPrefs({ appearance: v })}
				/>
			</Section>

			<Section title="App updates">
				<AppUpdatesCard />
			</Section>

			<Section title="Privacy">
				<Card style={{ gap: 6 }}>
					<Txt variant="muted">
						Everything stays on this phone: the Open Cloud key goes only to apis.roblox.com, each backend token only to its backend. Public Roblox data
						(names, icons, player counts) comes from Roblox's public APIs. The app has no analytics or telemetry.
					</Txt>
				</Card>
			</Section>

			<Txt variant="small" style={{ textAlign: "center" }}>
				TypeTorch {Constants.expoConfig?.version ?? ""}
			</Txt>
		</Screen>
	);
}
