# TypeTorch mobile

One app for all your Roblox experiences. Expo (React Native), Android first. Most of it runs in Expo Go; the widgets, the live watch and push need the APK
(the local native module `modules/typetorch-live` and Firebase).

Part of TypeTorch. Read `../TypeTorch.md` (hub) and `../plans/07-web-mobile.md` (this repo's plan).

## What it does

- **Projects** (home): every experience you can reach, grouped as *My experiences* and one section per group:
  - the universes your Open Cloud API key names,
  - your own public experiences (`games.roblox.com/v2/users/{id}/games`),
  - the experiences of the groups where your rank is high enough (`groups.roblox.com/v2/users/{id}/groups/roles` →
    `games.roblox.com/v2/groups/{id}/gamesV2`; Settings picks "groups I own" / "rank 200+" / "all"),
  - experiences you add by place link or ID.

  Icons, playing, visits and likes come from Roblox's public APIs. A **TypeTorch** badge marks projects with a connected
  backend. Pull to refresh, search.
- **Per experience** (tabs):
  - **Overview**: banner, playing / visits / favorites / likes, description, creator, dates, visibility / devices /
    maturity / voice / private servers (Open Cloud universe), places, public servers.
  - **Analytics**: Creator Hub's charts through the Open Cloud Analytics Query API (port of
    `../backend/src/opencloud.ts` `queryAnalyticsMetric`): DAU, MAU, peak concurrent, playtime, sessions, session
    length, stickiness, D1/D7/D30 retention, revenue, ARPDAU, ARPPU, payers, payer conversion, impressions, qualified
    plays, play-through rates, server FPS, client FPS, crash rate, server crashes. 7 / 28 / 90 days; breakdowns per
    metric (platform, OS, country, age, new vs returning, source, …). At most 2 queries in flight, cached for an hour
    (Roblox allows 30 queries a minute per key owner).
  - **Tools** (each only with its scope): data stores (list stores, list / filter keys by scope and prefix, view an
    entry as JSON with metadata, revisions and past values, edit and delete behind a confirm), ordered data stores,
    memory store sorted maps and queues (read; a queue read is a peek with `invisibilityWindow=0s`), MessagingService
    publish, restart all servers (confirm), bans (list, log, ban / unban with confirm), game passes / developer
    products / badges.
  - **TypeTorch** (only when a backend is connected for that universe): the backend's dashboard, native, inside the app:
    every page of the web explorer (Overview, Roblox, Demographics, Session time, Retention (players back and revenue /
    LTV), Funnels, Players + a player page, Flow, Experiments, Live events, Notifications, Feedback, First session, Events,
    Fleet + server pages with their offline history, debug bundles and (owners) the remote debug session, Server
    history, Deploys, Errors (+ drop rules), Performance, Economy, Monetization, Query, Settings (owners: runtime
    settings, alert rules, backups, migration); owners also Audit log and Backend stats), grouped like the web's
    sidebar, with the server status dot, a command palette and Find player in every TypeTorch header. The web's
    filter bar (range, branch, artifact, device, new / returning, variant) is one state per backend that follows you from
    page to page; Roblox benchmarks are kept on the phone per backend.
- **Backends**: connect TypeTorch backends by URL (several at once), sign in with the browser or the admin token.
  `http://` only for localhost and LAN addresses (marked "not encrypted"; the admin token over http asks first).
  A connected backend's universe is always listed under Projects, even when private or unlisted.
- **Settings**: the Open Cloud key (checked with Roblox, which scopes are missing for which feature), the Roblox user
  whose experiences to list, group rank filter, appearance (system / dark / light).

Everything stays on the phone (expo-secure-store): the Open Cloud key is only ever sent to `apis.roblox.com`, each
backend token only to its backend. No analytics, no telemetry.

## Run it

```sh
npm install
npx expo start          # scan the QR code with Expo Go (Android)
npx tsc --noEmit        # type check
```

APK: `eas build -p android --profile preview` (internal distribution, `buildType: apk`); store build: `--profile production`.

The screens use only Expo Go modules (expo-router, @tanstack/react-query, expo-secure-store, expo-web-browser, expo-crypto,
expo-linking, expo-clipboard, expo-image, expo-device, react-native-svg, @expo/vector-icons, react-native-gesture-handler,
react-native-reanimated, expo-file-system, expo-sharing, @react-native-async-storage/async-storage, and the pure-JS
@dagrejs/dagre). The APK adds the local module `modules/typetorch-live` (widgets, live watch; docs/PUSH_WATCH_WIDGETS.md)
with androidx.javascriptengine (docs/WIDGET_PROGRAM.md) and expo-notifications; in Expo Go those parts are hidden.

**Browser sign-in in Expo Go**: the redirect is `exp://…/--/auth`, which a backend accepts only with
`TYPETORCH_MOBILE_DEV_REDIRECTS=on`. Without it, use "Use the admin token" (shown first in Expo Go). The built APK uses
`typetorch://auth`, which every backend accepts.

## Open Cloud key scopes

Create the key on Creator Hub → Open Cloud → API Keys and add each experience to the per-experience scopes (group
experiences: a key made under the group). Every feature needs only its own scopes; Settings lists what the key is missing.

**Read-only (start here):** `universe:read`, `universe.place:read`, `universe.analytics:read`, `group:read`,
`user.social:read`, `user.advanced:read`, `universe-datastores.control:list`, `universe-datastores.objects:list`,
`universe-datastores.objects:read`, `universe-datastores.versions:list`, `universe-datastores.versions:read`,
`universe.ordered-data-store.scope.entry:read`, `memory-store.sorted-map:read`, `universe.user-restriction:read`,
`developer-product:read`, `game-pass:read`.

| Write area (each action confirms first) | Scopes |
| --- | --- |
| Experience and places | `universe:write` (also restart servers), `universe.place:write`, `universe-places:write` (publish) |
| Data stores | `universe-datastores.objects:create`, `:update`, `:delete`, `universe-datastores.control:delete`, `universe-datastores.control:snapshot` |
| Ordered data stores | `universe.ordered-data-store.scope.entry:write` |
| Memory stores | `memory-store.sorted-map:write`, `memory-store.queue:add`, `memory-store.queue:dequeue`, `memory-store.queue:discard`, `memory-store:flush` |
| Messaging | `universe-messaging-service:publish` |
| Bans | `universe.user-restriction:write` |
| Products, passes, badges | `developer-product:write`, `game-pass:write`, `legacy-universe.badge:write`, `legacy-universe.badge:manage-and-spend-robux` |
| Analytics extras | `universe.analytics:write`, `universe.analytics.dashboard:read` / `:write`, `universe.analytics.alert:read` / `:write` |
| Engagement | `universe.event:read` / `:write`, `universe.notification-string:read` / `:write`, `universe.thumbnail:read` / `:write`, `user.user-notification:write` |
| Servers and live tools | `universe.place.instance:read` / `:write`, `universe.place.luau-execution-session:read` / `:write` |
| Secrets | `universe.secret:read` / `:write` |
| Assets | `asset:read`, `asset:write`, `asset-permissions:write` |
| Other | `ad.campaign:read` / `:write`, `extended-services:read` / `:write` |

Optional: `legacy-universe:manage`, `legacy-game-pass:manage`, `legacy-developer-product:manage`, `legacy-badge:manage`,
`legacy-group:manage`, `legacy-team-collaboration:manage`, `legacy-universe.following:read` / `:write`, for the screens
that ask for them.

The key's universes, scopes and owner come from `POST https://apis.roblox.com/api-keys/v1/introspect` (`{ apiKey }`).

## TypeTorch backend endpoints the app uses

Auth (all shapes in `src/api/backend-auth.ts`):

- `GET /auth/mobile/start?redirect_uri=&state=&code_challenge=&code_challenge_method=S256&device=` (browser, PKCE);
  back to `redirect_uri?code=&state=` or `?error=access_denied|not_owner|not_blessed|state|failed`
- `POST /v1/auth/mobile/token` `{ code, code_verifier }`, or Bearer admin token + `{ device }` →
  `{ token, id, expiresAt, role, user }` (`ttm_<id>_<secret>`, 30–90 days)
- `POST /v1/auth/mobile/refresh` (Bearer; done at app start when < 15 days remain, the new token is saved before
  anything else runs because the old one is revoked at once), `POST /v1/auth/mobile/logout`
- `GET /v1/auth/mobile/tokens[?all=1]` (an admin gets every user's live tokens, others their own; `?all=1` only adds
  revoked and expired rows, the Settings "+ ended" view), `DELETE /v1/auth/mobile/tokens/<id>`
- `GET /v1/auth/check` (`game: { universeId, label }` links the backend to its project; a 401 has `mobileLogin`),
  `GET /v1/place` (name). A 401 `{ code: "mobile_token_dead" }` marks the backend signed out.

Dashboard (Bearer, client in `src/api/backend.ts`, ported from `../backend/web/src/lib/api.ts`): `/healthz`,
`/v1/query/overview`, `/v1/fleet/servers[?gone=1]`, `/v1/fleet/servers/<job>`, `/v1/fleet/servers/<job>/metrics`,
`/v1/servers/<job>/errors`, `/v1/fleet/deploys`, `/v1/fleet/deploys/<seq>`, `/v1/fleet/alerts`,
`/v1/fleet/alerts/<id>/ack`, `/v1/fleet/reports?latest[&branch=]`, `/v1/errors`, `/v1/errors/<fp>`,
`/v1/errors/<fp>/players`, `/v1/storage` (owners), `/v1/admin/settings`.

Phase 2 pages add: `POST /v1/query/<name>` (retention, funnel, funnel-progress, playtime-funnel, funnel-players,
players, player-stats, timeline, player-graph, flow, experiment, confusion, top-events, events, values, benchmarks,
realtime, trends, perf-client, perf-server, perf-compare, economy, monetization, monetization-players,
monetization-purchases, and any name on the Query page), `/v1/queries`, `POST /v1/sql`, `/v1/saved-queries` (+ POST,
PATCH, DELETE `/<id>`), `/v1/experiments`, `/v1/experiments/<e>/players`, `/v1/identity` (+ `/backfill`,
`/<pid>/profile`), `/v1/players/<pid>/errors`, `/v1/roblox/products`, `/v1/roblox/analytics/acquisition`,
`/v1/fleet/marks`, `/v1/fleet/bundles/<id>`, `/v1/admin/audit`, `/v1/admin/stats`.

Ops pages add: `/v1/notify/status`, `/v1/notify/config`, POST `/v1/notify/test`, `/v1/notify/user`, `/v1/notify/recent`,
`/v1/notify/users[?format=csv]`, POST `/v1/query/notify-funnel|notify-optin|notify-queue`, POST
`/v1/fleet/servers/<job>/watch`, POST `/v1/fleet/servers/<job>/commands`, `/v1/fleet/servers/<job>/commands/<id>`,
`/v1/fleet/servers/<job>/streams`, `/v1/fleet/debug/audit`, `/v1/roblox/servers/<job>/logs`, `/v1/fleet/columns`,
`/v1/fleet/reports`, `/v1/fleet/stream?branch`, `/v1/errors/drop-rules` (+ POST `/preview`), PATCH `/v1/admin/settings`,
POST `/v1/admin/settings/test-alert`, `/v1/admin/alert-rules`, `/v1/admin/devices` (+ DELETE `/<id>`),
`/v1/admin/backups` (+ POST, POST `/download`), `/v1/admin/migrate` (+ POST), `/v1/place`, `/healthz`.

## Code layout

```
src/app/                 expo-router routes
  (tabs)/                Projects, Backends, Settings
  project/[universeId]/  index (tabs) + datastores, datastore, entry, ordered, memory, messaging, bans, monetization
  tt/[backendId]/        TypeTorch dashboard: index (Overview), fleet, server/[job], bundle/[id], server-history, deploys,
                         deploy/[seq], errors, error/[fp], settings, roblox, demographics, session-time, retention,
                         funnels, players, player/[pid], flow, experiments, live-events, notifications, feedback, first-session, events,
                         performance, economy, monetization, query, audit, backend-stats
  backend/connect.tsx    connect / sign in again
src/api/                 http.ts, opencloud.ts, roblox-public.ts, backend.ts, backend-auth.ts, tt/ (web types and pure
                         helpers, copied: types, format, perf, perf-thresholds, deploys, benchmarks, graph-text,
                         server-history, compare)
src/store/accounts.tsx   key, backends, tokens, prefs (secure store)
src/features/            project (projects list, analytics, tabs), typetorch (pages registry, hooks, screen frame,
                         filters.tsx = the filter bar (saved per backend) + useTTAnalytics, bits.tsx = query state /
                         share bars / player rows / products / JSON, table/ = DataTable (model, view, export),
                         cards.tsx = player and product cards, event-table.tsx, graph.tsx + graph-view.tsx = the node
                         graph drawn and as lists, marks.tsx = deploy / live-event marks and their cards, view-link.tsx
                         = page params in the route and "Copy link to this view", sheet.tsx, persist.ts, roblox-cards.ts)
src/components/ui.tsx    design system;  src/charts/LineChart.tsx  LineChart (dashed series, tappable marks), BarChart (tap
                         a bar, previous period dashed, tappable marks), Sparkline, ShareBars
```

### Adding a TypeTorch page

1. `src/app/tt/[backendId]/<key>.tsx`: `export default function X() { return <TTScreen title="…">{({ backendId }) => …}</TTScreen> }`,
   data through `useTTQuery(backendId, [...key], (api, signal) => api.<method>(…, signal))`, or for a named query
   under the filter bar `useTTAnalytics(backendId, "<name>", options)` with `<FilterBar backendId={backendId} />` on top.
2. In `src/features/typetorch/pages.ts`, set the page's `status` to `"ready"` (the menu links it).
3. Types and API methods are already there (`src/api/tt/types.ts`, `src/api/backend.ts`, same names as the web).

## TODO

Phase 2 TypeTorch pages (web: `../backend/web/src/pages/`), all ported:

- [x] Roblox
- [x] Retention
- [x] Funnels
- [x] Players
- [x] Flow
- [x] Experiments
- [x] FirstSession
- [x] Events
- [x] ServerHistory
- [x] Performance
- [x] Economy
- [x] Monetization
- [x] Query
- [x] AuditLog (admin)
- [x] BackendStats (admin)

Where the phone differs from the web: the node graph (Flow, a player's timeline) is drawn with dagre + react-native-svg
(one finger pans, two pinch, buttons zoom / fit / flip / full screen, tap a state for its details and moves; the list
view stays as a toggle); every table is the shared DataTable (`features/typetorch/table/`, a port of the web's): tap a
header to sort, long-press to add it to the sort, filter sheets with chips, Columns (show / hide, − / + widths instead of
dragging), paging, long-press a row to copy a cell or the row, Export saves CSV / JSON through the share sheet or copies
CSV / TSV / JSON; hover cards are a long-press (players) or a tap (product ids, deploy marks); the filter bar is one state
per backend saved on the phone, and the link button in every TypeTorch header copies or shares a link with the page, its
parameters (the web's names), the whole filter bar and every table's view (another phone with the same backend connected
opens it on its own account; keys the link leaves out go back to their defaults, like a web URL). An installed build makes
typetorch:// links. In Expo Go the link is exp://<dev server>:<port>/--/tt/…, which opens only in Expo Go on a phone
that reaches the same Metro dev server; the share sheet says so and also offers the typetorch:// form for a phone with
the installed app; Roblox benchmarks are kept per backend on the phone (secure store), with copy /
paste / file export of the web's JSON.

Also not yet in the app: deploy notifications (push needs a dev build), place versions (no Open Cloud read API).
