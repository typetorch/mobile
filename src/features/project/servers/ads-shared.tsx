/** Small pieces the Ads screens share: enum labels and the delivery status badge. */
import { Badge } from "@/components/ui";
import type { Tone } from "@/theme";

import type { DeliveryStatus } from "../api/servers";

const SPECIAL: Record<string, string> = {
	AGE_13_17: "13-17",
	AGE_18_24: "18-24",
	AGE_25_PLUS: "25+",
	ANZ: "Australia & NZ",
	ROW: "Rest of world",
	UAC: "UAC",
	QPP_AUTO_PAUSED: "Auto paused",
	ROBUX_SPEND: "Robux spend",
};

/** "NOT_SERVING" -> "Not serving". */
export function label(value: string | null | undefined): string {
	if (!value) return "";
	if (SPECIAL[value]) return SPECIAL[value]!;
	const t = value.toLowerCase().replace(/_/g, " ");
	return t.charAt(0).toUpperCase() + t.slice(1);
}

const DELIVERY_TONE: Record<DeliveryStatus, Tone> = { SERVING: "good", IN_REVIEW: "brand", NOT_SERVING: "muted", REJECTED: "critical" };

export function DeliveryBadge({ status }: { status: DeliveryStatus | undefined }) {
	if (!status) return null;
	return <Badge label={label(status)} tone={DELIVERY_TONE[status] ?? "muted"} />;
}
