/**
 * Extended services (service-efficiency-api, EXPERIMENTAL): whether the key's owner can use them for this experience,
 * the account's eligibility checks, this experience's paid capacity configuration (monthly budgets per service or per
 * resource, unlocked resources; editable), billing activity (balances and bills by month), one bill's breakdown per
 * experience / service / resource and its payments, and the account's tax details (editable). Group-owned
 * experiences use the group's account, others the owner's. Payment methods and payments are not built here.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { gameDetails } from "@/api/roblox-public";
import { Badge, Button, Card, Chips, confirm, EmptyState, Field, KV, List, notify, Row, Section, Segmented, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import {
	billingActivities,
	ELIGIBILITY_LABELS,
	extendedAccount,
	extendedAllowed,
	extendedConfiguration,
	extendedEligibility,
	fmtMoney,
	getBill,
	parseMoney,
	updateExtendedAccount,
	updateExtendedConfiguration,
	type AccountTaxType,
	type ExtendedAccount,
	type ExtendedOwner,
	type ServiceConfiguration,
	type TaxIdType,
} from "@/features/project/api/servers";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { label } from "@/features/project/servers/ads-shared";
import { SwitchRow } from "@/features/project/servers/shared";
import { ToolScreen } from "@/features/project/tool";
import { fmtDate } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme, type Tone } from "@/theme";

export default function ExtendedScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Extended services" scopes={["extended-services:read"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "extended"], type: "active" })}>
			{({ universeId, cloud, can }) => <Extended universeId={universeId} cloud={cloud} canWrite={can("extended-services:write")} />}
		</ToolScreen>
	);
}

const STATE_TONE: Record<string, Tone> = { Normal: "good", Overdue: "warning", Suspended: "critical", Invalid: "muted" };

function Extended({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const { keyInfo } = useAccounts();
	const [tab, setTab] = useState<"budget" | "billing" | "account">("budget");
	const game = useQuery({ queryKey: ["oc", "extended", universeId, "owner"], queryFn: async () => (await gameDetails([universeId]))[0] ?? null, staleTime: 3600_000, retry: false });
	const creator = game.data?.creator;
	// The key owner's own account is only a fallback once the public details answered without a creator: while they
	// load (or after they failed) a group-owned experience would otherwise show, and let you edit, the wrong account.
	const owner: ExtendedOwner | null = !game.isSuccess
		? null
		: creator?.type === "Group"
			? { kind: "groups", id: creator.id }
			: creator?.id
				? { kind: "users", id: creator.id }
				: keyInfo?.authorizedUserId
					? { kind: "users", id: keyInfo.authorizedUserId }
					: null;
	const allowed = useQuery({ queryKey: ["oc", "extended", universeId, "allowed"], queryFn: () => extendedAllowed(cloud, universeId), retry: false });

	return (
		<>
			<Card style={{ gap: 4 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Txt variant="h3" style={{ flex: 1 }}>
						Access
					</Txt>
					{allowed.data !== undefined ? <Badge label={allowed.data ? "allowed" : "not allowed"} tone={allowed.data ? "good" : "warning"} /> : null}
				</View>
				<Txt variant="small">
					{owner
						? `Billed to the ${owner.kind === "groups" ? `group ${creator?.name ?? owner.id}` : `account of ${creator?.name ?? `user ${owner.id}`}`}.`
						: game.isSuccess
							? "Couldn't tell who owns this experience."
							: game.error
								? "Couldn't load the experience's owner."
								: "Finding the experience's owner…"}{" "}
					Extended services is an EXPERIMENTAL Roblox API.
				</Txt>
				{game.error ? <CloudError error={game.error} what="Experience owner" onRetry={() => game.refetch()} /> : null}
				{allowed.error ? <CloudError error={allowed.error} what="Extended services" onRetry={() => allowed.refetch()} /> : null}
			</Card>
			<Segmented options={[{ value: "budget", label: "Budget" }, { value: "billing", label: "Billing" }, { value: "account", label: "Account" }]} value={tab} onChange={setTab} />
			{tab === "budget" ? <Budget universeId={universeId} cloud={cloud} canWrite={canWrite} /> : !owner ? (
				game.isSuccess ? <EmptyState icon="person-outline" title="No owner found" body="Roblox's public details didn't name this experience's creator, and the key has no owner user ID." /> : game.error ? null : <SkeletonList rows={3} />
			) : tab === "billing" ? <Billing owner={owner} cloud={cloud} /> : <Account owner={owner} cloud={cloud} canWrite={canWrite} />}
		</>
	);
}

// Budget configuration -------------------------------------------------------------------------------------------------

function budgetKey(serviceId: string, resourceId?: string) {
	return resourceId ? `${serviceId}/${resourceId}` : serviceId;
}

function priceText(price: { cost?: { units?: number; nanos?: number; currencyCode?: string | null }; unitAmount?: number } | undefined): string {
	if (!price?.cost) return "";
	return `${fmtMoney(price.cost)} per ${price.unitAmount ? price.unitAmount.toLocaleString() : "unit"}`;
}

function Budget({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const config = useQuery({ queryKey: ["oc", "extended", universeId, "config"], queryFn: () => extendedConfiguration(cloud, universeId), retry: false });
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [unlocks, setUnlocks] = useState<Record<string, boolean>>({});
	const [error, setError] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (services: ServiceConfiguration[]) => updateExtendedConfiguration(cloud, universeId, services),
		onSuccess: (r) => {
			setEdits({});
			setUnlocks({});
			queryClient.setQueryData(["oc", "extended", universeId, "config"], r);
			queryClient.invalidateQueries({ queryKey: ["oc", "extended", universeId] });
			notify("Saved", "The budgets are updated.");
		},
		onError: (e) => notify("Couldn't save the budgets", cloudErrorText(e)),
	});

	if (config.error) return <CloudError error={config.error} what="Extended services" onRetry={() => config.refetch()} />;
	if (!config.data) return <SkeletonList rows={3} />;
	const c = config.data;
	const dirty = Object.keys(edits).length > 0 || Object.keys(unlocks).length > 0;

	async function submit() {
		setError(null);
		try {
			const changes: string[] = [];
			const services = c.serviceConfigurations.map((s): ServiceConfiguration => {
				const currency = s.monthlyBudget?.currencyCode || s.resourceConfigurations[0]?.unitCost?.currencyCode || "USD";
				const sKey = budgetKey(s.serviceId);
				const monthlyBudget = edits[sKey] !== undefined ? parseMoney(edits[sKey]!, currency, `${s.serviceId} budget`) : s.monthlyBudget;
				if (edits[sKey] !== undefined) changes.push(`${s.serviceId}: ${fmtMoney(s.monthlyBudget)} → ${fmtMoney(monthlyBudget)} a month`);
				return {
					...s,
					...(monthlyBudget ? { monthlyBudget } : {}),
					resourceConfigurations: s.resourceConfigurations.map((r) => {
						const rKey = budgetKey(s.serviceId, r.resourceId);
						const budget = edits[rKey] !== undefined ? parseMoney(edits[rKey]!, r.unitCost?.currencyCode || currency, `${r.resourceId} budget`) : r.monthlyBudget;
						if (edits[rKey] !== undefined) changes.push(`${r.resourceId}: ${fmtMoney(r.monthlyBudget)} → ${fmtMoney(budget)} a month`);
						const unlocked = unlocks[rKey] ?? r.unlocked;
						if (unlocks[rKey] !== undefined && unlocks[rKey] !== r.unlocked) changes.push(`${r.resourceId}: ${unlocked ? "unlock paid usage" : "lock paid usage"}`);
						return { ...r, unlocked, ...(budget ? { monthlyBudget: budget } : {}) };
					}),
				};
			});
			if (!changes.length) return;
			if (await confirm("Save budgets?", `${changes.join("\n")}\n\nRoblox bills paid usage up to these budgets.`, "Save", false)) save.mutate(services);
		} catch (e) {
			setError((e as Error).message);
		}
	}

	return (
		<>
			<StatGrid>
				<Stat label="Account" value={c.accountState ?? "–"} tone={STATE_TONE[c.accountState ?? ""]} />
				<Stat label="Account info" value={c.accountInfoComplete ? "complete" : "incomplete"} tone={c.accountInfoComplete ? "good" : "warning"} />
			</StatGrid>
			{c.serviceConfigurations.length ? (
				c.serviceConfigurations.map((s) => {
					const sKey = budgetKey(s.serviceId);
					return (
						<Card key={s.serviceId} style={{ gap: 8 }}>
							<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
								<Txt variant="h3" style={{ flex: 1 }}>
									{label(s.serviceId.replace(/([a-z])([A-Z])/g, "$1_$2"))}
								</Txt>
								<Badge label={s.budgetLevel === "ServiceOnly" ? "service budget" : "per resource"} />
							</View>
							{s.budgetLevel === "ServiceOnly" ? (
								canWrite ? (
									<Field label="Monthly budget" value={edits[sKey] ?? String((s.monthlyBudget?.units ?? 0) + (s.monthlyBudget?.nanos ?? 0) / 1e9)} onChangeText={(v) => setEdits({ ...edits, [sKey]: v })} keyboardType="decimal-pad" maxLength={16} />
								) : (
									<KV label="Monthly budget" value={fmtMoney(s.monthlyBudget)} />
								)
							) : null}
							{s.resourceConfigurations.map((r) => {
								const rKey = budgetKey(s.serviceId, r.resourceId);
								return (
									<View key={r.resourceId} style={{ gap: 4 }}>
										<Txt style={{ fontWeight: "500" }}>{r.resourceId}</Txt>
										<Txt variant="small">{priceText(r.price) || `${fmtMoney(r.unitCost)} per unit`}</Txt>
										{canWrite ? (
											<>
												<SwitchRow label="Paid usage unlocked" value={unlocks[rKey] ?? r.unlocked} onChange={(v) => setUnlocks({ ...unlocks, [rKey]: v })} />
												{s.budgetLevel === "ResourceOnly" ? (
													<Field label="Monthly budget" value={edits[rKey] ?? String((r.monthlyBudget?.units ?? 0) + (r.monthlyBudget?.nanos ?? 0) / 1e9)} onChangeText={(v) => setEdits({ ...edits, [rKey]: v })} keyboardType="decimal-pad" maxLength={16} />
												) : null}
											</>
										) : (
											<Txt variant="small">
												{r.unlocked ? "unlocked" : "locked"}
												{s.budgetLevel === "ResourceOnly" ? ` · budget ${fmtMoney(r.monthlyBudget)} a month` : ""}
											</Txt>
										)}
									</View>
								);
							})}
						</Card>
					);
				})
			) : (
				<EmptyState icon="card-outline" title="No paid services" body="This experience has no extended services configured." />
			)}
			{error ? <Txt color={p.destructive}>{error}</Txt> : null}
			{canWrite && c.serviceConfigurations.length ? (
				<View style={{ flexDirection: "row", gap: 8 }}>
					<Button title="Save budgets…" variant="brand" disabled={!dirty} loading={save.isPending} onPress={submit} />
					<Button title="Discard changes" disabled={!dirty} onPress={() => { setEdits({}); setUnlocks({}); setError(null); }} />
				</View>
			) : !canWrite ? (
				<Txt variant="small">Read only: add extended-services:write to change budgets.</Txt>
			) : null}
		</>
	);
}

// Billing --------------------------------------------------------------------------------------------------------------

function monthRange(months: number) {
	const now = new Date();
	const end = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
	const s = new Date(Date.UTC(end.year, end.month - 1 - (months - 1), 1));
	return { startYear: s.getUTCFullYear(), startMonth: s.getUTCMonth() + 1, endYear: end.year, endMonth: end.month };
}

const BILL_TONE: Record<string, Tone> = { Paid: "good", Unpaid: "warning", Closed: "muted", Invalid: "muted" };

function Billing({ owner, cloud }: { owner: ExtendedOwner; cloud: OpenCloud }) {
	const [months, setMonths] = useState(6);
	const [bill, setBill] = useState<{ billId?: string; latest?: boolean } | null>(null);
	const range = monthRange(months);
	const activity = useQuery({ queryKey: ["oc", "extended", "billing", owner.kind, owner.id, months], queryFn: () => billingActivities(cloud, owner, range), retry: false });
	const a = activity.data;
	return (
		<>
			<Chips options={[3, 6, 12, 24].map((m) => ({ value: m, label: `${m} months` }))} value={months} onChange={setMonths} />
			{activity.error ? (
				<CloudError error={activity.error} what="Extended services billing" onRetry={() => activity.refetch()} />
			) : !a ? (
				<SkeletonList rows={3} />
			) : (
				<>
					<StatGrid>
						<Stat label="Balance" value={fmtMoney(a.currentBalance)} />
						<Stat label="This month" value={fmtMoney(a.monthToDateBalance)} />
						<Stat label="Charged at" value={fmtMoney(a.chargingThreshold)} sub="charging threshold" />
						<Stat label="Account" value={a.accountState ?? "–"} tone={STATE_TONE[a.accountState ?? ""]} />
					</StatGrid>
					<Section title="Bills" right={<Button title="Latest bill" small onPress={() => setBill({ latest: true })} />}>
						{a.billSummaries?.length ? (
							<List>
								{a.billSummaries
									.slice()
									.sort((x, y) => y.timestamp - x.timestamp)
									.map((b, i) => (
										<Row
											key={b.billId ?? i}
											title={fmtDate(b.timestamp)}
											subtitle={b.billId ?? undefined}
											right={
												<View style={{ alignItems: "flex-end", gap: 3 }}>
													<Txt style={{ fontWeight: "600" }}>{fmtMoney(b.totalAmount)}</Txt>
													<Badge label={b.billStatus.toLowerCase()} tone={BILL_TONE[b.billStatus] ?? "muted"} />
												</View>
											}
											onPress={b.billId ? () => setBill({ billId: b.billId! }) : undefined}
											chevron={!!b.billId}
										/>
									))}
							</List>
						) : (
							<Txt variant="muted">No bills in this period.</Txt>
						)}
					</Section>
				</>
			)}
			{bill ? <BillView owner={owner} cloud={cloud} which={bill} onClose={() => setBill(null)} /> : null}
		</>
	);
}

function BillView({ owner, cloud, which, onClose }: { owner: ExtendedOwner; cloud: OpenCloud; which: { billId?: string; latest?: boolean }; onClose: () => void }) {
	const bill = useQuery({ queryKey: ["oc", "extended", "bill", owner.kind, owner.id, which.billId ?? "latest"], queryFn: () => getBill(cloud, owner, which), retry: false });
	const b = bill.data;
	return (
		<Section title={which.billId ? "Bill" : "Latest bill"} right={<Button title="Close" small onPress={onClose} />}>
			{bill.error ? (
				<CloudError error={bill.error} what="Extended services bill" onRetry={() => bill.refetch()} />
			) : !b ? (
				<SkeletonList rows={3} />
			) : (
				<>
					<Card style={{ gap: 2 }}>
						<KV label="Bill" value={b.billId ?? "–"} mono />
						<KV label="Status" value={<Badge label={b.billStatus.toLowerCase()} tone={BILL_TONE[b.billStatus] ?? "muted"} />} />
						<KV label="Usage" value={fmtMoney(b.usageAmount)} />
						<KV label="Tax" value={fmtMoney(b.taxAmount)} />
						<KV label="Total" value={fmtMoney(b.totalAmount)} />
						{b.conversionRate ? <KV label="USD rate" value={String(b.conversionRate)} /> : null}
					</Card>
					{b.usages.map((u) => (
						<Card key={u.consumerId} style={{ gap: 4 }}>
							<View style={{ flexDirection: "row", gap: 8 }}>
								<Txt variant="h3" style={{ flex: 1 }}>
									{u.consumerName || `Experience ${u.consumerId}`}
								</Txt>
								<Txt style={{ fontWeight: "600" }}>{fmtMoney(u.subtotalAmount)}</Txt>
							</View>
							{u.serviceUsages.map((s) => (
								<View key={s.serviceId} style={{ gap: 2 }}>
									<KV label={s.serviceId} value={fmtMoney(s.subtotalAmount)} />
									{s.resourceUsages.map((r) => (
										<Txt key={r.resourceId} variant="small">
											{r.resourceId}: {r.paidAmount?.toLocaleString() ?? 0} paid + {r.freeAmount?.toLocaleString() ?? 0} free · {priceText(r.price) || fmtMoney(r.unitCost)} · {fmtMoney(r.totalCost)}
										</Txt>
									))}
								</View>
							))}
						</Card>
					))}
					{b.payments.length ? (
						<List>
							{b.payments.map((pay, i) => (
								<Row key={i} title={fmtMoney(pay.amount)} subtitle={fmtDate(pay.timestamp)} right={<Badge label={pay.status.toLowerCase()} tone={pay.status === "Successful" ? "good" : pay.status === "Failed" ? "critical" : "muted"} />} />
							))}
						</List>
					) : null}
				</>
			)}
		</Section>
	);
}

// Account and eligibility ---------------------------------------------------------------------------------------------

const TAX_TYPES: AccountTaxType[] = ["Individual", "Business"];
const TAX_ID_TYPES: TaxIdType[] = ["Invalid", "UnitedStatesEin", "EuropeanVatNumber", "UnitedKingdomVatNumber", "CanadianBusinessNumber", "CanadianGstHstNumber", "MexicanRfcNumber"];
const TAX_ID_LABEL: Record<TaxIdType, string> = {
	Invalid: "None",
	UnitedStatesEin: "US EIN",
	EuropeanVatNumber: "EU VAT",
	UnitedKingdomVatNumber: "UK VAT",
	CanadianBusinessNumber: "CA BN",
	CanadianGstHstNumber: "CA GST/HST",
	MexicanRfcNumber: "MX RFC",
};

function masked(text: string | null | undefined): string {
	if (!text) return "–";
	return text.length <= 4 ? "••••" : `••••${text.slice(-4)}`;
}

function Account({ owner, cloud, canWrite }: { owner: ExtendedOwner; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const eligibility = useQuery({ queryKey: ["oc", "extended", "eligibility", owner.kind, owner.id], queryFn: () => extendedEligibility(cloud, owner), retry: false });
	const account = useQuery({ queryKey: ["oc", "extended", "account", owner.kind, owner.id], queryFn: () => extendedAccount(cloud, owner), retry: false });
	const [editing, setEditing] = useState<ExtendedAccount | null>(null);
	const [error, setError] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (a: ExtendedAccount) => updateExtendedAccount(cloud, owner, a),
		onSuccess: (r) => {
			setEditing(null);
			queryClient.setQueryData(["oc", "extended", "account", owner.kind, owner.id], r);
			queryClient.invalidateQueries({ queryKey: ["oc", "extended"] });
		},
		onError: (e) => notify("Couldn't save the account", cloudErrorText(e)),
	});
	const a = account.data?.account;

	async function submit() {
		if (!editing) return;
		setError(null);
		const name = (editing.accountName ?? "").trim();
		const taxId = (editing.taxId ?? "").trim();
		if (name.length > 200) return setError("The account name is at most 200 characters.");
		if (taxId && (editing.taxIdType ?? "Invalid") === "Invalid") return setError("Pick the kind of tax ID.");
		if (taxId && !/^[A-Za-z0-9 .\-/]{2,40}$/.test(taxId)) return setError("The tax ID has 2-40 letters, digits, spaces, dots, dashes or slashes.");
		const next: ExtendedAccount = { accountTaxType: editing.accountTaxType, accountName: name || null, taxId: taxId || null, taxIdType: taxId ? editing.taxIdType : "Invalid" };
		if (await confirm("Save account details?", `${next.accountTaxType}${name ? `, “${name}”` : ""}${taxId ? `, ${TAX_ID_LABEL[next.taxIdType ?? "Invalid"]} ${masked(taxId)}` : ""}. Roblox uses these for tax on your bills.`, "Save", false)) save.mutate(next);
	}

	return (
		<>
			<Section title="Eligibility">
				{eligibility.error ? (
					<CloudError error={eligibility.error} what="Extended services eligibility" onRetry={() => eligibility.refetch()} />
				) : !eligibility.data ? (
					<SkeletonList rows={3} />
				) : eligibility.data.eligibilityRequirementResults?.length ? (
					<List>
						{eligibility.data.eligibilityRequirementResults.map((r, i) => (
							<Row key={r.eligibilityRequirement ?? i} title={ELIGIBILITY_LABELS[r.eligibilityRequirement ?? ""] ?? r.eligibilityRequirement ?? "?"} right={<Badge label={r.eligible ? "met" : "not met"} tone={r.eligible ? "good" : "critical"} />} />
						))}
					</List>
				) : (
					<Txt variant="muted">No eligibility checks returned.</Txt>
				)}
			</Section>
			<Section title="Account">
				{account.error ? (
					<CloudError error={account.error} what="Extended services account" onRetry={() => account.refetch()} />
				) : !a ? (
					<SkeletonList rows={2} />
				) : editing ? (
					<Card style={{ gap: 8 }}>
						<Txt variant="label">Tax treatment</Txt>
						<Chips options={TAX_TYPES.map((t) => ({ value: t, label: t }))} value={editing.accountTaxType} onChange={(t) => setEditing({ ...editing, accountTaxType: t })} />
						<Field label="Account name" value={editing.accountName ?? ""} onChangeText={(v) => setEditing({ ...editing, accountName: v })} maxLength={200} />
						<Txt variant="label">Tax ID kind</Txt>
						<Chips options={TAX_ID_TYPES.map((t) => ({ value: t, label: TAX_ID_LABEL[t] }))} value={editing.taxIdType ?? "Invalid"} onChange={(t) => setEditing({ ...editing, taxIdType: t })} />
						<Field label="Tax ID" value={editing.taxId ?? ""} onChangeText={(v) => setEditing({ ...editing, taxId: v })} maxLength={40} autoCapitalize="characters" />
						{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
						<View style={{ flexDirection: "row", gap: 8 }}>
							<Button title="Save…" variant="brand" small loading={save.isPending} onPress={submit} />
							<Button title="Cancel" small onPress={() => setEditing(null)} />
						</View>
					</Card>
				) : (
					<Card style={{ gap: 2 }}>
						<KV label="Tax treatment" value={a.accountTaxType} />
						<KV label="Name" value={a.accountName || "–"} />
						<KV label="Tax ID" value={a.taxId ? `${TAX_ID_LABEL[a.taxIdType ?? "Invalid"]} ${masked(a.taxId)}` : "–"} />
						{canWrite ? <Button title="Edit" small onPress={() => setEditing({ ...a, accountTaxType: a.accountTaxType === "Invalid" ? "Individual" : a.accountTaxType })} style={{ alignSelf: "flex-start", marginTop: 6 }} /> : null}
					</Card>
				)}
			</Section>
		</>
	);
}
