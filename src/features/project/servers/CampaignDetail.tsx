/**
 * One ad campaign (Ads Manager, BETA): delivery status and reasons, budget (with a pending decrease), schedule,
 * objective, targeting; its performance as Ads Manager shows it (CampaignPerformance: totals, a chart, the ads as a
 * table with spend, impressions, CTR, clicks, CPC and each ad's on / off); the creatives (a creative that is also a
 * homepage thumbnail shows that thumbnail's play-through); and its edits (PATCH /campaigns/{id}): pause / resume, cancel, budget, name,
 * schedule (before it starts), add creatives, video, automatic ad-credit reload. Anything that can spend money or is
 * permanent asks first.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, Chips, confirm, ErrorState, Field, KV, notify, Section, Skeleton, Txt } from "@/components/ui";
import { CampaignPerformance } from "@/features/project/servers/CampaignPerformance";
import { ThumbStatLine, useCreativeImages, useCreativeThumbnailStats } from "@/features/project/servers/creative-stats";
import { fmtTime } from "@/lib/format";
import { useTheme } from "@/theme";

import { campaignOptions, fmtUsd, getCampaign, listCreatives, microsToUsd, updateCampaign, usdToMicros, type Campaign, type UpdateCampaignRequest, type VideoSource } from "../api/servers";
import { CloudError, cloudErrorText } from "../CloudError";
import { DeliveryBadge, label } from "./ads-shared";
import { MultiChips, SwitchRow } from "./shared";

export function CampaignDetail({ id, cloud, universeId, canWrite }: { id: string; cloud: OpenCloud; universeId: number; canWrite: boolean }) {
	const queryClient = useQueryClient();
	const campaign = useQuery({ queryKey: ["oc", "ads", "campaign", id], queryFn: () => getCampaign(cloud, id), retry: false });
	const update = useMutation({
		mutationFn: (body: UpdateCampaignRequest) => updateCampaign(cloud, id, body),
		onSuccess: (c) => {
			queryClient.setQueryData(["oc", "ads", "campaign", id], c);
			queryClient.invalidateQueries({ queryKey: ["oc", "ads"] });
		},
		onError: (e) => notify("Couldn't update the campaign", cloudErrorText(e)),
	});

	if (!id) return <ErrorState error={new Error("No campaign id.")} />;
	if (campaign.error) return <CloudError error={campaign.error} what="Ads" onRetry={() => campaign.refetch()} />;
	if (!campaign.data) return <Skeleton height={240} />;
	const c = campaign.data;
	return (
		<>
			<Card style={{ gap: 2 }}>
				<Txt variant="h3">{c.name}</Txt>
				<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginVertical: 4 }}>
					<Badge label={c.status.toLowerCase()} tone={c.status === "ACTIVE" ? "good" : c.status === "PAUSED" ? "warning" : "muted"} />
					<DeliveryBadge status={c.deliveryStatus} />
					{(c.deliveryStatusReasons ?? []).map((r) => (
						<Badge key={r} label={label(r)} />
					))}
				</View>
				<KV label="Budget" value={`${fmtUsd(microsToUsd(c.budget?.amountMicros))} ${c.budget?.type === "DAILY" ? "per day" : "total"}`} />
				{c.budget?.scheduledAmountMicros ? <KV label="Lowering to" value={`${fmtUsd(microsToUsd(c.budget.scheduledAmountMicros))} from ${fmtTime(c.budget.scheduledEffectiveTime)} UTC`} /> : null}
				<KV label="Starts" value={`${fmtTime(c.schedule?.startTime)} UTC`} />
				<KV label="Ends" value={c.schedule?.durationInDays ? `${fmtTime(c.schedule.endTime)} UTC (${c.schedule.durationInDays} d)` : "no end date"} />
				<KV label="Objective" value={label(c.objective)} />
				<KV label="Payment" value={label(c.paymentType)} />
				<KV label="Audience" value={targetingText(c)} />
				<KV label="Creatives" value={(c.creativeAssetIds ?? []).join(", ") || "–"} mono />
				<KV label="Video" value={label(c.video?.source) || "–"} />
				{c.paymentType === "ADS_CREDIT" ? <KV label="Auto reload ad credit" value={c.autoReloadAdCreditEnabled ? "on" : "off"} /> : null}
				<KV label="Experience" value={c.targetUniverseId ?? "–"} />
				<KV label="Billing account" value={c.billingAccountId ?? "–"} mono />
				<KV label="Created" value={`${fmtTime(c.createTime)} UTC${c.creator?.userId ? ` by user ${c.creator.userId}` : ""}${c.creator?.groupId ? ` (group ${c.creator.groupId})` : ""}`} />
			</Card>
			<CampaignPerformance c={c} cloud={cloud} universeId={universeId} canWrite={canWrite} />
			<CampaignCreatives c={c} cloud={cloud} universeId={universeId} />
			{canWrite && c.status !== "CANCELLED" ? <CampaignEdits c={c} cloud={cloud} universeId={universeId} pending={update.isPending} save={(b) => update.mutateAsync(b).then(() => true, () => false)} /> : null}
			{!canWrite ? <Txt variant="small">Read only: add ad.campaign:write to pause, resume or change the budget.</Txt> : null}
		</>
	);
}

/**
 * The campaign's creatives as images, with their saved-creative name and moderation state (first page of the ads
 * account's creatives) and, when one is also a homepage thumbnail of the advertised experience, its play-through.
 */
function CampaignCreatives({ c, cloud, universeId }: { c: Campaign; cloud: OpenCloud; universeId: number }) {
	const p = useTheme();
	const ids = c.creativeAssetIds ?? [];
	const target = Number(c.targetUniverseId) || universeId;
	const images = useCreativeImages(ids);
	const groupId = c.creator?.groupId && /^\d+$/.test(c.creator.groupId) ? Number(c.creator.groupId) : undefined;
	const saved = useQuery({
		queryKey: ["oc", "ads", "creatives", target, "names", groupId ?? "me"],
		enabled: ids.length > 0,
		staleTime: 300_000,
		queryFn: () => listCreatives(cloud, { universeId: target, groupId }),
		retry: false,
	});
	const stats = useCreativeThumbnailStats(target, ids);
	return (
		<Section title={`Creatives (${ids.length})`}>
			{!ids.length ? <Txt variant="muted">{c.video?.source === "PREVIEW_VIDEO" ? "This campaign runs the experience's preview video." : "No creatives on this campaign."}</Txt> : null}
			{ids.map((id) => {
				const url = images.data?.[Number(id)];
				const info = saved.data?.creatives?.find((x) => x.assetId === id);
				const stat = stats.byAsset.get(id);
				return (
					<Card key={id} style={{ gap: 8 }}>
						<View style={{ flexDirection: "row", gap: 10 }}>
							{url ? (
								<Image source={{ uri: url }} style={{ width: 128, height: 72, borderRadius: 6 }} contentFit="cover" />
							) : (
								<View style={{ width: 128, height: 72, borderRadius: 6, backgroundColor: p.muted }} />
							)}
							<View style={{ flex: 1, gap: 4 }}>
								<Txt style={{ fontWeight: "600" }} numberOfLines={2}>
									{info?.assetName || `Asset ${id}`}
								</Txt>
								<Txt variant="small" selectable>
									{id}
									{info?.width && info.height ? ` · ${info.width}×${info.height}` : ""}
								</Txt>
								{info?.moderationStatus ? <Badge label={label(info.moderationStatus)} tone={info.moderationStatus === "APPROVED" ? "good" : info.moderationStatus === "REJECTED" ? "critical" : "brand"} /> : null}
							</View>
						</View>
						{stat ? <ThumbStatLine stat={stat} /> : null}
					</Card>
				);
			})}
			{stats.can && ids.length ? (
				stats.error ? (
					<CloudError error={stats.error} what="Homepage thumbnail stats" />
				) : stats.loading ? (
					<Txt variant="small">Loading homepage thumbnail stats…</Txt>
				) : stats.unknown ? (
					<Button title="Match creatives with homepage thumbnail stats" icon="images-outline" small variant="ghost" onPress={stats.request} style={{ alignSelf: "flex-start" }} />
				) : stats.requested && !stats.matched ? (
					<Txt variant="small">None of these creatives has homepage thumbnail stats in the last 28 days.</Txt>
				) : null
			) : null}
		</Section>
	);
}

function targetingText(c: Campaign): string {
	const t = c.targeting;
	if (!t) return "everyone";
	const parts = [
		t.audienceType && t.audienceType !== "ALL_PLAYERS" ? label(t.audienceType) : null,
		t.devices?.length ? t.devices.map(label).join(", ") : null,
		t.ageGroups?.length ? t.ageGroups.map(label).join(", ") : null,
		t.regions?.length ? t.regions.map(label).join(", ") : null,
		t.countries?.length ? t.countries.join(", ") : null,
	].filter(Boolean);
	return parts.join(" · ") || "everyone";
}

/** "2026-11-20 14:00" (local time) -> ISO; throws a readable error. */
export function parseLocalDateTime(text: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text.trim());
	if (!m) throw new Error("Start must look like 2026-11-20 14:00 (your local time).");
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
	if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) throw new Error("That start date doesn't exist.");
	if (d.getTime() < Date.now()) throw new Error("The start must be in the future.");
	return d.toISOString();
}

export function localDateTime(ms: number): string {
	const d = new Date(ms);
	const two = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function CampaignEdits({ c, cloud, universeId, pending, save }: { c: Campaign; cloud: OpenCloud; universeId: number; pending: boolean; save: (b: UpdateCampaignRequest) => Promise<boolean> }) {
	const p = useTheme();
	const [budget, setBudget] = useState(String(microsToUsd(c.budget?.amountMicros) ?? ""));
	const [name, setName] = useState(c.name);
	const startMs = Date.parse(c.schedule?.startTime ?? "");
	const notStarted = Number.isFinite(startMs) && startMs > Date.now();
	const [start, setStart] = useState(Number.isFinite(startMs) ? localDateTime(startMs) : "");
	const [days, setDays] = useState(String(c.schedule?.durationInDays ?? 0));
	const [addCreatives, setAddCreatives] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	// campaign-options says whether the video can change (mutableFields lists "video"), which sources are allowed, and
	// which billing accounts exist (each with its owning user or group).
	const optionsUniverse = Number(c.targetUniverseId) || universeId;
	const options = useQuery({ queryKey: ["oc", "ads", "options", optionsUniverse], queryFn: () => campaignOptions(cloud, optionsUniverse), retry: false, staleTime: 300_000 });
	// Saved creatives come from the ads account that owns the campaign: the group's when its billing account belongs
	// to a group (or the campaign names one), else the personal one.
	const ownerGroup = options.data?.billingAccounts?.find((a) => a.id === c.billingAccountId)?.creator?.groupId ?? c.creator?.groupId;
	const groupId = ownerGroup && /^\d+$/.test(ownerGroup) ? Number(ownerGroup) : undefined;
	const creatives = useQuery({
		queryKey: ["oc", "ads", "creatives", universeId, "edit", groupId ?? "me"],
		enabled: !options.isLoading,
		queryFn: () => listCreatives(cloud, { universeId, groupId, isArchived: false }),
		retry: false,
	});
	const attachable = (creatives.data?.creatives ?? []).filter((x) => !(c.creativeAssetIds ?? []).includes(x.assetId) && x.moderationStatus !== "REJECTED");
	const videoMutable = !!options.data?.mutableFields?.includes("video");
	const previewAvailable = options.data?.video?.previewVideo?.available !== false;
	const videoSources = (options.data?.video?.sources ?? []).filter((v) => v !== "PREVIEW_VIDEO" || previewAvailable);
	const currentVideo: VideoSource = c.video?.source ?? "IMAGE_ONLY";
	const canSwitchVideo = videoMutable && videoSources.some((v) => v !== currentVideo);
	const maxCreatives = options.data?.creativeRequirements?.maximumCount;
	const roomForCreatives = Math.min(5, maxCreatives ? Math.max(0, maxCreatives - (c.creativeAssetIds ?? []).length) : 5);

	async function run(body: UpdateCampaignRequest, title: string, message: string, destructive = false) {
		setError(null);
		if (await confirm(title, message, "Confirm", destructive)) return save(body);
		return false;
	}

	return (
		<>
			<Section title="Run">
				<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
					{c.status === "ACTIVE" ? (
						<Button title="Pause" icon="pause" small loading={pending} onPress={() => run({ status: "PAUSED" }, "Pause the campaign?", "It stops serving ads until you resume it.")} />
					) : (
						<Button
							title="Resume"
							icon="play"
							variant="brand"
							small
							loading={pending}
							onPress={() => run({ status: "ACTIVE" }, "Resume the campaign?", `It starts serving again and spends up to ${fmtUsd(microsToUsd(c.budget?.amountMicros))} ${c.budget?.type === "DAILY" ? "a day" : "in total"}.`)}
						/>
					)}
					<Button title="Cancel campaign" variant="destructive" small loading={pending} onPress={() => run({ status: "CANCELLED" }, "Cancel the campaign?", "Cancelling is permanent: it can't run again.", true)} />
				</View>
			</Section>

			<Card style={{ gap: 8 }}>
				<Txt variant="h3">Budget</Txt>
				<Field label={`Amount in USD (${c.budget?.type === "DAILY" ? "per day" : "total"})`} value={budget} onChangeText={setBudget} keyboardType="decimal-pad" maxLength={12} />
				<Txt variant="small">An increase takes effect now; a decrease on a running campaign waits until the account's next midnight.</Txt>
				<Button
					title="Save budget"
					small
					loading={pending}
					onPress={async () => {
						try {
							const micros = usdToMicros(budget);
							if (micros === c.budget?.amountMicros) return setError("That's the current budget.");
							await run({ budget: { amountMicros: micros } }, "Change the budget?", `${fmtUsd(microsToUsd(c.budget?.amountMicros))} → ${fmtUsd(microsToUsd(micros))} ${c.budget?.type === "DAILY" ? "per day" : "total"}. This changes what Roblox may charge.`);
						} catch (e) {
							setError((e as Error).message);
						}
					}}
					style={{ alignSelf: "flex-start" }}
				/>
			</Card>

			<Card style={{ gap: 8 }}>
				<Txt variant="h3">Details</Txt>
				<Field label="Name" value={name} onChangeText={setName} maxLength={200} />
				<Button
					title="Rename"
					small
					disabled={!name.trim() || name.trim() === c.name}
					loading={pending}
					onPress={() => save({ name: name.trim() })}
					style={{ alignSelf: "flex-start" }}
				/>
				{notStarted ? (
					<>
						<Field label="Start (local time)" value={start} onChangeText={setStart} placeholder="2026-11-20 14:00" />
						<Field label="Days to run (0 = no end, max 3650)" value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={4} />
						<Button
							title="Save schedule"
							small
							loading={pending}
							onPress={async () => {
								try {
									const startTime = parseLocalDateTime(start);
									if (!/^\d+$/.test(days.trim()) || Number(days) > 3650) throw new Error("Days must be a whole number from 0 to 3650.");
									// Schedule.durationInDays: a LIFETIME budget needs an end date.
									if (c.budget?.type === "LIFETIME" && Number(days) === 0) throw new Error("A total budget needs an end date: set days to 1 or more.");
									await run({ schedule: { startTime, durationInDays: Number(days) } }, "Change the schedule?", `Starts ${start}, ${Number(days) ? `runs ${days} days` : "no end date"}.`);
								} catch (e) {
									setError((e as Error).message);
								}
							}}
							style={{ alignSelf: "flex-start" }}
						/>
					</>
				) : (
					<Txt variant="small">The schedule can only change before the campaign starts.</Txt>
				)}
				<Txt variant="label">Video</Txt>
				{options.isLoading ? (
					<Txt variant="small">Checking what can change…</Txt>
				) : canSwitchVideo ? (
					<>
						<Chips
							options={Array.from(new Set([currentVideo, ...videoSources])).map((v) => ({ value: v, label: label(v) }))}
							value={currentVideo}
							onChange={(source) => source !== currentVideo && videoSources.includes(source) && run({ video: { source } }, "Change the video?", `Every ad of this campaign switches to ${label(source).toLowerCase()}.`)}
						/>
						{!previewAvailable ? <Txt variant="small">This experience has no preview video, so only images can be used.</Txt> : null}
					</>
				) : (
					<Txt variant="small">
						{label(currentVideo)}.{" "}
						{options.error ? "Couldn't check whether the video can change." : !videoMutable ? "This account can't change the video of a campaign." : "No other video source is available."}
					</Txt>
				)}
				{c.paymentType === "ADS_CREDIT" ? (
					<SwitchRow
						label="Reload ad credit automatically"
						hint="Buys more ad credit when it runs low."
						value={!!c.autoReloadAdCreditEnabled}
						disabled={pending}
						onChange={(on) => (on ? run({ autoReloadAdCreditEnabled: true }, "Turn on automatic reload?", "Roblox will charge your payment method for more ad credit when it runs low.") : save({ autoReloadAdCreditEnabled: false }))}
					/>
				) : null}
			</Card>

			<Card style={{ gap: 8 }}>
				<Txt variant="h3">Add creatives</Txt>
				{creatives.error ? (
					<CloudError error={creatives.error} what="Ad creatives" onRetry={() => creatives.refetch()} />
				) : roomForCreatives === 0 ? (
					<Txt variant="small">The campaign already has the most creatives allowed{maxCreatives ? ` (${maxCreatives})` : ""}.</Txt>
				) : attachable.length ? (
					<>
						<Txt variant="small">Up to {roomForCreatives} more at a time (they're appended; existing ones stay).</Txt>
						<MultiChips options={attachable.map((x) => ({ value: x.assetId, label: x.assetName || x.assetId }))} value={addCreatives} onChange={setAddCreatives} />
						<Button
							title="Add to campaign"
							small
							disabled={!addCreatives.length}
							loading={pending}
							onPress={async () => {
								// UpdateCampaignRequest.creativeAssetIds: maxItems 5 per request.
								if (addCreatives.length > roomForCreatives) return setError(`Pick at most ${roomForCreatives} creatives.`);
								setError(null);
								if (await save({ creativeAssetIds: addCreatives })) setAddCreatives([]);
							}}
							style={{ alignSelf: "flex-start" }}
						/>
					</>
				) : (
					<Txt variant="small">{creatives.isPending ? "Loading creatives…" : `Every saved creative for this experience in the ${groupId ? "group's" : "personal"} ads account is already in the campaign.`}</Txt>
				)}
			</Card>
			{error ? <Txt color={p.destructive}>{error}</Txt> : null}
		</>
	);
}
