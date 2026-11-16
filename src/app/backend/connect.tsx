/**
 * Connect a TypeTorch backend (or sign in to one again with ?reauth=<id>): the address, then a browser sign-in (PKCE)
 * or the admin token once, then which experience it belongs to (from /v1/auth/check's universeId, else /v1/place,
 * else the person picks).
 */
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { createApi } from "@/api/backend";
import { deviceLabel, isDevRedirect, isUnencrypted, loginOptions, normalizeBackendUrl, signInWithAdminToken, signInWithBrowser, UNENCRYPTED_HINT, type MobileToken } from "@/api/backend-auth";
import { ProjectRow } from "@/components/ProjectRow";
import { Button, Card, confirm, Field, Icon, List, Screen, Section, Txt } from "@/components/ui";
import { useProjects } from "@/features/project/projects";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

interface Pending {
	url: string;
	token: MobileToken;
	name: string;
	version?: string;
	universeId: number | null;
}

/** What the backend says about itself with the new token. */
async function describe(url: string, token: MobileToken): Promise<Pending> {
	const api = createApi({ base: url, token: token.token });
	// /v1/auth/check always carries game: { universeId, label } on backends with mobile tokens.
	const check = (await api.authCheck()) as Awaited<ReturnType<typeof api.authCheck>> & { game?: { universeId?: number | string | null; label?: string | null } | null };
	let universeId = check.game?.universeId ? Number(check.game.universeId) : null;
	let name = check.game?.label || url.replace(/^https?:\/\//, "");
	try {
		const place = await api.place();
		if (place.configured) {
			universeId = universeId ?? place.universeId;
			name = place.name ?? name;
		}
	} catch {
		// older backend without /v1/place
	}
	return { url, token, name, version: check.version, universeId: universeId && Number.isFinite(universeId) ? universeId : null };
}

export default function ConnectBackend() {
	const p = useTheme();
	const { reauth, url: linkUrl } = useLocalSearchParams<{ reauth?: string; url?: string }>();
	const { backends, addBackend, replaceToken } = useAccounts();
	const existing = backends.find((b) => b.id === reauth) ?? null;
	const projects = useProjects();
	const [url, setUrl] = useState(existing?.url ?? (typeof linkUrl === "string" ? linkUrl : ""));
	const [adminToken, setAdminToken] = useState("");
	const [showToken, setShowToken] = useState(false);
	const [busy, setBusy] = useState<"browser" | "token" | "save" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<Pending | null>(null);
	const [manualId, setManualId] = useState("");
	const [hint, setHint] = useState<string | null>(null);
	/** null: unknown yet; false: the backend has no browser sign-in (hide the button). */
	const [mobileLogin, setMobileLogin] = useState<boolean | null>(null);
	const devRedirect = isDevRedirect();
	let plainHttp = false;
	try {
		plainHttp = !!url.trim() && isUnencrypted(normalizeBackendUrl(url));
	} catch {
		// not a usable address yet
	}

	// Ask the backend which sign-ins it offers once the address looks complete.
	useEffect(() => {
		let base: string;
		try {
			base = normalizeBackendUrl(url);
		} catch {
			return;
		}
		if (!/\.[a-z]{2,}|localhost|:\d+/i.test(base)) return;
		let stale = false;
		const t = setTimeout(() => {
			loginOptions(base)
				.then((o) => !stale && setMobileLogin(o.mobileLogin))
				.catch(() => !stale && setMobileLogin(null));
		}, 600);
		return () => {
			stale = true;
			clearTimeout(t);
		};
	}, [url]);

	async function finish(next: Pending) {
		if (existing) {
			// One write: a separate updateBackend after this would build on the list from before the token changed.
			await replaceToken(existing.id, next.token, !existing.universeId && next.universeId ? { universeId: next.universeId } : {});
			router.replace(`/tt/${existing.id}`);
			return;
		}
		const dup = backends.find((b) => b.url === next.url);
		if (dup) {
			await replaceToken(dup.id, next.token);
			router.replace(`/tt/${dup.id}`);
			return;
		}
		const account = await addBackend(next.url, next.token, { name: next.name, universeId: next.universeId, version: next.version });
		router.replace(`/tt/${account.id}`);
	}

	async function run(kind: "browser" | "token") {
		setError(null);
		setHint(null);
		setBusy(kind);
		try {
			const base = normalizeBackendUrl(url);
			let token: MobileToken;
			if (kind === "browser") {
				const r = await signInWithBrowser(base);
				if ("cancelled" in r) {
					// Closed, or (Expo Go) the backend refused the exp:// redirect: point at the admin token.
					if (r.hint) {
						setHint(r.hint);
						setShowToken(true);
					}
					return;
				}
				token = r.token;
			} else {
				// The admin token is full admin on the backend: never send it in the clear without asking.
				if (
					isUnencrypted(base) &&
					!(await confirm("Send the admin token unencrypted?", `${base} is http://: anyone on this network can read the admin token. Only continue on a network you trust.`, "Send anyway"))
				)
					return;
				token = await signInWithAdminToken(base, adminToken);
			}
			setAdminToken("");
			const info = await describe(base, token);
			if (info.universeId || existing?.universeId) await finish(info);
			else setPending(info);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(null);
		}
	}

	async function pick(universeId: number) {
		if (!pending) return;
		setBusy("save");
		try {
			await finish({ ...pending, universeId });
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(null);
		}
	}

	if (pending) {
		return (
			<Screen>
				<Stack.Screen options={{ title: "Which experience?" }} />
				<Card style={{ gap: 6 }}>
					<Txt variant="h3">Signed in to {pending.name}</Txt>
					<Txt variant="muted">The backend didn't say which experience it serves. Pick it so its dashboard opens from that project.</Txt>
				</Card>
				<Card style={{ gap: 8 }}>
					<Field label="Universe ID" value={manualId} onChangeText={setManualId} keyboardType="number-pad" placeholder="e.g. 1234567890" />
					<View style={{ flexDirection: "row", gap: 8 }}>
						<Button title="Use this ID" variant="brand" disabled={!/^\d+$/.test(manualId.trim())} loading={busy === "save"} onPress={() => pick(Number(manualId.trim()))} />
						<Button title="Skip for now" variant="ghost" onPress={() => finish(pending)} />
					</View>
				</Card>
				{projects.data?.all.length ? (
					<Section title="Your experiences">
						<List>
							{projects.data.all.map((x) => (
								<ProjectRow key={x.universeId} project={x} hasBackend={false} onPress={() => pick(x.universeId)} />
							))}
						</List>
					</Section>
				) : null}
				{error ? <Txt color={p.destructive}>{error}</Txt> : null}
			</Screen>
		);
	}

	return (
		<Screen>
			<Stack.Screen options={{ title: existing ? `Sign in to ${existing.name}` : "Connect a backend" }} />
			<Card style={{ gap: 10 }}>
				<Field label="Backend address" value={url} onChangeText={setUrl} placeholder="https://typetorch.mygame.com" keyboardType="url" editable={!existing} />
				<Txt variant="small">This device will appear as “{deviceLabel()}” in the backend's sessions.</Txt>
				{plainHttp ? (
					<View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
						<Icon name="warning-outline" size={15} color={p.warning} />
						<Txt variant="small" color={p.warning} style={{ flex: 1 }}>
							{UNENCRYPTED_HINT}
						</Txt>
					</View>
				) : null}
			</Card>

			{devRedirect ? (
				<>
			<Card style={{ gap: 10 }}>
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Icon name="key-outline" size={18} />
					<Txt variant="h3">Use the admin token</Txt>
				</View>
				<Txt variant="muted">Paste the backend's admin token once. The app trades it for its own device token and forgets the admin token right away.</Txt>
				{showToken ? (
					<>
						<Field value={adminToken} onChangeText={setAdminToken} placeholder="Admin token" secureTextEntry autoComplete="off" />
						<Button title="Connect" icon="link-outline" loading={busy === "token"} disabled={!url.trim() || !adminToken.trim() || !!busy} onPress={() => run("token")} />
					</>
				) : (
					<Button title="Paste the admin token" icon="clipboard-outline" onPress={() => setShowToken(true)} />
				)}
			</Card>
			{mobileLogin === false ? null : (
			<Card style={{ gap: 10 }}>
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Icon name="globe-outline" size={18} />
					<Txt variant="h3">Sign in with the browser</Txt>
				</View>
				<Txt variant="muted">Opens the backend's sign-in page (Roblox or typetorch.dev). Your role there (admin or viewer) carries over to the app.</Txt>
				{devRedirect ? <Txt variant="small" color={p.warning}>In Expo Go this needs TYPETORCH_MOBILE_DEV_REDIRECTS=on on the backend; otherwise use the admin token.</Txt> : null}
				<Button title="Sign in" variant="brand" icon="log-in-outline" loading={busy === "browser"} disabled={!url.trim() || !!busy} onPress={() => run("browser")} />
			</Card>
			)}
				</>
			) : (
				<>
			{mobileLogin === false ? null : (
			<Card style={{ gap: 10 }}>
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Icon name="globe-outline" size={18} />
					<Txt variant="h3">Sign in with the browser</Txt>
				</View>
				<Txt variant="muted">Opens the backend's sign-in page (Roblox or typetorch.dev). Your role there (admin or viewer) carries over to the app.</Txt>
				{devRedirect ? <Txt variant="small" color={p.warning}>In Expo Go this needs TYPETORCH_MOBILE_DEV_REDIRECTS=on on the backend; otherwise use the admin token.</Txt> : null}
				<Button title="Sign in" variant="brand" icon="log-in-outline" loading={busy === "browser"} disabled={!url.trim() || !!busy} onPress={() => run("browser")} />
			</Card>
			)}
			<Card style={{ gap: 10 }}>
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Icon name="key-outline" size={18} />
					<Txt variant="h3">Use the admin token</Txt>
				</View>
				<Txt variant="muted">Paste the backend's admin token once. The app trades it for its own device token and forgets the admin token right away.</Txt>
				{showToken ? (
					<>
						<Field value={adminToken} onChangeText={setAdminToken} placeholder="Admin token" secureTextEntry autoComplete="off" />
						<Button title="Connect" icon="link-outline" loading={busy === "token"} disabled={!url.trim() || !adminToken.trim() || !!busy} onPress={() => run("token")} />
					</>
				) : (
					<Button title="Paste the admin token" icon="clipboard-outline" onPress={() => setShowToken(true)} />
				)}
			</Card>
				</>
			)}
			{mobileLogin === false ? <Txt variant="small">This backend has no browser sign-in for the app; use the admin token.</Txt> : null}
			{hint ? (
				<Card style={{ borderColor: `${p.warning}88` }}>
					<Txt color={p.warning}>{hint}</Txt>
				</Card>
			) : null}
			{error ? (
				<Card style={{ borderColor: `${p.destructive}66` }}>
					<Txt color={p.destructive} selectable>
						{error}
					</Txt>
				</Card>
			) : null}
		</Screen>
	);
}
