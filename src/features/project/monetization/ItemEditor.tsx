/**
 * Create / edit form for a game pass or a developer product: name, description, icon (picked with the system file
 * picker), price, for sale, price optimization (managed pricing) and regional pricing, plus the product-only store page
 * switch. An edit sends only the changed
 * fields (the PATCH changes only what it is sent); taking an item off sale asks first. Neither can be deleted through
 * the API: off sale is how an item is retired. Replacing an icon asks first.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { gamePassIcons, productIcons } from "@/api/roblox-public";
import { GameIcon } from "@/components/ProjectRow";
import { Badge, Button, Card, confirm, EmptyState, Field, KV, notify, SkeletonList, Txt } from "@/components/ui";
import {
	createDeveloperProduct,
	createGamePass,
	getDeveloperProduct,
	getGamePass,
	parsePrice,
	type IconFile,
	updateDeveloperProduct,
	updateGamePass,
	type ItemFields,
	type PriceInformation,
} from "@/features/project/api/monetization";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { fmtDate, fmtRobux } from "@/lib/format";
import { useTheme } from "@/theme";

import { ICON_REVIEW_NOTE, IconPicker, SwitchRow } from "./shared";

export type ItemKind = "pass" | "product";

/** The fields both kinds share, normalized from GamePassConfigV2 / the product creator view. */
interface Item {
	id: number;
	name: string;
	description: string;
	isForSale: boolean;
	priceInformation: PriceInformation | null;
	isManagedPricingEnabled: boolean;
	storePageEnabled?: boolean | null;
	isImmutable?: boolean;
	created: string;
	updated: string;
}

const LABEL: Record<ItemKind, { one: string; the: string }> = {
	pass: { one: "game pass", the: "the game pass" },
	product: { one: "developer product", the: "the developer product" },
};

const NAME_MAX = 50;
const DESCRIPTION_MAX = 1000;

async function loadItem(kind: ItemKind, cloud: OpenCloud, universeId: number, id: number): Promise<Item> {
	if (kind === "pass") {
		const g = await getGamePass(cloud, universeId, id);
		return { id: g.gamePassId, name: g.name, description: g.description ?? "", isForSale: g.isForSale, priceInformation: g.priceInformation, isManagedPricingEnabled: g.isManagedPricingEnabled, created: g.createdTimestamp, updated: g.updatedTimestamp };
	}
	const d = await getDeveloperProduct(cloud, universeId, id);
	return {
		id: d.productId,
		name: d.name,
		description: d.description ?? "",
		isForSale: d.isForSale,
		priceInformation: d.priceInformation,
		isManagedPricingEnabled: d.isManagedPricingEnabled,
		storePageEnabled: d.storePageEnabled,
		isImmutable: d.isImmutable,
		created: d.createdTimestamp,
		updated: d.updatedTimestamp,
	};
}

export function ItemEditor({ kind, universeId, cloud, id, canRead, canWrite }: { kind: ItemKind; universeId: number; cloud: OpenCloud; id: number | "new"; canRead: boolean; canWrite: boolean }) {
	const q = useQuery({
		queryKey: ["monetization", kind, universeId, id],
		enabled: id !== "new",
		queryFn: () => loadItem(kind, cloud, universeId, id as number),
	});
	const icon = useQuery({
		queryKey: ["monetization", kind, "icon", id],
		enabled: id !== "new",
		staleTime: 300_000,
		queryFn: async () => ((kind === "pass" ? await gamePassIcons([id as number]) : await productIcons([id as number]))[id as number] ?? null),
	});
	if (id === "new") {
		if (!canWrite) return <EmptyState icon="key-outline" title={`Creating a ${LABEL[kind].one} needs ${kind === "pass" ? "game-pass:write" : "developer-product:write"}`} body="Add the scope for this experience to your API key on Creator Hub." />;
		return <ItemForm kind={kind} universeId={universeId} cloud={cloud} item={null} canWrite />;
	}
	if (!canRead) return <EmptyState icon="key-outline" title={`Reading a ${LABEL[kind].one} needs ${kind === "pass" ? "game-pass:read" : "developer-product:read"}`} body="Add the scope for this experience to your API key on Creator Hub." />;
	if (q.error) return <CloudError error={q.error} what={`This ${LABEL[kind].one}`} onRetry={() => q.refetch()} />;
	if (!q.data) return <SkeletonList rows={3} />;
	return (
		<>
			<Card style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
				<GameIcon uri={icon.data} size={56} />
				<View style={{ flex: 1, gap: 2 }}>
					<Txt variant="h3">{q.data.name}</Txt>
					<Txt variant="small" selectable>
						ID {q.data.id} · created {fmtDate(q.data.created)} · updated {fmtDate(q.data.updated)}
					</Txt>
					<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
						{q.data.isForSale ? <Badge label={fmtRobux(q.data.priceInformation?.defaultPriceInRobux ?? null)} tone="good" /> : <Badge label="off sale" />}
						{q.data.priceInformation?.enabledFeatures?.includes("PriceOptimization") ? <Badge label="price optimization" tone="brand" /> : null}
						{q.data.priceInformation?.enabledFeatures?.includes("RegionalPricing") ? <Badge label="regional pricing" tone="brand" /> : null}
						{q.data.isImmutable ? <Badge label="immutable" tone="warning" /> : null}
					</View>
				</View>
			</Card>
			<ItemForm key={q.data.updated} kind={kind} universeId={universeId} cloud={cloud} item={q.data} canWrite={canWrite && !q.data.isImmutable} />
		</>
	);
}

function ItemForm({ kind, universeId, cloud, item, canWrite }: { kind: ItemKind; universeId: number; cloud: OpenCloud; item: Item | null; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const startPrice = item?.priceInformation?.defaultPriceInRobux;
	const [name, setName] = useState(item?.name ?? "");
	const [description, setDescription] = useState(item?.description ?? "");
	const [price, setPrice] = useState(startPrice ? String(startPrice) : "");
	const [forSale, setForSale] = useState(item?.isForSale ?? true);
	const [managed, setManaged] = useState(item?.isManagedPricingEnabled ?? false);
	const startRegional = item?.priceInformation?.enabledFeatures?.includes("RegionalPricing") ?? false;
	const [regional, setRegional] = useState(startRegional);
	const [storePage, setStorePage] = useState(item?.storePageEnabled ?? false);
	const [icon, setIcon] = useState<IconFile | null>(null);
	const [formError, setFormError] = useState<string | null>(null);

	const save = useMutation({
		mutationFn: async (fields: ItemFields & { storePageEnabled?: boolean }) => {
			if (!item) {
				const full = { ...fields, name: fields.name ?? name.trim() };
				if (kind === "pass") return (await createGamePass(cloud, universeId, full)).gamePassId;
				return (await createDeveloperProduct(cloud, universeId, full)).productId;
			}
			if (kind === "pass") await updateGamePass(cloud, universeId, item.id, fields);
			else await updateDeveloperProduct(cloud, universeId, item.id, fields);
			return item.id;
		},
		onSuccess: (newId) => {
			queryClient.invalidateQueries({ queryKey: ["monetization"] });
			if (!item) {
				notify(`${kind === "pass" ? "Game pass" : "Developer product"} created`, `ID ${newId}.${icon ? ` ${ICON_REVIEW_NOTE}` : ""}`);
				router.replace(`/project/${universeId}/${kind}?id=${newId}`);
			} else notify("Saved", icon ? ICON_REVIEW_NOTE : undefined);
		},
		onError: (e) => notify(item ? "Save failed" : "Create failed", cloudErrorText(e)),
	});

	async function onSave() {
		setFormError(null);
		const n = name.trim();
		if (!n) return setFormError("Give it a name.");
		if (n.length > NAME_MAX) return setFormError(`The name can be at most ${NAME_MAX} characters.`);
		if (description.length > DESCRIPTION_MAX) return setFormError(`The description can be at most ${DESCRIPTION_MAX} characters.`);
		let priceValue: number | undefined;
		if (price.trim() || forSale) {
			const r = parsePrice(price);
			if ("error" in r) return setFormError(forSale && !price.trim() ? "An item for sale needs a price." : r.error);
			priceValue = r.value;
		}
		const fields: ItemFields & { storePageEnabled?: boolean } = {};
		if (!item || n !== item.name) fields.name = n;
		if (!item ? description.trim() !== "" : description !== item.description) fields.description = description;
		if (!item || forSale !== item.isForSale) fields.isForSale = forSale;
		if (priceValue !== undefined && (!item || priceValue !== startPrice)) fields.price = priceValue;
		if (!item ? managed : managed !== item.isManagedPricingEnabled) fields.isManagedPricingEnabled = managed;
		// Regional pricing is deprecated: Roblox says not to send it together with managed pricing.
		const regionalChanged = !item ? regional : regional !== startRegional;
		if (regionalChanged && fields.isManagedPricingEnabled !== undefined) return setFormError("Roblox doesn't take a regional pricing change together with a price optimization change: save one, then the other.");
		if (regionalChanged) fields.isRegionalPricingEnabled = regional;
		if (kind === "product" && item && storePage !== (item.storePageEnabled ?? false)) fields.storePageEnabled = storePage;
		if (icon) fields.imageFile = icon;
		if (item && !Object.keys(fields).length) return setFormError("Nothing changed.");
		if (item && icon && !(await confirm("Replace the icon?", `${icon.name} replaces ${LABEL[kind].the}'s current icon.`, "Replace icon"))) return;
		if (item && item.isForSale && fields.isForSale === false) {
			if (!(await confirm(`Take ${item.name} off sale?`, `Players can no longer buy ${LABEL[kind].the}${kind === "pass" ? "; players who own it keep it" : ""}.`, "Take off sale"))) return;
		}
		if (item && fields.price !== undefined && item.isForSale) {
			if (!(await confirm("Change the price?", `${fmtRobux(startPrice ?? null)} → ${fmtRobux(fields.price)} for every new purchase.`, "Change price", false))) return;
		}
		save.mutate(fields);
	}

	if (!canWrite) {
		return (
			<Card style={{ gap: 4 }}>
				<KV label="Description" value={item?.description || "–"} />
				<KV label="Price optimization" value={item?.isManagedPricingEnabled ? "on" : "off"} />
				{kind === "product" ? <KV label="Store page" value={item?.storePageEnabled ? "on" : "off"} /> : null}
				<Txt variant="small">
					{item?.isImmutable ? "This product can't be edited (it was made as a commerce product)." : `Read only: add ${kind === "pass" ? "game-pass:write" : "developer-product:write"} to edit.`}
				</Txt>
			</Card>
		);
	}

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">{item ? "Edit" : `New ${LABEL[kind].one}`}</Txt>
			<Field label="Name" value={name} onChangeText={setName} maxLength={NAME_MAX} placeholder="Name" autoCapitalize="sentences" />
			<Field label="Description" value={description} onChangeText={setDescription} maxLength={DESCRIPTION_MAX} placeholder="Description (optional)" autoCapitalize="sentences" multiline style={{ minHeight: 70, fontFamily: undefined }} />
			<SwitchRow label="For sale" hint={forSale ? undefined : "Off sale: nobody can buy it. The API has no delete; this is how an item is retired."} value={forSale} onChange={setForSale} />
			<Field label="Price (Robux)" value={price} onChangeText={setPrice} keyboardType="number-pad" placeholder="e.g. 100" />
			<SwitchRow label="Price optimization" hint="Managed pricing: Roblox tests and sets the best price per market." value={managed} onChange={setManaged} />
			<SwitchRow
				label="Regional pricing"
				hint="Lower prices in some regions (Roblox's deprecated switch; price optimization replaces it). Change it in a separate save from price optimization."
				value={regional}
				onChange={setRegional}
			/>
			{kind === "product" && item ? <SwitchRow label="Sell on the store page" hint="The experience's external store page (deprecated by Roblox)." value={storePage} onChange={setStorePage} /> : null}
			<IconPicker value={icon} onChange={setIcon} hint={item ? "Pick an image to replace the current icon." : "Optional: PNG, JPG, BMP or TGA, shown at 512 × 512."} disabled={save.isPending} />
			<Button title={item ? "Save" : "Create"} variant="brand" icon={item ? "save-outline" : "add"} small loading={save.isPending} onPress={onSave} style={{ alignSelf: "flex-start" }} />
			{formError ? (
				<Txt variant="small" color={p.destructive}>
					{formError}
				</Txt>
			) : null}
		</Card>
	);
}
