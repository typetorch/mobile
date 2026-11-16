/**
 * Run Luau (Open Cloud Luau Execution): run a script against a place (its latest version, or a version number) in a
 * headless server, wait for it (bounded polling, can be stopped), then show the returned values and the printed logs.
 * It doesn't touch live servers, but data stores, messaging etc. are the real ones, so it asks first. Roblox allows 5
 * runs a minute. Binary input isn't offered: it needs a file picker the app doesn't ship.
 */
import { useMutation } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, confirm, Field, notify, Section, Txt } from "@/components/ui";
import { createLuauTask, LUAU_DONE, LUAU_LIMITS, luauTaskLogs, utf8Length, waitLuauTask, type LuauLog, type LuauTask } from "@/features/project/api/configure";
import { PlacePicker, useUniversePlaces } from "@/features/project/configure/shared";
import { cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtTime, prettyJson } from "@/lib/format";
import { toneColor, useTheme, type Tone } from "@/theme";

export default function LuauScreen() {
	return <ToolScreen title="Run Luau" scopes={["universe.place.luau-execution-session:write"]}>{({ universeId, cloud }) => <Luau universeId={universeId} cloud={cloud} />}</ToolScreen>;
}

const SAMPLE = `-- Runs in a headless server on the saved place.
print("Workspace children:", #workspace:GetChildren())
return game.PlaceId, game.PlaceVersion`;

interface Run {
	task: LuauTask;
	logs: LuauLog[];
	/** Set when reading the logs failed (e.g. 429: logs allow 45 calls a minute); the run itself still finished. */
	logsError?: unknown;
	placeId: number;
	startedAt: number;
}

const STATE_TONE: Record<string, Tone> = { COMPLETE: "good", FAILED: "critical", CANCELLED: "warning", QUEUED: "muted", PROCESSING: "brand" };
const MESSAGE_TONE: Record<string, Tone> = { WARNING: "warning", ERROR: "critical", INFO: "brand" };

function Luau({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const params = useLocalSearchParams<{ placeId?: string }>();
	const { places, rootId, loading } = useUniversePlaces(universeId, cloud);
	const [placeId, setPlaceId] = useState<number | null>(params.placeId ? Number(params.placeId) : null);
	const [version, setVersion] = useState("");
	const [timeout, setTimeoutText] = useState("60");
	const [script, setScript] = useState(SAMPLE);
	const [error, setError] = useState<string | null>(null);
	const [live, setLive] = useState<LuauTask | null>(null);
	const [runs, setRuns] = useState<Run[]>([]);
	const stop = useRef<AbortController | null>(null);
	const pid = placeId ?? rootId;

	const run = useMutation({
		mutationFn: async (args: { placeId: number; script: string; timeoutSeconds: number; version?: number }) => {
			const controller = new AbortController();
			stop.current = controller;
			const startedAt = Date.now();
			const created = await createLuauTask(cloud, universeId, args.placeId, { script: args.script, timeoutSeconds: args.timeoutSeconds }, args.version);
			setLive(created);
			const done = await waitLuauTask(cloud, created, { signal: controller.signal, deadlineMs: (args.timeoutSeconds + 90) * 1000, onUpdate: setLive });
			let logs: LuauLog[] = [];
			let logsError: unknown;
			try {
				logs = await luauTaskLogs(cloud, done, controller.signal);
			} catch (e) {
				logsError = e;
			}
			return { task: done, logs, logsError, placeId: args.placeId, startedAt };
		},
		onSuccess: (r) => setRuns((list) => [r, ...list].slice(0, 10)),
		onError: (e) => notify("The run didn't finish", cloudErrorText(e)),
		onSettled: () => {
			setLive(null);
			stop.current = null;
		},
	});

	async function submit() {
		setError(null);
		if (!pid) return setError("Pick a place.");
		if (!script.trim()) return setError("The script is empty.");
		if (utf8Length(script) > LUAU_LIMITS.scriptBytes) return setError("The script is over 4 MB, Roblox's limit.");
		const t = timeout.trim();
		if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > LUAU_LIMITS.timeoutMax) return setError(`The timeout must be 1–${LUAU_LIMITS.timeoutMax} seconds.`);
		const v = version.trim();
		if (v && !/^[1-9]\d*$/.test(v)) return setError("The version must be a positive whole number (or empty for the latest).");
		const placeName = places.find((pl) => pl.id === pid)?.name ?? `place ${pid}`;
		if (!(await confirm("Run this script?", `On ${placeName}${v ? ` version ${v}` : " (latest version)"}, up to ${t} s. It uses the experience's real data stores and services.`, "Run", false))) return;
		run.mutate({ placeId: pid, script, timeoutSeconds: Number(t), version: v ? Number(v) : undefined });
	}

	return (
		<>
			<Section title="Place">
				<PlacePicker places={places} rootId={rootId} value={pid} onChange={setPlaceId} loading={loading} />
			</Section>
			<Card style={{ gap: 8 }}>
				<Field label="Script" value={script} onChangeText={setScript} multiline style={{ minHeight: 180 }} />
				<View style={{ flexDirection: "row", gap: 8 }}>
					<View style={{ flex: 1 }}>
						<Field label="Version (empty = latest)" value={version} onChangeText={setVersion} keyboardType="number-pad" maxLength={9} />
					</View>
					<View style={{ flex: 1 }}>
						<Field label="Timeout (s, ≤ 300)" value={timeout} onChangeText={setTimeoutText} keyboardType="number-pad" maxLength={3} />
					</View>
				</View>
				{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Button title="Run" variant="brand" icon="play" small loading={run.isPending} onPress={submit} />
					{run.isPending ? <Button title="Stop waiting" small variant="ghost" onPress={() => stop.current?.abort()} /> : null}
					{live?.state ? <Badge label={live.state.toLowerCase()} tone={STATE_TONE[live.state] ?? "muted"} /> : null}
				</View>
				<Txt variant="small">Runs in a headless server on the saved place, not in live servers. Roblox allows 5 runs a minute.</Txt>
			</Card>

			{runs.map((r, i) => (
				<RunResult key={`${r.task.path}-${i}`} run={r} cloud={cloud} placeName={places.find((pl) => pl.id === r.placeId)?.name} />
			))}
		</>
	);
}

function RunResult({ run, cloud, placeName }: { run: Run; cloud: OpenCloud; placeName?: string }) {
	const p = useTheme();
	const t = run.task;
	const results = t.output?.results ?? [];
	// A failed log read is shown with Retry instead of reading as "Nothing printed."
	const reload = useMutation({ mutationFn: () => luauTaskLogs(cloud, t) });
	const logs = reload.data ?? run.logs;
	const logsError = reload.data ? null : reload.error ?? (reload.isPending ? null : run.logsError);
	const lines = logs.flatMap((l) => (l.structuredMessages?.length ? l.structuredMessages : (l.messages ?? []).map((m) => ({ message: m, messageType: "OUTPUT" as const, createTime: undefined }))));
	const text = lines.map((l) => l.message).join("\n");
	const ended = LUAU_DONE.includes(t.state ?? "STATE_UNSPECIFIED");
	return (
		<Section title={`${placeName ?? "Run"} · ${fmtTime(run.startedAt)}`}>
			<Card style={{ gap: 8 }}>
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Badge label={(t.state ?? "unknown").toLowerCase()} tone={STATE_TONE[t.state ?? ""] ?? "muted"} />
					{ended && t.updateTime && t.createTime ? <Txt variant="small">{((Date.parse(t.updateTime) - Date.parse(t.createTime)) / 1000).toFixed(1)} s</Txt> : null}
				</View>
				{t.error ? (
					<Txt variant="mono" color={p.destructive} selectable>
						{t.error.code}: {t.error.message}
					</Txt>
				) : null}
				{t.state === "COMPLETE" ? (
					<>
						<Txt variant="label">Returned</Txt>
						<ScrollView horizontal>
							<Txt variant="mono" selectable>
								{results.length ? results.map((x) => prettyJson(x)).join("\n") : "(nothing)"}
							</Txt>
						</ScrollView>
					</>
				) : null}
				<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
					<Txt variant="label">Output ({lines.length})</Txt>
					{lines.length ? (
						<Button
							title="Copy"
							small
							variant="ghost"
							icon="copy-outline"
							onPress={async () => {
								await Clipboard.setStringAsync(text);
								notify("Copied", `${lines.length} lines`);
							}}
						/>
					) : null}
				</View>
				{logsError ? (
					<View style={{ gap: 6 }}>
						<Txt variant="small" color={p.destructive}>
							Couldn't load the logs: {cloudErrorText(logsError)}
						</Txt>
						<Button title="Retry" small icon="refresh" loading={reload.isPending} onPress={() => reload.mutate()} style={{ alignSelf: "flex-start" }} />
					</View>
				) : reload.isPending ? (
					<Txt variant="small">Loading the logs…</Txt>
				) : lines.length ? (
					<View style={{ gap: 2 }}>
						{lines.slice(0, 500).map((l, i) => (
							<Txt key={i} variant="mono" color={MESSAGE_TONE[l.messageType ?? ""] ? toneColor(p, MESSAGE_TONE[l.messageType ?? ""]!) : undefined} selectable>
								{l.message}
							</Txt>
						))}
						{lines.length > 500 ? <Txt variant="small">…{lines.length - 500} more lines (Copy has them all).</Txt> : null}
					</View>
				) : (
					<Txt variant="small">Nothing printed.</Txt>
				)}
			</Card>
		</Section>
	);
}
