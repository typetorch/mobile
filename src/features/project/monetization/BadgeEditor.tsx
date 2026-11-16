/**
 * Create a badge (shows the price, today's free quota and who pays first, then asks with the cost) or edit one: name,
 * description, enabled, and replace its icon (legacy-badge:manage, image from the system file picker, asks first).
 * Badges can't be deleted through the API; disabling is how one is retired. A new badge without a picked image gets
 * Roblox's default icon.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { badgeIcons } from "@/api/roblox-public";
import { GameIcon } from "@/components/ProjectRow";
import { Badge, Button, Card, confirm, EmptyState, ErrorState, Field, KV, notify, Skeleton, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { badgeMetadata, createBadge, freeBadgesQuota, getBadge, updateBadge, uploadBadgeIcon, type BadgeDetail, type BadgeMetadata, type IconFile } from "@/features/project/api/monetization";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { compact, fmtDate, fmtRobux } from "@/lib/format";
import { useTheme } from "@/theme";

import { ICON_REVIEW_NOTE, IconPicker, SwitchRow } from "./shared";

/** Fallbacks while badges v1 metadata loads or if it fails. */
const NAME_MAX = 50;
const DESCRIPTION_MAX = 1000;

function useMetadata() {
	return useQuery({ queryKey: ["monetization", "badge-metadata"], queryFn: badgeMetadata, staleTime: 3600_000 });
}

export function BadgeEditor({
	universeId,
	cloud,
	id,
	canCreate,
	canWrite,
	canIcon,
}: {
	universeId: number;
	cloud: OpenCloud;
	id: number | "new";
	canCreate: boolean;
	canWrite: boolean;
	canIcon: boolean;
}) {
	const meta = useMetadata();
	const q = useQuery({ queryKey: ["monetization", "badge", id], enabled: id !== "new", queryFn: () => getBadge(id as number) });
	const icon = useQuery({ queryKey: ["monetization", "badge", "icon", id], enabled: id !== "new", staleTime: 300_000, queryFn: async () => (await badgeIcons([id as number]))[id as number] ?? null });
	if (id === "new") {
		if (!canCreate) return <EmptyState icon="key-outline" title="Creating a badge needs legacy-universe.badge:manage-and-spend-robux" body="Add the scope to your API key on Creator Hub. It lets the key spend Robux on badges." />;
		return <CreateBadge universeId={universeId} cloud={cloud} meta={meta.data} metaError={meta.error} />;
	}
	if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data) return <SkeletonList rows={3} />;
	const b = q.data;
	const s = b.statistics;
	return (
		<>
			<Card style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
				<GameIcon uri={icon.data} size={56} />
				<View style={{ flex: 1, gap: 2 }}>
					<Txt variant="h3">{b.displayName || b.name}</Txt>
					<Txt variant="small" selectable>
						ID {b.id} · created {fmtDate(b.created)} · updated {fmtDate(b.updated)}
					</Txt>
					<View style={{ flexDirection: "row", gap: 6 }}>{b.enabled ? <Badge label="enabled" tone="good" /> : <Badge label="disabled" />}</View>
				</View>
			</Card>
			{s ? (
				<StatGrid>
					<Stat label="Awarded" value={compact(s.awardedCount)} />
					<Stat label="Yesterday" value={compact(s.pastDayAwardedCount)} />
					<Stat label="Win rate" value={`${(s.winRatePercentage <= 1 ? s.winRatePercentage * 100 : s.winRatePercentage).toFixed(1)}%`} />
				</StatGrid>
			) : null}
			{b.awardingUniverse && b.awardingUniverse.id !== universeId ? (
				<Card style={{ gap: 4 }}>
					<KV label="Description" value={b.description || "–"} />
					<Txt variant="small">This badge belongs to another experience ({b.awardingUniverse.name}), so it can't be edited from here. Open that experience to edit it.</Txt>
				</Card>
			) : (
				<>
					<EditBadge key={b.updated} cloud={cloud} badge={b} meta={meta.data} canWrite={canWrite} />
					<BadgeIcon cloud={cloud} badge={b} canIcon={canIcon} />
				</>
			)}
		</>
	);
}

function EditBadge({ cloud, badge, meta, canWrite }: { cloud: OpenCloud; badge: BadgeDetail; meta?: BadgeMetadata; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [name, setName] = useState(badge.name);
	const [description, setDescription] = useState(badge.description ?? "");
	const [enabled, setEnabled] = useState(badge.enabled);
	const [formError, setFormError] = useState<string | null>(null);
	const nameMax = meta?.maxBadgeNameLength ?? NAME_MAX;
	const descMax = meta?.maxBadgeDescriptionLength ?? DESCRIPTION_MAX;
	const save = useMutation({
		mutationFn: (body: { name?: string; description?: string; enabled?: boolean }) => updateBadge(cloud, badge.id, body),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["monetization"] });
			notify("Saved", "Roblox may take a minute to show the change.");
		},
		onError: (e) => notify("Save failed", cloudErrorText(e)),
	});

	if (!canWrite) {
		return (
			<Card style={{ gap: 4 }}>
				<KV label="Description" value={badge.description || "–"} />
				<Txt variant="small">Read only: add legacy-universe.badge:write to rename, describe, enable or disable badges.</Txt>
			</Card>
		);
	}

	async function onSave() {
		setFormError(null);
		const n = name.trim();
		if (!n) return setFormError("Give it a name.");
		if (n.length > nameMax) return setFormError(`The name can be at most ${nameMax} characters.`);
		if (description.length > descMax) return setFormError(`The description can be at most ${descMax} characters.`);
		const body: { name?: string; description?: string; enabled?: boolean } = {};
		if (n !== badge.name) body.name = n;
		if (description !== (badge.description ?? "")) body.description = description;
		if (enabled !== badge.enabled) body.enabled = enabled;
		if (!Object.keys(body).length) return setFormError("Nothing changed.");
		if (body.enabled === false && !(await confirm(`Disable ${badge.name}?`, "Game servers can no longer award it. Players who have it keep it.", "Disable"))) return;
		save.mutate(body);
	}

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">Edit</Txt>
			<Field label="Name" value={name} onChangeText={setName} maxLength={nameMax} autoCapitalize="sentences" />
			<Field label="Description" value={description} onChangeText={setDescription} maxLength={descMax} autoCapitalize="sentences" multiline style={{ minHeight: 70, fontFamily: undefined }} />
			<SwitchRow label="Enabled" hint="A disabled badge can't be awarded. The API has no delete; disabling is how a badge is retired." value={enabled} onChange={setEnabled} />
			<Button title="Save" variant="brand" icon="save-outline" small loading={save.isPending} onPress={onSave} style={{ alignSelf: "flex-start" }} />
			{formError ? (
				<Txt variant="small" color={p.destructive}>
					{formError}
				</Txt>
			) : null}
		</Card>
	);
}

function CreateBadge({ universeId, cloud, meta, metaError }: { universeId: number; cloud: OpenCloud; meta?: BadgeMetadata; metaError: unknown }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const quota = useQuery({ queryKey: ["monetization", "badge-quota", universeId], queryFn: () => freeBadgesQuota(universeId), staleTime: 60_000 });
	const owner = useQuery({ queryKey: ["oc", "universe", universeId, "monetization"], queryFn: () => cloud.universe(universeId), staleTime: 300_000 });
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [active, setActive] = useState(true);
	const [icon, setIcon] = useState<IconFile | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const group = owner.data?.group ? owner.data.group : null;
	const create = useMutation({
		mutationFn: (args: { cost: number }) => createBadge(cloud, universeId, { name: name.trim(), description, paymentSourceType: group ? 2 : 1, expectedCost: args.cost, isActive: active, files: icon ?? undefined }),
		onSuccess: (b) => {
			queryClient.invalidateQueries({ queryKey: ["monetization"] });
			notify("Badge created", `ID ${b.id}.${icon ? ` ${ICON_REVIEW_NOTE}` : ""}`);
			router.replace(`/project/${universeId}/badge?id=${b.id}`);
		},
		onError: (e) => notify("Create failed", cloudErrorText(e)),
	});

	if (metaError) return <ErrorState error={metaError} title="Can't read the badge price" />;
	if (!meta || quota.isLoading || owner.isLoading) return <Skeleton height={120} />;
	if (owner.error) return <CloudError error={owner.error} what="The experience's owner" onRetry={() => owner.refetch()} />;
	const free = (quota.data ?? 0) > 0;
	const cost = free ? 0 : meta.badgeCreationPrice;
	const noIcon = meta.defaultBadgeIconImageId === 0;

	async function onCreate() {
		setFormError(null);
		const n = name.trim();
		if (!n) return setFormError("Give it a name.");
		if (n.length > meta!.maxBadgeNameLength) return setFormError(`The name can be at most ${meta!.maxBadgeNameLength} characters.`);
		if (description.length > meta!.maxBadgeDescriptionLength) return setFormError(`The description can be at most ${meta!.maxBadgeDescriptionLength} characters.`);
		if (noIcon && !icon) return setFormError("Roblox has no default badge icon right now: choose an image.");
		const payer = group ? "the group's funds" : "your Robux";
		const msg = cost ? `This costs ${fmtRobux(cost)}, paid from ${payer}. It can't be refunded.` : `Free: ${quota.data} free badge${quota.data === 1 ? "" : "s"} left today for this experience.`;
		if (await confirm(`Create the badge “${n}”?`, `${msg} ${icon ? `Icon: ${icon.name}.` : "It gets Roblox's default icon."}`, cost ? `Pay ${fmtRobux(cost)}` : "Create", cost > 0)) create.mutate({ cost });
	}

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">New badge</Txt>
			<KV label="Price" value={free ? `free (${quota.data} left today)` : fmtRobux(meta.badgeCreationPrice)} />
			<KV label="Paid by" value={group ? "the group" : "you"} />
			{quota.error ? <Txt variant="small">Couldn't read today's free quota; Roblox charges the price if none is left.</Txt> : null}
			<Field label="Name" value={name} onChangeText={setName} maxLength={meta.maxBadgeNameLength} autoCapitalize="sentences" placeholder={`Up to ${meta.maxBadgeNameLength} characters`} />
			<Field label="Description" value={description} onChangeText={setDescription} maxLength={meta.maxBadgeDescriptionLength} autoCapitalize="sentences" multiline style={{ minHeight: 70, fontFamily: undefined }} />
			<SwitchRow label="Enabled" hint="Game servers can award it right away." value={active} onChange={setActive} />
			<IconPicker value={icon} onChange={setIcon} hint={noIcon ? "Required: Roblox has no default badge icon right now." : "Optional: without one the badge gets Roblox's default icon. Shown as a circle."} disabled={create.isPending} />
			<Button title={cost ? `Create for ${fmtRobux(cost)}` : "Create"} variant="brand" icon="ribbon-outline" small disabled={noIcon && !icon} loading={create.isPending} onPress={onCreate} style={{ alignSelf: "flex-start" }} />
			{formError ? (
				<Txt variant="small" color={p.destructive}>
					{formError}
				</Txt>
			) : null}
		</Card>
	);
}

/** Replace the icon: POST /legacy-publish/v1/badges/{id}/icon overwrites it, so it asks first. */
function BadgeIcon({ cloud, badge, canIcon }: { cloud: OpenCloud; badge: BadgeDetail; canIcon: boolean }) {
	const queryClient = useQueryClient();
	const [icon, setIcon] = useState<IconFile | null>(null);
	const upload = useMutation({
		mutationFn: (file: IconFile) => uploadBadgeIcon(cloud, badge.id, file),
		onSuccess: () => {
			setIcon(null);
			queryClient.invalidateQueries({ queryKey: ["monetization", "badge"] });
			notify("Icon replaced", ICON_REVIEW_NOTE);
		},
		onError: (e) => notify("Icon upload failed", cloudErrorText(e)),
	});
	if (!canIcon) {
		return (
			<Card>
				<Txt variant="small">Add legacy-badge:manage to your API key to replace this badge's icon.</Txt>
			</Card>
		);
	}
	async function onUpload() {
		if (!icon) return;
		if (await confirm("Replace the icon?", `${icon.name} replaces ${badge.name}'s current icon for every player.`, "Replace icon")) upload.mutate(icon);
	}
	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">Icon</Txt>
			<IconPicker value={icon} onChange={setIcon} hint="Shown as a circle; Roblox scales it to 512 × 512." disabled={upload.isPending} />
			<Button title="Upload icon" variant="brand" icon="cloud-upload-outline" small disabled={!icon} loading={upload.isPending} onPress={onUpload} style={{ alignSelf: "flex-start" }} />
		</Card>
	);
}
