/**
 * Every Open Cloud feature in the app and the scopes it needs (from Roblox's OpenAPI document, x-roblox-scopes,
 * 2026-11). Settings shows which are missing; the project's Tools tab hides or explains the ones the key can't use.
 */
import { hasScope, type KeyInfo } from "@/api/opencloud";
import type { IconName } from "@/components/ui";

export interface Feature {
	key: string;
	title: string;
	icon: IconName;
	description: string;
	/** All needed (read path). */
	scopes: string[];
	/** Extra scopes for the write actions inside it (shown, not required). */
	writeScopes?: string[];
}

export const FEATURES: Feature[] = [
	{ key: "analytics", title: "Analytics", icon: "stats-chart-outline", description: "Creator Hub charts: DAU, retention, revenue, sessions.", scopes: ["universe.analytics:read"] },
	{
		key: "datastores",
		title: "Data stores",
		icon: "server-outline",
		description: "List stores and keys, read entries and their versions.",
		scopes: ["universe-datastores.control:list", "universe-datastores.objects:list", "universe-datastores.objects:read"],
		writeScopes: ["universe-datastores.versions:list", "universe-datastores.objects:update", "universe-datastores.objects:delete"],
	},
	{ key: "ordered", title: "Ordered data stores", icon: "podium-outline", description: "Leaderboards: entries by value.", scopes: ["universe.ordered-data-store.scope.entry:read"] },
	{ key: "memory", title: "Memory stores", icon: "flash-outline", description: "Sorted maps and queues (read only).", scopes: ["memory-store.sorted-map:read"], writeScopes: ["memory-store.queue:dequeue"] },
	{ key: "messaging", title: "Messaging", icon: "megaphone-outline", description: "Publish a MessagingService message to live servers.", scopes: ["universe-messaging-service:publish"] },
	{ key: "restart", title: "Restart servers", icon: "refresh-circle-outline", description: "Shut down every server so they restart on the latest version.", scopes: ["universe:write"] },
	{ key: "bans", title: "Bans", icon: "ban-outline", description: "User restrictions: list, ban and unban, logs.", scopes: ["universe.user-restriction:read"], writeScopes: ["universe.user-restriction:write"] },
	{ key: "products", title: "Developer products", icon: "pricetag-outline", description: "Product names, prices, sale state.", scopes: ["developer-product:read"] },
	{ key: "passes", title: "Game passes", icon: "ticket-outline", description: "Passes with prices (public list without the scope).", scopes: ["game-pass:read"] },
];

export function featureByKey(key: string): Feature | undefined {
	return FEATURES.find((f) => f.key === key);
}

export function missingScopes(info: KeyInfo | null | undefined, scopes: string[], universeId?: number): string[] {
	return scopes.filter((s) => !hasScope(info, s, universeId));
}

export function featureReady(info: KeyInfo | null | undefined, feature: Feature, universeId?: number): boolean {
	return missingScopes(info, feature.scopes, universeId).length === 0;
}
