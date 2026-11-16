/**
 * A new ad campaign for this experience (POST /ads-management/v1/campaigns, BETA). It starts from campaign-options
 * for the universe: eligibility (with Roblox's reasons), objectives, billing accounts and their payment types, budget
 * minimums / maximums, creative count, targeting values and video sources; the form checks against those before
 * sending. The x-idempotency-key is kept for an unchanged body (a retry can't create two campaigns) and renewed when
 * the body changes. Spends money once approved, so it asks first with the amount.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, Chips, confirm, Field, notify, Skeleton, Txt } from "@/components/ui";
import { useTheme } from "@/theme";

import {
	campaignOptions,
	createCampaign,
	fmtUsd,
	listCreatives,
	microsToUsd,
	newIdempotencyKey,
	usdToMicros,
	type AgeGroup,
	type AudienceType,
	type BudgetType,
	type CreateCampaignRequest,
	type CreateObjective,
	type Device,
	type PaymentType,
	type Targeting,
	type VideoSource,
} from "../api/servers";
import { CloudError, cloudErrorText } from "../CloudError";
import { label } from "./ads-shared";
import { localDateTime, parseLocalDateTime } from "./CampaignDetail";
import { MultiChips, SwitchRow } from "./shared";

export function CampaignCreate({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const options = useQuery({ queryKey: ["oc", "ads", "options", universeId], queryFn: () => campaignOptions(cloud, universeId), retry: false });

	const [name, setName] = useState("");
	const [objective, setObjective] = useState<CreateObjective | "">("");
	const [accountId, setAccountId] = useState("");
	const [payment, setPayment] = useState<PaymentType | "">("");
	const [budgetType, setBudgetType] = useState<BudgetType>("DAILY");
	const [amount, setAmount] = useState("");
	const [start, setStart] = useState(() => localDateTime(Date.now() + 3600_000));
	const [days, setDays] = useState("7");
	const [picked, setPicked] = useState<string[]>([]);
	const [extraAssets, setExtraAssets] = useState("");
	const [devices, setDevices] = useState<Device[]>([]);
	const [ages, setAges] = useState<AgeGroup[]>([]);
	const [regions, setRegions] = useState<string[]>([]);
	const [countries, setCountries] = useState("");
	const [audience, setAudience] = useState<AudienceType>("ALL_PLAYERS");
	const [video, setVideo] = useState<VideoSource>("IMAGE_ONLY");
	const [autoReload, setAutoReload] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const idem = useRef<{ body: string; key: string } | null>(null);

	// Saved creatives live in the ads account that pays: a group billing account lists the group's (groupId), else the personal one.
	const o0 = options.data;
	const accounts0 = (o0?.billingAccounts ?? []).filter((a) => a.status === "ACTIVE");
	const creativesGroup = (accounts0.find((a) => a.id === accountId) ?? accounts0[0])?.creator?.groupId;
	const creativesGroupId = creativesGroup && /^\d+$/.test(creativesGroup) ? Number(creativesGroup) : undefined;
	const creatives = useQuery({
		queryKey: ["oc", "ads", "creatives", universeId, "create", creativesGroupId ?? "me"],
		enabled: !!o0,
		queryFn: () => listCreatives(cloud, { universeId, groupId: creativesGroupId, isArchived: false }),
		retry: false,
	});

	const create = useMutation({
		mutationFn: (args: { body: CreateCampaignRequest; key: string }) => createCampaign(cloud, args.body, args.key),
		onSuccess: (c) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "ads"] });
			notify("Campaign created", `“${c.name}” is ${label(c.deliveryStatus).toLowerCase() || "created"}. Roblox reviews it before it serves.`);
			router.replace(`/project/${universeId}/ads?campaign=${encodeURIComponent(c.id)}`);
		},
		onError: (e) => notify("Couldn't create the campaign", cloudErrorText(e)),
	});

	if (options.error) return <CloudError error={options.error} what="Ads" onRetry={() => options.refetch()} />;
	if (!options.data) return <Skeleton height={300} />;
	const o = options.data;
	const eligible = o.eligibility?.eligible !== false;
	const objectiveOptions = (o.objectiveOptions ?? []).filter((x) => x.available);
	const objectiveValue = objective || objectiveOptions[0]?.objective || o.objectives?.[0] || "PLAYS";
	const objOption = (o.objectiveOptions ?? []).find((x) => x.objective === objectiveValue);
	const accounts = (o.billingAccounts ?? []).filter((a) => a.status === "ACTIVE");
	const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
	const payments = account?.paymentTypes?.length ? account.paymentTypes : (o.paymentTypes ?? []);
	const paymentValue = payment && payments.includes(payment) ? payment : payments[0];
	const constraint = (o.budgetConstraints ?? []).find((b) => b.budgetType === budgetType);
	const maxDays = constraint?.maximumDurationInDays ?? 3650;
	const minCreatives = o.creativeRequirements?.minimumCount ?? 1;
	const maxCreatives = o.creativeRequirements?.maximumCount ?? 10;
	const dims = o.targetingDimensions ?? {};
	const supportsTargeting = objOption?.supportsTargeting !== false;
	const usable = (creatives.data?.creatives ?? []).filter((x) => x.moderationStatus !== "REJECTED");
	// What the chips show is what gets sent: a stale video / audience choice falls back to the first allowed value.
	const videoSources = o.video?.sources ?? [];
	const videoValue: VideoSource | undefined = videoSources.includes(video) ? video : videoSources[0];
	const audienceTypes = objOption?.audienceTypes ?? [];
	const audienceValue: AudienceType = audienceTypes.includes(audience) ? audience : "ALL_PLAYERS";

	async function submit() {
		setError(null);
		try {
			if (!eligible) throw new Error("This experience can't be advertised right now (see above).");
			if (!name.trim()) throw new Error("Give the campaign a name.");
			if (!paymentValue) throw new Error("No payment type is available for this billing account.");
			if (!/^\d+$/.test(days.trim()) || Number(days) > maxDays) throw new Error(`Days must be a whole number from 0 to ${maxDays}.`);
			const durationInDays = Number(days);
			// A LIFETIME budget needs an end date (Schedule.durationInDays > 0).
			if (budgetType === "LIFETIME" && durationInDays === 0) throw new Error("A total budget needs an end date: set days to 1 or more.");
			const amountMicros = usdToMicros(amount);
			const dayFactor = budgetType === "LIFETIME" ? durationInDays : 1;
			const min = Number(constraint?.minimumAmountMicros ?? 0) * dayFactor;
			if (min && Number(amountMicros) < min) throw new Error(`The ${budgetType === "DAILY" ? "daily" : "total"} budget must be at least ${fmtUsd(min / 1e6)}.`);
			// maximumDailyBudgetMicros limits CREDIT_CARD only; non-positive means no card budget at all; LIFETIME caps at daily max × days.
			const maxDailyText = paymentValue === "CREDIT_CARD" ? (account?.maximumDailyBudgetMicros ?? constraint?.maximumAmountMicros) : undefined;
			if (maxDailyText !== undefined && maxDailyText !== "") {
				const maxDaily = Number(maxDailyText);
				if (!(maxDaily > 0)) throw new Error("This billing account can't fund card campaigns. Pick another payment type or account.");
				const cap = maxDaily * dayFactor;
				if (Number(amountMicros) > cap)
					throw new Error(budgetType === "DAILY" ? `This account allows at most ${fmtUsd(maxDaily / 1e6)} a day by card.` : `By card this account allows at most ${fmtUsd(cap / 1e6)} in total (${fmtUsd(maxDaily / 1e6)} × ${durationInDays} days).`);
			}
			const startTime = parseLocalDateTime(start);
			const extra = extraAssets.split(/[\s,]+/).filter(Boolean);
			for (const a of extra) if (!/^\d{1,20}$/.test(a)) throw new Error(`“${a}” is not an image asset ID.`);
			const creativeAssetIds = Array.from(new Set([...picked, ...extra]));
			if (creativeAssetIds.length < minCreatives || creativeAssetIds.length > maxCreatives) throw new Error(`Pick ${minCreatives === maxCreatives ? minCreatives : `${minCreatives}-${maxCreatives}`} creatives.`);
			const countryList = countries.split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase());
			for (const c of countryList) if (!/^[A-Z]{2}$/.test(c) || (dims.countries?.length && !dims.countries.includes(c))) throw new Error(`“${c}” isn't a country Roblox can target.`);
			// Targeting.regions: ALL can't be combined with other regions or with countries. A country inside a picked
			// region is also rejected; Roblox names that case in its error.
			if (regions.includes("ALL") && (regions.length > 1 || countryList.length)) throw new Error("“All” regions can't be combined with other regions or with countries.");

			const targeting: Targeting = {};
			if (supportsTargeting) {
				if (devices.length) targeting.devices = devices;
				if (ages.length) targeting.ageGroups = ages;
				if (regions.length) targeting.regions = regions;
				if (countryList.length) targeting.countries = countryList;
				if (audienceValue !== "ALL_PLAYERS") targeting.audienceType = audienceValue;
			}
			const body: CreateCampaignRequest = {
				name: name.trim(),
				objective: objectiveValue,
				paymentType: paymentValue,
				budget: { amountMicros, type: budgetType },
				schedule: { startTime, durationInDays },
				targetUniverseId: String(universeId),
				creativeAssetIds,
				...(account ? { billingAccountId: account.id } : {}),
				...(Object.keys(targeting).length ? { targeting } : {}),
				...(videoValue ? { video: { source: videoValue } } : {}),
				...(paymentValue === "ADS_CREDIT" ? { autoReloadAdCreditEnabled: autoReload } : {}),
			};
			const json = JSON.stringify(body);
			if (!idem.current || idem.current.body !== json) idem.current = { body: json, key: newIdempotencyKey() };
			const key = idem.current.key;
			const spend = `${fmtUsd(Number(amountMicros) / 1e6)} ${budgetType === "DAILY" ? `a day${durationInDays ? ` for ${durationInDays} days` : " with no end date"}` : "in total"}`;
			if (await confirm("Create this campaign?", `“${body.name}” (${label(objectiveValue)}), paid by ${label(paymentValue).toLowerCase()}, up to ${spend}, from ${start}. Roblox reviews it before it serves.`, "Create", false))
				create.mutate({ body, key });
		} catch (e) {
			setError((e as Error).message);
		}
	}

	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Txt variant="h3" style={{ flex: 1 }}>
						Eligibility
					</Txt>
					<Badge label={eligible ? "can advertise" : "not eligible"} tone={eligible ? "good" : "critical"} />
				</View>
				{(o.eligibility?.details ?? []).map((r) => (
					<Txt key={r.code} variant="small">
						{r.message}
						{r.remediation ? ` ${r.remediation}` : ""}
					</Txt>
				))}
				{!o.eligibility?.details?.length && o.eligibility?.reasons?.length ? <Txt variant="small">{o.eligibility.reasons.map(label).join(", ")}</Txt> : null}
			</Card>

			<Card style={{ gap: 8 }}>
				<Field label="Name" value={name} onChangeText={setName} placeholder="Winter update" maxLength={200} />
				<Txt variant="label">Objective</Txt>
				<Chips options={(objectiveOptions.length ? objectiveOptions.map((x) => x.objective) : (o.objectives ?? [])).map((x) => ({ value: x, label: label(x) }))} value={objectiveValue} onChange={setObjective} />
				{(o.objectiveOptions ?? [])
					.filter((x) => !x.available)
					.map((x) => (
						<Txt key={x.objective} variant="small">
							{label(x.objective)}: {(x.unavailableReasons ?? []).map((r) => r.message).join(" ") || "not available"}
						</Txt>
					))}
				{accounts.length > 1 ? (
					<>
						<Txt variant="label">Billing account</Txt>
						<Chips options={accounts.map((a) => ({ value: a.id, label: a.displayName }))} value={account?.id ?? ""}
							onChange={(v) => {
								// Another account has other saved creatives: drop picks that would no longer be visible.
								setAccountId(v);
								setPicked([]);
							}}
						/>
					</>
				) : account ? (
					<Txt variant="small">Billing account: {account.displayName}</Txt>
				) : null}
				<Txt variant="label">Payment</Txt>
				<Chips options={payments.map((x) => ({ value: x, label: label(x) }))} value={paymentValue ?? ("" as PaymentType)} onChange={setPayment} />
				{paymentValue === "ADS_CREDIT" ? <SwitchRow label="Reload ad credit automatically" hint="Charges your payment method when ad credit runs low." value={autoReload} onChange={setAutoReload} /> : null}
				<Txt variant="label">Budget</Txt>
				<Chips options={[{ value: "DAILY" as BudgetType, label: "Per day" }, { value: "LIFETIME" as BudgetType, label: "Total" }]} value={budgetType} onChange={setBudgetType} />
				<Field
					value={amount}
					onChangeText={setAmount}
					placeholder="USD, e.g. 25"
					keyboardType="decimal-pad"
					maxLength={12}
					hint={constraint ? `At least ${fmtUsd(microsToUsd(constraint.minimumAmountMicros))}${budgetType === "LIFETIME" ? " per day of the schedule" : ""}` : undefined}
				/>
				<Field label="Start (local time)" value={start} onChangeText={setStart} placeholder="2026-11-20 14:00" />
				<Field label={`Days to run (${budgetType === "LIFETIME" ? "at least 1" : "0 = no end"}, max ${maxDays})`} value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={4} />
			</Card>

			<Card style={{ gap: 8 }}>
				<Txt variant="h3">Creatives</Txt>
				<Txt variant="small">
					{minCreatives === maxCreatives ? minCreatives : `${minCreatives}-${maxCreatives}`} image assets
					{o.adFormats?.length ? ` sized ${o.adFormats.map((f) => `${f.width}×${f.height}`).join(" or ")}` : ""}.
				</Txt>
				{creatives.error ? (
					<CloudError error={creatives.error} what="Ad creatives" onRetry={() => creatives.refetch()} />
				) : usable.length ? (
					<MultiChips options={usable.map((x) => ({ value: x.assetId, label: `${x.assetName || x.assetId}${x.moderationStatus === "PENDING_REVIEW" ? " (in review)" : ""}` }))} value={picked} onChange={setPicked} />
				) : (
					<Txt variant="small">{creatives.isLoading ? "Loading creatives…" : `No saved creatives for this experience in the ${creativesGroupId ? "group's" : "personal"} ads account yet.`}</Txt>
				)}
				<Field value={extraAssets} onChangeText={setExtraAssets} placeholder="Other image asset IDs: 123, 456" keyboardType="numbers-and-punctuation" />
				{o.video?.sources?.length ? (
					<>
						<Txt variant="label">Video</Txt>
						<Chips options={o.video.sources.map((v) => ({ value: v, label: label(v) }))} value={videoValue!} onChange={setVideo} />
						{o.video.previewVideo && !o.video.previewVideo.available ? <Txt variant="small">This experience has no preview video to show.</Txt> : null}
					</>
				) : null}
			</Card>

			{supportsTargeting ? (
				<Card style={{ gap: 8 }}>
					<Txt variant="h3">Audience</Txt>
					<Txt variant="small">Leave a row empty to reach everyone.</Txt>
					{objOption?.audienceTypes?.length ? <Chips options={objOption.audienceTypes.map((a) => ({ value: a, label: label(a) }))} value={audienceValue} onChange={setAudience} /> : null}
					{dims.devices?.length ? <MultiChips options={dims.devices.map((d) => ({ value: d, label: label(d) }))} value={devices} onChange={setDevices} /> : null}
					{dims.ageGroups?.length ? <MultiChips options={dims.ageGroups.map((a) => ({ value: a, label: label(a) }))} value={ages} onChange={setAges} /> : null}
					{dims.regions?.length ? <MultiChips options={dims.regions.map((r) => ({ value: r, label: label(r) }))} value={regions} onChange={setRegions} /> : null}
					<Field value={countries} onChangeText={setCountries} placeholder="Or countries: US, GB, DE" autoCapitalize="characters" />
				</Card>
			) : (
				<Txt variant="small">{label(objectiveValue)} campaigns reach everyone (no targeting).</Txt>
			)}

			{error ? <Txt color={p.destructive}>{error}</Txt> : null}
			<Button title="Create campaign…" variant="brand" icon="add" loading={create.isPending} disabled={!eligible} onPress={submit} />
		</>
	);
}
