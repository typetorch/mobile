/**
 * The experience's secrets store (HttpService:GetSecret): names, domains and dates (Roblox never returns a value), add,
 * replace and delete. A value is sealed on the phone (LibSodium crypto_box_seal against the universe's public key,
 * pure TypeScript in sealedbox.ts) and only the sealed base64 goes to apis.roblox.com; it is never logged or kept.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, confirm, EmptyState, Field, List, notify, Row, Section, SkeletonList, Txt } from "@/components/ui";
import { createSecret, deleteSecret, listSecrets, SECRET_ID, SECRETS_MAX, updateSecret, type UniverseSecret } from "@/features/project/api/data";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtDate } from "@/lib/format";
import { useTheme } from "@/theme";

export default function SecretsScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Secrets" scopes={["universe.secret:read"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "secrets"], type: "active" })}>
			{({ universeId, cloud, can }) => <Secrets universeId={universeId} cloud={cloud} canWrite={can("universe.secret:write")} />}
		</ToolScreen>
	);
}

function domainLabel(domain: string | null | undefined): string {
	if (!domain) return "private key (no domain)";
	return domain === "*" ? "any domain" : domain;
}

function Secrets({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<UniverseSecret | "new" | null>(null);
	const q = useInfiniteQuery({
		queryKey: ["oc", "secrets", universeId],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listSecrets(cloud, universeId, pageParam),
		getNextPageParam: (last) => last.nextPageCursor || undefined,
	});
	const secrets = q.data?.pages.flatMap((p) => p.secrets ?? []) ?? [];
	const remove = useMutation({
		mutationFn: (id: string) => deleteSecret(cloud, universeId, id),
		onSuccess: () => {
			setEditing(null);
			queryClient.invalidateQueries({ queryKey: ["oc", "secrets", universeId] });
		},
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});

	async function onDelete(id: string) {
		if (await confirm(`Delete the secret ${id}?`, "It is deleted for good; game code calling HttpService:GetSecret for it starts failing.", "Delete")) remove.mutate(id);
	}

	return (
		<>
			<Txt variant="small">Values are write-only: Roblox never shows a stored secret. Game servers read them with HttpService:GetSecret.</Txt>
			{canWrite ? (
				editing ? (
					<SecretForm
						key={editing === "new" ? "new" : editing.id}
						universeId={universeId}
						cloud={cloud}
						secret={editing === "new" ? null : editing}
						onDone={() => {
							setEditing(null);
							queryClient.invalidateQueries({ queryKey: ["oc", "secrets", universeId] });
						}}
						onCancel={() => setEditing(null)}
						onDelete={editing === "new" ? undefined : () => onDelete(editing.id)}
						deleting={remove.isPending}
					/>
				) : (
					<Button title="Add a secret" variant="brand" icon="add" small disabled={!!q.data && secrets.length >= SECRETS_MAX && !q.hasNextPage} onPress={() => setEditing("new")} style={{ alignSelf: "flex-start" }} />
				)
			) : (
				<Txt variant="small">Read only: add universe.secret:write to add, replace and delete secrets.</Txt>
			)}
			{q.error ? <CloudError error={q.error} what="Secrets (only the owner, or for a group the owner and allowed members, can read them)" onRetry={() => q.refetch()} /> : null}
			{q.isLoading ? <SkeletonList rows={4} /> : null}
			{q.data && !secrets.length ? <EmptyState icon="lock-closed-outline" title="No secrets" body="Add API keys for outside services here instead of putting them in scripts." /> : null}
			{secrets.length ? (
				<Section title={`${secrets.length}${q.hasNextPage ? "+" : ""} of ${SECRETS_MAX} secrets`}>
					<List>
						{secrets.map((s) => (
							<Row
								key={s.id}
								chevron={canWrite}
								onPress={canWrite ? () => setEditing(s) : undefined}
								title={s.id}
								subtitle={`${domainLabel(s.domain)} · updated ${fmtAgo(s.update_time)}${s.create_time ? ` · created ${fmtDate(s.create_time)}` : ""}`}
								right={!s.domain ? <Badge label="private" tone="warning" /> : undefined}
							/>
						))}
					</List>
					{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</Section>
			) : null}
		</>
	);
}

function SecretForm({
	universeId,
	cloud,
	secret,
	onDone,
	onCancel,
	onDelete,
	deleting,
}: {
	universeId: number;
	cloud: OpenCloud;
	secret: UniverseSecret | null;
	onDone: () => void;
	onCancel: () => void;
	onDelete?: () => void;
	deleting: boolean;
}) {
	const p = useTheme();
	const [id, setId] = useState(secret?.id ?? "");
	const [value, setValue] = useState("");
	const [reveal, setReveal] = useState(false);
	const [domain, setDomain] = useState(secret ? (secret.domain ?? "") : "*");
	const [error, setError] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (input: { id: string; value: string; domain: string }) => (secret ? updateSecret(cloud, universeId, secret.id, input) : createSecret(cloud, universeId, input)),
		onSuccess: () => {
			setValue("");
			onDone();
		},
		onError: (e) => notify("Save failed", cloudErrorText(e)),
	});

	function checkDomain(d: string): string {
		const t = d.trim();
		if (t && t !== "*" && !/^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(t)) throw new Error("Domain: “*”, a host like api.example.com, a wildcard like *.example.org, or empty for a private key.");
		return t;
	}

	async function onSave() {
		setError(null);
		let d: string;
		try {
			if (!secret && !SECRET_ID.test(id.trim())) throw new Error("A secret name is 1-64 letters, digits or _, and does not start with a digit.");
			if (!value) throw new Error("Type the secret value.");
			d = checkDomain(domain);
		} catch (e) {
			setError((e as Error).message);
			return;
		}
		const name = secret?.id ?? id.trim();
		const where = d ? (d === "*" ? "sent to any domain" : `sent only to ${d}`) : "used only as a private key (not as a header or URL)";
		if (await confirm(secret ? `Replace ${name}?` : `Add ${name}?`, `${secret ? "The old value is overwritten for good. " : ""}The value is encrypted on this phone for this experience and can be ${where}.`, secret ? "Replace" : "Add", !!secret)) {
			save.mutate({ id: name, value, domain: d });
		}
	}

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">{secret ? `Replace ${secret.id}` : "New secret"}</Txt>
			{secret ? null : <Field label="Name" value={id} onChangeText={setId} placeholder="discord_webhook" maxLength={64} hint="Letters, digits and _, up to 64; not starting with a digit." />}
			<Field label={secret ? "New value" : "Value"} value={value} onChangeText={setValue} secureTextEntry={!reveal} placeholder="sk_live_…" textContentType="none" autoComplete="off" importantForAutofill="no" hint={secret ? "Roblox never sends the value back, so type it again even to change only the domain." : undefined} />
			<Button title={reveal ? "Hide value" : "Show value"} small variant="ghost" icon={reveal ? "eye-off-outline" : "eye-outline"} onPress={() => setReveal(!reveal)} style={{ alignSelf: "flex-start" }} />
			<Field label="Domain" value={domain} onChangeText={setDomain} placeholder="*" hint="Where game servers may send it: * (anywhere), api.example.com, *.example.org. Empty = a private key." />
			{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				<Button title={secret ? "Replace" : "Add"} variant="brand" icon="lock-closed-outline" small loading={save.isPending} onPress={onSave} />
				<Button title="Cancel" variant="ghost" small onPress={onCancel} />
				{onDelete ? <Button title="Delete" variant="destructive" icon="trash-outline" small loading={deleting} onPress={onDelete} /> : null}
			</View>
		</Card>
	);
}
