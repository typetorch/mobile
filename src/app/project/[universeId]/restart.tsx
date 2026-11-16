/**
 * Restart servers: the forecast (players / servers each place would lose, per version), the plain "restart servers"
 * (cloud/v2 :restartServers with Roblox's defaults), a restart with options (which places, every version / only
 * outdated ones / chosen versions, a bleed-off period, attributes sent to the servers) through server management
 * (BETA) or cloud/v2, and the restart history with live progress (polled every 5 s while one runs, at most 10 minutes).
 * Every restart asks first and names the expected impact.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, confirm, EmptyState, Field, List, notify, Row, Section, Segmented, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import {
	forecastRestart,
	launchRestart,
	listRestarts,
	parseRestartAttributes,
	restartUniverseServers,
	type LaunchRestartRequest,
	type PlaceFilter,
	type PlaceForecast,
	type RestartStatus,
} from "@/features/project/api/servers";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { MultiChips, SwitchRow, placeName, usePlaces } from "@/features/project/servers/shared";
import { ToolScreen } from "@/features/project/tool";
import { compact, fmtAgo, fmtTime, plural } from "@/lib/format";
import { useTheme, type Tone } from "@/theme";

export default function RestartScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Restart servers" scopes={["universe:read"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "restart"], type: "active" })}>
			{({ universeId, cloud, can }) => <Restart universeId={universeId} cloud={cloud} canWrite={can("universe:write")} />}
		</ToolScreen>
	);
}

type Mode = "all" | "outdated" | "versions";

/** What a restart would hit, from the forecast. `placeIds` null = every place. */
function estimate(forecasts: Record<string, PlaceForecast>, placeIds: string[] | null, mode: Mode, versions: number[]): { players: number; servers: number } {
	let players = 0;
	let servers = 0;
	for (const id of placeIds ?? Object.keys(forecasts)) {
		const f = forecasts[id];
		if (!f) continue;
		const ppv = f.playersPerVersion ?? {};
		const ipv = f.instancesPerVersion ?? {};
		if (mode === "all") {
			players += f.totalPlayers ?? 0;
			servers += f.totalInstances ?? 0;
		} else if (mode === "outdated") {
			const latest = f.latestPlaceVersion ?? "";
			players += (f.totalPlayers ?? 0) - (ppv[latest] ?? 0);
			servers += (f.totalInstances ?? 0) - (ipv[latest] ?? 0);
		} else {
			for (const v of versions) {
				players += ppv[String(v)] ?? 0;
				servers += ipv[String(v)] ?? 0;
			}
		}
	}
	return { players, servers };
}

function parseVersions(text: string): number[] {
	const parts = text.split(/[\s,]+/).filter(Boolean);
	for (const p of parts) if (!/^\d{1,9}$/.test(p)) throw new Error(`“${p}” is not a version number.`);
	return Array.from(new Set(parts.map(Number)));
}

function Restart({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const params = useLocalSearchParams<{ place?: string; version?: string }>();
	const places = usePlaces(universeId);
	const forecast = useQuery({ queryKey: ["oc", "restart", universeId, "forecast"], queryFn: () => forecastRestart(cloud, universeId), retry: false, staleTime: 15_000 });
	const forecasts = forecast.data?.placeForecasts ?? {};
	const totals = estimate(forecasts, null, "all", []);

	// History: polled every 5 s while a restart is running, at most 120 fetches (10 minutes) per screen visit or launch.
	// The counter goes up in queryFn (real fetches), not in refetchInterval, which TanStack evaluates on every render.
	const polls = useRef(0);
	const history = useQuery({
		queryKey: ["oc", "restart", universeId, "history"],
		queryFn: () => {
			polls.current++;
			return listRestarts(cloud, universeId);
		},
		retry: false,
		refetchInterval: (query) => {
			const running = Object.values(query.state.data?.restartStatuses ?? {}).some((r) => Object.values(r.placeRestartStatuses ?? {}).some((pl) => pl.state !== "SUCCEEDED"));
			return running && polls.current < 120 ? 5000 : false;
		},
	});

	const afterRestart = () => {
		polls.current = 0;
		queryClient.invalidateQueries({ queryKey: ["oc", "restart", universeId] });
		queryClient.invalidateQueries({ queryKey: ["oc", "servers", universeId] });
	};

	const quick = useMutation({
		mutationFn: () => cloud.restartServers(universeId),
		onSuccess: () => {
			afterRestart();
			notify("Restart sent", "Roblox is restarting the servers. Progress shows under History.");
		},
		onError: (e) => notify("Couldn't restart", cloudErrorText(e)),
	});

	const placeOptions = Array.from(new Set([...(places.data ?? []).map((pl) => String(pl.id)), ...Object.keys(forecasts)])).map((id) => ({ value: id, label: placeName(places.data, id) }));

	return (
		<>
			<Section title="Right now">
				{forecast.error ? (
					<CloudError error={forecast.error} what="Restart forecast" onRetry={() => forecast.refetch()} />
				) : !forecast.data ? (
					<SkeletonList rows={2} />
				) : Object.keys(forecasts).length ? (
					<>
						<StatGrid>
							<Stat label="Players" value={compact(totals.players)} />
							<Stat label="Servers" value={compact(totals.servers)} />
						</StatGrid>
						<List>
							{Object.entries(forecasts).map(([id, f]) => {
								const versions = Object.entries(f.playersPerVersion ?? {}).sort((a, b) => Number(b[0]) - Number(a[0]));
								return (
									<Row
										key={id}
										title={`${placeName(places.data, id)}${f.isNotInUniverse ? " (moved out)" : ""}`}
										subtitle={`${plural(f.totalPlayers, "player")} on ${plural(f.totalInstances, "server")} · latest v${f.latestPlaceVersion ?? "?"}${f.publishTime ? ` (${fmtAgo(f.publishTime)})` : ""}\n${versions
											.map(([v, n]) => `v${v}: ${n} players / ${f.instancesPerVersion?.[v] ?? 0} servers`)
											.join(" · ")}`}
										numberOfLines={3}
									/>
								);
							})}
						</List>
					</>
				) : (
					<EmptyState icon="moon-outline" title="No servers running" body="Nothing would be restarted right now." />
				)}
			</Section>

			{canWrite ? (
				<Card style={{ gap: 8 }}>
					<Txt variant="h3">Restart servers</Txt>
					<Txt variant="small">Roblox's default restart (cloud/v2): every place; servers on an older version than the latest publish shut down and players rejoin the new version.</Txt>
					<Button
						title="Restart servers"
						variant="destructive"
						icon="refresh-circle-outline"
						loading={quick.isPending}
						onPress={async () => {
							const hit = estimate(forecasts, null, "outdated", []);
							if (await confirm("Restart servers?", `Servers running an older version of any place shut down now${forecast.data ? ` (about ${plural(hit.players, "player")} on ${plural(hit.servers, "server")})` : ""}. Players are moved to new servers.`, "Restart")) quick.mutate();
						}}
						style={{ alignSelf: "flex-start" }}
					/>
				</Card>
			) : (
				<Txt variant="small">Read only: add universe:write for this experience to restart servers.</Txt>
			)}

			{canWrite ? (
				<RestartOptions
					universeId={universeId}
					cloud={cloud}
					forecasts={forecasts}
					hasForecast={!!forecast.data}
					placeOptions={placeOptions}
					initialPlace={params.place && /^\d+$/.test(params.place) ? params.place : null}
					initialVersion={params.version && /^\d+$/.test(params.version) ? Number(params.version) : null}
					onDone={afterRestart}
					placeLabel={(id) => placeName(places.data, id)}
				/>
			) : null}

			<Section title="History">
				{history.error ? (
					<CloudError error={history.error} what="Restart history" onRetry={() => history.refetch()} />
				) : !history.data ? (
					<SkeletonList rows={3} />
				) : Object.keys(history.data.restartStatuses ?? {}).length ? (
					<List>
						{Object.entries(history.data.restartStatuses ?? {})
							.sort((a, b) => Date.parse(b[1].scheduledTime ?? "") - Date.parse(a[1].scheduledTime ?? ""))
							.map(([id, r]) => (
								<HistoryRow key={id} id={id} restart={r} placeLabel={(pid) => placeName(places.data, pid)} />
							))}
					</List>
				) : (
					<Txt variant="muted">No restarts yet.</Txt>
				)}
				{history.data && polls.current >= 120 ? <Txt variant="small" color={p.mutedForeground}>Stopped checking for progress; pull to refresh.</Txt> : null}
			</Section>
		</>
	);
}

const STATE_TONE: Record<string, Tone> = { DELAYING: "warning", RESTARTING: "brand", SUCCEEDED: "good" };

function HistoryRow({ id, restart, placeLabel }: { id: string; restart: RestartStatus; placeLabel: (id: string) => string }) {
	const placesStatus = Object.entries(restart.placeRestartStatuses ?? {});
	return (
		<View style={{ paddingVertical: 10, paddingHorizontal: 12, gap: 6 }}>
			<Txt style={{ fontWeight: "500" }}>
				{fmtTime(restart.scheduledTime)} UTC
			</Txt>
			<Txt variant="small" selectable>
				{id}
				{restart.startTime && restart.startTime !== restart.scheduledTime ? ` · bleed-off until ${fmtTime(restart.startTime)}` : ""}
			</Txt>
			{placesStatus.map(([pid, s]) => {
				const filter = s.filter?.versions?.length ? `versions ${s.filter.versions.join(", ")}` : s.filter?.excludeCurrentVersion ? "outdated versions" : "every version";
				const done = s.totalPlayers ? Math.round(((s.totalPlayers - s.remainingPlayers) / s.totalPlayers) * 100) : null;
				return (
					<View key={pid} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
						<Badge label={s.state.toLowerCase()} tone={STATE_TONE[s.state] ?? "muted"} />
						<Txt variant="small" style={{ flex: 1 }} numberOfLines={2}>
							{placeLabel(pid)} · {filter} · {s.remainingInstances}/{s.totalInstances} servers, {s.remainingPlayers}/{s.totalPlayers} players left{done !== null && s.state !== "SUCCEEDED" ? ` (${done}%)` : ""}
							{s.endTime ? ` · done ${fmtTime(s.endTime)}` : ""}
						</Txt>
					</View>
				);
			})}
		</View>
	);
}

function RestartOptions({
	universeId,
	cloud,
	forecasts,
	hasForecast,
	placeOptions,
	initialPlace,
	initialVersion,
	onDone,
	placeLabel,
}: {
	universeId: number;
	cloud: OpenCloud;
	forecasts: Record<string, PlaceForecast>;
	hasForecast: boolean;
	placeOptions: { value: string; label: string }[];
	initialPlace: string | null;
	initialVersion: number | null;
	onDone: () => void;
	placeLabel: (id: string) => string;
}) {
	const p = useTheme();
	const [api, setApi] = useState<"sm" | "v2">("sm");
	const [allPlaces, setAllPlaces] = useState(!initialPlace);
	const [selected, setSelected] = useState<string[]>(initialPlace ? [initialPlace] : []);
	const [mode, setMode] = useState<Mode>(initialVersion ? "versions" : "outdated");
	const [versions, setVersions] = useState<number[]>(initialVersion ? [initialVersion] : []);
	const [versionText, setVersionText] = useState("");
	const [bleed, setBleed] = useState("");
	const [attributes, setAttributes] = useState("");
	const [formError, setFormError] = useState<string | null>(null);

	const onePlace = !allPlaces && selected.length === 1 ? selected[0]! : null;
	const placeVersions = onePlace ? Object.keys(forecasts[onePlace]?.playersPerVersion ?? {}).sort((a, b) => Number(b) - Number(a)) : [];
	const effectiveMode: Mode = api === "v2" && mode === "versions" ? "outdated" : mode;
	const maxBleed = api === "sm" ? 240 : 60;

	const run = useMutation({
		mutationFn: async (body: { kind: "sm"; req: LaunchRestartRequest } | { kind: "v2"; placeIds?: number[]; closeAllVersions: boolean; bleed?: number }) => {
			if (body.kind === "sm") return launchRestart(cloud, universeId, body.req);
			await restartUniverseServers(cloud, universeId, { placeIds: body.placeIds, closeAllVersions: body.closeAllVersions, bleedOffServers: !!body.bleed, bleedOffDurationMinutes: body.bleed });
			return null;
		},
		onSuccess: (r) => {
			onDone();
			notify("Restart launched", r ? `${plural(r.playersImpacted, "player")} on ${plural(r.instancesImpacted, "server")} affected.${r.id ? `\nRestart ${r.id}` : ""}` : "Roblox accepted the restart. Progress shows under History.");
		},
		onError: (e) => notify("Couldn't restart", cloudErrorText(e)),
	});

	async function submit() {
		setFormError(null);
		try {
			if (!allPlaces && !selected.length) throw new Error("Pick at least one place, or turn on every place.");
			let bleedMinutes: number | undefined;
			if (bleed.trim()) {
				if (!/^\d+$/.test(bleed.trim())) throw new Error("Bleed-off must be whole minutes.");
				bleedMinutes = Number(bleed.trim());
				if (bleedMinutes < 1 || bleedMinutes > maxBleed) throw new Error(`Bleed-off must be 1-${maxBleed} minutes.`);
			}
			let pickedVersions = versions;
			if (effectiveMode === "versions") {
				if (!onePlace) throw new Error("Picking versions works for one place at a time.");
				pickedVersions = Array.from(new Set([...versions, ...parseVersions(versionText)]));
				if (!pickedVersions.length) throw new Error("Pick or type at least one version.");
			}
			const placeIds = allPlaces ? null : selected;
			const hit = estimate(forecasts, placeIds, effectiveMode, pickedVersions);
			const where = allPlaces ? "every place" : selected.map(placeLabel).join(", ");
			const which = effectiveMode === "all" ? "all versions" : effectiveMode === "outdated" ? "older versions only" : `version${pickedVersions.length > 1 ? "s" : ""} ${pickedVersions.join(", ")}`;
			const impact = hasForecast ? ` About ${plural(hit.players, "player")} on ${plural(hit.servers, "server")} right now.` : "";
			const timing = bleedMinutes ? ` Matchmaking stops now; servers shut down after ${bleedMinutes} min.` : " Servers shut down now.";

			if (api === "sm") {
				const attrs = parseRestartAttributes(attributes);
				const req: LaunchRestartRequest = {};
				if (bleedMinutes) req.bleedOffDurationMinutes = bleedMinutes;
				if (attrs) req.attributes = attrs;
				if (placeIds || effectiveMode !== "all") {
					const ids = placeIds ?? Object.keys(forecasts);
					if (!ids.length) throw new Error("No places with servers to restart.");
					const filter: PlaceFilter = effectiveMode === "outdated" ? { excludeCurrentVersion: true } : effectiveMode === "versions" ? { versions: pickedVersions } : {};
					req.places = Object.fromEntries(ids.map((id) => [id, filter]));
				}
				if (await confirm("Restart servers?", `${where}, ${which}.${timing}${impact}`, "Restart")) run.mutate({ kind: "sm", req });
			} else {
				if (await confirm("Restart servers?", `${where}, ${which}.${timing}${impact}`, "Restart"))
					run.mutate({ kind: "v2", placeIds: placeIds?.map(Number), closeAllVersions: effectiveMode === "all", bleed: bleedMinutes });
			}
		} catch (e) {
			setFormError((e as Error).message);
		}
	}

	return (
		<Card style={{ gap: 10 }}>
			<Txt variant="h3">Restart with options</Txt>
			<Segmented options={[{ value: "sm", label: "Server management" }, { value: "v2", label: "Cloud v2" }]} value={api} onChange={setApi} />
			<Txt variant="small">{api === "sm" ? "BETA: per-place version filters, bleed-off up to 240 min, attributes for your servers." : "Stable: places, all or older versions, bleed-off up to 60 min."}</Txt>
			<SwitchRow label="Every place" value={allPlaces} onChange={setAllPlaces} />
			{!allPlaces ? (
				placeOptions.length ? (
					<MultiChips options={placeOptions} value={selected} onChange={setSelected} />
				) : (
					<Txt variant="small">No places found.</Txt>
				)
			) : null}
			<Txt variant="label">Which servers</Txt>
			<Segmented
				options={[
					{ value: "outdated", label: "Older versions" },
					{ value: "all", label: "All versions" },
					...(api === "sm" ? [{ value: "versions" as Mode, label: "Pick versions" }] : []),
				]}
				value={effectiveMode}
				onChange={setMode}
			/>
			{effectiveMode === "versions" ? (
				onePlace ? (
					<>
						{placeVersions.length ? (
							<MultiChips
								options={placeVersions.map((v) => ({ value: Number(v), label: `v${v} · ${forecasts[onePlace]?.playersPerVersion?.[v] ?? 0}` }))}
								value={versions}
								onChange={setVersions}
							/>
						) : null}
						<Field value={versionText} onChangeText={setVersionText} placeholder="More versions: 41, 42" keyboardType="numbers-and-punctuation" />
					</>
				) : (
					<Txt variant="small">Pick exactly one place to choose versions.</Txt>
				)
			) : null}
			<Field label={`Bleed-off (minutes, 1-${maxBleed}; empty = now)`} value={bleed} onChangeText={setBleed} placeholder="10" keyboardType="number-pad" maxLength={3} />
			{api === "sm" ? (
				<Field
					label="Attributes for the servers (JSON object, 500 bytes)"
					value={attributes}
					onChangeText={setAttributes}
					placeholder='{"reason": "hotfix"}'
					multiline
					style={{ minHeight: 60 }}
				/>
			) : null}
			{formError ? <Txt variant="small" color={p.destructive}>{formError}</Txt> : null}
			<Button title="Restart…" variant="destructive" icon="refresh-circle-outline" loading={run.isPending} onPress={submit} style={{ alignSelf: "flex-start" }} />
		</Card>
	);
}
