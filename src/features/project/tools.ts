/**
 * The project's Tools tab: every Creator Hub page the app has, grouped like Creator Hub's sidebar. Each entry opens
 * /project/<universeId>/<route>; `scopes` are what its main (read) view needs, `writeScopes` what its actions need
 * (from Roblox's OpenAPI document, x-roblox-scopes). The tab shows a "Needs …" badge when the key lacks `scopes` for
 * this experience; the screen itself names the scope again if a call answers 401 / 403.
 */
import type { IconName } from "@/components/ui";

export interface ToolEntry {
	key: string;
	title: string;
	icon: IconName;
	description: string;
	/** Route under /project/<universeId>/ (may carry a query string). */
	route: string;
	scopes: string[];
	writeScopes?: string[];
	/** Opens without a key (public data). */
	publicRead?: boolean;
}

export interface ToolSection {
	title: string;
	tools: ToolEntry[];
}

export const TOOL_SECTIONS: ToolSection[] = [
	{
		title: "Configure",
		tools: [
			{ key: "configure", title: "Experience settings", icon: "settings-outline", description: "Name, description, devices, voice, private servers, social links, public / private.", route: "configure", scopes: [], writeScopes: ["universe:write", "universe.place:write", "legacy-universe:manage"] },
			{ key: "places", title: "Places", icon: "map-outline", description: "Every place: details, server size, version history, notes.", route: "places", scopes: [], publicRead: true, writeScopes: ["universe.place:write"] },
			{ key: "team", title: "Collaboration", icon: "people-outline", description: "Team Create, active editors, Team Test servers.", route: "team", scopes: ["legacy-team-collaboration:manage"] },
			{ key: "activity", title: "Activity history", icon: "time-outline", description: "Group audit log: who changed what.", route: "activity", scopes: ["legacy-group:manage"] },
			{ key: "luau", title: "Run Luau", icon: "code-slash-outline", description: "Run a script against a place (headless) and read its output.", route: "luau", scopes: ["universe.place.luau-execution-session:write"] },
			{ key: "instances", title: "Place instances", icon: "git-network-outline", description: "Browse a saved place's instance tree and properties.", route: "instances", scopes: ["universe.place.instance:read"], writeScopes: ["universe.place.instance:write"] },
		],
	},
	{
		title: "Monetization",
		tools: [
			{ key: "monetization", title: "Passes, products & badges", icon: "pricetag-outline", description: "Lists, prices, sale state, price optimization; create and edit with icons; asset permissions.", route: "monetization", scopes: [], publicRead: true, writeScopes: ["game-pass:write", "developer-product:write", "legacy-universe.badge:write", "legacy-universe.badge:manage-and-spend-robux", "legacy-badge:manage", "asset-permissions:write"] },
			{ key: "player", title: "Player lookup", icon: "person-circle-outline", description: "A player's passes, badges, subscription, ban status, profile and past names.", route: "player", scopes: [], publicRead: true },
		],
	},
	{
		title: "Engagement",
		tools: [
			{ key: "events", title: "Events", icon: "calendar-outline", description: "Virtual events: list, create, edit, delete.", route: "events", scopes: ["universe.event:read"], writeScopes: ["universe.event:write"] },
			{ key: "notifications", title: "Notifications", icon: "notifications-outline", description: "Notification strings: create, edit, archive, test-send; analytics.", route: "notifications", scopes: ["universe.notification-string:read"], writeScopes: ["universe.notification-string:write", "user.user-notification:write", "universe.analytics:read"] },
			{ key: "thumbnails", title: "Icon & thumbnails", icon: "images-outline", description: "Icon and thumbnails per language: upload, order, alt text; homepage personalization.", route: "thumbnails", scopes: [], publicRead: true, writeScopes: ["legacy-universe:manage", "universe.thumbnail:read", "universe.thumbnail:write"] },
			{ key: "localization", title: "Localization", icon: "language-outline", description: "Languages, automatic translation, translated name and description, items, localization table, translator and text to speech.", route: "localization", scopes: [], publicRead: true, writeScopes: ["legacy-universe:manage", "legacy-game-pass:manage", "legacy-developer-product:manage", "legacy-badge:manage", "developer-product:read", "universe:write", "asset:read", "asset:write"] },
		],
	},
	{
		title: "Analytics",
		tools: [
			{ key: "dashboards", title: "Custom dashboards", icon: "grid-outline", description: "Your Creator Hub custom dashboards: tiles, pin, add charts, edit, delete.", route: "dashboards", scopes: ["universe.analytics.dashboard:read"], writeScopes: ["universe.analytics.dashboard:write"] },
			{ key: "alerts", title: "Alerts", icon: "alarm-outline", description: "Analytics alerts, what fired; create, mute, edit, delete.", route: "alerts", scopes: ["universe.analytics.alert:read"], writeScopes: ["universe.analytics.alert:write"] },
			{ key: "errors", title: "Error report", icon: "bug-outline", description: "Find errors by keyword or hash, stack traces; grouping rules.", route: "errors", scopes: ["universe.analytics:read"], writeScopes: ["universe.analytics:write"] },
			{ key: "experiments", title: "Experiments", icon: "flask-outline", description: "A/B experiments: create, start, schedule, complete; sample size.", route: "experiments", scopes: ["universe:read"], writeScopes: ["universe:write"] },
			{ key: "configs", title: "Configs", icon: "options-outline", description: "Experience configs: values, draft, publish, history, restore.", route: "configs", scopes: ["universe:read"], writeScopes: ["universe:write"] },
		],
	},
	{
		title: "Data",
		tools: [
			{ key: "datastores", title: "Data stores", icon: "server-outline", description: "Stores, keys, entries, versions, snapshot; edit, create, delete.", route: "datastores", scopes: ["universe-datastores.objects:list"], writeScopes: ["universe-datastores.objects:update", "universe-datastores.objects:create", "universe-datastores.objects:delete", "universe-datastores.control:snapshot", "universe-datastores.control:delete"] },
			{ key: "ordered", title: "Ordered data stores", icon: "podium-outline", description: "Leaderboards: entries by value; edit, increment, delete.", route: "ordered", scopes: ["universe.ordered-data-store.scope.entry:read"], writeScopes: ["universe.ordered-data-store.scope.entry:write"] },
			{ key: "memory", title: "Memory stores", icon: "flash-outline", description: "Sorted maps and queues; edit, add, remove, flush.", route: "memory", scopes: [], writeScopes: ["memory-store.sorted-map:read", "memory-store.sorted-map:write", "memory-store.queue:add", "memory-store.queue:dequeue", "memory-store.queue:discard", "memory-store:flush", "memory-store:get"] },
			{ key: "secrets", title: "Secrets", icon: "lock-closed-outline", description: "Secrets for HttpService: list, add, update, delete.", route: "secrets", scopes: ["universe.secret:read"], writeScopes: ["universe.secret:write"] },
		],
	},
	{
		title: "Servers & moderation",
		tools: [
			{ key: "servers", title: "Servers", icon: "hardware-chip-outline", description: "Running servers: version, players, FPS, memory, logs.", route: "servers", scopes: ["universe:read"] },
			{ key: "restart", title: "Restart servers", icon: "refresh-circle-outline", description: "Restart with forecast, bleed-off and version filter; history.", route: "restart", scopes: ["universe:read"], writeScopes: ["universe:write"] },
			{ key: "messaging", title: "Messaging", icon: "megaphone-outline", description: "Publish a MessagingService message to live servers.", route: "messaging", scopes: ["universe-messaging-service:publish"] },
			{ key: "bans", title: "Bans", icon: "ban-outline", description: "User restrictions: list, check, ban and unban (experience or place), logs.", route: "bans", scopes: ["universe.user-restriction:read"], writeScopes: ["universe.user-restriction:write"] },
		],
	},
	{
		title: "Account",
		tools: [
			{ key: "ads", title: "Ads", icon: "trending-up-outline", description: "Ad campaigns: delivery, pause, budget.", route: "ads", scopes: ["ad.campaign:read"], writeScopes: ["ad.campaign:write"] },
			{ key: "extended", title: "Extended services", icon: "card-outline", description: "Extended services eligibility, budget, bills.", route: "extended", scopes: ["extended-services:read"], writeScopes: ["extended-services:write"] },
		],
	},
];

export const ALL_TOOLS: ToolEntry[] = TOOL_SECTIONS.flatMap((s) => s.tools);
