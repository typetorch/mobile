# Creator Hub parity (phone app)

What Creator Hub (create.roblox.com/dashboard) shows for an experience, which API serves it, and whether the phone app has it. The app only has the user's Open Cloud **API key** (sent only to apis.roblox.com) and Roblox's public no-auth web APIs, so anything that needs a browser cookie or OAuth is "no API" here.

Sources: Roblox's OpenAPI document (github.com/Roblox/creator-docs `content/en-us/reference/cloud/openapi.json`, 2026-11-16: 1029 operations, 370 usable with an API key), create.roblox.com/docs, and the app's code. Scopes are the doc's `x-roblox-scopes`; when a call answers 401/403 the app names the scope it needs (`ScopeError` in `src/api/opencloud.ts`, `CloudError` in `src/features/project/CloudError.tsx`).

**Totals:** 37 were in the app before, 148 added now, 5 available but not in the app, 23 with no API-key or public API.

Where things are: Projects tab (list); a project's **Overview / Analytics / Tools** tabs; every Tools entry is in `src/features/project/tools.ts` and opens `/project/<universeId>/<route>` (`src/app/project/[universeId]/`). API calls: `src/api/opencloud.ts`, `src/api/roblox-public.ts`, `src/features/project/api/*.ts`.

## No API (why)

- **Analytics > Insights: Insights page (auto-detected large changes)**: The OpenAPI document has no endpoint for it (the inventory marks it no_api).
- **Configure > Basic settings: Maturity / content questionnaire (ageRating)**: The questionnaire exists only on Creator Hub. The rating is shown read-only on the configure screen
- **Configure > Access: Friends-only / playtesters / audiences / archive experience**: Needs a browser cookie; no API-key endpoint
- **Configure > Basic settings: Edit genre, paid access price, Studio API access, allow copying, third-party teleports/sales, regions opt-in**: Needs a browser cookie (develop configuration). The values are shown read-only on the Overview
- **Configure > Avatar: Avatar settings (R6/R15, scales, animation, collision, body parts overrides)**: Needs a browser cookie. The avatar type is shown read-only on the Overview
- **Collaborators / Permissions: List and add collaborators (user experiences), group role permissions for the experience**: No endpoint. The configure screen shows the key owner's own permission check (canManage/canCloudEdit)
- **Collaboration > Playtesters: Playtester list / add / remove**: Needs a browser cookie; no API-key endpoint
- **Activity history: Activity history for user-owned experiences**: No endpoint
- **Places: Create a new experience or add a new place to an experience; delete a place**: No endpoint (noted on the Places screen)
- **Collaborators / Group payouts: Recurring revenue split (percentage payouts) for a group-owned experience**: Needs a browser cookie; no API-key endpoint
- **Analytics > Error report: Error report list (grouped client/server errors with counts and trends)**: I checked again in this pass: the OpenAPI doc has no error-report list or aggregate endpoint, and the Query API has no error-count metric. errors.tsx explains that errors are found by keyword or message hash.
- **Monetization > Private servers: Private server stats and list**: Needs a cookie
- **Monetization > Passes: Delete a game pass**: There is no DELETE endpoint. Turning the pass off sale is offered instead.
- **Monetization > Developer products: Delete a developer product**: There is no DELETE endpoint. Turning the product off sale is offered instead.
- **Monetization > Subscriptions: List, create or edit subscription products**: Creator Hub only
- **Badges: Delete a badge**: There is no delete endpoint. Disabling, with a confirm, is offered instead.
- **Monetization > Revenue: Sales / transaction log and revenue summary**: Needs a cookie
- **Monetization > Creator Rewards / Premium payouts: Creator Rewards, Premium payouts, legacy developer stats**: Needs a cookie
- **Server management > Servers: Shut down a single server / launch update via matchmaking (Creator Hub 'Shut down' on one instance)**: The matchmaking-api endpoints are cookie-only. As the closest option, server.tsx offers 'Restart this version's servers', which opens the restart screen pre-filled.
- **Matchmaking: Matchmaking configuration (scoring configs and signal weights, player/server attributes, start place, feature flags)**: Cookie-only endpoints with no x-roblox-scopes.
- **Localization > Translators: Translator roles (assign/revoke localization roles)**: Cookie only (status no_api in the inventory).
- **Home > Projects list: List the user's PRIVATE / unpublished universes**: Only the cookie endpoint develop /v1/user/universes lists every private universe a user owns. All the workarounds are wired in: key-introspection ids, ids added by hand, the develop v1 group lists, ads advertisable ids, and the develop multiget plus GET /cloud/v2/universes/{id} fallback in resolveProjects.
- **Monetization > Private servers: Private server stats (active servers, active subscriptions) and the list of private servers**: Cookie only.

## Available but not in the app

- **Data stores (v1, legacy): Standard data stores v1**: Cloud v2 replaces it, and v1 has nothing v2 lacks. v1 matchVersion maps to the v2 etag, exclusiveCreate to v2 POST create, the versions time range to the v2 revision filter plus @latest:<time>, and content-md5 is only part of the v1 wire format.
- **Places > Publish: Publish or save a new place version from an .rbxl/.rbxlx file**: Needs a document picker (expo-document-picker), which isn't installed, and adding packages isn't allowed. Downloading a version through Asset Delivery and posting it back isn't a workaround: POST /universes/v1/.../versions takes a binary body and the doc marks it firstPartyOAuthOnly. Rollback already covers restoring an older version
- **Luau execution: Upload binary input for a Luau task**: Needs a file picker (expo-document-picker), which isn't installed, and adding packages isn't allowed
- **Collaborators / Group payouts: Group payout-visible universes, suggested one-time payouts and latest payouts per user**: These economy.roblox.com endpoints need a browser cookie (unauthenticated calls return 404/403) and have no API-key route
- **Followings: Follow/unfollow an experience; list followed universes for the key owner**: Excluded from this package: the configure agent owns Followings.

## Every item

### Home > Projects list

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List the user's own public experiences | ✅ in app (before) | GET /v2/users/{userId}/games [public, host games.roblox.com] | src/api/roblox-public.ts userGames(); src/features/project/projects.ts useProjects() |
| List the user's PRIVATE / unpublished universes | ⛔ no API | GET /v1/user/universes [cookie only, develop.roblox.com] | Only the cookie endpoint develop /v1/user/universes lists every private universe a user owns. All the workarounds are wired in: key-introspection ids, ids added by hand, the develop v1 group lists, ads advertisable ids, and the develop multiget plus GET /clou… |
| Universes named by the API key (introspection) | ✅ in app (before) | POST /api-keys/v1/introspect [no scope; key goes in body {apiKey}] (not in the OpenAPI doc; documented on create.roblox.com/docs/cloud/auth/api-keys) | src/features/project/projects.ts resolveProjects(), section subtitles in useProjects() |
| Add an experience by universe id or place id | ✅ in app (before) | GET /universes/v1/places/{placeId}/universe [public, apis.roblox.com; not in OpenAPI doc] | src/app/(tabs)/index.tsx addExperience()/saveUniverse()/universeName() |
| List the user's groups with their role/rank (for group games) | ✅ in app (new) | GET /cloud/v2/groups/{group_id}/memberships [no scope; API key; BETA] | src/features/project/projects.ts loadGroups(); src/app/(tabs)/index.tsx GroupRow |
| Groups the key owner can manage (instead of a min-rank guess) | ✅ in app (new) | GET /legacy-develop/v1/user/groups/canmanage [legacy-group:manage] | src/features/project/projects.ts loadGroups() |
| Group experiences (public) | ✅ in app (before) | GET /v2/groups/{groupId}/gamesV2 [public, host games.roblox.com] | src/api/roblox-public.ts groupGames(); src/features/project/projects.ts harvestGroup() |
| Group universes including archived/private flags | ✅ in app (new) | GET /v1/groups/{groupId}/universes [public or cookie, host develop.roblox.com] | src/api/roblox-public.ts groupUniverses(); src/components/ProjectRow.tsx; src/app/(tabs)/index.tsx Chips + GroupRow |
| Universe status for ids the key names (privacy/archived/active) and whether the user can manage them | ✅ in app (new) | GET /v1/universes/multiget [public, develop.roblox.com]<br>GET /legacy-develop/v1/universes/multiget/permissions [legacy-universe:manage] | src/api/roblox-public.ts developUniverses/cloudUniverse/universePermissions; src/features/project/projects.ts resolveProjects() |
| Universes the ads billing account can advertise (extra source of owned universe ids) | ✅ in app (new) | GET /ads-management/v1/advertisable-universes [ad.campaign:read] | src/api/roblox-public.ts advertisableUniverses(); src/features/project/projects.ts useProjects() |
| Created-places inventory of a user | ✅ in app (new) | GET /v1/users/{userId}/places/inventory [public or cookie, inventory.roblox.com] | src/api/roblox-public.ts userCreatedPlaces(); src/features/project/projects.ts useProjects() |

### Overview

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Headline stats: playing now, visits, favorites, like ratio | ✅ in app (before) | GET /v1/games [public, games.roblox.com]<br>GET /v1/games/votes [public, games.roblox.com] | src/features/project/OverviewTab.tsx |
| Icon and banner thumbnail | ✅ in app (before) | GET /v1/games/icons [public, thumbnails.roblox.com]<br>GET /v1/games/multiget/thumbnails [public, thumbnails.roblox.com] | src/features/project/OverviewTab.tsx |
| Public servers of the root place | ✅ in app (before) | GET /v1/games/{placeId}/servers/{serverType} [public, games.roblox.com] | src/features/project/OverviewTab.tsx |
| Details from public games v1: genre, paid access price, avatar type, copying allowed, Studio API access, private servers allowed | ✅ in app (new) | GET /v1/games [public, games.roblox.com] | src/features/project/OverviewTab.tsx (Details card); gameDetailFull() in src/features/project/api/configure.ts |

### Overview / Configure

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Edit experience name and description | ✅ in app (new) | PATCH /cloud/v2/universes/{universeId}/places/{placeId} [universe.place:write] | /project/[universeId]/configure (Name and description): PATCH on the root place with ?updateMask=displayName,description. Checks length (name 1-50, description up to 1000) and shows a Team Create message on 409 |

### Configure > Access

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Edit playable devices (desktop, mobile, tablet, console, VR) | ✅ in app (new) | PATCH /cloud/v2/universes/{universeId} [universe:write] | /project/[universeId]/configure (Devices and voice chat): the updateMask lists only changed fields, at least one device must stay on, and turning a device off asks first |
| Friends-only / playtesters / audiences / archive experience | ⛔ no API | GET /v1/universes/{universeId}/configuration/playtesters [cookie only, develop.roblox.com]<br>PATCH /v2/universes/{universeId}/configuration [cookie only, develop.roblox.com] | Needs a browser cookie; no API-key endpoint |
| Ban / restrict players for one place (place-level user restrictions) | ✅ in app (new) | GET /cloud/v2/universes/{universe_id}/places/{place_id}/user-restrictions [universe.user-restriction:read]<br>PATCH /cloud/v2/universes/{universe_id}/places/{place_id}/user-restrictions/{user_restriction_id} [universe.user-restriction:write] | src/features/project/configure/PlaceBans.tsx on the place screen: list (inherited bans marked 'experience'), ban form (asks first), unban (asks first). User lookups now use their own query key [users,byId,ids], which fixes a crash when bans.tsx had cached a d… |

### Configure > Access / Overview status

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Make public / private (activate / deactivate universe) | ✅ in app (new) | POST /legacy-develop/v1/universes/{universeId}/activate [legacy-universe:manage]<br>POST /legacy-develop/v1/universes/{universeId}/deactivate [legacy-universe:manage] | /project/[universeId]/configure (Status): legacy-develop activate/deactivate, asks first; the canManage/canCloudEdit permission check is also shown |

### Configure > Avatar

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Avatar settings (R6/R15, scales, animation, collision, body parts overrides) | ⛔ no API | GET /v1/universes/{universeId}/configuration [cookie only, develop.roblox.com]<br>PATCH /v2/universes/{universeId}/configuration [cookie only] | Needs a browser cookie. The avatar type is shown read-only on the Overview |

### Configure > Basic settings

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| View universe settings: visibility, maturity/ageRating, devices, voice chat, private server price | ✅ in app (before) | GET /cloud/v2/universes/{universeId} [no scope listed; API key] | OverviewTab Details; also shown on /project/[universeId]/configure |
| View social links (Discord, YouTube, Twitter/X, Twitch, Facebook, Guilded, Roblox group) | ✅ in app (new) | GET /cloud/v2/universes/{universeId} [API key] | /project/[universeId]/configure (Social links) |
| Edit social links | ✅ in app (new) | PATCH /cloud/v2/universes/{universeId} [universe:write] | /project/[universeId]/configure: Add/Edit per link (PATCH updateMask=<field>, body {field:{title,uri}}, https check). Remove puts the field in the mask, leaves it out of the body and asks first |
| Maturity / content questionnaire (ageRating) | ⛔ no API | GET /cloud/v2/universes/{universeId} [API key] | The questionnaire exists only on Creator Hub. The rating is shown read-only on the configure screen |
| Edit genre, paid access price, Studio API access, allow copying, third-party teleports/sales, regions opt-in | ⛔ no API | PATCH /v2/universes/{universeId}/configuration [cookie only, develop.roblox.com] | Needs a browser cookie (develop configuration). The values are shown read-only on the Overview |

### Configure > Communication

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Toggle voice chat | ✅ in app (new) | PATCH /cloud/v2/universes/{universeId} [universe:write] | /project/[universeId]/configure (updateMask=voiceChatEnabled) |

### Configure > Icon

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| View icon(s) with moderation state; upload or delete an icon per language | ✅ in app (new) | GET /legacy-game-internationalization/v1/game-icon/games/{gameId} [legacy-universe:manage]<br>POST /legacy-game-internationalization/v1/game-icon/games/{gameId}/language-codes/{languageCode} [legacy-universe:manage]<br>DELETE /legacy-game-internationalization/v1/game-icon/games/{gameId}/language-codes/{languageCode} [legacy-universe:manage] | src/app/project/[universeId]/thumbnails.tsx (IconSection: per-language icons with a state badge; 'Upload a language's icon' with language chips, POST .../game-icon/games/{id}/language-codes/{code} multipart, confirm that says Replace when one exists; delete a… |

### Configure > Thumbnails

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List all experience thumbnails and videos with approval state | ✅ in app (new) | GET /v2/games/{universeId}/media [public, games.roblox.com]<br>GET /v1/games/{universeId}/thumbnails [public, thumbnails.roblox.com] | src/app/project/[universeId]/thumbnails.tsx (MediaSection; games v2 media + thumbnails v1) |
| Upload, delete, reorder thumbnails and set alt text (per language; source language = main thumbnails) | ✅ in app (new) | POST /legacy-game-internationalization/v1/game-thumbnails/games/{gameId}/language-codes/{languageCode}/image [legacy-universe:manage]<br>DELETE /legacy-game-internationalization/v1/game-thumbnails/games/{gameId}/language-codes/{languageCode}/images/{imageId} [legacy-universe:manage]<br>POST /legacy-game-internationalization/v1/game-thumbnails/games/{gameId}/language-codes/{languageCode}/images/or… | src/app/project/[universeId]/thumbnails.tsx (LocalizedSection: 'Add <language> thumbnails' uploads through POST .../game-thumbnails/games/{id}/language-codes/{code}/image (multipart 'Files', one request per file, multi-select, 10-per-set cap, confirm, then in… |

### Places

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List places of the universe | ✅ in app (before) | GET /v1/universes/{universeId}/places [public, develop.roblox.com] | OverviewTab Places; also /project/[universeId]/places, which falls back to the root place from Open Cloud when the public list is empty |
| Create a new experience or add a new place to an experience; delete a place | ⛔ no API | – | No endpoint (noted on the Places screen) |

### Places / Servers

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Restart servers with forecast, bleed-off and version filter; restart status | ✅ in app (new) | GET /server-management/v1/universes/{universeId}/restarts:forecast [universe:read]<br>POST /server-management/v1/universes/{universeId}/restarts [universe:write]<br>GET /server-management/v1/universes/{universeId}/restarts [universe:read] | /project/[universeId]/restart (restart.tsx; api/servers.ts forecastRestart, launchRestart, listRestarts) |

### Places / Team Create

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Team Create on/off, remove member, active session members, close team test | ✅ in app (new) | GET /legacy-develop/v1/universes/{universeId}/teamcreate [legacy-team-collaboration:manage]<br>PATCH /legacy-develop/v1/universes/{universeId}/teamcreate [legacy-team-collaboration:manage]<br>DELETE /legacy-develop/v1/universes/{universeId}/teamcreate/memberships [legacy-team-collaboration:manage]<br>GET /legacy-develop/v1/places/{placeId}/teamcreate/active_session/members [legacy-team-collaborat… | /project/[universeId]/team |

### Places / Version history

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Revert a place to an earlier version (rollback) and publish place content through the Assets API | ✅ in app (new) | GET /assets/v1/assets/{assetId}/versions [asset:read]<br>POST /assets/v1/assets/{assetId}/versions:rollback [asset:write]<br>PATCH /assets/v1/assets/{assetId} [asset:write] | Place screen version row: Revert -> POST /assets/v1/assets/{placeId}/versions:rollback, asks first |

### Places > Configure

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| View place details (name, description, server size, root, created/updated) | ✅ in app (new) | GET /cloud/v2/universes/{universeId}/places/{placeId} [API key] | /project/[universeId]/place?placeId= (opened from Overview place rows and the Places screen) |
| Edit place name, description, server size | ✅ in app (new) | PATCH /cloud/v2/universes/{universeId}/places/{placeId} [universe.place:write] | /project/[universeId]/place: PATCH with an updateMask of the changed fields. Checks name 1-50, description up to 1000, server size 1-700; Team Create message on 409 |

### Places > Publish

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Publish or save a new place version from an .rbxl/.rbxlx file | ⚠️ available, not in app | POST /universes/v1/{universeId}/places/{placeId}/versions [universe-places:write] | Needs a document picker (expo-document-picker), which isn't installed, and adding packages isn't allowed. Downloading a version through Asset Delivery and posting it back isn't a workaround: POST /universes/v1/.../versions takes a binary body and the doc mark… |

### Places > Version history

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List place versions (published/saved, notes, contributors) | ✅ in app (new) | GET /place-version-history-api/v1/{placeId}/history [universe.place:read]<br>GET /place-version-history-api/v1/{placeId}/contributors [universe.place:read] | src/features/project/configure/VersionHistory.tsx on the place screen: paging, filters, search, contributor chips. Contributor names now use their own query key [users,names,ids] (fixes the cache clash with bans.tsx and server.tsx) |
| Edit a version's notes (title/description) | ✅ in app (new) | POST /place-version-history-api/v1/{placeId}/version/{version}/notes [universe.place:write] | Place screen: tap a version, then POST .../version/{v}/notes |

### Collaboration > Playtesters

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Playtester list / add / remove | ⛔ no API | GET /v1/universes/{universeId}/configuration/playtesters [cookie only]<br>POST /v1/universes/{universeId}/configuration/playtesters [cookie only]<br>DELETE /v1/universes/{universeId}/configuration/playtesters [cookie only] | Needs a browser cookie; no API-key endpoint |

### Collaboration > Team Create / Team Test

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Team Create status and active session members | ✅ in app (new) | GET /legacy-develop/v1/universes/{universeId}/teamcreate [legacy-team-collaboration:manage]<br>GET /legacy-develop/v1/universes/multiget/teamcreate?ids= [legacy-team-collaboration:manage]<br>GET /legacy-develop/v1/places/{placeId}/teamcreate/active_session/members [legacy-team-collaboration:manage] | /project/[universeId]/team (status switch, who is in Studio per place, with headshots) |
| Enable/disable Team Create, remove a collaborator membership | ✅ in app (new) | PATCH /legacy-develop/v1/universes/{universeId}/teamcreate [legacy-team-collaboration:manage]<br>DELETE /legacy-develop/v1/universes/{universeId}/teamcreate/memberships [legacy-team-collaboration:manage] | /project/[universeId]/team: PATCH {isEnabled} and DELETE memberships {userId}, both ask first |
| Close a running Team Test server | ✅ in app (new) | DELETE /legacy-develop/v2/teamtest/{placeId}?gameId={jobGuid} [legacy-team-collaboration:manage] | /project/[universeId]/team: checks the game id is a GUID, then DELETE /legacy-develop/v2/teamtest/{placeId}?gameId=, asks first |

### Collaborators / Group payouts

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Recurring revenue split (percentage payouts) for a group-owned experience | ⛔ no API | GET /v1/universes/{universeId}/payouts [cookie only, economy] | Needs a browser cookie; no API-key endpoint |
| Group payout-visible universes, suggested one-time payouts and latest payouts per user | ⚠️ available, not in app | GET /v1/groups/{groupId}/payouts/universes [public or cookie]<br>GET /v1/groups/{groupId}/payouts/suggested [public or cookie]<br>GET /v1/groups/{groupId}/payouts/latest [public or cookie] | These economy.roblox.com endpoints need a browser cookie (unauthenticated calls return 404/403) and have no API-key route |

### Collaborators / Permissions

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List and add collaborators (user experiences), group role permissions for the experience | ⛔ no API | – | No endpoint. The configure screen shows the key owner's own permission check (canManage/canCloudEdit) |

### Activity history

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Experience activity / audit history (who changed settings, published or saved places, created passes/badges/products) | ✅ in app (new) | GET /legacy-groups/v1/groups/{groupId}/audit-log [legacy-group:manage] | /project/[universeId]/activity (group audit log, actionType chips, This experience / Whole group, paging) |
| Activity history for user-owned experiences | ⛔ no API | – | No endpoint |

### Luau execution

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Run a Luau script against a place (or a specific place version) and see output/logs | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}/places/{place_id}/luau-execution-session-tasks [universe.place.luau-execution-session:write]<br>POST /cloud/v2/universes/{universe_id}/places/{place_id}/versions/{version_id}/luau-execution-session-tasks [universe.place.luau-execution-session:write]<br>GET /cloud/v2/universes/{universe_id}/places/{place_id}/versions/{version_id}/luau-execution-sessions/{luau… | /project/[universeId]/luau: bounded polling with an overall deadline, structured logs. Fix pass: a failed log read is no longer turned into an empty list. The run shows 'Couldn't load the logs: <cloudErrorText>' with a Retry button instead of 'Nothing printed… |
| Upload binary input for a Luau task | ⚠️ available, not in app | POST /cloud/v2/universes/{universe_id}/luau-execution-session-task-binary-inputs [universe.place.luau-execution-session:write] | Needs a file picker (expo-document-picker), which isn't installed, and adding packages isn't allowed |

### Place instances

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Browse a place's instance tree (DataModel) and read properties | ✅ in app (new) | GET /cloud/v2/universes/{universe_id}/places/{place_id}/instances/{instance_id} [universe.place.instance:read]<br>GET /cloud/v2/universes/{universe_id}/places/{place_id}/instances/{instance_id}:listChildren [universe.place.instance:read]<br>GET /cloud/v2/universes/{universe_id}/places/{place_id}/instances/{instance_id}/operations/{operation_id} | /project/[universeId]/instances. Fix pass: listChildren starts at maxPageSize 200. When the Operation fails with 422 (over the 500,000-byte limit), it retries the same page at 50, then 10, then 1. The size that worked is kept for the next page, because the do… |
| Edit an instance (e.g. change a Script's source) in the saved place | ✅ in app (new) | PATCH /cloud/v2/universes/{universe_id}/places/{place_id}/instances/{instance_id}?updateMask=... [universe.place.instance:write] | Instances screen ScriptEditor: edits Source (checked against the 200,000-byte UTF-8 limit) and Enabled, asks before overwriting, polls the operation |

### Monetization > Creator Rewards / Premium payouts

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Creator Rewards, Premium payouts, legacy developer stats | ⛔ no API | GET /v2/users/{userId}/transaction-totals [cookie only] (fields premiumPayouts, groupPremiumPayouts, ...; transaction types EngagementPayout, CreatorRewardsPayout, PrivateServerEngagementPayout, AdsRevsharePayout)<br>GET /v1/universes/{universeId}/stats?Type=PremiumUpsells\\|PremiumVisits [cookie only, develop.roblox.com] | Needs a cookie |

### Monetization > Developer products

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Create a developer product | ✅ in app (new) | POST /developer-products/v2/universes/{universeId}/developer-products [developer-product:write] | /project/[universeId]/product?id=new |
| Update a developer product (name, description, icon, price, for sale, store page, regional/managed pricing) | ✅ in app (new) | PATCH /developer-products/v2/universes/{universeId}/developer-products/{productId} [developer-product:write]<br>GET /developer-products/v2/universes/{universeId}/developer-products/{productId}/creator [developer-product:read] | /project/[universeId]/product?id=<id> |
| Delete a developer product | ⛔ no API | – | There is no DELETE endpoint. Turning the product off sale is offered instead. |

### Monetization > Passes

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Create a game pass | ✅ in app (new) | POST /game-passes/v1/universes/{universeId}/game-passes [game-pass:write] | /project/[universeId]/pass?id=new (ItemEditor.tsx, IconPicker in monetization/shared.tsx) |
| Update a game pass (name, description, icon, price, for sale, regional/managed pricing) | ✅ in app (new) | PATCH /game-passes/v1/universes/{universeId}/game-passes/{gamePassId} [game-pass:write]<br>GET /game-passes/v1/universes/{universeId}/game-passes/{gamePassId}/creator [game-pass:read] | /project/[universeId]/pass?id=<id> |
| Delete a game pass | ⛔ no API | – | There is no DELETE endpoint. Turning the pass off sale is offered instead. |

### Monetization > Price optimization / Regional pricing

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| See and toggle price optimization and regional pricing per pass and product | ✅ in app (new) | PATCH /game-passes/v1/universes/{universeId}/game-passes/{gamePassId} [game-pass:write]<br>PATCH /developer-products/v2/universes/{universeId}/developer-products/{productId} [developer-product:write] | monetization.tsx, pass.tsx, product.tsx |

### Monetization > Private servers

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| View private server price / enabled | ✅ in app (before) | GET /cloud/v2/universes/{universeId} [API key]<br>GET /v1/private-servers/enabled-in-universe/{universeId} [public, games.roblox.com] | OverviewTab.tsx, configure.tsx |
| Enable/disable private servers and set their price | ✅ in app (before) | PATCH /cloud/v2/universes/{universeId} [universe:write] | src/app/project/[universeId]/configure.tsx (linked from monetization.tsx) |
| Private server stats and list | ⛔ no API | PATCH /cloud/v2/universes/{universeId} [universe:write] | Needs a cookie |
| Private server stats (active servers, active subscriptions) and the list of private servers | ⛔ no API | GET /v1/universes/{universeId}/configuration/vip-servers [cookie only]<br>GET /v1/games/{placeId}/private-servers [cookie only] | Cookie only. |

### Monetization > Revenue

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Sales / transaction log and revenue summary | ⛔ no API | GET /v2/users/{userId}/transactions [cookie only]<br>GET /v2/users/{userId}/transaction-totals [cookie only]<br>GET /v2/groups/{groupId}/transactions [cookie only]<br>GET /v1/groups/{groupId}/revenue/summary/{timeFrame} [cookie only] | Needs a cookie |

### Monetization > Subscriptions

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List, create or edit subscription products | ⛔ no API | – | Creator Hub only |
| Look up one player's subscription status | ✅ in app (new) | GET /cloud/v2/universes/{universe_id}/subscription-products/{subscription_product_id}/subscriptions/{subscription_id} [universe:write OR universe.subscription-product.subscription:read] | /project/[universeId]/player (PlayerLookup.tsx SubscriptionCheck) |

### Associated items / Badges

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List badges with icon, enabled state and stats | ✅ in app (before) | GET /v1/universes/{universeId}/badges [public, badges.roblox.com]<br>GET /v1/badges/icons [public, thumbnails.roblox.com] | monetization.tsx Badges tab (rows open badge.tsx) |

### Associated items / Monetization > Developer products

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List developer products with price and sale state | ✅ in app (before) | GET /developer-products/v2/universes/{universeId}/developer-products/creator [developer-product:read] | monetization.tsx |

### Associated items / Monetization > Passes

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List game passes with price, sale state, private passes | ✅ in app (before) | GET /game-passes/v1/universes/{universeId}/game-passes/creator [game-pass:read] | monetization.tsx (shows price optimization and regional pricing badges; rows open the editor) |

### Badges

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Create a badge (costs Robux after the free daily quota) | ✅ in app (new) | POST /legacy-badges/v1/universes/{universeId}/badges [legacy-universe.badge:manage-and-spend-robux]<br>GET /v1/universes/{universeId}/free-badges-quota [public, badges.roblox.com]<br>GET /v1/badges/metadata [public, badges.roblox.com] | /project/[universeId]/badge?id=new (BadgeEditor.tsx) |
| Update a badge: name, description, enable/disable | ✅ in app (new) | PATCH /legacy-badges/v1/badges/{badgeId} [legacy-universe.badge:write] | /project/[universeId]/badge?id=<id> |
| Replace a badge icon | ✅ in app (new) | POST /legacy-game-internationalization/v1/badges/{badgeId}/icons/language-codes/{languageCode} [legacy-badge:manage]<br>POST /legacy-publish/v1/badges/{badgeId}/icon [legacy-badge:manage] | /project/[universeId]/badge?id=<id> (BadgeEditor.tsx BadgeIcon) |
| Delete a badge | ⛔ no API | – | There is no delete endpoint. Disabling, with a confirm, is offered instead. |

### Assets / Permissions

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Grant the experience permission to use assets | ✅ in app (new) | PATCH /asset-permissions-api/v1/assets/permissions [asset-permissions:write] | monetization.tsx 'Asset permissions' card (AssetPermissions.tsx) |

### Moderation > Bans

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List active bans (universe-wide) | ✅ in app (before) | GET /cloud/v2/universes/{universe_id}/user-restrictions [universe.user-restriction:read] | bans.tsx |
| Ban / unban a user (duration, display + private reason, alt accounts) | ✅ in app (before) | PATCH /cloud/v2/universes/{universe_id}/user-restrictions/{user_restriction_id}?updateMask=gameJoinRestriction [universe.user-restriction:write] | bans.tsx |
| Ban history logs (who banned whom, when, by script or user) | ✅ in app (before) | GET /cloud/v2/universes/{universe_id}/user-restrictions:listLogs [universe.user-restriction:read] | bans.tsx Log |
| Check one user's ban status | ✅ in app (new) | GET /cloud/v2/universes/{universe_id}/user-restrictions/{user_restriction_id} [universe.user-restriction:read] | bans.tsx 'Check a player' (also bans?user=<id>) |
| Place-level bans (list / get / ban-unban in one place only) | ✅ in app (new) | GET /cloud/v2/universes/{universe_id}/places/{place_id}/user-restrictions [universe.user-restriction:read]<br>GET /cloud/v2/universes/{universe_id}/places/{place_id}/user-restrictions/{user_restriction_id} [universe.user-restriction:read]<br>PATCH /cloud/v2/universes/{universe_id}/places/{place_id}/user-restrictions/{user_restriction_id} [universe.user-restriction:write] | bans.tsx 'Where' picker |

### Moderation > Users

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| User lookup (by id or username, avatar headshot) | ✅ in app (before) | POST https://users.roblox.com/v1/users (public)<br>POST https://users.roblox.com/v1/usernames/users (public)<br>GET https://users.roblox.com/v1/users/{userId} (public)<br>GET https://thumbnails.roblox.com/v1/users/avatar-headshot (public) | bans.tsx; reused in player.tsx |
| Open Cloud user profile (premium, ID-verified, locale, social links) | ✅ in app (new) | GET /cloud/v2/users/{user_id} [user.advanced:read, user.social:read for extra fields] | /project/[universeId]/player |
| Check whether a player owns a game pass / has a badge / owns an asset | ✅ in app (new) | GET /v1/users/{userId}/items/{itemType}/{itemTargetId}/is-owned [public, inventory.roblox.com]<br>GET /cloud/v2/users/{user_id}/inventory-items [API key; user.inventory-item:read only for private inventories] | /project/[universeId]/player |
| Username history of a player | ✅ in app (new) | GET /v1/users/{userId}/username-history [public, users.roblox.com] | /project/[universeId]/player |

### Engagement > Audio / TTS

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Generate an English speech (text-to-speech) audio asset for the experience | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}:generateSpeechAsset [universe:write + asset:read + asset:write]<br>GET /assets/v1/operations/{operationId} [asset:write] | src/features/project/engagement/TextTools.tsx |

### Engagement > Events

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List virtual events of the experience | ✅ in app (new) | GET /virtual-events/v3/universes/{universeId}/game-events [universe.event:read] | src/app/project/[universeId]/events.tsx |
| View one event | ✅ in app (new) | GET /virtual-events/v3/game-events/{eventId} [universe.event:read] | src/app/project/[universeId]/event.tsx?id= |
| Create an event | ✅ in app (new) | POST /virtual-events/v3/universes/{universeId}/game-events [universe.event:write] | src/app/project/[universeId]/event.tsx?new=1 |
| Update an event | ✅ in app (new) | PATCH /virtual-events/v3/game-events/{eventId} [universe.event:write] | src/app/project/[universeId]/event.tsx |
| Delete an event | ✅ in app (new) | DELETE /virtual-events/v3/game-events/{eventId} [universe.event:write] | src/app/project/[universeId]/event.tsx (confirm) |

### Engagement > Notifications

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List experience notification strings | ✅ in app (new) | GET /notifications/v1/developer-configuration/experience-notifications-list [universe.notification-string:read] | src/app/project/[universeId]/notifications.tsx |
| View one notification string | ✅ in app (new) | GET /notifications/v1/developer-configuration/experience-notification [universe.notification-string:read] | src/app/project/[universeId]/notification.tsx |
| Create a notification string | ✅ in app (new) | POST /notifications/v1/developer-configuration/create-notification [universe.notification-string:write] | src/app/project/[universeId]/notifications.tsx |
| Update a notification string | ✅ in app (new) | POST /notifications/v1/developer-configuration/update-notification [universe.notification-string:write] | src/app/project/[universeId]/notification.tsx |
| Archive (delete) a notification string | ✅ in app (new) | POST /notifications/v1/developer-configuration/archive-notification [universe.notification-string:write] | src/app/project/[universeId]/notification.tsx |
| Notification analytics; send a test notification to a user | ✅ in app (new) | GET /notifications/v1/developer-analytics/get-notifs-analytics [universe.analytics:read]<br>POST /cloud/v2/users/{user_id}/notifications [user.user-notification:write] | notifications.tsx (Analytics) + notification.tsx (SendTest) |

### Engagement > Thumbnail personalization

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Homepage thumbnail pool: list, upload, delete, upload status | ✅ in app (new) | GET /thumbnail-personalization-api/v1/universes/{universeId}/thumbnails [universe.thumbnail:read]<br>POST /thumbnail-personalization-api/v1/universes/{universeId}/thumbnails/uploads [universe.thumbnail:write]<br>GET /thumbnail-personalization-api/v1/universes/{universeId}/thumbnails/uploads/status [universe.thumbnail:read]<br>DELETE /thumbnail-personalization-api/v1/universes/{universeId}/thumbna… | src/features/project/engagement/Personalization.tsx (thumbnails.tsx > Personalization tab: Upload button (multi-select, confirm) -> POST .../thumbnails/uploads with repeated 'files' parts; then GET .../thumbnails/uploads/status?operationIds=… polled at most 1… |
| Personalization configs: list (with stats), create (activate), update thumbnails | ✅ in app (new) | GET /thumbnail-personalization-api/v1/universes/{universeId}/personalization [universe.thumbnail:read]<br>POST /thumbnail-personalization-api/v1/universes/{universeId}/personalization/create [universe.thumbnail:write]<br>POST /thumbnail-personalization-api/v1/universes/{universeId}/personalization/update [universe.thumbnail:write] | src/features/project/engagement/Personalization.tsx |

### Localization

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Translate arbitrary text with Roblox's translator | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}:translateText [universe:write] | src/features/project/engagement/TextTools.tsx (localization.tsx > Translate & speech) |

### Localization > Automatic translation

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Automatic and image translation status per language; toggle | ✅ in app (new) | GET /legacy-game-internationalization/v1/supported-languages/games/{gameId}/automatic-translation-status [legacy-universe:manage]<br>PATCH /legacy-game-internationalization/v1/supported-languages/games/{gameId}/languages/{languageCode}/automatic-translation-status [legacy-universe:manage]<br>PATCH /legacy-game-internationalization/v1/supported-languages/games/{gameId}/languages/{languageCode}/ima… | src/features/project/engagement/Languages.tsx |

### Localization > Experience info

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Read the experience name and description in every language | ✅ in app (new) | GET /v1/name-description/games/{gameId} [public, gameinternationalization.roblox.com] | src/features/project/engagement/ExperienceInfo.tsx |
| Edit translated name/description; translation history | ✅ in app (new) | PATCH /legacy-game-internationalization/v1/name-description/games/{gameId} [legacy-universe:manage]<br>POST /legacy-game-internationalization/v1/name-description/games/translation-history [legacy-universe:manage] | src/features/project/engagement/ExperienceInfo.tsx + History.tsx |

### Localization > Languages

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| View supported languages and source language | ✅ in app (new) | GET /v1/supported-languages/games/{gameId} [public, gameinternationalization.roblox.com]<br>GET /v1/source-language/games/{gameId} [public, gameinternationalization.roblox.com] | src/features/project/engagement/Languages.tsx |
| Add/remove supported languages, set source language | ✅ in app (new) | PATCH /legacy-game-internationalization/v1/supported-languages/games/{gameId} [legacy-universe:manage]<br>PATCH /legacy-game-internationalization/v1/source-language/games/{gameId} [legacy-universe:manage] | src/features/project/engagement/Languages.tsx |

### Localization > Localization tables

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Auto-localization table: settings, entries, entry count, update entries, translation history | ✅ in app (new) | POST /legacy-localization-tables/v1/autolocalization/games/{gameId}/autolocalizationtable [legacy-universe:manage]<br>PATCH /legacy-localization-tables/v1/autolocalization/games/{gameId}/settings [legacy-universe:manage]<br>GET /legacy-localization-tables/v1/localization-table/tables/{tableId} [legacy-universe:manage]<br>GET /legacy-localization-tables/v1/localization-table/tables/{tableId}/entri… | src/features/project/engagement/LocalizationTable.tsx |

### Localization > Passes / Products / Badges

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Localized name, description and icon of game passes, developer products and badges (get, update, delete per language) | ✅ in app (new) | GET /legacy-game-internationalization/v1/game-passes/{gamePassId}/name-description [legacy-game-pass:manage]<br>PATCH /legacy-game-internationalization/v1/game-passes/{gamePassId}/name-description/language-codes/{languageCode} [legacy-game-pass:manage]<br>DELETE /legacy-game-internationalization/v1/game-passes/{gamePassId}/name-description/language-codes/{languageCode} [legacy-game-pass:manage]<b… | src/features/project/engagement/ItemLocalization.tsx (localization.tsx > Passes, products, badges) |

### Localization > Translators

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Translator roles (assign/revoke localization roles) | ⛔ no API | PATCH /v1/game-localization-roles/games/{gameId} [cookie only] | Cookie only (status no_api in the inventory). |

### Followings

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Follow/unfollow an experience; list followed universes for the key owner | ✅ in app (new) | GET /legacy-followings/v2/users/{userId}/universes [legacy-universe.following:read]<br>GET /legacy-followings/v1/users/{userId}/universes/{universeId}/status [legacy-universe.following:read]<br>POST /legacy-followings/v1/users/{userId}/universes/{universeId} [legacy-universe.following:write]<br>DELETE /legacy-followings/v1/users/{userId}/universes/{universeId} [legacy-universe.following:write] | OverviewTab: Follow/Following button (POST/DELETE followings for the key owner) and an 'Experiences you follow' list, shown when the key has the legacy-universe.following scopes |
| Follow/unfollow an experience; list followed universes for the key owner | ⚠️ available, not in app | GET /legacy-followings/v2/users/{userId}/universes [legacy-universe.following:read]<br>GET /legacy-followings/v1/users/{userId}/universes/{universeId}/status [legacy-universe.following:read]<br>POST /legacy-followings/v1/users/{userId}/universes/{universeId} [legacy-universe.following:write]<br>DELETE /legacy-followings/v1/users/{userId}/universes/{universeId} [legacy-universe.following:write] | Excluded from this package: the configure agent owns Followings. |

### Analytics > Acquisition

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Impression/qualified-play funnel (UniqueUsersWithImpressions, QualifiedUniqueUsersWithPlaySessions, QualifiedEndToEndCVR) | ✅ in app (before) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Acquisition |
| Rest of the acquisition funnel: ImpressionCVR, ClickCVR, EndToEndCVR, UniqueUsersWithClicks, UniqueUsersWithPlaySessions | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Acquisition: one card per metric, plus the Acquisition funnel view in analytics/views.tsx (impressions, clicks and plays as range totals, with step and end-to-end conversion) |

### Analytics > Acquisition > Home recommendations

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Home recommendation signals (RFY*) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Home recs: all RFY* metrics plus RFYPlayThroughRate, daily, by AgeGroupV2 and Gender. The first 4 load by themselves; the rest load on a tap. Fix pass: these daily-only metrics now cap ranges longer than 2 years to the last 730 days and show a… |

### Analytics > Ads (publisher / rewarded video)

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| In-experience ads publisher revenue and impressions | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Ads: all 6 AdsPublisherReporting* metrics |

### Analytics > Alerts

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List alert configurations (with firing status filter) | ✅ in app (new) | GET /analytics-alert-control-plane/v1/resource/{resourceType}/id/{resourceId}/alerts [universe.analytics.alert:read] | alerts.tsx: All/Firing/OK and severity filters, firing count. alert.tsx gets one alert through the list with ids=[id], because the API has no single-alert GET. |
| Alert incidents history (what fired, when, resolved) | ✅ in app (new) | GET /analytics-alert-control-plane/v1/resource/{resourceType}/id/{resourceId}/alerts/incidents [universe.analytics.alert:read] | alerts.tsx Incidents view (24 h / 7 d / 30 d) and the 30-day incidents on alert.tsx. Fix pass: startTime is now at most INCIDENT_MAX_MS back (30 days minus 10 minutes, in alerts-model.ts), so it stays inside Roblox's MaxQueryDays despite latency or clock skew. |
| Create an alert | ✅ in app (new) | POST /analytics-alert-control-plane/v1/resource/{resourceType}/id/{resourceId}/alerts [universe.analytics.alert:write] | alert.tsx without id + AlertForm.tsx: metric picker, any number of filters and breakdown entries (add/remove rows), per-metric dimension checks, name 1-128, consecutiveOccurrences >= 1, numeric threshold, offset only for PeriodOverPeriod, unique UUID receivers |
| Update / enable / disable an alert | ✅ in app (new) | PATCH /analytics-alert-control-plane/v1/resource/{resourceType}/id/{resourceId}/alerts/{alertId} [universe.analytics.alert:write] | alert.tsx Enable/Disable (PATCH configState; disabling confirms) and Edit. Fix pass: the form keeps the full filter[] and breakdown[] lists. Save sends only the changed fields, via alertPatch in alerts-model.ts, so filter and breakdown are left out unless edi… |
| Delete an alert | ✅ in app (new) | DELETE /analytics-alert-control-plane/v1/resource/{resourceType}/id/{resourceId}/alerts/{alertId} [universe.analytics.alert:write] | alert.tsx Delete (confirm) -> DELETE |

### Analytics > Analytics Home (multi-experience)

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Cross-experience summary (up to 9 games side by side) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Compare (analytics/Compare.tsx). Fix pass: a failed cell shows a red "error" badge, or "no access" for a missing scope. Tapping it opens an Alert with cloudErrorText (Roblox's message or the missing scope) and a Try again button that refetches. |

### Analytics > Audience

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Audience / demographics breakdowns | ✅ in app (before) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read]<br>POST /analytics-query-api/v1/universes/{universeId}/dimension-values [universe.analytics:read] | Breakdown chips on every card, plus a second dimension and filters |

### Analytics > Custom dashboards

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List custom dashboards (+ pinned, capabilities) | ✅ in app (new) | GET /analytics-custom-dashboards/v1/universes/{universeId}/custom-dashboards [universe.analytics.dashboard:read]<br>GET /analytics-custom-dashboards/v1/universes/{universeId}/custom-dashboards/pinned [universe.analytics.dashboard:read]<br>GET /analytics-custom-dashboards/v1/universes/{universeId}/custom-dashboards/capabilities [universe.analytics.dashboard:read] | dashboards.tsx: pageSize/pageToken paging, pinned first, capabilities and limits from the list response (the doc says these match GET /capabilities) |
| View one custom dashboard (render its tiles) | ✅ in app (new) | GET /analytics-custom-dashboards/v1/universes/{universeId}/custom-dashboards/{dashboardId} [universe.analytics.dashboard:read]<br>POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | dashboard.tsx + dashboard-model.ts + DashboardTile.tsx: every page and layout kind, chart/table/summary/tabbed/controlled tiles through cloud.queryMetric inside analyticsSlot, LineChart for lines, and only the first 6 tiles load automatically. Assumption: met… |
| Create / publish (edit) a custom dashboard | ✅ in app (new) | POST /analytics-custom-dashboards/v1/universes/{universeId}/custom-dashboards [universe.analytics.dashboard:write]<br>POST /analytics-custom-dashboards/v1/universes/{universeId}/custom-dashboards/{dashboardId}/publish [universe.analytics.dashboard:write]<br>POST /analytics-custom-dashboards/v1/universes/{universeId}/custom-dashboard-documents/validate [universe.analytics.dashboard:write] | Create on dashboards.tsx. On dashboard.tsx: add a chart tile, remove a tile, or edit the whole document as JSON, each validated, confirmed, then published with expectedHeadEtag. Fix pass: removeTile now also removes tiles inside a tabbedChart or tabbedTable (… |
| Rename / describe / pin-unpin a custom dashboard | ✅ in app (new) | PATCH /analytics-custom-dashboards/v1/universes/{universeId}/custom-dashboards/{dashboardId}/metadata [universe.analytics.dashboard:write] | dashboard.tsx Name & description form and Pin/Unpin, plus the pin buttons on dashboards.tsx (PATCH /metadata with expectedHeadEtag). Fix pass: name and description caps come from capabilities.limits (maxDashboardNameLength / maxDashboardDescriptionLength) and… |
| Delete a custom dashboard | ✅ in app (new) | POST /analytics-custom-dashboards/v1/universes/{universeId}/custom-dashboards/{dashboardId}/delete [universe.analytics.dashboard:write] | dashboard.tsx Delete (confirm) -> POST /{id}/delete {expectedHeadEtag}; hidden when capabilities.canDelete is false (fix pass) |

### Analytics > Custom events

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Custom events dashboard (counts/values per event name) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read]<br>POST /analytics-query-api/v1/universes/{universeId}/dimension-values [universe.analytics:read] | Analytics tab > Custom events: an optional CustomEventName picker, and all 7 CustomEvent* metrics |

### Analytics > Economy

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Economy dashboard: wallet balance, sources/sinks, transaction counts | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Economy. A currency picker (CurrencyType from dimension-values) filters every card: sources and sinks, average wallet balance, transaction count, and top items (ItemSku, top 25). |

### Analytics > Engagement

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| New user first-session retention (TotalSessionsEndedInBucket by SessionTimeBucket) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Engagement > "New users' first session" card. It opens as a range total by SessionTimeBucket, with bars in bucket order. Other dimensions and the U6 segments are available. Fix pass: when the person picks another breakdown, the bars are ranked… |

### Analytics > Error report

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Error report list (grouped client/server errors with counts and trends) | ⛔ no API | – | I checked again in this pass: the OpenAPI doc has no error-report list or aggregate endpoint, and the Query API has no error-count metric. errors.tsx explains that errors are found by keyword or message hash. |
| Error log details (message, stack trace, OS/platform, first seen version) by message hash or keyword | ✅ in app (new) | GET /universe-performance-raqi/v1/events/logging/universe/{universeId}/log-details [universe.analytics:read] | errors.tsx Find errors -> error.tsx detail (message, stack trace with copy, platform/OS, first seen) |

### Analytics > Error report > Grouping rules

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List error grouping regex rules (log attribute) | ✅ in app (new) | GET /log-attribute-http-service/v1/universe-regexes [universe.analytics:read] | errors.tsx Grouping rules tab (status chips, sorted by order, matched count, sample message) |
| Create / update / delete / ignore / reorder error grouping rules | ✅ in app (new) | POST /log-attribute-http-service/v1/universe-regexes [universe.analytics:write]<br>PUT /log-attribute-http-service/v1/universe-regexes/{id} [universe.analytics:write]<br>DELETE /log-attribute-http-service/v1/universe-regexes/{id} [universe.analytics:write]<br>PUT /log-attribute-http-service/v1/universe-regexes/{id}/ignore [universe.analytics:write] | errors.tsx: new rule, edit (PUT), Ignore (confirm), Up/Down reorder, Delete (confirm); the regex must compile and be at most 1000 characters |

### Analytics > Experiments

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| A/B experiments: list, view, results stats | ✅ in app (new) | GET /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments [universe:read]<br>GET /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments/{experimentId} [universe:read]<br>GET /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments/{experimentId}/stats [universe:read]<br>GET /creator-configs-public-api/v1/experimentati… | Same screens as Experimentation: experiments.tsx and experiment.tsx (the only stat is SRM, which is all the API returns) |
| A/B experiments: create, update, start, schedule, complete (pick winner), discard, MDE calculator | ✅ in app (new) | POST /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments [universe:write]<br>PATCH /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments/{experimentId} [universe:write]<br>POST /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments/{experimentId}:start [universe:write]<br>POST /creator-configs-public-api/v1/exper… | Same screens as Experimentation: experiment.tsx, plus the MDE calculator on experiments.tsx (now polls by re-sending POST calculateMde) |

### Analytics > Funnels

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Funnel dashboard (onboarding / progression / shop funnels) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read]<br>POST /analytics-query-api/v1/universes/{universeId}/dimension-values [universe.analytics:read] | Analytics tab > Funnels. The FunnelName picker is required. It covers all 10 Funnel* metrics; step metrics are range totals by FunnelStep in step order. Fix pass: step order applies only to the FunnelStep breakdown, and other breakdowns are ranked by value. |

### Analytics > Insights

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Insights page (auto-detected large changes) | ⛔ no API | – | The OpenAPI document has no endpoint for it (the inventory marks it no_api). |

### Analytics > Journeys

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Player journeys (stage/node transitions, churn, skips) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Journeys. The JourneyName picker is required. It covers all 24 Journey* metrics (granularity None). Fix pass: transitions (FromStage x ToStage, shown as 'A → B') and node metrics are now ranked by value, so the biggest stay in the first 25 bar… |

### Analytics > Matchmaking

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Matchmaking signal quality metrics | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Matchmaking: 8 built-in signals with Avg/P10/P50/P90, PreferredPlayerMatchRatioAvg, and the categorical and numeric custom signals. Granularity is chosen for the span after the 90-day retention cap. |

### Analytics > Monetization

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Revenue, ARPDAU, paying users, payer conversion, ARPPU | ✅ in app (before) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Monetization |
| Realtime Robux spent per product (ItemMonetizationRevenue) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Monetization. "Robux spent per product" is a range total by ProductKey (top 25; Top N can be changed). "Robux spent (realtime)" is an hourly or daily series by ProductType, SalesLocation and the other dimensions. |

### Analytics > Observability > Data stores

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Data store request/usage dashboard | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Data stores: all 16 DataStore* metrics by operation, status, store type and request source; storage shown in bytes |

### Analytics > Observability > Memory stores

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Memory store usage dashboard | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Memory stores: all 5 MemoryStore* metrics |

### Analytics > Overview / Dashboard

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Benchmarks (compare a metric vs genre / similar / top experiences percentiles) | ✅ in app (new) | POST /analytics-benchmark/v1/universes/{universeId}/benchmarks [universe.analytics:read] | Analytics tab > Benchmarks (analytics/Benchmarks.tsx), using POST /analytics-benchmark/v1/universes/{id}/benchmarks. Fix pass: a 429 now says the benchmark limit is 300 a minute, as the OpenAPI x-roblox-rate-limits says. Metric and dimension-value queries sti… |

### Analytics > Overview / Engagement

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Core engagement charts (DAU, MAU, PCU, playtime, sessions, stickiness) | ✅ in app (before) | – | Project screen > Analytics tab > Engagement (src/features/project/analytics.ts). It also takes the range, granularity, filter and breakdown controls. |
| Core engagement charts: DailyActiveUsers, MonthlyActiveUsers, PeakConcurrentPlayers, AveragePlayTimeMinutesPerDAU, TotalPlayTimeHours, Visits (Sessions), AverageSessionLengthMinutes, DauMauStickiness (7/28/90-day ranges, one breakdown at a time) | ✅ in app (before) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read]<br>GET /analytics-query-api/v1/universes/{universeId}/operations/metrics/{operationId} [universe.analytics:read] | src/features/project/analytics.ts (METRIC_GROUPS 'Engagement'), src/features/project/AnalyticsTab.tsx, src/api/opencloud.ts queryAnalyticsMetric |

### Analytics > Performance

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Performance charts (ServerFrameRateP50, ClientFpsP50, ClientCrashRate15m, ServerCrashCount) | ✅ in app (before) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Performance |
| Remaining client/server performance metrics (CPU, memory, FPS percentiles, OOM, session duration, API calls) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Performance: Avg/P10/P50/P90 variants for FPS, memory, session duration, CPU and server memory, plus ClientCrashCount, OomUnexpectedExits, ClientCpuTimeAvg, CpuCoreUtilization and RotraceTotalCalls. Fix pass: granularity is now chosen for the … |

### Analytics > Query options

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Granularity / date-range controls (hourly, weekly, monthly, total; custom range; >90 days) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab, top: preset or custom range (up to 1468 days) and a granularity picker. Fix pass (analytics.ts): the new effectiveSpanDays picks the granularity for the span after the retention cap. When none of a metric's granularities fits the span, the old … |
| Filters on charts and multi-dimension breakdown | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Each card's Options panel (FilterEditor in analytics/options.tsx): up to 5 validated filters, a "Then by" second dimension, and Top N (1-1000, Total plus a breakdown) |
| Dimension value lookup (list valid filter values / display names) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/dimension-values [universe.analytics:read]<br>GET /analytics-query-api/v1/universes/{universeId}/operations/dimension-values/{operationId} [universe.analytics:read] | "Look up values" in each filter row and the funnel, journey, event and currency pickers. It calls POST dimension-values and polls a bounded number of times (api/analytics-query.ts). |

### Analytics > Retention

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| D1/D7/D30 forward retention charts | ✅ in app (before) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Retention. Fix pass: over a custom range longer than 730 days these daily-only metrics now ask for the last 730 days and say so, instead of sending daily data over the whole span. |
| Cohort retention table (daily / weekly cohorts) | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Retention > Cohort retention (CohortTable in analytics/views.tsx). Daily cohorts use DailyCohortRetention by CohortDay; weekly cohorts use WeeklyCohortRetention by CohortWeek. It loads on a tap. Fix pass: the query covers only the latest 30 co… |

### Analytics > Safety

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Abuse reports dashboard | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Safety: TotalAbuseReports and UniqueAbuseReportSubmittersPer1000PlaytimeHours by AbuseCategory or AbuseChannel |

### Analytics > Thumbnails

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Thumbnail personalization / A-B results | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Thumbnails: all 6 Thumbnail* metrics by ThumbnailAsset or ThumbnailList. ThumbnailWinningSegments shows its stringValues. |

### Analytics > Voice/TTS

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Speech-to-text and text-to-speech usage | ✅ in app (new) | POST /analytics-query-api/v1/universes/{universeId}/metrics [universe.analytics:read] | Analytics tab > Voice: the STT and TTS usage, status and error metrics |

### Configs (Experience configs)

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| View published config and the draft for a repository | ✅ in app (new) | GET /creator-configs-public-api/v1/configs/universes/{universeId}/repositories/{repository} [universe:read]<br>GET /creator-configs-public-api/v1/configs/universes/{universeId}/repositories/{repository}/full [universe:read]<br>GET /creator-configs-public-api/v1/configs/universes/{universeId}/repositories/{repository}/draft [universe:read] | src/app/project/[universeId]/configs.tsx (Published / Draft / History tabs, repository chips); GET /, /full, /draft in src/features/project/api/analytics-tools.ts. Fix pass: the Draft tab now shows <CloudError> when the published values fail to load and waits… |
| Edit the draft, publish, reset the draft | ✅ in app (new) | PATCH /creator-configs-public-api/v1/configs/universes/{universeId}/repositories/{repository}/draft [universe:write]<br>PUT /creator-configs-public-api/v1/configs/universes/{universeId}/repositories/{repository}/draft:overwrite [universe:write]<br>POST /creator-configs-public-api/v1/configs/universes/{universeId}/repositories/{repository}/publish [universe:write]<br>DELETE /creator-configs-public… | configs.tsx Draft tab: set or delete an entry, discard one change (PATCH with draftHash), overwrite as JSON (PUT draft:overwrite; confirms and lists the deleted keys), reset (confirm), publish Immediate or GradualRollout (confirm). Fix pass: published state n… |
| Revision history and restore | ✅ in app (new) | GET /creator-configs-public-api/v1/configs/universes/{universeId}/repositories/{repository}/revisions [universe:read]<br>POST /creator-configs-public-api/v1/configs/universes/{universeId}/repositories/{repository}/revisions/{revisionId}/restore [universe:write] | configs.tsx History tab: MaxPageSize/Skip/SortOrder/SortKey paging, before/after per key, restore with confirm (stages the revert in the draft) |

### Experimentation

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List and view experiments and their stats | ✅ in app (new) | GET /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments [universe:read]<br>GET /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments/{experimentId} [universe:read]<br>GET /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments/{experimentId}/stats [universe:read] | experiments.tsx (state chips, search, paging) and experiment.tsx (variants, goal, timing, operational status; /stats polled at most 5 times). The API's only stat is isSrmDetected. |
| Create, update, start, schedule, complete and discard experiments; MDE calculator | ✅ in app (new) | POST /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments [universe:write]<br>PATCH /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments/{experimentId} [universe:write]<br>POST /creator-configs-public-api/v1/experimentation/universes/{universeId}/experiments/{experimentId}:start [universe:write]<br>POST /creator-configs-public-api/v1/exper… | experiment.tsx + ExperimentForm.tsx: every action confirms first, and operations are polled on /operations/{id} at most 15 times, 2 s apart. MDE calculator on experiments.tsx. Fix pass: calculateMde in api/analytics-tools.ts now polls by re-sending POST exper… |

### Data stores (v1, legacy)

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Standard data stores v1 | ⚠️ available, not in app | GET /datastores/v1/universes/{universeId}/standard-datastores [universe-datastores.control:list]<br>GET /datastores/v1/universes/{universeId}/standard-datastores/datastore/entries [universe-datastores.objects:list]<br>GET /datastores/v1/universes/{universeId}/standard-datastores/datastore/entries/entry [universe-datastores.objects:read]<br>POST /datastores/v1/universes/{universeId}/standard-datas… | Cloud v2 replaces it, and v1 has nothing v2 lacks. v1 matchVersion maps to the v2 etag, exclusiveCreate to v2 POST create, the versions time range to the v2 revision filter plus @latest:<time>, and content-md5 is only part of the v1 wire format. |

### Data stores (v2)

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List data stores (with name prefix filter) | ✅ in app (before) | GET /cloud/v2/universes/{universe_id}/data-stores [universe-datastores.control:list] | src/app/project/[universeId]/datastores.tsx |
| Show deleted stores and undelete (cancel scheduled deletion) | ✅ in app (new) | GET /cloud/v2/universes/{universe_id}/data-stores?showDeleted=true [universe-datastores.control:list]<br>POST /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}:undelete [universe-datastores.control:delete] | datastores.tsx; data.ts listDataStores/undeleteDataStore |
| Delete (schedule permanent deletion of) a data store | ✅ in app (new) | DELETE /cloud/v2/universes/{universe_id}/data-stores/{data_store_id} [universe-datastores.control:delete] | datastore.tsx Danger zone; data.ts deleteDataStore |
| Take a data store snapshot | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}/data-stores:snapshot [universe-datastores.control:snapshot] | datastores.tsx Snapshot card; data.ts snapshotDataStores |
| List entry keys in a store (by scope, prefix, all scopes with '-') | ✅ in app (before) | GET /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries [universe-datastores.objects:list]<br>GET /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/scopes/{scope_id}/entries [universe-datastores.objects:list] | datastore.tsx |
| Read an entry and a past revision | ✅ in app (before) | GET .../entries/{key}@{revisionId} [universe-datastores.versions:read]<br>PATCH /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries/{entry_id} [universe-datastores.objects:update] | entry.tsx |
| List entry revisions (version history) | ✅ in app (before) | GET /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries/{entry_id}:listRevisions [universe-datastores.versions:list] | entry.tsx |
| Update an entry's value | ✅ in app (new) | PATCH /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries/{entry_id} [universe-datastores.objects:update] | entry.tsx; data.ts writeEntry |
| Edit an entry's user IDs and attributes (metadata) | ✅ in app (new) | PATCH /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries/{entry_id} [universe-datastores.objects:update] | entry.tsx Metadata Edit; data.ts parseUsers/parseAttributes/writeEntry |
| Create a new entry (new key) | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries?id={key} [universe-datastores.objects:create]<br>POST /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/scopes/{scope_id}/entries?id={key} [universe-datastores.objects:create] | datastore.tsx New entry; data.ts createEntry |
| Increment a numeric entry | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries/{entry_id}:increment [universe-datastores.objects:create + universe-datastores.objects:update] | entry.tsx; data.ts incrementEntry |
| Delete an entry | ✅ in app (before) | DELETE /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries/{entry_id} [universe-datastores.objects:delete] | entry.tsx |
| Restore an entry to a past revision | ✅ in app (new) | GET .../entries/{key}@{revisionId} [universe-datastores.versions:read]<br>PATCH /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries/{entry_id} [universe-datastores.objects:update] | entry.tsx Restore this value |
| Read an entry (value, users, attributes, etag, revision) and a past revision | ✅ in app (before) | GET /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/entries/{entry_id} [universe-datastores.objects:read]<br>GET /cloud/v2/universes/{universe_id}/data-stores/{data_store_id}/scopes/{scope_id}/entries/{entry_id} [universe-datastores.objects:read] | src/app/project/[universeId]/entry.tsx, src/api/opencloud.ts getEntry/getEntryRevision |

### Ordered data stores

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List ordered entries (leaderboard, asc/desc) | ✅ in app (before) | GET /cloud/v2/universes/{universe_id}/ordered-data-stores/{ordered_data_store_id}/scopes/{scope_id}/entries [universe.ordered-data-store.scope.entry:read] | ordered.tsx |
| Get one ordered entry | ✅ in app (new) | GET /cloud/v2/universes/{universe_id}/ordered-data-stores/{ordered_data_store_id}/scopes/{scope_id}/entries/{entry_id} [universe.ordered-data-store.scope.entry:read] | ordered.tsx Look up a key; data.ts getOrdered |
| Create an ordered entry | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}/ordered-data-stores/{ordered_data_store_id}/scopes/{scope_id}/entries?id={key} [universe.ordered-data-store.scope.entry:write] | ordered.tsx Add an entry; data.ts createOrdered |
| Update an ordered entry's value | ✅ in app (new) | PATCH /cloud/v2/universes/{universe_id}/ordered-data-stores/{ordered_data_store_id}/scopes/{scope_id}/entries/{entry_id} [universe.ordered-data-store.scope.entry:write] | ordered.tsx Set; data.ts setOrdered |
| Increment an ordered entry | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}/ordered-data-stores/{ordered_data_store_id}/scopes/{scope_id}/entries/{entry_id}:increment [universe.ordered-data-store.scope.entry:write] | ordered.tsx Add; data.ts incrementOrdered |
| Delete an ordered entry | ✅ in app (new) | DELETE /cloud/v2/universes/{universe_id}/ordered-data-stores/{ordered_data_store_id}/scopes/{scope_id}/entries/{entry_id} [universe.ordered-data-store.scope.entry:write] | ordered.tsx Delete entry; data.ts deleteOrdered |

### Memory stores

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Browse a sorted map (list items, asc/desc) | ✅ in app (before) | GET /cloud/v2/universes/{universe_id}/memory-store/sorted-maps/{sorted_map_id}/items [memory-store.sorted-map:read] | memory.tsx |
| Get one sorted map item | ✅ in app (new) | GET /cloud/v2/universes/{universe_id}/memory-store/sorted-maps/{sorted_map_id}/items/{item_id} [memory-store.sorted-map:read] | memory.tsx Look up an item; data.ts getSortedMapItem |
| Create a sorted map item | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}/memory-store/sorted-maps/{sorted_map_id}/items?id={itemId} [memory-store.sorted-map:write] | memory.tsx MapItemEditor; data.ts createSortedMapItem |
| Update a sorted map item | ✅ in app (new) | PATCH /cloud/v2/universes/{universe_id}/memory-store/sorted-maps/{sorted_map_id}/items/{item_id} [memory-store.sorted-map:write] | memory.tsx MapItemEditor; data.ts updateSortedMapItem |
| Delete a sorted map item | ✅ in app (new) | DELETE /cloud/v2/universes/{universe_id}/memory-store/sorted-maps/{sorted_map_id}/items/{item_id} [memory-store.sorted-map:write] | memory.tsx MapItemEditor; data.ts deleteSortedMapItem |
| Peek a queue (non-destructive read) | ✅ in app (before) | GET /cloud/v2/universes/{universe_id}/memory-store/queues/{queue_id}/items:read [memory-store.queue:dequeue] | memory.tsx |
| Add an item to a queue | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}/memory-store/queues/{queue_id}/items [memory-store.queue:add] | memory.tsx; data.ts addQueueItem |
| Dequeue: read with invisibility window then discard | ✅ in app (new) | GET /cloud/v2/universes/{universe_id}/memory-store/queues/{queue_id}/items:read [memory-store.queue:dequeue]<br>POST /cloud/v2/universes/{universe_id}/memory-store/queues/{queue_id}/items:discard [memory-store.queue:discard] | memory.tsx; data.ts readQueue/discardQueueItems |
| Flush the whole memory store (LIVE or TEST scope) | ✅ in app (new) | POST /cloud/v2/universes/{universe_id}/memory-store:flush [memory-store:flush]<br>GET /cloud/v2/universes/{universe_id}/memory-store/operations/{operation_id} [memory-store:get] | memory.tsx Flush; data.ts flushMemoryStore |

### Secrets

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List secrets (names, domain, created/updated) | ✅ in app (new) | GET /cloud/v2/universes/{universeId}/secrets [universe.secret:read] | secrets.tsx |
| Create / update a secret | ✅ in app (new) | GET /cloud/v2/universes/{universeId}/secrets/public-key [universe.secret:read]<br>POST /cloud/v2/universes/{universeId}/secrets [universe.secret:write]<br>PATCH /cloud/v2/universes/{universeId}/secrets/{secretId} [universe.secret:write] | secrets.tsx; sealedbox.ts |
| Delete a secret | ✅ in app (new) | DELETE /cloud/v2/universes/{universeId}/secrets/{secretId} [universe.secret:write] | secrets.tsx |

### Secrets store

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List universe secrets (metadata only) | ✅ in app (new) | GET /cloud/v2/universes/{universeId}/secrets [universe.secret:read] | src/app/project/[universeId]/secrets.tsx; src/features/project/api/data.ts listSecrets |
| Create or update a secret | ✅ in app (new) | GET /cloud/v2/universes/{universeId}/secrets/public-key [universe.secret:read]<br>POST /cloud/v2/universes/{universeId}/secrets [universe.secret:write]<br>PATCH /cloud/v2/universes/{universeId}/secrets/{secretId} [universe.secret:write] | secrets.tsx SecretForm; data.ts createSecret/updateSecret/sealForUniverse; src/features/project/sealedbox.ts |
| Delete a secret | ✅ in app (new) | DELETE /cloud/v2/universes/{universeId}/secrets/{secretId} [universe.secret:write] | secrets.tsx; data.ts deleteSecret |

### Server management > Restart

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Restart all servers (shut down every server) | ✅ in app (before) | POST /cloud/v2/universes/{universeId}:restartServers [universe:write] | restart.tsx 'Restart servers' card |
| Restart with options: per place, only outdated versions, bleed-off period, attributes sent to servers | ✅ in app (new) | POST /cloud/v2/universes/{universeId}:restartServers [universe:write]<br>POST /server-management/v1/universes/{universeId}/restarts [universe:write] | restart.tsx RestartOptions |
| Restart impact forecast (players/servers that would be kicked per place) | ✅ in app (new) | GET /server-management/v1/universes/{universeId}/restarts:forecast [universe:read] | restart.tsx 'Right now' section and confirm dialogs |
| Restart progress / history (statuses) | ✅ in app (new) | GET /server-management/v1/universes/{universeId}/restarts [universe:read] | restart.tsx History |

### Server management > Servers

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List running game servers (job id, version, players, FPS, memory, uptime, region, player ids) | ✅ in app (new) | GET /server-management/v1/universes/{universeId}/places/{placeId}/versions/{versionNumber}/game-servers [universe:read]<br>GET /server-management/v1/universes/{universeId}/places/{placeId}/game-servers:filter-options [universe:read] | /project/[universeId]/servers (servers.tsx) and server.tsx |
| Public server list (players/max, FPS, ping) | ✅ in app (before) | GET https://games.roblox.com/v1/games/{placeId}/servers/{serverType} (public, no auth) | OverviewTab.tsx |
| Game server logs (server console output for one job) | ✅ in app (new) | GET /server-management/v1/universes/{universeId}/places/{placeId}/versions/{versionNumber}/game-servers/{jobId}/logs [universe:read] | server.tsx 'Server logs' (servers/shared.tsx LogsPanel) |
| Client session logs (one player's client output on a server) | ✅ in app (new) | GET /server-management/v1/universes/{universeId}/places/{placeId}/game-servers/{jobId}/client-sessions/{sessionId}/logs [universe:read] | server.tsx 'Client session logs' tab |
| Shut down a single server / launch update via matchmaking (Creator Hub 'Shut down' on one instance) | ⛔ no API | POST /matchmaking-api/v1/game-instances/shutdown [cookie only]<br>POST /matchmaking-api/v1/game-instances/launch-update [cookie only]<br>POST /matchmaking-api/v1/game-instances/forecast-update [cookie only]<br>GET /matchmaking-api/v1/game-instances/get-update-status [cookie only] | The matchmaking-api endpoints are cookie-only. As the closest option, server.tsx offers 'Restart this version's servers', which opens the restart screen pre-filled. |

### Messaging

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Publish a MessagingService message to all live servers | ✅ in app (before) | POST /cloud/v2/universes/{universe_id}:publishMessage [universe-messaging-service:publish] | messaging.tsx |

### Matchmaking

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Matchmaking configuration (scoring configs and signal weights, player/server attributes, start place, feature flags) | ⛔ no API | GET /matchmaking-api/v1/matchmaking/scoring-configurations/{universeId} [cookie only]<br>POST/PATCH/DELETE /matchmaking-api/v1/matchmaking/scoring-configuration... [cookie only]<br>GET/POST/PATCH/DELETE /matchmaking-api/v1/matchmaking/player-attribute(s)... [cookie only]<br>GET/POST/PATCH/DELETE /matchmaking-api/v1/matchmaking/server-attribute(s)... [cookie only] | Cookie-only endpoints with no x-roblox-scopes. |

### Ads Manager

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| List and view ad campaigns with delivery status | ✅ in app (new) | GET /ads-management/v1/campaigns [ad.campaign:read]<br>GET /ads-management/v1/campaigns/{id} [ad.campaign:read]<br>POST /ads-management/v1/campaigns:batchGetStatus [ad.campaign:read]<br>GET /ads-management/v1/creatives [ad.campaign:read] | /project/[universeId]/ads and ads?campaign=<id> (ads.tsx, servers/CampaignDetail.tsx) |
| Create / update (pause, budget) an ad campaign | ✅ in app (new) | GET /ads-management/v1/campaign-options [ad.campaign:read]<br>POST /ads-management/v1/campaigns [ad.campaign:write]<br>PATCH /ads-management/v1/campaigns/{id} [ad.campaign:write] | ads?create=1 (servers/CampaignCreate.tsx) and ads?campaign=<id> (CampaignDetail.tsx) |

### Extended services (service efficiency)

| Item | Status | API (scope) | Where / notes |
|---|---|---|---|
| Extended services eligibility, account, per-universe budget configuration | ✅ in app (new) | GET /service-efficiency-api/v1/is_allowed?universeId= [extended-services:read]<br>GET /service-efficiency-api/v1/eligibility/users/{userId} [extended-services:read]<br>GET /service-efficiency-api/v1/accounts/users/{userId} [extended-services:read]<br>PUT /service-efficiency-api/v1/accounts/users/{userId} [extended-services:write] | /project/[universeId]/extended (extended.tsx Budget and Account tabs) |
| Extended services bills and billing activity (usage cost per experience) | ✅ in app (new) | GET /service-efficiency-api/v1/billing_activities/users/{userId}?startYear&startMonth&endYear&endMonth [extended-services:read]<br>GET /service-efficiency-api/v1/bills/users/{userId}?billId\\|year&month\\|latest [extended-services:read] | extended.tsx Billing tab |
| Extended services account, eligibility, bills and billing activity for GROUP-owned experiences | ✅ in app (new) | GET /service-efficiency-api/v1/eligibility/groups/{groupId} [extended-services:read]<br>GET /service-efficiency-api/v1/accounts/groups/{groupId} [extended-services:read]<br>PUT /service-efficiency-api/v1/accounts/groups/{groupId} [extended-services:write]<br>GET /service-efficiency-api/v1/billing_activities/groups/{groupId} [extended-services:read] | extended.tsx (ExtendedOwner kind 'groups') |

