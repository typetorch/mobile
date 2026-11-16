/**
 * Settings for one backend. For everyone: this device's session, the app sessions (list / revoke), the experience it
 * is linked to, the server's health. For owners (the web's Settings page, owner-only there): the runtime settings per
 * group with Save / Undo / Reset to env / Reset all to env, the write-only webhook and Send test alert, the backend
 * alert rules with their last run, Sign in with typetorch.dev (trusted browsers, revoke), Backups and disk (Back up
 * now, Download backup through the share sheet), Migration (start, pause / resume / cancel, resolve) and Recent
 * changes (features/typetorch/settings/).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { listSessions, refreshToken, revokeSession } from "@/api/backend-auth";
import { Badge, Button, Card, confirm, ErrorState, Field, KV, List, Row, Section, Segmented, Skeleton, Txt } from "@/components/ui";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { BackupCard, CentralLoginSection, MigrationCard } from "@/features/typetorch/settings/cards";
import { SETTINGS_KEY, SettingsAudit, SettingsForm } from "@/features/typetorch/settings/form";
import { daysLeft, fmtAgo, fmtDate, fmtInt } from "@/lib/format";
import { useAccounts, type BackendAccount } from "@/store/accounts";
import { useTheme } from "@/theme";

export default function BackendSettingsScreen() {
	return <TTScreen title="Settings">{({ account }) => <BackendSettings account={account} />}</TTScreen>;
}

function BackendSettings({ account }: { account: BackendAccount }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const { backendToken, removeBackend, replaceToken, updateBackend } = useAccounts();
	const admin = account.role === "admin";
	const [all, setAll] = useState(false);
	const [universeText, setUniverseText] = useState(account.universeId ? String(account.universeId) : "");
	const token = backendToken(account.id) ?? "";

	const health = useTTQuery(account.id, ["health"], (api, s) => api.health(s), { staleTime: 30_000 });
	const sessions = useTTQuery(account.id, ["mobile-sessions", all], () => listSessions(account.url, token, account.tokenId, all));
	const settings = useTTQuery(account.id, SETTINGS_KEY, (api, s) => api.settings(s), { enabled: admin, retry: false, staleTime: 0 });

	const revoke = useMutation({
		mutationFn: (id: string) => revokeSession(account.url, token, id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tt", account.id, "mobile-sessions"] }),
	});
	const refresh = useMutation({
		mutationFn: async () => replaceToken(account.id, await refreshToken(account.url, token)),
	});

	async function disconnect() {
		if (!(await confirm("Disconnect this backend?", "The app signs out (the backend revokes this device's token) and forgets it.", "Disconnect"))) return;
		await removeBackend(account.id);
		router.replace("/backends");
	}

	const left = daysLeft(account.expiresAt);
	const user = account.user;

	return (
		<>
			<Section title="This device">
				<Card>
					<KV label="Signed in as" value={user && user.kind === "roblox" ? `@${user.name}` : user ? "admin token" : "–"} />
					<KV label="Role" value={<Badge label={account.role} tone={admin ? "brand" : "muted"} />} />
					<KV label="Token" value={`${fmtDate(account.expiresAt)} (${left} d left)`} />
					<KV label="Session id" value={account.tokenId || "–"} mono />
					<View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
						<Button title="Renew token" small icon="refresh" loading={refresh.isPending} onPress={() => refresh.mutate()} />
						<Button title="Sign in again" small icon="log-in-outline" onPress={() => router.push(`/backend/connect?reauth=${account.id}`)} />
						<Button title="Disconnect" small variant="destructive" icon="log-out-outline" onPress={disconnect} />
					</View>
					{refresh.error ? <Txt variant="small" color={p.destructive}>{(refresh.error as Error).message}</Txt> : null}
				</Card>
			</Section>

			<Section title="Experience">
				<Card style={{ gap: 8 }}>
					<Txt variant="muted">The project in the app whose TypeTorch tab opens this dashboard.</Txt>
					<Field value={universeText} onChangeText={setUniverseText} keyboardType="number-pad" placeholder="Universe ID" />
					<Button
						title="Save"
						small
						disabled={!/^\d+$/.test(universeText.trim()) || Number(universeText) === account.universeId}
						onPress={() => updateBackend(account.id, { universeId: Number(universeText.trim()) })}
						style={{ alignSelf: "flex-start" }}
					/>
				</Card>
			</Section>

			<Section title="App sessions" right={admin ? <Segmented options={[{ value: 0, label: "Mine" }, { value: 1, label: "Everyone" }]} value={all ? 1 : 0} onChange={(v) => setAll(v === 1)} style={{ width: 170 }} /> : undefined}>
				{sessions.error ? (
					<ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
				) : !sessions.data ? (
					<Skeleton height={80} />
				) : (
					<List>
						{sessions.data.map((s) => (
							<Row
								key={s.id}
								title={
									<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
										<Txt numberOfLines={1} style={{ flexShrink: 1, fontWeight: "500" }}>
											{s.device ?? "Unknown device"}
										</Txt>
										{s.current ? <Badge label="this phone" tone="brand" /> : null}
									</View>
								}
								subtitle={`${s.user && s.user.kind === "roblox" ? `@${s.user.name} · ` : ""}${s.role ?? ""} · used ${fmtAgo(s.lastUsedAt)} · ends ${fmtDate(s.expiresAt)}`}
								right={
									s.current ? undefined : (
										<Button
											title="Revoke"
											small
											variant="ghost"
											loading={revoke.isPending && revoke.variables === s.id}
											onPress={async () => {
												if (await confirm("Revoke this session?", `${s.device ?? "The device"} is signed out right away.`, "Revoke")) revoke.mutate(s.id);
											}}
										/>
									)
								}
							/>
						))}
					</List>
				)}
				{revoke.error ? <Txt variant="small" color={p.destructive}>{(revoke.error as Error).message}</Txt> : null}
			</Section>

			<Section title="Server">
				{health.error ? (
					<ErrorState error={health.error} />
				) : health.data ? (
					<Card>
						<KV label="Status" value={<Badge label={health.data.ok ? "ok" : "not ok"} tone={health.data.ok ? "good" : "critical"} />} />
						{health.data.runtime ? <KV label="Runtime" value={health.data.runtime} /> : null}
						{health.data.uptimeSeconds !== undefined ? <KV label="Up" value={fmtAgo(Date.now() - health.data.uptimeSeconds * 1000).replace(" ago", "")} /> : null}
						{health.data.rssMb !== undefined ? <KV label="Memory" value={`${fmtInt(health.data.rssMb)} MB`} /> : null}
						{health.data.analytics ? <KV label="Analytics lag" value={`${fmtInt(health.data.analytics.loaderLagSeconds)} s`} /> : null}
						{health.data.fleet ? <KV label="Fleet streams" value={`${health.data.fleet.streams} · ${health.data.fleet.unacked} unacked alerts`} /> : null}
					</Card>
				) : (
					<Skeleton height={80} />
				)}
			</Section>

			{admin ? (
				settings.error ? (
					<Section title="Runtime settings">
						<ErrorState error={settings.error} onRetry={() => settings.refetch()} />
					</Section>
				) : !settings.data ? (
					<Section title="Runtime settings">
						<Skeleton height={120} />
					</Section>
				) : (
					<>
						<Section title="Runtime settings">
							<SettingsForm backendId={account.id} data={settings.data} />
						</Section>
						{settings.data.centralLogin ? <CentralLoginSection backendId={account.id} info={settings.data.centralLogin} /> : null}
						<BackupCard backendId={account.id} />
						<MigrationCard backendId={account.id} />
						<SettingsAudit entries={settings.data.audit} envOnly={settings.data.envOnly} />
					</>
				)
			) : null}
		</>
	);
}
