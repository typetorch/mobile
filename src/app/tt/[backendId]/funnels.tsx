/**
 * Funnels: a funnel's steps (logged funnel rows, query `funnel`, or the built-in playtime funnels, `playtime-funnel`), or
 * two compared. A step opens the players who reached it or dropped off there (`funnel-players`).
 */
import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { FunnelPlayer, FunnelResult, PlaytimeFunnelResult } from "@/api/tt/types";
import { Button, Chips, Icon, List, Segmented, Txt } from "@/components/ui";
import { NamedPlayerRow, Note, Panel, QueryState, ShareBar } from "@/features/typetorch/bits";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, fmtInt, fmtNum, fmtPct, plural } from "@/lib/format";
import { space, useTheme } from "@/theme";

type Steps = Extract<FunnelResult, { steps: unknown }> & { playtime?: { measure: PlaytimeFunnelResult["measure"]; capHours: number } };
type Step = Steps["steps"][number] & { seconds?: number };
type AnyFunnel = FunnelResult | PlaytimeFunnelResult;
type Mode = "reached" | "dropped";

const VIRTUAL: { key: string; title: string; measure: PlaytimeFunnelResult["measure"] }[] = [
	{ key: "playtime:total", title: "Playtime: total", measure: "total" },
	{ key: "playtime:first", title: "Playtime: first session", measure: "first" },
];
const virtualOf = (name: string) => VIRTUAL.find((v) => v.key === name);

function playtimeSteps(title: string, d: PlaytimeFunnelResult): Steps {
	const index = (seconds: number) => d.steps.findIndex((s) => s.seconds === seconds) + 1;
	return {
		funnel: title,
		players: d.players,
		steps: d.steps.map<Step>((s, i) => ({ step: i + 1, seconds: s.seconds, label: `≥ ${s.label}`, reached: s.reached, ofStart: s.ofTotal, fromPrevious: s.fromPrevious, logged: s.reached, medianSecondsFromStart: null })),
		biggestDrop: d.biggestDrop ? { step: index(d.biggestDrop.seconds), lost: d.biggestDrop.lost, share: d.biggestDrop.share } : null,
		playtime: { measure: d.measure, capHours: d.sessionCapHours },
	};
}

function useFunnel(backendId: string, name: string) {
	const v = virtualOf(name);
	const logged = useTTAnalytics(backendId, "funnel", { funnel: name }, { enabled: !v && name !== "" });
	const playtime = useTTAnalytics(backendId, "playtime-funnel", { measure: v?.measure ?? "total" }, { enabled: !!v });
	const query = (v ? playtime : logged) as UseQueryResult<AnyFunnel, Error>;
	const toSteps = (d: AnyFunnel): Steps | null => {
		if (v) return playtimeSteps(v.title, d as PlaytimeFunnelResult);
		const f = d as FunnelResult;
		return f.funnel === null ? null : f;
	};
	return { query, toSteps, data: query.data ? toSteps(query.data) : null };
}

function playtimeDescription(x: NonNullable<Steps["playtime"]>): string {
	const length = `A session lasts from its first to its last event (one still running counts up to its latest event), at most ${x.capHours} h.`;
	return x.measure === "total"
		? `Players whose playtime in this range (their sessions added up) reached each step, of every player in the range. ${length}`
		: `New players whose first-ever session (in this range) lasted at least each step, of those new players. ${length}`;
}

const stepValue = (s: Step) => s.seconds ?? s.step;
const completion = (d: Steps) => d.steps[d.steps.length - 1]?.ofStart ?? 0;

function fmtPlaytime(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = s % 60;
	if (h) return m ? `${h}h ${m}m` : `${h}h`;
	if (m) return r ? `${m}m ${r}s` : `${m}m`;
	return `${r}s`;
}

interface Open {
	funnel: string;
	step: number;
}

export default function FunnelsScreen() {
	return <TTScreen title="Funnels">{({ backendId }) => <Funnels backendId={backendId} />}</TTScreen>;
}

function Funnels({ backendId }: { backendId: string }) {
	const list = useTTAnalytics(backendId, "funnel", {});
	const [picked, setPicked] = useState("");
	const [compare, setCompare] = useState("");
	const [open, setOpen] = useState<Open | null>(null);
	const [mode, setMode] = useState<Mode>("reached");
	const funnels = list.data && list.data.funnel === null ? list.data.funnels : [];
	const name = picked || funnels[0]?.name || (VIRTUAL[0] as (typeof VIRTUAL)[number]).key;
	const other = compare && compare !== name ? compare : "";
	const options = (exclude: string) => [...funnels.filter((f) => f.name !== exclude).map((f) => ({ value: f.name, label: `${f.name} (${fmtInt(f.players)})` })), ...VIRTUAL.filter((v) => v.key !== exclude).map((v) => ({ value: v.key, label: v.title }))];
	const onOpen = (funnel: string, step: number) => setOpen(open && open.funnel === funnel && open.step === step ? null : { funnel, step });
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>Step-by-step funnels the game logs (funnel rows: step index i, step name), and the built-in playtime funnels.</Note>
			{list.error ? <Note>Couldn't load the logged funnels: {list.error.message}</Note> : null}
			<View style={{ gap: space.sm }}>
				<Txt variant="label">Funnel</Txt>
				<Chips options={options("")} value={name} onChange={(v) => { setPicked(v); setOpen(null); }} />
				<Txt variant="label">Compare with</Txt>
				<Chips options={[{ value: "", label: "none" }, ...options(name)]} value={other} onChange={(v) => { setCompare(v); setOpen(null); }} />
				{other ? (
					<Button
						title="Swap"
						small
						icon="swap-horizontal"
						variant="ghost"
						onPress={() => {
							setPicked(other);
							setCompare(name);
						}}
						style={{ alignSelf: "flex-start" }}
					/>
				) : null}
			</View>
			{other ? <CompareSummary backendId={backendId} a={name} b={other} /> : null}
			<FunnelSteps backendId={backendId} name={name} open={open} mode={mode} onMode={setMode} onOpen={onOpen} />
			{other ? <FunnelSteps backendId={backendId} name={other} open={open} mode={mode} onMode={setMode} onOpen={onOpen} /> : null}
		</>
	);
}

function CompareSummary({ backendId, a, b }: { backendId: string; a: string; b: string }) {
	const p = useTheme();
	const da = useFunnel(backendId, a).data;
	const db = useFunnel(backendId, b).data;
	if (!da || !db || !da.players || !db.players || !da.steps.length || !db.steps.length) return null;
	const delta = (completion(db) - completion(da)) * 100;
	const line = (d: Steps) => (
		<View key={d.funnel} style={{ gap: 2 }}>
			<Txt style={{ fontWeight: "600" }}>{d.funnel}</Txt>
			<Txt variant="small">
				{fmtInt(d.players)} started · {d.steps.length} steps · {fmtPct(completion(d))} completed · biggest drop{" "}
				{d.biggestDrop ? `${d.playtime ? "" : `step ${d.biggestDrop.step} `}(${d.steps.find((s) => s.step === d.biggestDrop?.step)?.label ?? "?"}): ${fmtPct(d.biggestDrop.share)} lost` : "none"}
			</Txt>
		</View>
	);
	return (
		<Panel title={`${da.funnel} vs ${db.funnel}`} note="Completed = share of the players who started (playtime funnels: of their base) that reached the funnel's last step.">
			{line(da)}
			{line(db)}
			<Txt variant="small">
				{db.funnel} completes{" "}
				<Txt variant="small" color={delta > 0 ? p.good : delta < 0 ? p.destructive : p.foreground} style={{ fontWeight: "600" }}>
					{delta === 0 ? "the same as" : `${fmtNum(Math.abs(delta), 1)} points ${delta > 0 ? "more" : "less"} than`}
				</Txt>{" "}
				{da.funnel}.
			</Txt>
		</Panel>
	);
}

function FunnelSteps({ backendId, name, open, mode, onMode, onOpen }: { backendId: string; name: string; open: Open | null; mode: Mode; onMode(m: Mode): void; onOpen(funnel: string, step: number): void }) {
	const funnel = useFunnel(backendId, name);
	const isEmpty = (d: AnyFunnel) => {
		const steps = funnel.toSteps(d);
		return !steps || steps.players === 0 || steps.steps.length === 0;
	};
	return (
		<QueryState q={funnel.query} isEmpty={isEmpty} empty="Nobody reached a step of this funnel in this range.">
			{(d) => {
				const steps = funnel.toSteps(d);
				return steps ? <StepBars backendId={backendId} funnelKey={name} data={steps} open={open?.funnel === name ? open.step : null} mode={mode} onMode={onMode} onOpen={onOpen} /> : null;
			}}
		</QueryState>
	);
}

function StepBars({ backendId, funnelKey, data, open, mode, onMode, onOpen }: { backendId: string; funnelKey: string; data: Steps; open: number | null; mode: Mode; onMode(m: Mode): void; onOpen(funnel: string, step: number): void }) {
	const p = useTheme();
	const drop = data.biggestDrop;
	const pt = data.playtime;
	const base = pt ? (pt.measure === "first" ? "of new players" : "of all players") : "of start";
	return (
		<Panel
			title={pt ? `${data.funnel}: ${plural(data.players, pt.measure === "first" ? "new player" : "player")}` : `${data.funnel}: ${plural(data.players, "player")} started`}
			note={`${pt ? playtimeDescription(pt) : "Reached = players whose furthest step is at least this one. Time = median from their first step."} Tap a step for its players.`}
		>
			{data.steps.map((s: Step, i) => {
				const isDrop = drop?.step === s.step;
				const value = stepValue(s);
				const selected = open === value;
				return (
					<View key={s.step} style={{ gap: space.sm }}>
						<Pressable
							onPress={() => onOpen(funnelKey, value)}
							style={({ pressed }) => [{ borderWidth: 1, borderColor: isDrop ? p.destructive : selected ? p.brand : p.border, borderRadius: 8, padding: 10, gap: 6, backgroundColor: selected ? p.muted : undefined }, pressed && { opacity: 0.7 }]}
						>
							<Txt style={{ fontWeight: "600" }}>
								{pt ? "" : <Txt variant="muted">Step {s.step} </Txt>}
								{s.label ?? ""}
							</Txt>
							<Txt variant="small">
								<Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>
									{fmtInt(s.reached)}
								</Txt>{" "}
								reached · {fmtPct(s.ofStart)} {base} · {fmtPct(s.fromPrevious)} from previous
								{pt ? "" : ` · ${s.medianSecondsFromStart === null ? "–" : `${fmtNum(s.medianSecondsFromStart, 1)} s`} median`}
							</Txt>
							<ShareBar share={s.ofStart} {...(isDrop ? { tone: "critical" as const } : {})} />
							{isDrop && drop ? (
								<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
									<Icon name="warning-outline" size={13} color={p.destructive} />
									<Txt variant="small" color={p.destructive} style={{ flex: 1 }}>
										Biggest drop: {plural(drop.lost, "player")} ({fmtPct(drop.share)}) stopped before {pt ? "reaching this" : "this step"}
									</Txt>
								</View>
							) : null}
						</Pressable>
						{selected ? <StepPlayers backendId={backendId} funnelKey={funnelKey} steps={data} index={i} step={value} mode={mode} onMode={onMode} /> : null}
					</View>
				);
			})}
			{!drop && data.steps.length > 0 ? <Note>No drop between steps yet.</Note> : null}
		</Panel>
	);
}

function StepPlayers({ backendId, funnelKey, steps: data, index, step, mode, onMode }: { backendId: string; funnelKey: string; steps: Steps; index: number; step: number; mode: Mode; onMode(m: Mode): void }) {
	const v = virtualOf(funnelKey);
	const { state } = useTTFilters(backendId);
	const players = useTTAnalytics(backendId, "funnel-players", v ? { measure: v.measure, step, mode } : { funnel: funnelKey, step, mode });
	const steps: Step[] = data.steps;
	const labelOf = (n: number) => {
		const s = steps.find((x) => x.step === n);
		return s?.label ? `${n}. ${s.label}` : `Step ${n}`;
	};
	const before = index > 0 ? (steps[index - 1]?.reached ?? null) : index === 0 && v ? data.players : null;
	const reached = steps[index]?.reached ?? null;
	const detail = (x: FunnelPlayer) => {
		if (v) return `${fmtPlaytime(x.playtimeSeconds ?? 0)} played · seen ${x.lastAt ? fmtAgo(x.lastAt) : "–"}`;
		const last = x.lastStep === null ? "" : labelOf(x.lastStep);
		return mode === "reached" ? `reached ${x.at ? fmtAgo(x.at) : "–"}${last ? ` · furthest ${last}` : ""} · seen ${x.lastAt ? fmtAgo(x.lastAt) : "–"}` : `last step ${last || "–"} ${x.at ? fmtAgo(x.at) : ""} · seen ${x.lastAt ? fmtAgo(x.lastAt) : "–"}`;
	};
	return (
		<View style={{ gap: space.sm, paddingLeft: space.sm }}>
			<Segmented
				options={[
					{ value: "reached", label: `Reached${reached !== null ? ` (${fmtInt(reached)})` : ""}` },
					{ value: "dropped", label: `Dropped off${before !== null && reached !== null ? ` (${fmtInt(before - reached)})` : ""}` },
				]}
				value={mode}
				onChange={onMode}
			/>
			<Note>{`${describeRange(state)}, under the page's filters.`}</Note>
			<QueryState q={players} rows={3}>
				{(d) =>
					d.players.length ? (
						<View style={{ gap: space.sm }}>
							<List>
								{[...d.players]
									.sort((a, b) => ((v ? b.lastAt : b.at) ?? "").localeCompare((v ? a.lastAt : a.at) ?? ""))
									.map((x) => (
										<NamedPlayerRow key={x.pid} backendId={backendId} row={x} detail={detail(x)} />
									))}
							</List>
							<Note>
								{d.more ? `The ${fmtInt(d.players.length)} most recent, of ${fmtInt(d.total)}. ` : ""}
								{v
									? mode === "reached"
										? "Players whose playtime reached this step."
										: "Players whose playtime reached the step before (for the first step: any playtime) but not this one."
									: mode === "reached"
										? "Players whose furthest step is at least this one."
										: "Players who reached the step before but not this one."}
							</Note>
						</View>
					) : (
						<Txt variant="muted">
							{mode === "reached" ? "Nobody reached this step in this range." : index === 0 && !v ? "Nobody drops off at the first step: every starter logged it." : "Nobody dropped off here in this range."}
						</Txt>
					)
				}
			</QueryState>
		</View>
	);
}

