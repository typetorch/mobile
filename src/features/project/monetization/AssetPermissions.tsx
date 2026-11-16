/**
 * Grant this experience permission to use assets (audio, meshes, images, … the key owner can manage), with or without
 * their dependencies: PATCH /asset-permissions-api/v1/assets/permissions with subjectType Universe and action Use. There
 * is no endpoint that lists what an experience may already use, so this is write-only.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, confirm, Field, notify, Txt } from "@/components/ui";
import { grantAssetUse } from "@/features/project/api/monetization";
import { cloudErrorText } from "@/features/project/CloudError";
import { useTheme } from "@/theme";

import { SwitchRow } from "./shared";

/** Assets per request (a sane batch; Roblox answers BatchSizeLimitExceeded beyond its own limit). */
const MAX_ASSETS = 50;

export function AssetPermissions({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const [text, setText] = useState("");
	const [deps, setDeps] = useState(true);
	const [formError, setFormError] = useState<string | null>(null);
	const grant = useMutation({
		mutationFn: (ids: number[]) => grantAssetUse(cloud, universeId, ids, deps),
		onSuccess: (r) => {
			const ok = r.successAssetIds ?? [];
			const bad = r.errors ?? [];
			notify(
				ok.length === 0 ? "Nothing granted" : bad.length ? "Granted in part" : "Granted",
				[ok.length ? `Can now use: ${ok.join(", ")}` : "", bad.length ? `Failed: ${bad.map((e) => `${e.assetId} (${e.code})`).join(", ")}` : ""].filter(Boolean).join("\n\n"),
			);
			if (!bad.length) setText("");
		},
		onError: (e) => notify("Grant failed", cloudErrorText(e)),
	});

	async function onGrant() {
		setFormError(null);
		const parts = text.split(/[\s,;]+/).filter(Boolean);
		if (!parts.length) return setFormError("Enter one or more asset IDs.");
		if (parts.some((s) => !/^\d+$/.test(s) || Number(s) <= 0)) return setFormError("Asset IDs are numbers, separated by commas or spaces.");
		const ids = Array.from(new Set(parts.map(Number)));
		if (ids.length > MAX_ASSETS) return setFormError(`At most ${MAX_ASSETS} assets at a time.`);
		if (await confirm(`Let this experience use ${ids.length} asset${ids.length === 1 ? "" : "s"}?`, `${ids.join(", ")}${deps ? "\n\nTheir dependencies are granted too (Roblox does that in the background)." : ""}`, "Grant", false)) grant.mutate(ids);
	}

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">Asset permissions</Txt>
			<Txt variant="small">Let this experience use audio, meshes or other assets that you or your groups manage.</Txt>
			{canWrite ? (
				<>
					<Field value={text} onChangeText={setText} placeholder="Asset IDs, e.g. 1234567, 7654321" keyboardType="numbers-and-punctuation" />
					<SwitchRow label="Include dependencies" hint="Also grant the assets these ones use (e.g. a model's meshes)." value={deps} onChange={setDeps} />
					<Button title="Grant use" small icon="key-outline" loading={grant.isPending} onPress={onGrant} style={{ alignSelf: "flex-start" }} />
					{formError ? (
						<Txt variant="small" color={p.destructive}>
							{formError}
						</Txt>
					) : null}
				</>
			) : (
				<Txt variant="small">Needs asset-permissions:write on your API key.</Txt>
			)}
		</Card>
	);
}
