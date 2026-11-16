import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";

import { isUnencrypted } from "@/api/backend-auth";
import type { BackendAccount } from "@/store/accounts";
import { Badge, Button, Dot, EmptyState, Icon, List, Row, Screen, Section, Txt } from "@/components/ui";
import { daysLeft } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

function host(url: string): string {
	return url.replace(/^https?:\/\//, "");
}

function BackendRow({ b }: { b: BackendAccount }) {
	const p = useTheme();
	const { backendApi } = useAccounts();
	const api = backendApi(b.id);
	const check = useQuery({ queryKey: ["tt", b.id, "check"], queryFn: ({ signal }) => (api as NonNullable<typeof api>).authCheck(signal), enabled: !!api && !b.signedOut, staleTime: 60_000 });
	const left = daysLeft(b.expiresAt);
	const tone = b.signedOut || check.error ? "critical" : check.data ? "good" : "muted";
	return (
		<Row
			onPress={() => router.push(b.signedOut ? `/backend/connect?reauth=${b.id}` : `/tt/${b.id}`)}
			chevron
			left={
				<View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
					<Icon name="flame" size={18} color={p.brand} />
				</View>
			}
			title={
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<Dot tone={tone} />
					<Txt style={{ fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>
						{b.name}
					</Txt>
					<Badge label={b.role} tone={b.role === "admin" ? "brand" : "muted"} />
					{isUnencrypted(b.url) ? <Badge label="not encrypted" tone="warning" /> : null}
				</View>
			}
			subtitle={
				b.signedOut
					? "Signed out: tap to sign in again"
					: check.error
						? (check.error as Error).message
						: `${host(b.url)} · ${b.universeId ? `universe ${b.universeId}` : "no universe"} · token ${left >= 0 ? `${left} d left` : "expired"}`
			}
		/>
	);
}

export default function BackendsScreen() {
	const { backends } = useAccounts();
	return (
		<Screen>
			{backends.length ? (
				<Section title="Connected backends">
					<List>
						{backends.map((b) => (
							<BackendRow key={b.id} b={b} />
						))}
					</List>
				</Section>
			) : (
				<EmptyState
					icon="flame-outline"
					title="No TypeTorch backend yet"
					body="Connect your game's TypeTorch backend to get its full dashboard here: live servers, deploys, errors and more. Sign in through the browser, or paste the admin token once."
				/>
			)}
			<Button title="Connect a TypeTorch backend" variant="brand" icon="add" onPress={() => router.push("/backend/connect")} />
			<Txt variant="small" style={{ textAlign: "center" }}>
				The app keeps a device token per backend (30–90 days, refreshed automatically). Revoke it any time from the backend's Settings.
			</Txt>
		</Screen>
	);
}
