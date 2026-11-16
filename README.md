# TypeTorch mobile

One app for all your Roblox experiences. Expo (React Native), Android first, runs in Expo Go.

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
    every page of the web explorer (Overview, Roblox, Retention, Funnels, Players + a player page, Flow, Experiments,
    First session, Events, Fleet + server pages with their offline history and debug bundles, Server history, Deploys,
    Errors, Performance, Economy, Monetization, Query, Settings; owners also Audit log and Backend stats). The web's
    filter bar (range, branch, artifact, device, new / returning, variant) is one state per backend that follows you from
    page to page; Roblox benchmarks are kept on the phone per backend.
- **Backends**: connect TypeTorch backends by URL (several at once), sign in with the browser or the admin token.
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

Only Expo Go modules are used (expo-router, @tanstack/react-query, expo-secure-store, expo-web-browser, expo-crypto,
expo-linking, expo-clipboard, expo-image, expo-device, react-native-svg, @expo/vector-icons). No config plugin needs a
dev client (`expo-secure-store`'s plugin only sets iOS Face ID text).

**Browser sign-in in Expo Go**: the redirect is `exp://…/--/auth`, which a backend accepts only with
`TYPETORCH_MOBILE_DEV_REDIRECTS=on`. Without it, use "Use the admin token" (shown first in Expo Go). The built APK uses
`typetorch://auth`, which every backend accepts.

## Open Cloud key scopes

Create the key on Creator Hub → Open Cloud → API Keys, add the experiences, and add what you want to use:

| Feature | Scopes |
| --- | --- |
| Analytics | `universe.analytics:read` |
| Data stores | `universe-datastores.control:list`, `universe-datastores.objects:list`, `universe-datastores.objects:read`; history `universe-datastores.versions:list`; edit `universe-datastores.objects:update`; delete `universe-datastores.objects:delete` |
| Ordered data stores | `universe.ordered-data-store.scope.entry:read` |
| Memory stores | `memory-store.sorted-map:read`, `memory-store.queue:dequeue` (peek) |
| Messaging | `universe-messaging-service:publish` |
| Restart servers | `universe:write` |
| Bans | `universe.user-restriction:read`; ban / unban `universe.user-restriction:write` |
| Developer products | `developer-product:read` |
| Game passes | `game-pass:read` (a public list without it) |

The key's universes, scopes and owner come from `POST https://apis.roblox.com/api-keys/v1/introspect` (`{ apiKey }`).

## TypeTorch backend endpoints the app uses

Auth (all shapes in `src/api/backend-auth.ts`):

- `GET /auth/mobile/start?redirect_uri=&state=&code_challenge=&code_challenge_method=S256&device=` (browser, PKCE);
  back to `redirect_uri?code=&state=` or `?error=access_denied|not_owner|not_blessed|state|failed`
- `POST /v1/auth/mobile/token` `{ code, code_verifier }`, or Bearer admin token + `{ device }` →
  `{ token, id, expiresAt, role, user }` (`ttm_<id>_<secret>`, 30–90 days)
- `POST /v1/auth/mobile/refresh` (Bearer; done at app start when < 15 days remain, the new token is saved before
  anything else runs because the old one is revoked at once), `POST /v1/auth/mobile/logout`
- `GET /v1/auth/mobile/tokens[?all=1]`, `DELETE /v1/auth/mobile/tokens/<id>`
- `GET /v1/auth/check` (`game: { universeId, label }` links the backend to its project; a 401 has `mobileLogin`),
  `GET /v1/place` (name). A 401 `{ code: "mobile_token_dead" }` marks the backend signed out.

Dashboard (Bearer, client in `src/api/backend.ts`, ported from `../backend/web/src/lib/api.ts`): `/healthz`,
`/v1/query/overview`, `/v1/fleet/servers[?gone=1]`, `/v1/fleet/servers/<job>`, `/v1/fleet/servers/<job>/metrics`,
`/v1/servers/<job>/errors`, `/v1/fleet/deploys`, `/v1/fleet/deploys/<seq>`, `/v1/fleet/alerts`,
`/v1/fleet/alerts/<id>/ack`, `/v1/errors`, `/v1/errors/<fp>`, `/v1/admin/settings`.

Phase 2 pages add: `POST /v1/query/<name>` (retention, funnel, funnel-progress, playtime-funnel, funnel-players,
players, player-stats, timeline, player-graph, flow, experiment, confusion, top-events, events, values, benchmarks,
realtime, trends, perf-client, perf-server, perf-compare, economy, monetization, monetization-players,
monetization-purchases, and any name on the Query page), `/v1/queries`, `POST /v1/sql`, `/v1/saved-queries` (+ POST,
PATCH, DELETE `/<id>`), `/v1/experiments`, `/v1/experiments/<e>/players`, `/v1/identity` (+ `/backfill`,
`/<pid>/profile`), `/v1/players/<pid>/errors`, `/v1/roblox/products`, `/v1/roblox/analytics/acquisition`,
`/v1/fleet/marks`, `/v1/fleet/bundles/<id>`, `/v1/admin/audit`, `/v1/admin/stats`.

## Code layout

```
src/app/                 expo-router routes
  (tabs)/                Projects, Backends, Settings
  project/[universeId]/  index (tabs) + datastores, datastore, entry, ordered, memory, messaging, bans, monetization
  tt/[backendId]/        TypeTorch dashboard: index (Overview), fleet, server/[job], bundle/[id], server-history, deploys,
                         deploy/[seq], errors, error/[fp], settings, roblox, retention, funnels, players, player/[pid],
                         flow, experiments, first-session, events, performance, economy, monetization, query, audit,
                         backend-stats
  backend/connect.tsx    connect / sign in again
src/api/                 http.ts, opencloud.ts, roblox-public.ts, backend.ts, backend-auth.ts, tt/ (web types and pure
                         helpers, copied: types, format, perf, perf-thresholds, deploys, benchmarks, graph-text,
                         server-history, compare)
src/store/accounts.tsx   key, backends, tokens, prefs (secure store)
src/features/            project (projects list, analytics, tabs), typetorch (pages registry, hooks, screen frame,
                         filters.tsx = the filter bar + useTTAnalytics, bits.tsx = query state / tables / share bars /
                         player rows / products / JSON, graph.tsx = the node graph as lists, marks.tsx, roblox-cards.ts)
src/components/ui.tsx    design system;  src/charts/LineChart.tsx  LineChart (dashed series, deploy marks), BarChart (tap
                         a bar), Sparkline, ShareBars
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

Where the phone differs from the web: the node graph (Flow, a player's timeline) is a list of states with their moves
out, a one-session path and the exit / move tables, not a drawn graph ("Copy Mermaid" gives the drawing); tables are
sideways-scrolling lists without the web's per-column filters, column picker or CSV export (the Query page copies TSV);
the filter bar's state lives in memory per backend, not in a shareable URL; Roblox benchmarks are kept per backend on the
phone (secure store), not per browser.

Also not yet in the app: remote debug commands on the server page, changing runtime settings (read only here),
deploy notifications (push needs a dev build), place versions (no Open Cloud read API).
