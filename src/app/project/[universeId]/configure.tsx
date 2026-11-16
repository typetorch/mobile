/**
 * Experience settings (Creator Hub → Configure): public / private (legacy activate / deactivate, confirm first), name
 * and description (the ROOT place's PATCH: the universe's own fields are readOnly), devices, voice chat, private
 * servers and social links (PATCH /cloud/v2/universes/{id} with an updateMask of just the changed fields).
 * Maturity, audiences, playtesters, genre and avatar settings have no Open Cloud write (cookie only): shown read only.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, confirm, EmptyState, Field, KV, notify, Section, SkeletonList, Txt } from "@/components/ui";
import {
	getUniverse,
	placeIdOf,
	PLACE_LIMITS,
	SCOPES,
	setUniverseActive,
	SOCIAL_FIELDS,
	universePermissions,
	updatePlace,
	updateUniverse,
	validatePlacePatch,
	type DeviceField,
	type SocialField,
	type UniverseFull,
	type UniversePatch,
} from "@/features/project/api/configure";
import { SwitchRow } from "@/features/project/configure/shared";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtDate } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

export default function ConfigureScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Experience settings" scopes={[]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "universe"], type: "active" })}>
			{({ universeId, cloud, can }) => <Configure universeId={universeId} cloud={cloud} can={can} />}
		</ToolScreen>
	);
}

type Can = (scope: string) => boolean;

function Configure({ universeId, cloud, can }: { universeId: number; cloud: OpenCloud; can: Can }) {
	const { hasKey } = useAccounts();
	const universe = useQuery({ queryKey: ["oc", "universe", universeId], queryFn: () => getUniverse(cloud, universeId), enabled: hasKey, retry: false, staleTime: 60_000 });
	if (!hasKey)
		return <EmptyState icon="key-outline" title="Add an Open Cloud key" body="Experience settings are read and changed with your Open Cloud key." action={<Button title="Open Settings" variant="brand" onPress={() => router.push("/settings")} />} />;
	if (universe.error) return <CloudError error={universe.error} what="Experience settings" onRetry={() => universe.refetch()} />;
	if (!universe.data) return <SkeletonList rows={6} />;
	const u = universe.data;
	const canWrite = can(SCOPES.universeWrite);
	return (
		<>
			<Status universeId={universeId} cloud={cloud} u={u} can={can} />
			<NameDescription key={`nd-${u.updateTime}`} universeId={universeId} cloud={cloud} u={u} canWrite={can(SCOPES.placeWrite)} />
			{!canWrite ? <Txt variant="small">Read only: add universe:write for this experience to change devices, voice chat, private servers and social links.</Txt> : null}
			<Devices key={`dv-${u.updateTime}`} universeId={universeId} cloud={cloud} u={u} canWrite={canWrite} />
			<PrivateServers key={`ps-${u.updateTime}`} universeId={universeId} cloud={cloud} u={u} canWrite={canWrite} />
			<SocialLinks key={`sl-${u.updateTime}`} universeId={universeId} cloud={cloud} u={u} canWrite={canWrite} />
			<Section title="Only on Creator Hub">
				<Card>
					<KV label="Maturity" value={u.ageRating ? u.ageRating.replace(/^AGE_RATING_/, "").replace(/_/g, " ").toLowerCase() : "–"} />
					<Txt variant="small">The maturity questionnaire, audiences, playtesters, genre, paid access, avatar and copying settings have no Open Cloud API.</Txt>
				</Card>
				<Button
					title="Open Creator Hub"
					small
					icon="open-outline"
					style={{ alignSelf: "flex-start" }}
					onPress={() => WebBrowser.openBrowserAsync(`https://create.roblox.com/dashboard/creations/experiences/${universeId}/configure`)}
				/>
			</Section>
		</>
	);
}

/** Saves a universe PATCH and refreshes everything that shows the universe. */
function useUniversePatch(universeId: number, cloud: OpenCloud) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (args: { mask: string[]; body: UniversePatch; done?: string }) => updateUniverse(cloud, universeId, args.mask, args.body),
		onSuccess: (_r, args) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "universe", universeId] });
			if (args.done) notify("Saved", args.done);
		},
		onError: (e) => notify("Couldn't save", cloudErrorText(e)),
	});
}

// Public / private -----------------------------------------------------------------------------------------------------

function Status({ universeId, cloud, u, can }: { universeId: number; cloud: OpenCloud; u: UniverseFull; can: Can }) {
	const queryClient = useQueryClient();
	const canManage = can(SCOPES.legacyUniverse);
	const perms = useQuery({ queryKey: ["oc", "universe", universeId, "permissions"], queryFn: () => universePermissions(cloud, universeId), enabled: canManage, retry: false, staleTime: 300_000 });
	const active = useMutation({
		mutationFn: (on: boolean) => setUniverseActive(cloud, universeId, on),
		onSuccess: (_r, on) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "universe", universeId] });
			queryClient.invalidateQueries({ queryKey: ["project", universeId] });
			notify(on ? "Experience is public" : "Experience is private", on ? "Players can find and join it again." : "Players can no longer join.");
		},
		onError: (e) => notify("Couldn't change visibility", cloudErrorText(e)),
	});
	const isPublic = u.visibility === "PUBLIC";
	return (
		<Section title="Status">
			<Card style={{ gap: 4 }}>
				<KV label="Visibility" value={<Badge label={(u.visibility ?? "–").toLowerCase()} tone={isPublic ? "good" : "muted"} />} />
				<KV label="Owner" value={u.group ? `Group ${u.group.replace(/^groups\//, "")}` : u.user ? `User ${u.user.replace(/^users\//, "")}` : "–"} />
				<KV label="Root place" value={String(placeIdOf(u.rootPlace) ?? "–")} mono />
				<KV label="Created" value={fmtDate(u.createTime)} />
				<KV label="Updated" value={`${fmtDate(u.updateTime)} (${fmtAgo(u.updateTime)})`} />
				{perms.data ? <KV label="Your key can" value={[perms.data.canManage ? "manage" : null, perms.data.canCloudEdit ? "cloud edit" : null].filter(Boolean).join(", ") || "nothing"} /> : null}
				{canManage ? (
					<Button
						title={isPublic ? "Make private" : "Make public"}
						variant={isPublic ? "destructive" : "brand"}
						small
						icon={isPublic ? "eye-off-outline" : "eye-outline"}
						loading={active.isPending}
						style={{ alignSelf: "flex-start", marginTop: 6 }}
						onPress={async () => {
							const ok = isPublic
								? await confirm("Make the experience private?", "Every player in it is removed right away and nobody can join until it's public again.", "Make private")
								: await confirm("Make the experience public?", "Anyone the audience settings allow can find and join it.", "Make public", false);
							if (ok) active.mutate(!isPublic);
						}}
					/>
				) : (
					<Txt variant="small">Add legacy-universe:manage to make it public or private.</Txt>
				)}
			</Card>
		</Section>
	);
}

// Name and description -------------------------------------------------------------------------------------------------

function NameDescription({ universeId, cloud, u, canWrite }: { universeId: number; cloud: OpenCloud; u: UniverseFull; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const rootId = placeIdOf(u.rootPlace);
	const [name, setName] = useState(u.displayName ?? "");
	const [description, setDescription] = useState(u.description ?? "");
	const [error, setError] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (patch: { displayName?: string; description?: string }) => updatePlace(cloud, universeId, rootId!, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "universe", universeId] });
			queryClient.invalidateQueries({ queryKey: ["oc", "place", universeId] });
			queryClient.invalidateQueries({ queryKey: ["project", universeId] });
			queryClient.invalidateQueries({ queryKey: ["places", universeId] });
			notify("Saved", "The name and description are updated (the public page may take a few minutes).");
		},
		onError: (e) => notify("Couldn't save", cloudErrorText(e)),
	});
	const changed = name !== (u.displayName ?? "") || description !== (u.description ?? "");
	function submit() {
		const patch: { displayName?: string; description?: string } = {};
		if (name !== (u.displayName ?? "")) patch.displayName = name.trim();
		if (description !== (u.description ?? "")) patch.description = description;
		const v = validatePlacePatch(patch);
		setError(v);
		if (!v && rootId) save.mutate(patch);
	}
	return (
		<Section title="Name and description">
			<Card style={{ gap: 8 }}>
				<Field label={`Name (${name.length}/${PLACE_LIMITS.name})`} value={name} onChangeText={setName} editable={canWrite} maxLength={PLACE_LIMITS.name} autoCapitalize="sentences" />
				<Field
					label={`Description (${description.length}/${PLACE_LIMITS.description})`}
					value={description}
					onChangeText={setDescription}
					editable={canWrite}
					multiline
					maxLength={PLACE_LIMITS.description}
					autoCapitalize="sentences"
					style={{ fontFamily: undefined, fontSize: 14 }}
				/>
				{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
				{canWrite && rootId ? (
					<View style={{ flexDirection: "row", gap: 8 }}>
						<Button title="Save" variant="brand" small loading={save.isPending} disabled={!changed} onPress={submit} />
						{changed ? (
							<Button
								title="Reset"
								small
								variant="ghost"
								onPress={() => {
									setName(u.displayName ?? "");
									setDescription(u.description ?? "");
									setError(null);
								}}
							/>
						) : null}
					</View>
				) : (
					<Txt variant="small">{rootId ? "Add universe.place:write to edit them." : "Roblox didn't say which place is the root."}</Txt>
				)}
				<Txt variant="small">Saved on the start place (Roblox refuses while it's open in Team Create). Translations are under Localization.</Txt>
			</Card>
		</Section>
	);
}

// Devices and voice ----------------------------------------------------------------------------------------------------

const DEVICES: { field: DeviceField; label: string }[] = [
	{ field: "desktopEnabled", label: "Computer" },
	{ field: "mobileEnabled", label: "Phone" },
	{ field: "tabletEnabled", label: "Tablet" },
	{ field: "consoleEnabled", label: "Console" },
	{ field: "vrEnabled", label: "VR headset" },
];

function Devices({ universeId, cloud, u, canWrite }: { universeId: number; cloud: OpenCloud; u: UniverseFull; canWrite: boolean }) {
	const initial = Object.fromEntries([...DEVICES.map((d) => [d.field, !!u[d.field]]), ["voiceChatEnabled", !!u.voiceChatEnabled]]) as Record<DeviceField | "voiceChatEnabled", boolean>;
	const [values, setValues] = useState(initial);
	const patch = useUniversePatch(universeId, cloud);
	const mask = (Object.keys(values) as (keyof typeof values)[]).filter((k) => values[k] !== initial[k]);
	async function save() {
		if (DEVICES.every((d) => !values[d.field])) {
			notify("Pick a device", "At least one device must be able to join.");
			return;
		}
		const off = DEVICES.filter((d) => initial[d.field] && !values[d.field]).map((d) => d.label.toLowerCase());
		if (off.length && !(await confirm("Turn off devices?", `Players on ${off.join(", ")} won't be able to join.`, "Turn off"))) return;
		patch.mutate({ mask, body: Object.fromEntries(mask.map((k) => [k, values[k]])), done: "Devices and voice chat are updated. Voice changes apply to new servers." });
	}
	return (
		<Section title="Devices and voice chat">
			<Card>
				{DEVICES.map((d) => (
					<SwitchRow key={d.field} label={d.label} value={values[d.field]} disabled={!canWrite} onChange={(v) => setValues((s) => ({ ...s, [d.field]: v }))} />
				))}
				<SwitchRow
					label="Voice chat"
					hint="Running servers keep their current setting."
					value={values.voiceChatEnabled}
					disabled={!canWrite}
					onChange={(v) => setValues((s) => ({ ...s, voiceChatEnabled: v }))}
				/>
				{canWrite ? (
					<View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
						<Button title="Save" variant="brand" small loading={patch.isPending} disabled={!mask.length} onPress={save} />
						{mask.length ? <Button title="Reset" variant="ghost" small onPress={() => setValues(initial)} /> : null}
					</View>
				) : null}
			</Card>
		</Section>
	);
}

// Private servers ------------------------------------------------------------------------------------------------------

const INT32_MAX = 2_147_483_647;

function PrivateServers({ universeId, cloud, u, canWrite }: { universeId: number; cloud: OpenCloud; u: UniverseFull; canWrite: boolean }) {
	const p = useTheme();
	const wasOn = u.privateServerPriceRobux !== undefined && u.privateServerPriceRobux !== null;
	const [on, setOn] = useState(wasOn);
	const [price, setPrice] = useState(wasOn ? String(u.privateServerPriceRobux) : "0");
	const [error, setError] = useState<string | null>(null);
	const patch = useUniversePatch(universeId, cloud);
	const changed = on !== wasOn || (on && price.trim() !== String(u.privateServerPriceRobux ?? ""));
	async function save() {
		setError(null);
		if (!on) {
			if (await confirm("Turn off private servers?", "Every active private server is shut down and subscriptions end.", "Turn off"))
				patch.mutate({ mask: ["privateServerPriceRobux"], body: {}, done: "Private servers are off." });
			return;
		}
		const text = price.trim();
		if (!/^\d+$/.test(text) || Number(text) > INT32_MAX) {
			setError("The price must be a whole number of Robux (0 = free).");
			return;
		}
		const n = Number(text);
		const msg = wasOn ? `Changing the price cancels every private server subscription. New price: ${n ? `R$ ${n}` : "free"} a month.` : `Players can buy private servers for ${n ? `R$ ${n}` : "free"} a month.`;
		if (await confirm(wasOn ? "Change the price?" : "Turn on private servers?", msg, wasOn ? "Change price" : "Turn on", wasOn))
			patch.mutate({ mask: ["privateServerPriceRobux"], body: { privateServerPriceRobux: n }, done: "Private servers are updated." });
	}
	return (
		<Section title="Private servers">
			<Card style={{ gap: 6 }}>
				<SwitchRow label="Allow private servers" value={on} disabled={!canWrite} onChange={setOn} />
				{on ? <Field label="Price (Robux a month)" value={price} onChangeText={setPrice} keyboardType="number-pad" editable={canWrite} maxLength={10} /> : null}
				{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
				{canWrite ? <Button title="Save" variant="brand" small loading={patch.isPending} disabled={!changed} onPress={save} style={{ alignSelf: "flex-start" }} /> : null}
			</Card>
		</Section>
	);
}

// Social links ---------------------------------------------------------------------------------------------------------

function SocialLinks({ universeId, cloud, u, canWrite }: { universeId: number; cloud: OpenCloud; u: UniverseFull; canWrite: boolean }) {
	return (
		<Section title="Social links">
			{SOCIAL_FIELDS.map((s) => (
				<SocialLinkCard key={s.field} universeId={universeId} cloud={cloud} field={s.field} label={s.label} link={u[s.field]} canWrite={canWrite} />
			))}
			<Txt variant="small">Roblox only accepts links to each site's own domain.</Txt>
		</Section>
	);
}

function SocialLinkCard({ universeId, cloud, field, label, link, canWrite }: { universeId: number; cloud: OpenCloud; field: SocialField; label: string; link: UniverseFull[SocialField]; canWrite: boolean }) {
	const p = useTheme();
	const has = !!link?.uri;
	const [title, setTitle] = useState(link?.title ?? "");
	const [uri, setUri] = useState(link?.uri ?? "");
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const patch = useUniversePatch(universeId, cloud);
	const changed = title !== (link?.title ?? "") || uri !== (link?.uri ?? "");

	function save() {
		const t = title.trim();
		const target = uri.trim();
		if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(target)) return setError("Enter a full https:// link.");
		if (t.length > 100) return setError("The title is too long (100 characters at most).");
		setError(null);
		patch.mutate({ mask: [field], body: { [field]: { title: t, uri: target } }, done: `${label} link saved.` });
	}
	async function remove() {
		if (await confirm(`Remove the ${label} link?`, "It disappears from the experience page.", "Remove")) patch.mutate({ mask: [field], body: {}, done: `${label} link removed.` });
	}

	return (
		<Card style={{ gap: 6 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Txt style={{ fontWeight: "600", flex: 1 }}>{label}</Txt>
				{has ? <Badge label="set" tone="good" /> : <Badge label="none" />}
				{canWrite ? <Button title={open ? "Close" : has ? "Edit" : "Add"} small variant="ghost" onPress={() => setOpen((v) => !v)} /> : null}
			</View>
			{has && !open ? (
				<Txt variant="small" selectable numberOfLines={2}>
					{link?.title ? `${link.title} · ` : ""}
					{link?.uri}
				</Txt>
			) : null}
			{open ? (
				<>
					<Field value={title} onChangeText={setTitle} placeholder="Title (shown on the button)" autoCapitalize="sentences" maxLength={100} />
					<Field value={uri} onChangeText={setUri} placeholder="https://…" keyboardType="url" />
					{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
					<View style={{ flexDirection: "row", gap: 8 }}>
						<Button title="Save" variant="brand" small loading={patch.isPending} disabled={!changed || !uri.trim()} onPress={save} />
						{has ? <Button title="Remove" variant="destructive" small disabled={patch.isPending} onPress={remove} /> : null}
					</View>
				</>
			) : null}
		</Card>
	);
}
