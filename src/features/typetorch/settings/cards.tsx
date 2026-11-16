/**
 * The Settings screen's owner cards (ports of the web's components/CentralLoginSection.tsx, BackupCard.tsx,
 * DiskWarning.tsx and MigrationCard.tsx):
 *
 *   - Sign in with typetorch.dev: on / off (environment only), the fingerprint, and the browsers trusted for full admin
 *     (GET /v1/admin/devices) with Revoke (DELETE /v1/admin/devices/<id>, behind a confirm). "Trust this browser" is a
 *     browser cookie (POST /auth/device): no phone meaning, the screen says to use the web or the CLI's bless.
 *   - Backups and disk: the schedule, the local backups, Back up now (POST /v1/admin/backups), Download backup (POST
 *     /v1/admin/backups/download: the tar is written to the app's cache and offered through the share sheet), the disk
 *     warning; every 60 s.
 *   - Migration: the move's state, source, rows, steps, per-day report; pause / resume / cancel (confirm) and resolve
 *     (resend / skip) a page cut off mid-send; with nothing run yet the start form (old URL + admin token, sent once).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { ApiError } from "@/api/backend";
import { daysLeft, migrateActions, migratePollMs } from "@/api/tt/migrate";
import type { BackupInfo, BackupsStatus, BlessedDevice, CentralLoginInfo, DiskStatus, MigrateAction, MigrateDay, MigrateDecision, MigrateState, MigrateStatus, MigrateStep } from "@/api/tt/types";
import { Badge, Button, Card, confirm, ErrorState, Field, KV, List, Row, Section, Skeleton, Txt } from "@/components/ui";
import { Callout } from "@/features/typetorch/analytics-bits";
import { CopyButton, ShareBar } from "@/features/typetorch/bits";
import { shareFile } from "@/features/typetorch/files";
import { MIGRATE_KEY } from "@/features/typetorch/history-banner";
import { useTTQuery } from "@/features/typetorch/hooks";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { fmtAgo, fmtBytes, fmtInt, fmtPct, fmtTime, plural } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme, type Tone } from "@/theme";

// Sign in with typetorch.dev --------------------------------------------------------------------------------------------

export const DEVICES_KEY = ["admin-devices"] as const;

export function blessError(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.status === 401) return "That is not the admin token.";
		if (error.status === 429) return "Too many tries. Wait a few minutes.";
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
}

function Devices({ backendId }: { backendId: string }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const devices = useTTQuery(backendId, DEVICES_KEY, (a, s) => a.devices(s), { staleTime: 0 });
	const revoke = useMutation({ mutationFn: (id: string) => api!.revokeDevice(id), onSuccess: (list) => client.setQueryData(["tt", backendId, ...DEVICES_KEY], list) });
	const list: BlessedDevice[] = devices.data ?? [];
	return (
		<View style={{ gap: space.sm }}>
			{devices.error ? (
				<Txt variant="small" color={p.destructive}>
					Could not load the trusted browsers.
				</Txt>
			) : null}
			{list.length ? (
				<List>
					{list.map((d) => (
						<Row
							key={d.id}
							title={d.agent ?? "Unknown browser"}
							subtitle={`Trusted with the ${d.via} on ${fmtTime(d.created)}, last used ${fmtAgo(d.used)}${d.current ? " · this browser" : ""}`}
							numberOfLines={2}
							right={
								<Button
									title="Revoke"
									small
									variant="ghost"
									icon="trash-outline"
									disabled={revoke.isPending}
									loading={revoke.isPending && revoke.variables === d.id}
									onPress={async () => {
										if (await confirm("Revoke this browser?", `${d.agent ?? d.id} loses full admin through typetorch.dev at once.`, "Revoke")) revoke.mutate(d.id);
									}}
								/>
							}
						/>
					))}
				</List>
			) : devices.data ? (
				<Txt variant="muted">No browser is trusted yet: owners who sign in through typetorch.dev get read-only access.</Txt>
			) : null}
			{revoke.error ? (
				<Txt variant="small" color={p.destructive}>
					{blessError(revoke.error)}
				</Txt>
			) : null}
			<Txt variant="small">To trust a browser, open the explorer in it and paste the admin token there, or run `typetorch backend bless` on the PC with the game's signing key.</Txt>
		</View>
	);
}

export function CentralLoginSection({ backendId, info }: { backendId: string; info: CentralLoginInfo | undefined }) {
	const on = Boolean(info?.on);
	return (
		<Section title="Sign in with typetorch.dev">
			<Txt variant="small">One Roblox sign-in on typetorch.dev for every backend. On by default with an https TYPETORCH_PUBLIC_URL; TYPETORCH_CENTRAL_LOGIN=off turns it off (environment only).</Txt>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Badge label={on ? "On" : "Off"} tone={on ? "brand" : "muted"} />
				{on && info?.issuer ? <Txt variant="small">through {info.issuer}</Txt> : null}
			</View>
			{on && info?.fingerprint ? (
				<Card style={{ gap: 6 }}>
					<Txt variant="small">This backend's fingerprint (paste it into Add project on dash.typetorch.dev)</Txt>
					<Txt variant="mono" selectable>
						{info.fingerprint}
					</Txt>
					<CopyButton text={info.fingerprint} title="Copy fingerprint" />
				</Card>
			) : null}
			{on ? (
				<>
					<Txt variant="small">
						{info?.unblessed === "web" || info?.unblessed === "refuse"
							? `Owners get full admin only on a trusted browser; elsewhere they get ${info.unblessed === "refuse" ? "no access" : "read-only access"} (TYPETORCH_CENTRAL_LOGIN_UNBLESSED=${info.unblessed}).`
							: "Owners get full admin on any browser (TYPETORCH_CENTRAL_LOGIN_UNBLESSED=admin): anyone who controls an owner's Roblox account can administer this backend. Set it to web or refuse to require a trusted browser."}
					</Txt>
					<Devices backendId={backendId} />
				</>
			) : null}
		</Section>
	);
}

// Backups and disk -----------------------------------------------------------------------------------------------------

export const BACKUPS_KEY = ["admin-backups"] as const;

export function diskWarningText(d: DiskStatus): string {
	const threshold = d.level === "critical" ? d.criticalFreePercent : d.warnFreePercent;
	return `${fmtBytes(d.freeBytes)} of ${fmtBytes(d.totalBytes)} free (${fmtPct(d.freePercent / 100)}, under ${threshold}%). Make a backup, then free space: shorter retention on the Settings screen, or a bigger volume.`;
}

export function DiskWarning({ disk, quiet = false }: { disk: DiskStatus | null | undefined; quiet?: boolean }) {
	if (!disk) return null;
	if (disk.level === "ok") {
		if (quiet) return null;
		return (
			<Txt variant="small">
				Disk: {fmtBytes(disk.freeBytes)} of {fmtBytes(disk.totalBytes)} free ({fmtPct(disk.freePercent / 100)}).
			</Txt>
		);
	}
	return (
		<Callout tone="critical" title={disk.level === "critical" ? "The data disk is almost full" : "The data disk is filling up"}>
			{diskWarningText(disk)}
		</Callout>
	);
}

const BACKUP_COLUMNS: DataColumn<BackupInfo>[] = [
	{ id: "at", header: "When", type: "date", accessor: (b) => b.createdAt, format: (_v, b) => (b.createdAt ? fmtAgo(b.createdAt) : "-") },
	{ id: "name", header: "Folder", accessor: (b) => b.name, mono: true, width: 200 },
	{ id: "reason", header: "Made", type: "enum", accessor: (b) => b.reason ?? "unknown" },
	{ id: "bytes", header: "Size", type: "number", accessor: (b) => b.bytes, format: (_v, b) => fmtBytes(b.bytes), filter: false },
	{ id: "files", header: "Files", type: "number", accessor: (b) => b.files, defaultHidden: true },
	{ id: "duckdb", header: "DuckDB", type: "boolean", accessor: (b) => b.duckdb, defaultHidden: true },
];

const backupFailure = (error: Error) => (error instanceof ApiError && error.status === 429 ? "Two a minute at most: wait a moment." : error.message);

function BackupBody({ backendId, s }: { backendId: string; s: BackupsStatus }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const now = useMutation({ mutationFn: () => api!.backupNow(), onSuccess: (status) => client.setQueryData(["tt", backendId, ...BACKUPS_KEY], status) });
	const download = useMutation({
		mutationFn: async () => {
			const answer = await api!.downloadBackup();
			const shared = await shareFile(answer.name, answer.bytes, "application/x-tar");
			return { name: answer.name, bytes: answer.bytes.byteLength, shared };
		},
	});
	const busy = s.running || now.isPending || download.isPending;
	return (
		<View style={{ gap: space.sm }}>
			<DiskWarning disk={s.disk} />
			<Txt variant="small">
				{s.everyHours > 0 ? `Every ${plural(s.everyHours, "hour")}, keeping the newest ${fmtInt(s.keep)}` : `No schedule (TYPETORCH_BACKUP_HOURS=0); keeping the newest ${fmtInt(s.keep)}`}, in {s.dir}.
				{s.next && s.everyHours > 0 ? ` Next ${fmtAgo(s.next)}.` : ""}
			</Txt>
			{s.last && !s.last.ok ? (
				<Txt variant="small" color={p.destructive}>
					The last backup failed {fmtAgo(s.last.at)}: {s.last.error}
				</Txt>
			) : null}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				<Button title={now.isPending ? "Backing up" : "Back up now"} small icon="archive-outline" disabled={busy} onPress={() => now.mutate()} />
				<Button title={download.isPending ? "Preparing download" : "Download backup"} small variant="primary" icon="download-outline" disabled={busy} onPress={() => download.mutate()} />
			</View>
			{now.error ? (
				<Txt variant="small" color={p.destructive}>
					{backupFailure(now.error)}
				</Txt>
			) : null}
			{download.error ? (
				<Txt variant="small" color={p.destructive}>
					{backupFailure(download.error)}
				</Txt>
			) : null}
			{download.data ? <Txt variant="small">{download.data.shared ? `Saved ${download.data.name} (${fmtBytes(download.data.bytes)}).` : `${download.data.name} is in the app's cache; this phone has no share sheet.`}</Txt> : null}
			<Txt variant="small">The download is a tar of a fresh backup without the alert webhook URL and instance.key, held in the phone's memory on the way: for a big data folder, curl it on a PC instead (see the README).</Txt>
			<DataTable id="backups" label="Local backups" columns={BACKUP_COLUMNS} data={s.backups} rowId={(b) => b.name} defaultSort={[{ id: "at", desc: true }]} density="compact" empty={<Txt variant="muted">No local backup yet.</Txt>} />
		</View>
	);
}

export function BackupCard({ backendId }: { backendId: string }) {
	const q = useTTQuery(backendId, BACKUPS_KEY, (api, s) => api.backups(s), { refetchInterval: 60_000 });
	return (
		<Section title="Backups and disk">
			<Txt variant="small">SQLite, DuckDB and the day files, copied while the server runs; the disk they are on.</Txt>
			{q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton height={80} /> : <BackupBody backendId={backendId} s={q.data} />}
		</Section>
	);
}

// Migration ------------------------------------------------------------------------------------------------------------

const STATE_TEXT: Record<MigrateState, string> = {
	idle: "Idle",
	running: "Running",
	paused: "Paused",
	waiting: "Waiting",
	done: "Done",
	failed: "Failed",
	cancelled: "Cancelled",
	needs_decision: "Needs a decision",
};
const STATE_TONE: Record<MigrateState, Tone> = { idle: "muted", running: "brand", paused: "warning", waiting: "warning", done: "good", failed: "critical", cancelled: "muted", needs_decision: "critical" };
const STEP_TEXT: Record<MigrateStep["name"], string> = {
	erased: "Erasure requests",
	identities: "Identities",
	fleet: "Fleet history",
	events: "Events",
	recordings: "Recordings",
	live: "Today (live)",
	rollups: "Rollups",
	verify: "Verify",
};
const STEP_TONE: Record<MigrateStep["state"], Tone> = { pending: "muted", running: "brand", done: "good", failed: "critical" };
const DAY_TONE: Record<MigrateDay["state"], Tone> = { pending: "muted", importing: "brand", match: "good", missing: "critical", differs: "critical", duplicates: "critical", sent: "muted" };
const DAY_ORDER = ["pending", "importing", "match", "missing", "differs", "duplicates", "sent"] as const;

const DAY_COLUMNS: DataColumn<MigrateDay>[] = [
	{ id: "table", header: "Table", type: "enum", accessor: (d) => d.table },
	{ id: "day", header: "Day", accessor: (d) => d.day, mono: true },
	{ id: "state", header: "State", type: "enum", order: DAY_ORDER, accessor: (d) => d.state, cell: (d) => <Badge label={d.state} tone={DAY_TONE[d.state]} /> },
	{ id: "source", header: "Rows source", type: "number", accessor: (d) => d.rowsSource },
	{ id: "target", header: "Rows here", type: "number", accessor: (d) => d.rowsTarget },
	{ id: "note", header: "Note", accessor: (d) => d.note || null, width: 200 },
];

function actionError(error: Error): string {
	if (error instanceof ApiError && error.status === 409) return `Not now: ${error.message}`;
	if (error instanceof ApiError && error.status === 429) return "Too many requests: wait a moment.";
	return error.message;
}

function StartForm({ backendId }: { backendId: string }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const [url, setUrl] = useState("");
	const [token, setToken] = useState("");
	const [rate, setRate] = useState("");
	const start = useMutation({
		mutationFn: (input: { url: string; token: string; rowsPerSecond?: number }) =>
			api!.migrateStart({ from: { kind: "backend", url: input.url, token: input.token }, ...(input.rowsPerSecond ? { rowsPerSecond: input.rowsPerSecond } : {}) }),
		onSuccess: (status) => client.setQueryData(["tt", backendId, ...MIGRATE_KEY], status),
	});
	const rateText = rate.trim();
	const rateBad = rateText !== "" && !/^\d+$/.test(rateText);
	const urlBad = url.trim() !== "" && !/^https?:\/\/\S+$/i.test(url.trim());
	const ready = Boolean(url.trim() && token.trim()) && !rateBad && !urlBad && !start.isPending;
	const submit = async () => {
		if (!ready) return;
		if (!(await confirm("Start the move?", `This server copies the history of ${url.trim()} day by day. Keep the old server running until the move is done.`, "Start", false))) return;
		const input = { url: url.trim(), token: token.trim(), ...(rateText ? { rowsPerSecond: Number(rateText) } : {}) };
		setToken("");
		start.mutate(input);
	};
	return (
		<View style={{ gap: space.sm }}>
			<Txt variant="small">
				Move to another server: start it here, on the new server. It copies the old server's history (identities, fleet, events, recordings, today's live rows) day by day and checks each day's row count against the old one. Keep the old server running until the move is done.
			</Txt>
			<Field label="Old server URL" value={url} onChangeText={setUrl} keyboardType="url" placeholder="https://old.example.com" />
			<Field label="Old server's admin token" value={token} onChangeText={setToken} secureTextEntry placeholder="sent once, never shown again" />
			<Field label="Rows per second" value={rate} onChangeText={setRate} keyboardType="number-pad" placeholder="default" />
			{urlBad ? (
				<Txt variant="small" color={p.destructive}>
					The URL must start with https:// (or http://).
				</Txt>
			) : null}
			{rateBad ? (
				<Txt variant="small" color={p.destructive}>
					Rows per second must be a whole number (empty: the server's default).
				</Txt>
			) : null}
			<Button title={start.isPending ? "Starting" : "Start the move"} small variant="primary" icon="swap-horizontal-outline" disabled={!ready} onPress={() => void submit()} style={{ alignSelf: "flex-start" }} />
			{start.error ? (
				<Txt variant="small" color={p.destructive}>
					{actionError(start.error)}
				</Txt>
			) : null}
		</View>
	);
}

const ACTION_TEXT: Record<MigrateAction, { idle: string; busy: string }> = {
	pause: { idle: "Pause", busy: "Pausing" },
	resume: { idle: "Resume", busy: "Resuming" },
	cancel: { idle: "Cancel", busy: "Cancelling" },
};

function Controls({ backendId, s }: { backendId: string; s: MigrateStatus }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const act = useMutation({ mutationFn: (action: MigrateAction) => api!.migrateAction(action), onSuccess: (status) => client.setQueryData(["tt", backendId, ...MIGRATE_KEY], status) });
	const actions = migrateActions(s.state);
	if (!actions.length) return null;
	const pending = act.isPending ? act.variables : undefined;
	return (
		<View style={{ gap: 6 }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				{actions.includes("pause") ? <Button title={pending === "pause" ? ACTION_TEXT.pause.busy : ACTION_TEXT.pause.idle} small icon="pause" disabled={act.isPending} onPress={() => act.mutate("pause")} /> : null}
				{actions.includes("resume") ? <Button title={pending === "resume" ? ACTION_TEXT.resume.busy : ACTION_TEXT.resume.idle} small variant="primary" icon="play" disabled={act.isPending} onPress={() => act.mutate("resume")} /> : null}
				{actions.includes("cancel") ? (
					<Button
						title={pending === "cancel" ? ACTION_TEXT.cancel.busy : ACTION_TEXT.cancel.idle}
						small
						variant="destructive"
						icon="ban"
						disabled={act.isPending}
						onPress={async () => {
							if (await confirm("Cancel the move?", "The move stops. Days already imported stay; starting again begins a new move.", "Cancel the move")) act.mutate("cancel");
						}}
					/>
				) : null}
			</View>
			{act.error ? (
				<Txt variant="small" color={p.destructive}>
					{actionError(act.error)}
				</Txt>
			) : null}
		</View>
	);
}

function routeText(s: MigrateStatus): string | null {
	const source = s.source;
	if (s.direction === "to-basin") return "from this server to Basin";
	if (source?.kind === "basin") return `from Basin ${source.bucket} / ${source.namespace}`;
	if (source?.kind === "backend") return `from ${source.url}`;
	return null;
}

function DecisionBlock({ backendId, decision }: { backendId: string; decision: MigrateDecision }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const resolve = useMutation({ mutationFn: (choice: "resend" | "skip") => api!.migrateResolve(decision.page, choice), onSuccess: (status) => client.setQueryData(["tt", backendId, ...MIGRATE_KEY], status) });
	return (
		<Callout tone="warning" title="A page needs a decision">
			<Txt variant="small">
				{fmtInt(decision.rows)} rows of {decision.table} {decision.day} (page {decision.page}): {decision.why}.
			</Txt>
			<Txt variant="small">Resend: Basin may then hold these rows twice. Skip: they may be missing in Basin. The verify step reports either.</Txt>
			<View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
				<Button
					title={resolve.isPending && resolve.variables === "resend" ? "Resending" : "Resend"}
					small
					variant="primary"
					disabled={resolve.isPending}
					onPress={async () => {
						if (await confirm("Resend this page?", "Basin may then hold these rows twice.", "Resend", false)) resolve.mutate("resend");
					}}
				/>
				<Button
					title={resolve.isPending && resolve.variables === "skip" ? "Skipping" : "Skip"}
					small
					disabled={resolve.isPending}
					onPress={async () => {
						if (await confirm("Skip this page?", "These rows may then be missing in Basin.", "Skip")) resolve.mutate("skip");
					}}
				/>
			</View>
			{resolve.error ? (
				<Txt variant="small" color={p.destructive}>
					{actionError(resolve.error)}
				</Txt>
			) : null}
		</Callout>
	);
}

function MigrationBody({ backendId, s }: { backendId: string; s: MigrateStatus }) {
	const p = useTheme();
	if (s.state === "idle" && !s.days.length) return <StartForm backendId={backendId} />;
	const share = s.rowsTotal > 0 ? s.rowsDone / s.rowsTotal : 0;
	const left = daysLeft(s.days);
	const route = routeText(s);
	return (
		<View style={{ gap: space.sm }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
				<Badge label={STATE_TEXT[s.state] ?? s.state} tone={STATE_TONE[s.state] ?? "muted"} />
				{route ? <Txt variant="small">{route}</Txt> : null}
			</View>
			{s.startedAt || s.finishedAt ? (
				<Txt variant="small">
					{s.startedAt ? `started ${fmtAgo(s.startedAt)}` : ""}
					{s.finishedAt ? `${s.startedAt ? " · " : ""}finished ${fmtAgo(s.finishedAt)}` : ""}
				</Txt>
			) : null}
			<ShareBar share={share} tone={s.state === "failed" ? "critical" : "brand"} />
			<View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
				<Txt variant="small">
					{fmtInt(s.rowsDone)} of {fmtInt(s.rowsTotal)} rows ({fmtPct(share)})
				</Txt>
				<Txt variant="small">
					{s.days.length ? `${plural(left, "day")} left` : ""}
					{s.rowsPerSecond ? `${s.days.length ? " · " : ""}at most ${fmtInt(s.rowsPerSecond)} rows / s` : ""}
				</Txt>
			</View>
			{s.waitingFor ? <Txt variant="small">Waiting for: {s.waitingFor}</Txt> : null}
			{s.error ? (
				<Callout tone="critical" title="The move stopped on an error">
					<Txt variant="small" color={p.foreground}>
						{s.error}
					</Txt>
				</Callout>
			) : null}
			{s.state === "needs_decision" && s.decision ? <DecisionBlock backendId={backendId} decision={s.decision} /> : null}
			<Controls backendId={backendId} s={s} />
			{s.steps.length ? (
				<Card style={{ gap: 0 }}>
					{s.steps.map((st) => (
						<KV
							key={st.name}
							label={STEP_TEXT[st.name] ?? st.name}
							value={
								<View style={{ alignItems: "flex-end", gap: 2, flexShrink: 1 }}>
									<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
										<Badge label={st.state} tone={STEP_TONE[st.state]} />
										<Txt variant="small">{st.total ? `${fmtInt(st.done)} / ${fmtInt(st.total)}` : fmtInt(st.done)}</Txt>
									</View>
									{st.note ? <Txt variant="small">{st.note}</Txt> : null}
								</View>
							}
						/>
					))}
				</Card>
			) : null}
			<DataTable id="migrate-days" label="Per-day report" columns={DAY_COLUMNS} data={s.days} rowId={(d) => `${d.table}:${d.day}`} defaultSort={[{ id: "day", desc: true }]} density="compact" empty={<Txt variant="muted">No day listed yet.</Txt>} />
		</View>
	);
}

/** 403 (read-only) and 404 (an older server): nothing to show, and no more polling. */
export const migrateHidden = (error: unknown) => error instanceof ApiError && (error.status === 403 || error.status === 404);

export function MigrationCard({ backendId }: { backendId: string }) {
	const q = useTTQuery(backendId, MIGRATE_KEY, (api, s) => api.migrateStatus(s) as Promise<MigrateStatus>, {
		retry: false,
		staleTime: 60_000,
		refetchInterval: (query) => (migrateHidden(query.state.error) ? false : migratePollMs((query.state.data as MigrateStatus | undefined)?.state)),
	});
	if (q.error && migrateHidden(q.error)) return null;
	return (
		<Section title="Migration">
			<Txt variant="small">Moving analytics history from another server or Basin to this one, or from this one to Basin, day by day, with a row count check per day.</Txt>
			{q.data ? <MigrationBody backendId={backendId} s={q.data} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Skeleton height={60} />}
		</Section>
	);
}
