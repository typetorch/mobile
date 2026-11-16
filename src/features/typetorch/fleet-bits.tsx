/**
 * Fleet pieces shared by the Fleet and server screens (ports of the web's components/HealthReasons.tsx and
 * components/ServerLocation.tsx): why a server needs a look (the backend's `reasons` as short lines, a health badge
 * that opens them on a tap), where it is (country code, place, network) and the IP database's credit line.
 */
import * as Linking from "expo-linking";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { FleetServer, GeoStatus, HealthReason, ServerLocation } from "@/api/tt/types";
import { Dot, Txt } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { radius, useTheme, type Tone } from "@/theme";

import { Sheet } from "./sheet";

/** The health words the kernel sends, plus "failing" from older backends. Colour never carries the meaning alone. */
export const HEALTH_TONE: Record<string, Tone> = { ok: "good", degraded: "warning", unverified: "warning", failed: "critical", failing: "critical" };

const num = (v: number | string) => (typeof v === "number" ? fmtNum(v, Number.isInteger(v) ? 0 : 1) : v);
const withUnit = (v: number | string, unit: string | null) => (unit ? `${num(v)} ${unit}` : num(v));

/** One reason as a short line: "TPS 42.5, under 50", "Memory 3,400 MB, over 3,000 MB", "Kernel health degraded". */
export function reasonText(r: HealthReason): string {
	if (r.signal === "health") return `Kernel health ${r.value}`;
	if (r.signal === "heartbeat") return `Last heartbeat ${withUnit(r.value, r.unit)} ago, over ${withUnit(r.threshold, r.unit)}`;
	const word = r.op === "<" ? "under" : r.op === ">" ? "over" : "not";
	const unit = r.unit === r.label ? null : r.unit;
	return `${r.label} ${withUnit(r.value, unit)}, ${word} ${withUnit(r.threshold, unit)}`;
}

/** The lines for a server: its reasons, then the kernel's last error when the kernel's health is one of them. */
export function reasonLines(s: Pick<FleetServer, "reasons" | "lastError">): string[] {
	const reasons = s.reasons ?? [];
	const lines = reasons.map(reasonText);
	if (s.lastError && reasons.some((r) => r.signal === "health")) lines.push(`Last error: ${s.lastError}`);
	return lines;
}

/** The reasons as a short list (the server screen and the badge's sheet). */
export function ReasonList({ lines }: { lines: string[] }) {
	return (
		<View style={{ gap: 4 }}>
			{lines.map((line) => (
				<View key={line} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
					<View style={{ marginTop: 6 }}>
						<Dot tone="warning" size={6} />
					</View>
					<Txt style={{ flex: 1 }} selectable>
						{line}
					</Txt>
				</View>
			))}
		</View>
	);
}

/** The health word with its dot; with reasons, a tap opens them (the web's popover). */
export function HealthBadge({ server }: { server: Pick<FleetServer, "health" | "reasons" | "lastError"> }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	const word = server.health ?? "unknown";
	const lines = reasonLines(server);
	const badge = (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
			<Dot tone={HEALTH_TONE[word] ?? "muted"} />
			<Txt variant="small" color={p.foreground} style={lines.length ? { textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>
				{word}
			</Txt>
		</View>
	);
	if (!lines.length) return badge;
	return (
		<>
			<Pressable onPress={() => setOpen(true)} hitSlop={6} accessibilityLabel={`${word}: ${lines.length === 1 ? "1 reason" : `${lines.length} reasons`}, show why`}>
				{badge}
			</Pressable>
			<Sheet open={open} onClose={() => setOpen(false)} title={`Why it is ${word}`}>
				<ReasonList lines={lines} />
			</Sheet>
		</>
	);
}

/** "Sterling, Virginia" (the place under the country), or null. */
export function placeText(loc: ServerLocation | null | undefined): string | null {
	if (!loc) return null;
	const parts = [loc.city, loc.region].filter((x): x is string => !!x && x.length > 0);
	const unique = parts.filter((x, i) => parts.indexOf(x) === i);
	return unique.length ? unique.join(", ") : null;
}

/** One line: "Sterling, Virginia, US", "Japan", or "–". */
export function locationText(loc: ServerLocation | null | undefined): string {
	if (!loc) return "–";
	const place = placeText(loc);
	if (place) return loc.country ? `${place}, ${loc.country}` : place;
	return loc.countryName ?? loc.country ?? "–";
}

/** "AS22697 Roblox", or null. */
export function networkText(loc: ServerLocation | null | undefined): string | null {
	if (!loc || (loc.asn === null && !loc.org)) return null;
	return [loc.asn !== null ? `AS${loc.asn}` : null, loc.org].filter(Boolean).join(" ");
}

export function CountryCode({ code }: { code: string | null | undefined }) {
	const p = useTheme();
	if (!code) return <Txt variant="small">–</Txt>;
	return (
		<View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.sm, paddingHorizontal: 3 }}>
			<Txt variant="mono" style={{ fontSize: 10, fontWeight: "600" }}>
				{code}
			</Txt>
		</View>
	);
}

/** The country chip and the place: "[US] Sterling, Virginia". */
export function LocationLabel({ location }: { location: ServerLocation | null | undefined }) {
	if (!location) return <Txt variant="small">unknown</Txt>;
	const place = placeText(location);
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
			<CountryCode code={location.country} />
			<Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
				{place ?? location.countryName ?? ""}
			</Txt>
		</View>
	);
}

/** The credit line (DB-IP's licence asks for it where its data is shown); nothing for a source that needs none. */
export function GeoCredit({ geo }: { geo: GeoStatus | null | undefined }) {
	const p = useTheme();
	if (!geo || geo.state !== "ready" || !geo.attribution) return null;
	return (
		<Txt variant="small">
			Locations are approximate.{" "}
			{geo.attributionUrl ? (
				<Text style={{ color: p.brand, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(geo.attributionUrl as string)}>
					{geo.attribution}
				</Text>
			) : (
				geo.attribution
			)}
			{geo.attributionUrl?.includes("db-ip.com") ? " (CC BY 4.0)." : "."}
		</Txt>
	);
}

export interface CountryCount {
	country: string;
	countryName: string | null;
	servers: number;
	players: number;
	places: string[];
}

/** Servers by country, most first ("??" for servers with no known location). */
export function countryCounts(servers: readonly FleetServer[]): CountryCount[] {
	const out = new Map<string, CountryCount & { placeCounts: Map<string, number> }>();
	for (const s of servers) {
		const code = s.location?.country ?? "??";
		const row = out.get(code) ?? { country: code, countryName: s.location?.countryName ?? (code === "??" ? "Unknown" : null), servers: 0, players: 0, places: [], placeCounts: new Map<string, number>() };
		row.servers++;
		row.players += s.players ?? 0;
		const place = placeText(s.location);
		if (place) row.placeCounts.set(place, (row.placeCounts.get(place) ?? 0) + 1);
		out.set(code, row);
	}
	return [...out.values()]
		.map(({ placeCounts, ...row }) => ({ ...row, places: [...placeCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([x]) => x) }))
		.sort((a, b) => b.servers - a.servers || a.country.localeCompare(b.country));
}
