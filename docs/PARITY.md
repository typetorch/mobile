# Web explorer ↔ phone parity

A 1:1 inventory of the TypeTorch web explorer on `origin/main` (backend `8fa8026`, read from `../backend-main/web/src`)
against this app (branch `feat/phone-parity`, `6b62adb`). For every page, tab, card, table, chart, filter, action,
mutation and live stream: what it does, the backend route(s) it calls (`web/src/lib/api.ts`, `lib/maps.ts`,
`lib/live-streams.ts`, `lib/remote-debug.ts`, `lib/asset-images.ts`, `lib/anim-clips.ts`), who may use it, and its
status in the app.

Status: **present** (same data and actions), **partial** (what is missing is named), **missing**, **n/a** (a browser
thing with no phone meaning). Roles: **all** = any signed-in session; **owner** = `role === "admin"` (Roblox owner or
admin token; `ownerOnly` in `web/src/lib/nav.ts`, `isReadOnly()` in pages); the backend enforces it either way.
App paths are under `src/`; `tt/` means `src/app/tt/[backendId]/`.

> Auth note: `origin/main` has **no** `/v1/auth/mobile/*` routes and no "mobile sessions" Settings card. The `ttm_`
> Bearer tokens the app uses (`src/api/backend-auth.ts`, the app's own Settings "App sessions" list) live on the WIP
> branch `backup/mobile-tokens-pre-rebase` of the backend. Parity work must not assume main serves them.

---

## 1. Shell and global pieces

| Item | Web file | Route(s) | Role | App |
| --- | --- | --- | --- | --- |
| Sidebar from one config, 5 groups (Overview; Players & gameplay; Observe & troubleshoot; Data; Admin), collapsible, phone drawer | `lib/nav.ts`, `components/SidebarNav.tsx`, `lib/nav-state.ts` | – | owner items hidden for `web` role | partial: `features/typetorch/pages.ts` is a flat list; Demographics, Session time, Live events and Feedback added (analytics); missing Notifications (Maps and Live map added by maps-live, Recordings by recordings); no groups |
| Header: page title, server status dot (GET `/healthz` every 30 s, 502/503/504 wording), theme menu, user menu / sign out | `components/AppShell.tsx` (`ServerStatus`, `ThemeToggle`, `UserMenu`) | `/healthz`, POST `/v1/auth/logout` | all | partial: health only on `tt/settings.tsx`; theme is app-wide (`(tabs)/settings.tsx`); no status dot in the TT header |
| Place card (icon, name, live players, link to roblox.com) and tab title "<page> \| <place>" | `components/PlaceCard.tsx` | GET `/v1/place` | all | partial: name used in `app/backend/connect.tsx`; no card / live count in `features/typetorch/components.tsx` `BackendHeader` |
| Top-bar "Find player" (pid, part of pid or UserId → Players) | `components/Identity.tsx` `FindPlayer` | GET `/v1/identity?uid=` | all | partial: only the Players page search (`tt/players.tsx`) |
| Command palette (Ctrl/Cmd+K, fuzzy, recent first): every page, every range preset, Clear filters, Copy link to this view, Refresh data, Toggle / system theme, Sign out, "Open player <id>", page commands (`players:copy-pid`) | `components/CommandPalette.tsx`, `lib/commands.ts` | – | pages filtered by role | missing |
| Filter bar: range presets `1h 6h 1d 3d 7d 30d 90d deploy` + custom UTC dates, branch, artifact, device, new / returning, experiment variant | `components/FilterBar.tsx`, `lib/filters.ts` | POST `/v1/query/values`, `/v1/query/experiment` | all | present: `3d` and `deploy` (since the last prod release, GET `/v1/fleet/deploys?branch=prod&limit=1`) presets (interaction); audience: see the next row |
| Filter bar Audience popover: country, language, account age, Premium, join source (player-level; choices from the `demographics` query) | `components/FilterBar.tsx`, `lib/audience.ts` | POST `/v1/query/demographics` | all | present (interaction 2): an "Audience" section in the Filters panel (`features/typetorch/filters.tsx` `AudienceSection`): country and language chips from the `demographics` query over the range (asked once the section opens), account age (`ACCOUNT_AGES`), Premium yes / no, join source (`JOIN_SOURCES`), "Clear audience"; names in `api/tt/audience.ts` (Hermes may lack `Intl.DisplayNames`: then the static English tables in `api/tt/locale-names.ts`, generated from Node's CLDR names, name them as the web does) |
| Filters in the URL (`range, from, to, branch, art, dev, players, exp, variant, country, lang, age, prem, source`), kept across links (`withFilters`) | `lib/filters.ts`, `lib/hooks.ts` `useFilters/useParam` | – | all | present (interaction): one state per backend saved on the phone (AsyncStorage `tt.filters.v1.<backend>`), written with the web's keys into "Copy link to this view" (header link button, `features/typetorch/view-link.tsx`); a link's keys set the bar (`features/typetorch/screen.tsx`). A view link (it always carries `backend=`) is the whole filter state like a web URL: a key it leaves out is reset to its default, and `range` is always written |
| History-importing banner above analytics pages while a migration imports | `components/HistoryImportingBanner.tsx` | GET `/v1/admin/migrate` | owner | present (analytics): `features/typetorch/history-banner.tsx`, rendered by the filter bar so every page with it has the banner; owners only (GET `/v1/admin/migrate`, `api/tt/migrate.ts` `historyBannerText`) |
| Untrusted-browser banner (owner via typetorch.dev on an untrusted browser; trust with admin token) | `components/UntrustedBrowserBanner.tsx` | POST `/auth/device` | owner | n/a (phone signs in with its own token) |
| Login page: Sign in with Roblox, Sign in with typetorch.dev, admin token | `components/LoginPage.tsx`, `components/AuthGate.tsx` | `/v1/auth/roblox/start`, `/auth/typetorch/start`, POST `/v1/auth/login` | – | present in app form (`app/backend/connect.tsx`, ttm_ PKCE / admin token) |
| 401 → back to login | `main.tsx` QueryCache | GET `/v1/auth/check` | – | present (`mobile_token_dead` marks signed out) |

## 2. Overview (`/`) — `pages/Overview.tsx`

| Item | Route(s) | Role | App (`features/typetorch/components.tsx` `TTHome`) |
| --- | --- | --- | --- |
| 8 stat tiles: Players, New, Returning, Sessions, Events, Playtime, Avg session, Playtime / player | POST `/v1/query/overview` | all | present (analytics): `features/typetorch/overview.tsx` `OverviewAnalytics` on `tt/index.tsx`: the filter bar's range (the project tab keeps its compact Today / 7 / 28 day summary), the web's 8 tiles |
| "vs previous period" (`vs=prev`) change chips | `/v1/query/overview` on the previous period (`lib/compare.ts`) | all | present: `vs=prev` in the route, chips on the 8 tiles against `previousPeriod` of the filter bar (`api/tt/compare.ts`) |
| "Why?" per tile → Explain panel (`explain=<metric>`) | POST `/v1/query/explain` | all | present (analytics): "Why?" under each chip (tiles with an explain metric), `explain=<metric>` in the route opens the Explain panel (`features/typetorch/explain.tsx`) |
| 4 bar charts (players, new players, sessions, playtime h), per day or per step for ≤ 1 day, previous period dashed | `/v1/query/overview` | all | present: 4 BarCharts per day or per step (the backend's `bucketMs`), empty days / steps filled with 0 like the web's fillDays / fillSteps, previous period dashed by position, deploy marks |
| Deploy marks on every chart + toggle, click → deploy page | GET `/v1/fleet/marks`, GET `/v1/live-events` | all | present on all 4 Overview charts (tap a mark for its card, one Deploys toggle) |
| Pinned saved-query tiles (table / bar / line) | GET `/v1/saved-queries`, POST `/v1/sql` | all | present (analytics): `features/typetorch/sql-result.tsx` `PinnedQueries` / `SavedQueryTile` (chart or DataTable `saved-tile-<id>`, its own range, at most 200 rows; Open goes to `tt/query?tab=sql&saved=<id>`, the Query page now keeps `tab` and `saved` in the route) |
| Storage card: disk use by part, Parquet events / recording chunks, live rows, every 30 s | GET `/v1/storage` | owner | present (analytics, owners): `features/typetorch/owner-cards.tsx` `StorageCard`: disk warning, on disk / live / Parquet history / disk free / used, part bar + DataTable `storage-parts`, rows, today's raw batches vs the 7-day average with a change chip, every 30 s |
| Ingest-busy note (503 in the last minute) every 30 s | GET `/v1/admin/stats?window=1m` | owner | present (analytics, owners): `owner-cards.tsx` `IngestBusyNote` (`recentlyBusy` against the server's `now`, every 30 s), tap for Backend stats |
| App-only extras: live servers / players / need-a-look, errors 24 h, latest deploy, recent alerts | – | – | (app has them, web shows them on Fleet) |

## 3. Players & gameplay pages

### Players (`/players`) — `pages/Players.tsx`, `components/ChurnRisk.tsx`, `components/player-detail/*`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Player list (DataTable `players-list`), sort, search by pid / UserId (`find`) | POST `/v1/query/players`, GET `/v1/identity?uid=` | all | present (`tt/players.tsx`): DataTable `players-list` with server sort, funnel columns (`funnels` param) in Columns; the search text is `find` in the route (a link opens on it; a link's `find` that is a pid or a known UserId opens that player, like the web's top-bar Find player); a web link's `pid` opens the player page |
| Funnel progress columns (`funnels` param) with step popover | `/v1/query/funnel`, `/v1/query/funnel-progress` | all | present |
| Identity status + backfill | GET `/v1/identity`, POST `/v1/identity/backfill` | all | present |
| PlayerHover on every pid | GET `/v1/identity/<pid>/profile` | all | present: long-press any pid (`features/typetorch/cards.tsx` `PlayerHover`, `PidLink`, `NamedPlayerRow`, `playerColumns`) |
| Churn risk: active / at risk / lapsing / churned as of today (90 d), bucket list (`risk` param, DataTable `players-churn`), each player's numbers, notification opt-in per player, Export UserIds | POST `/v1/query/churn` | all; opt-in column + export owner | present (interaction 2, `features/typetorch/churn.tsx` on `tt/players.tsx`): bucket tiles (players, share, payers), `risk` in the route, DataTable `players-churn` with ChurnBadge, last played, days away, usual gap, play days, last 14 d / before, opt-in column when the backend sends it (owners), UserId column for Export; a row opens the player. Types in `api/tt/audience.ts`, the query through `api.raw` (`useTTRawQuery`) |
| Player detail inline (`pid`, `view`, `show`): profile card | GET `/v1/identity/<pid>/profile` | all | present (`tt/player/[pid].tsx`) |
| Funnel progress per funnel | `/v1/query/funnel-progress` | all | present |
| Views Spending, Playtime, Sessions (Chart / Table) | POST `/v1/query/player-stats` | all | present |
| Sessions table "Recording" column: a recorded session's "Replay" (web `StatViews.tsx` ReplayLink, `lib/commands.ts` replayHref: `tab=replay`, `sid`, `range=custom`, from / to = the session's UTC days) | `player-stats` (`recorded`) | all | present (`player/[pid].tsx` SessionsView, `features/recordings/links.ts` openSessionReplay): the filter bar is per backend, not in the URL, so the link sets the bar to custom from / to (other filters kept, like keptFilters), then opens `/tt/[backendId]/recordings` with `{ tab: "replay", sid }`; `PlayerSessionRow.recorded` added |
| Timeline view (drawn graph, `sid`, `moments`, `facet`, "View graph" per session, events table) | `/v1/query/timeline`, `/v1/query/player-graph` | all | present: drawn graph (`features/typetorch/graph-view.tsx`, list as a toggle), `sid` / `facet` / `moments` / `view` / `show` in the route, session events as EventTable `player-events`; first sessions have "Replay (if recorded)" (web `TimelineView.tsx`), same link as the Sessions table |
| Join data `jd` per session (pretty JSON, `trunc` badge) | from `timeline` rows | all | present (analytics): `features/typetorch/join-data.tsx` `JoinData` (collapsed, keys in the title row, `truncated` badge, pretty JSON) on each Timeline session card, one per session/join row with a `jd` |
| Errors view (`realm`), each → Errors `?fp=` | GET `/v1/players/<pid>/errors` | all | present |
| Feedback view | POST `/v1/query/feedback-list` (`pid`) | all | present (analytics): player page view `feedback` (`feedback-list` with the pid, newest 100, `FeedbackList` from `features/typetorch/feedback.tsx` without the player column) |
| Notifications view (consent, sends with opens / plays, intents; link to Notifications `?player=<pid>&by=pid`) | GET `/v1/notify/user?pid=` | owner | missing |
| Command "Copy this player's pid" | – | all | n/a (app has a Copy pid button) |

### Events (`/events`) — `pages/Events.tsx`, `components/EventTable.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Top events per kind (`kind`), pick one (`event`), newest rows in EventTable, `pid` filter, links keep filters | `/v1/query/top-events`, `/v1/query/events` | all | present (`tt/events.tsx`): DataTables `events-names` and `events-rows` (EventTable), `kind` / `event` / `pid` in the route, player cards |

### Funnels (`/funnels`) — `pages/Funnels.tsx`, `components/FunnelSteps.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Funnel steps (logged or built-in playtime funnels incl. 15/20/25/45-min marks), compare two + swap (`funnel`, `compare`), step → players reached / dropped (`stepFunnel`, `step`, `stepMode`, DataTable `funnel-players`) | `/v1/query/funnel`, `/v1/query/playtime-funnel`, `/v1/query/funnel-players` | all | present (`tt/funnels.tsx`): `funnel`, `compare`, `stepFunnel`, `step`, `stepMode` in the route; players as DataTable `funnel-players` |

### Flow (`/flow`) — `pages/Flow.tsx`, `components/LazyGraph.tsx`, `components/GraphView.tsx`, `components/MermaidButton.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Drawn graph (React Flow + dagre), facet toggle, moments toggle, sparse note, min moves, exits table, moves table, Copy Mermaid | `/v1/query/flow` | all | present (`tt/flow.tsx`): drawn dagre graph with pan / pinch / fit / full screen / direction, tap a state for its events, steps and moves (list as a toggle), `facet` / `moments` / `minCount` in the route, DataTables `flow-exits` / `flow-moves` |

### Retention (`/retention`) — `pages/Retention.tsx`, `pages/RetentionLtv.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Players tab: cohorts by join day D1–D30, in-progress day marked, weighted average | `/v1/query/retention` | all | present (analytics): `tt/retention.tsx` tab `view` = players / revenue; D1–D30 (DataTable `retention-cohorts`, hide days under Columns), today in progress in orange with a dashed border (`partial`, `todayElapsed`), weighted average pinned |
| "Why?" on the retention numbers → Explain panel | `/v1/query/explain` | all | present (analytics): "Explain the D1 change" button (`explain=d1`), the Explain panel on the page |
| Revenue tab (`view=revenue`): cohort LTV D0/D1/D3/D7/D14/D30, per player (creator revenue or Robux) or share who paid (`ltv` param), DataTable `retention-ltv` | `/v1/query/ltv` | all | present (analytics): `view=revenue`, `ltv` param (revenue / robux / payers), DataTable `retention-ltv` D0/D1/D3/D7/D14/D30 heat cells, today orange, weighted average pinned, Roblox cut in the note; tap a cell (the average row too) for the web's tooltip as a sheet: the value, Robux paid in total, payers, cohort size and the in-progress text for today |

### Demographics (`/demographics`) — `pages/Demographics.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Roblox cards (age group, gender, language, country, platform, OS as DAU) with the filters Roblox can apply and a "not applied" list; 409 → how to add `universe.analytics:read` | GET `/v1/roblox/demographics?from&to&dev&players&country` | all | present (analytics): `tt/demographics.tsx` From Roblox: six ranked bar lists (tap a row for its count), window label, applied filters, "Not applied here" (Roblox's list + the filters it can't take), 409 / missing scope → how to turn on `universe.analytics:read` |
| Our cards (country, language, device, account age, Premium; every filter) as ranked bar lists | `/v1/query/demographics` | all | present (analytics): From our events (`demographics` via `useTTRawQuery`, every filter), five cards with the web's info texts, account age in age order, Not sent last; country and language names from a static English table when Hermes has no `Intl.DisplayNames` (also Explain's segments) |

### Notifications (`/notifications`) — see §5 ops (owner-heavy).

### Feedback (`/feedback`) — `pages/Feedback.tsx`, `pages/feedback/shared.tsx`, `components/RangePicker.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Own range + device picker (no shell filter bar), 4 KPIs (Feedback, Rated, Average rating, With text / Thumbs up), one distribution per scale (thumbs / stars / labelled faces), trend (count + normalised rating), list with filters `rating`, `text`, `q` | `/v1/query/feedback-summary`, `/v1/query/feedback-list` | all | present (analytics): `tt/feedback.tsx`: own range (`RangePicker`) and device chips writing the per-backend state, 4 KPIs (Thumbs up when every scale is thumbs), a distribution per scale (thumbs / stars / labelled), trend (count bars + average % line), list (`rating`, `text`, `q` in the route, 300 ms search, 50 a page, Newer / Older) |

### First session (`/first-session`) — `pages/FirstSession.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Confusion signals: early leaves by zone, back and forth, screen loops, repeated clicks, idle spots, camera spin from recordings; each signal links to Recordings (replay list filtered) | `/v1/query/confusion` | all | present (`tt/first-session.tsx`): idle / camera spin / repeated clicks rows have "Replays" (Recordings, `tab=replay&signal=…&zone=…` / `target=…`; the filter bar is per backend, so kept); header link "Maps, replays and quit autopsy". Signals are DataTables `first-session-<id>` (early-leave, screen-loops, back-and-forth, idle, camera-spin, repeated-clicks) with the web's columns and a Replay column (interaction 2) |

### Recordings (`/recordings`), Maps (`/maps`) — see §5 maps-live / recordings.

### Economy (`/economy`) — `pages/Economy.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Currency picker (`currency`), earned vs spent per day, running balance, per active player, top sources / sinks tables | `/v1/query/economy` | all | present (`tt/economy.tsx`): `currency` in the route; DataTables `economy-sources` / `economy-sinks` |

### Monetization (`/monetization`) — `pages/Monetization.tsx`, `components/ProductId.tsx`, `lib/products.ts`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Revenue / purchases / payers / ARPDAU per day (bar → day's buyers `buyersDay`), by product (row → buyers `buyers=<kind>:<id>`), payer conversion, ARPPU, repeat rate, time to first purchase, top buyers, latest purchases; ProductId hover card (icon, name, type, price, "Show only this") | `/v1/query/monetization`, `/v1/query/monetization-players`, `/v1/query/monetization-purchases`, GET `/v1/roblox/products` | all | present (`tt/monetization.tsx`): `buyers` / `buyersDay` in the route, DataTables `monetization-products` / `-buyers` / `-day-buyers` / `-product-buyers` / `-purchases`, product id card on tap with Show only this, kind filter, deploy marks |

### Live events (`/live-events`) — `pages/LiveEvents.tsx`, `lib/live-events.ts`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Live now / Upcoming / Past lists (every 60 s; `refresh=1`) | GET `/v1/live-events` | all | present (analytics): `tt/live-events.tsx` (every 60 s, "Check again" = `refresh=1`), signing card with bash / PowerShell commands (copy, each scrolls inside its 160 px box like the web's `max-h-40 overflow-auto`) and Download JSON (share sheet; when sharing fails, a message and Copy JSON) |
| Schedule form (name, values JSON, start / end UTC with local time) | POST `/v1/live-events` | owner | present (analytics, owners): name, values JSON, start / end as UTC `YYYY-MM-DDTHH:MM` with the phone's local time under each, "Start now", note |
| Cancel | POST `/v1/live-events/<id>/cancel` | owner | present (analytics, owners): Cancel with a confirm |
| Signing card: CLI command (bash / zsh, PowerShell + Download JSON) when servers lack the schedule; servers' schedule | from the responses (`SignCommands`) | owner | present (analytics): the signing card (needsSigning: warning callout with the bash / zsh and PowerShell commands, Copy each, Download JSON through the share sheet, for owners; others see who runs it) or the servers' schedule card with the signed record line; "Check again" |
| Lift report: baseline weeks, days after, per-metric lift vs normal range, pulled-forward check, verdict | GET `/v1/live-events/<id>/lift?weeks&afterDays` | all | present (analytics): Lift report per live / past event: baseline weeks 1–8 and days after 0–7 steppers, verdict, per-metric event / baseline / lift (normal range) / after, net, baseline notes |
| Event start / end as chart marks | GET `/v1/live-events` | all | present (interaction): start / end marks on every chart with deploy marks (`features/typetorch/marks.tsx`, GET `/v1/live-events`); the Live events page is the analytics group's |

### Experiments (`/experiments`) — `pages/Experiments.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Per-variant numbers, comparisons with the control (Holm), mixed / forced players note | `/v1/query/experiment` | all | present (`tt/experiments.tsx`): DataTables `experiment-variants`, `experiment-comparisons` (in words, metric, control, variant, lift, sure, can detect, time to tell, test + p-values hidden), `experiments-list` (state, weights with note, variants seen, assigned, forced; a row opens its players) |
| Sample ratio check (loud mismatch alert, chi-square p, `srm-line`) | `/v1/query/experiment` (`check.srm`) | all | present (analytics): `SampleRatio` (critical callout on a mismatch, quiet split line otherwise); the override's weights are sent as the intended split; forced players note; `AssignmentCheck` type |
| "Can detect" (MDE at 80 % power) and time-to-tell columns | `/v1/query/experiment` | all | present (interaction 2): columns of `experiment-comparisons` ("–" from servers that don't send them) |
| Experiments list with state and weights | GET `/v1/experiments` | all | present |
| Players in an experiment / variant (`assigned`, `assignedVariant`) | GET `/v1/experiments/<e>/players` | all | present |
| Control: Start, Stop, Clear, Change split (weights), Settle on a variant → prepared signed CLI command ("See the change first", "Run in the game's folder") | POST `/v1/experiments/<e>/change` | owner | present (analytics, owners): "Run it" panel: Start, Stop, Clear override, Change split (weights per variant, game order when known), Settle (chips) → the prepared command and its dry run with Copy, notes |
| `scope` / `experiment` params | – | all | present: `scope`, `experiment`, `assigned`, `assignedVariant` in the route; players as DataTable `experiment-players` |

### Session time (`/session-time`) — `pages/SessionTime.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Avg session length per bucket by end / start (`by`), total and per device (`split`), playtime, playtime / player, sessions (`metric`), merge rejoins (`merge`), bucket (`bucket`), smoothing (`smooth`), Roblox-style headline vs previous period, length histogram, per-step table | `/v1/query/session-time` | all | present (analytics): `tt/session-time.tsx`: `metric`, `split`, `total`, `bucket` (steps over 2000 per range disabled), `smooth`, `by`, `merge` in the route; 6 tiles vs the period before with info, line chart total + per device (fixed device colours, the web's `DEVICE_COLORS`; empty steps stay gaps, `connectNulls={false}` via LineChart `gaps`), histogram, DataTable `session-time-steps` |

### Roblox (`/roblox`) — `pages/Roblox.tsx`, `components/RobloxAcquisition.tsx`, `lib/benchmarks.ts`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Benchmark cards period over period (`period` 7/28), 50th / 90th editor (browser-kept), Differs badges | `/v1/query/benchmarks` | all | present (`tt/roblox.tsx`, phone-kept) |
| Realtime column (CCU sparkline, players, new, playtime, session time, client error rate, client FPS, server memory; every 30 s) + link "Session time by time step and device" | `/v1/query/realtime`, GET `/v1/fleet/servers` | all | present (analytics): the filter bar's range sets the window (`realtimeHours`), players / new / playtime / playtime per player rows, sessions and running, "Explore session time" → `tt/session-time.tsx` |
| Concurrent players by device: live now per device chips, hourly avg / peak lines (`devCcu`) | `/v1/query/realtime` (`devices`) | all | present (analytics): live-now chips per device with shares, hourly average / peak lines (`devCcu` in the route), Ours note; fixed device colours (`api/tt/perf.ts` `DEVICE_COLORS` / `deviceColor`, the web's palette slots) |
| Acquisition from Roblox (play-through funnel; 409 hint) | GET `/v1/roblox/analytics/acquisition?days` | all | present |
| Trends per join source: metric (`trend`), range 0/3/7/14/28/56/90 d (`trendDays`), granularity 6 h / 12 h / daily / 7-day MA (`trendWindow`) | `/v1/query/trends` | all | present (analytics): `trend`, `trendDays` (0/3/7/14/28/56/90), `trendWindow` (6 h / 12 h / daily / 7-day average; today only 6 h / 12 h) in the route, D1 per-day note, running bucket noted; empty buckets stay gaps (LineChart `gaps`, the web's `connectNulls={false}`) |
| How these are calculated | – | all | present |

## 4. Observe & troubleshoot pages

### Fleet (`/fleet`) — `pages/Fleet.tsx`, `components/HealthReasons.tsx`, `components/ServerLocation.tsx`
| Item | Route(s) | Role | App (`tt/fleet.tsx`) |
| --- | --- | --- | --- |
| Live servers table (DataTable `fleet-servers`): health badge + reasons popover, players, build, branch, kernel, TPS, memory, place version, budget pressure (DataStore / HTTP vs Roblox limits), country, address (owners), JobId → server page; branch filter (`branch`) | GET `/v1/fleet/servers?branch` | all; IP owner | partial: list + branch chips + versions; no budget, location or table features |
| Game-declared columns (hidden until picked in Columns) | GET `/v1/fleet/columns` | all | missing |
| Live events feed (SSE: server, alert, alert_ack, report, deploy) and query invalidation | SSE GET `/v1/fleet/stream?branch` | all | present: `features/typetorch/live-feeds.ts` `useFleetStream` (XHR streaming with the Bearer token, reopened with a backoff), refetches the app's own queries: `server` → Fleet servers / gone, `alert` / `alert_ack` → the alerts queries (home's recent alerts), `report` / `deploy` → the deploy list and deploy pages; "Live events" log (50); servers poll every 5 s while the stream is down and every 60 s while it is live (web: 30 s always). Opened without `?branch` (the branch chips filter on the phone, so it carries every branch). Only while the screen is focused. No Alerts / deploy report sections on the app's Fleet yet (rows below) |
| Latest deploy: results, server reports, deploy errors (DataTables `fleet-results`, `fleet-reports`, `fleet-deploy-errors`) | GET `/v1/fleet/reports?latest&branch` (or `?seq` / `?artifact`) | all | missing (app home shows the latest deploy row only) |
| By country (DataTable `fleet-countries`) + DB-IP credit | from servers | all | missing |
| Alerts (90 days, newest first, bundle link) | GET `/v1/fleet/alerts` | all | partial: home shows 5 recent alerts; ack only on `tt/deploy/[seq].tsx` |
| Recently gone (DataTable `fleet-gone`) | GET `/v1/fleet/servers?gone=1` | all | present (+ `tt/server-history.tsx`) |

### Live map (`/live`) — see Maps and Live map below (§5), app `tt/live.tsx`.

### Server (`/servers/:jobId`) — `pages/Server.tsx`, `pages/server/*`, `lib/remote-debug.ts`, `lib/live-streams.ts`
| Item | Route(s) | Role | App (`tt/server/[job].tsx`) |
| --- | --- | --- | --- |
| Header: state, health + reasons, build, branch, kernel, place version, players, last heartbeat, location, network, IP | GET `/v1/fleet/servers/<job>` | all; IP owner | present |
| Offline history: Offline badge, Timeline (alerts, reports, generation swaps, close / loss), whole-life charts | same (`history`) | all | present |
| Debug bundles list + bundle view (`bundle`): summary, Players, Server log, Player logs (owners), Deploy and swaps | `history.bundles`, GET `/v1/fleet/bundles/<id>` | all; player logs owner | present (`tt/bundle/[id].tsx`) |
| Errors it reported (30 d) → Errors `?fp=` | GET `/v1/servers/<job>/errors` | all | present (24 h list) |
| Roblox logs (Open Cloud server logs: search, order, page token, place version) | GET `/v1/roblox/servers/<job>/logs` | all | missing |
| Debug session: watch every 20 s, Connection status (waking / connecting / connected) | POST `/v1/fleet/servers/<job>/watch` | owner | missing |
| Remote command plumbing (queue, poll result ≤ 15 s) | POST `/v1/fleet/servers/<job>/commands`, GET `.../commands/<id>` | owner | missing (`remoteCommand` defined in `api/backend.ts`, unused) |
| Status tab: TPS / memory / players last hour with deploy marks + kernel `status` op | GET `.../metrics`, op `status` | metrics all; op owner | partial: metrics charts with deploy marks (tap for the card, toggle); no `status` op |
| Logs tab: server log ring (`logs`, "Fetch newer"), player client logs (`player.logs`) | ops | owner | missing |
| Players tab (`players`: dev, ping, account age, client start; "Logs") | op | owner | missing |
| Game tab: game commands (`game.<name>`, table / kv / JSON answers), Streams latest values (~1 s) | ops, GET `.../streams?since` | owner | missing |
| Live map tab (positions 2 Hz on the exported map, 20 s trail, `points` markers) | GET `.../streams`, maps geometry | owner | present as its own screen `tt/server-map/[job].tsx` (linked from the server page for live servers; holds the server watch 20 s, polls streams ~1 s, `features/maps/LiveMap.tsx`) so drags move the map, not the page |
| State tab (`state`: roots, 100-entry pages, key filter, breadcrumb) | op | owner | missing |
| Dex tab (`dex.children` lazy tree, `dex.props` properties / attributes / tags) | ops | owner | missing |
| Modules / Builds / Budget / Errors / Network tabs (13 tables) | ops `modules`, `assets`, `builds`, `budget`, `errors`, `network` | owner | missing |
| Audit tab (remote debug audit) | GET `/v1/fleet/debug/audit` | owner (hidden for `web`) | missing |

### Server history — app-only page `tt/server-history.tsx` (web shows it inside Fleet "Recently gone"): present.

### Deploys (`/deploys`, `/deploys/:seq`) — `pages/Deploys.tsx`, `pages/DeployDetail.tsx`, `lib/deploys.ts`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| History a page at a time, branch filter (`branch`) | GET `/v1/fleet/deploys?branch&before&limit` | all | present (analytics): `branch` text filter in the route (GET `/v1/fleet/deploys?branch`), 50 a page, empty text names the branch |
| Deploy page: release card, server reports or kept summary, kept deploy errors, alerts (ack), prev / next | GET `/v1/fleet/deploys/<seq>`, POST `/v1/fleet/alerts/<id>/ack` | all; ack owner | present (`tt/deploy/[seq].tsx`) |
| Error kinds before vs after (two equal windows) | GET `/v1/errors` ×2 | all | present (analytics): `tt/deploy/[seq].tsx` Before vs after: `hours` (1 h / 6 h / 1 d / 3 d each) in the route, 4 tiles, DataTable `deploy-error-changes` (new kinds first; a row opens the kind) |
| Key performance before vs after | POST `/v1/query/perf-compare` (`mode: around`) | all | present (analytics): `perf-compare` mode around, the Performance page's compare table (moved to `features/typetorch/perf-compare.tsx`, shared) |

### Errors (`/errors`) — `pages/Errors.tsx`, `components/ErrorDropRules.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Tiles (errors, kinds, players affected) with compare chips (`vs=prev`) | GET `/v1/errors` (+ previous window) | all | present (interaction 2, `tt/errors.tsx`): `vs=prev` switch, chips on Errors / Kinds / Players affected against the window before (`previousWindow`), plus the Trend step tile |
| Window, realm, search `q`, build, branch filters; sort (`sort=`) | GET `/v1/errors?window&realm&q&build&branch&sort` | all | present (interaction 2): `window` (1h, 6h, 24h, 7d, 30d), `realm`, `branch` (text), `build` (chips from the window's builds), `q`, `fp` (opens the kind page) in the route; server sort on `count`, `lastAt`, `firstAt`, `total`, `realm` (`KIND_SORT_COLUMNS`, `sort=`, limit 200); a row opens the kind with the list's window, realm, branch and build |
| Trend chart with step choice and deploy marks | same | all | present: the window's step (Trend step tile), sparkline per kind, the kind page's occurrence bars with deploy marks; plus a total trend on the list (every listed kind per step, bars at the backend's bucket starts `floor(from / step) * step` as `errors/store.ts` bucketIndex, deploy marks of the list's branch; analytics); the kind page's deploy marks follow its branch (`useDeployMarks(…, branch)`) like the web's SeriesBars |
| Kinds table (`errors-kinds`) | same | all | present: DataTable `errors-kinds` with the web's column ids (`error`, `realm`, `count`, `players`, `trend`, `firstAt`, `lastAt`, `total`, `fp`) |
| Live new errors (SSE topic `error`) | SSE GET `/v1/live?topics=error` | all | present: `useErrorStream` (debounced 1.5 s refetch, status badge live / connecting / retrying; polls every 30 s while down) |
| Kind side sheet (`fp`): where, stack, by side / build (→ deploy or Performance) / branch, servers | GET `/v1/errors/<fp>` | all | present (`tt/error/[fp].tsx`): every list window; realm, branch and build from the route (removable chips) and sent to the kind and players reads |
| Players who hit it (`errors-players`) | GET `/v1/errors/<fp>/players` | all | present (interaction 2): DataTable `errors-players` on the kind page (player with card, UserId, times, days, first / last seen, side; rows for occurrences that named nobody), refetched every 30 s |
| Drop rules: list with drop counts, editor with live preview, save | GET `/v1/errors/drop-rules`, POST `.../preview`, PATCH `/v1/admin/settings` (`errorDropRules`) | list all; edit owner | missing |

### Performance (`/performance`) — `pages/Performance.tsx`, `components/PerfChart.tsx`, `components/PerfFlag.tsx`, `lib/perf*.ts`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Client and server percentiles over time by group (`by`, `pct`, `step`), flags, deploy marks (`mark`, `marks`), vs previous period, live servers with history (`job`), compare builds / before-after (`cmode`, `cmp`, `around`, `hours`) | `/v1/query/perf-client`, `/v1/query/perf-server`, `/v1/query/perf-compare`, `/v1/query/values`, GET `/v1/fleet/marks`, `/v1/fleet/servers`, `.../metrics` | all | present (`tt/performance.tsx`): live-event marks, tap a mark for its card, `by` / `pct` / `step` / `mark` / `marks` (on / off: hides this page's marks; the switch writes it and the remembered toggle) / `vs` / `cmode` / `cmp` / `around` / `hours` / `job` in the route, DataTables `perf-<side>-groups`, `perf-compare-<mode>`, `perf-live-servers` (the web's columns, flags, History button; a row opens the history charts) |

## 5. Data and Admin pages

### Query (`/query`) — `pages/Query.tsx`, `components/SavedQueryView.tsx`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Named query + JSON filters / options (`q`), read-only SQL with limit, saved queries (`saved`; owners save, rename, chart, pin, delete), result as table / chart, CSV / copy | GET `/v1/queries`, POST `/v1/query/<name>`, POST `/v1/sql`, `/v1/saved-queries` GET / POST / PATCH / DELETE | run all; edit owner | present (`tt/query.tsx`): DataTable `query-sql` (SQL types, CSV / JSON file through the share sheet, CSV / TSV / JSON copy) |

### Settings (`/settings`, owner) — `pages/Settings.tsx` + cards
| Item | Route(s) | App (`tt/settings.tsx`) |
| --- | --- | --- |
| Runtime settings groups Alerts, Backend alerts, Access, Rate limits, Retention and error budgets, API keys, Notifications: edit, "Reset to env", secret webhook as write-only field | GET / PATCH `/v1/admin/settings` | partial: read-only list |
| Test alert | POST `/v1/admin/settings/test-alert` | missing |
| Backend alert rules: master switch, repeat window, hourly cap, per rule on / off / level / thresholds, last-run status | GET `/v1/admin/alert-rules`, PATCH settings `backendAlerts` | missing |
| Sign in with typetorch.dev: on / off, fingerprint, trusted browsers (revoke), trust this browser | GET `/v1/admin/devices`, DELETE `/v1/admin/devices/<id>`, POST `/auth/device` | missing (revoke is the useful part on a phone) |
| Backups and disk: schedule, local backups, Back up now, Download backup (tar), disk warning | GET / POST `/v1/admin/backups`, POST `/v1/admin/backups/download` | missing |
| Migration: state, source, rows copied, steps, per-day report; pause / resume / cancel / resolve (resend / skip); start form (URL + token) | GET / POST `/v1/admin/migrate` | missing |
| Recent changes (settings audit, DataTable `settings-audit`) | GET `/v1/admin/audit?action=settings…` | missing |
| App-only: this device, app sessions (`/v1/auth/mobile/tokens`), experience link, health | – | present (WIP backend branch only) |

### Backend stats (`/backend`, owner) — `pages/BackendStats.tsx`

| Item | Route(s) | App |
| --- | --- | --- |
| Requests, DuckDB, rows in / loaded, SQLite, latency p50/90/99, memory, CPU, loop lag, 2 min / 1 h, Live 2 s poll, routes table | GET `/v1/admin/stats?window` | present (`tt/backend-stats.tsx`) |

### Audit log (`/audit`, owner) — `pages/AuditLog.tsx`

| Item | Route(s) | App |
| --- | --- | --- |
| Filters actor / action / outcome (URL), facets, pages | GET `/v1/admin/audit` | present (`tt/audit.tsx`): `actor` / `action` / `outcome` in the route, DataTable `audit-log`, entry sheet |

### Notifications (`/notifications`) — `pages/Notifications.tsx`, `pages/notifications/*`
| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Header: live status chip + queue popover (15 s), dry run badge, own range picker, kind (`kind`), Send a test | GET `/v1/notify/status` | status owner | missing |
| 4 KPIs: Subscribers (known), Sent, Opened, Came back next day | `/v1/query/notify-funnel`, `/v1/query/notify-optin` | all | missing |
| Health tab: status sentence, who can get them, opened / back-next-day per day, Needs attention (`attention.ts`) | queries above + status | all (status owner) | missing |
| Funnel tab: prompt → subscribed → sent → opened → played 1 min+ → back next day, 3 insight cards, sends and opens per day, totals, opt-in by spot | `/v1/query/notify-funnel`, `/v1/query/notify-optin` | all | missing |
| Inbox tab: newest sends (15 s), filter chips, search, side panel (consent, request / answer, join data, earlier sends, intents) | GET `/v1/notify/recent?limit&kind`, GET `/v1/notify/user` | owner | missing |
| Player panel (`player`, `by` = uid / pid / name): consent, mute, kinds off in game, prompt rows, sends with opens / plays, intents | GET `/v1/notify/user` | owner | missing |
| Subscribers tab: state chips with counts, search, keyset pages, CSV | GET `/v1/notify/users`, `?format=csv` | owner | missing |
| Kinds tab: per kind sent / opened / played / back / skipped / pending, on / off switch, funnel per kind and day | `/v1/query/notify-funnel`, PATCH `/v1/admin/settings` | switch owner | missing |
| Queue & errors tab: right now, queue history per hour, planned / skipped by why, failures by HTTP status and code | `/v1/query/notify-queue`, GET `/v1/notify/status` | live part owner | missing |
| Settings tab: `notify.*` (pause, dry run, rate ceiling, stale hours, day clock), test send with preview, kinds config, config record | PATCH `/v1/admin/settings`, POST `/v1/notify/test`, GET `/v1/notify/config` | owner | missing |

### Maps (`/maps`) — `pages/Maps.tsx`, `lib/maps.ts`, `lib/map-view.ts`, `lib/map-textures.ts`, `components/maps/*`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Export card: last export (when, place version, parts), out of date, Export (owners) with progress, maps without a model | GET `/v1/maps`, POST `/v1/maps/export` | export owner | present (`tt/maps.tsx`; Export behind a confirm, 1.5 s poll while running, geometry refetched when done; + earlier exports line) |
| Map picker, 2D / 3D, Y band (floors, free range), draw toggles (decorative meshes, markers), draw rule | GET `/v1/maps/<name>/geometry` (binary TTMP) | all | present (`features/maps/maps.ts` TTMP v1 / v2 decoder, `BandControls.tsx` floors + two-thumb range, "Bigger" map toggle: the GLView is remounted at the new size, since expo-gl's drawing buffer keeps its first size); geometry download allowed 120 s (`MAP_GEOMETRY_TIMEOUT_MS`; the web has no deadline, other calls keep 30 s) |
| Layers: one per positioned event (`px/py/pz`), dots or heat cells 0.5 / 1 / 2 studs, filter bar applies | `/v1/query/map-positions`, `/v1/query/recording-layers` | all | present |
| Alignment: positioned events vs geometry or recordings; apply suggested offset / set model path; remove | PUT / DELETE `/v1/maps/<name>/override` | owner | present (recordings fallback via `recording-layers`, waits for the saved filter bar (`pending`) and sends `cleanFilters` like the web's useAnalytics; unconfirmed-zone note; offset and remove behind confirms) |
| Textures / decals | GET `/v1/images/<id>` (200 / 202) | all | partial (`features/maps/images.ts`: a PNG / JPEG 200 written once to the cache dir, uploaded as an expo-gl `{ localUri }` texture; 202 / 429 / 5xx retried 4 s .. 2 min; decals, textures, MaterialVariants, material look). WebP images are skipped (the part keeps its colour): expo-gl decodes `localUri` with stb_image, which has no WebP decoder, so the bytes are sniffed (PNG / JPEG magic) and a cached file is checked again before use. The web draws WebP |
| View state in URL (map, view, band, toggles, cell) | – | all | partial: one view state per backend in memory (`features/maps/hooks.ts` useMapView, shared by Maps / Live / server live map), not in a link (`map-view.ts` keeps the URL form) |

### Live map (`/live`) — `pages/Live.tsx`, `pages/live/LiveMap.tsx`, `lib/live-map.ts`, `lib/live-streams.ts`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Fleet-wide watch every 20 s, read latest positions every 3 s, dots moved between frames, colour per server, list per server, map switcher, follow player (cut roofs), name on hover, trail, `points` markers; read-only role gets a note | POST `/v1/fleet/live-map/watch`, GET `/v1/fleet/live-map` | owner | present (`tt/live.tsx`, `features/maps/LiveMap.tsx`): hover is a tap (name label + follow); following also keeps the player in the middle of the view; the watch, poll and 10 Hz ticker stop while another screen is on top (a pushed server page), so the watch lapses like the web's |

### Recordings (`/recordings`) — `pages/Recordings.tsx`, `pages/recordings/*`, `components/maps/PlayerScene.tsx`, `components/maps/avatar.ts`, `lib/anim-clips.ts`, `lib/asset-images.ts`

| Item | Route(s) | Role | App |
| --- | --- | --- | --- |
| Page description (PageHeader: "New players' first sessions, recorded from spawn until a minute after their first input: …") | – | all | present: a Note at the top of every tab's body, above the filter bar (TTScreen has no subtitle) |
| Map layers tab: map pick, layers (path density, idle spots, deaths, screens, buttons, quits, positioned events), filter by values / zone / screen, cell click → sessions there | `/v1/query/recording-layers` | all | present (`tt/recordings.tsx` LayersTab): layer chips with colour dots and counts, value chips (16) + show all, split-by-prop input for event layers, zone / screen inputs, map chips, legend, "Sessions in this cell" (compact list, `recording-sessions` with `box` / `layer`); a tap is the click. Map fixed on top, controls scroll under it |
| Real map (exported geometry, 2D / 3D, points / heatmap, cell size, band, follow player) or SVG silhouette fallback | GET `/v1/maps`, `/v1/maps/<name>/geometry` | all | present (`features/recordings/RealMap.tsx` on the maps' MapScene / renderer; `MapView.tsx` react-native-svg, cells of one shade batched into one path): 2D / 3D, Points / Heatmap, 0.5 / 1 / 2 stud cells (default 2), band (All / floors / range; Follow player, the replay default), picked cell outlined, 3D tap = nearest dot or heat cell; geometry error falls back to the SVG. Per-cell hover titles have no phone twin (legend + tap) |
| Replay tab: session list (from a cell, a quit, First session signals; `Session or player id` search) | `/v1/query/recording-sessions` | all | present: How it ended (All / Quit / Played on), id search, signal badge with clear, rows (id, Extended, ended, length, started, device, maps, signals, Replay) |
| Replay player: path, moving dot, camera cone, timeline of inputs / events / confusion signals, scrubber, play / pause, speed, back to start, AFK spans, captions strip, FPS strip | `/v1/query/recording-replay` | all | present (`features/recordings/ReplayPlayer.tsx`): view + transport fixed on top (play / pause, back to start, previous / next mark, clock, drag scrubber, timeline with hatched AFK spans and marks, a tap jumps to the nearest mark within 14 dp), speed 0.5–8x, badges, map / zone / screen, captions strip and FPS strip (tap to jump), Just happened (tap to jump), key presses. Marks are 3 dp lines (the web's 4 px buttons are too small for a finger) |
| Player view (plans/36): 3D from the recorded camera (FOV), R6 / R15 avatars with body colours + clothing, entities, poses from clips blended with recorded joints, free camera, tap rings, caption, AFK, legend, entity / UI properties | `recording-replay` (tt-ext-1), GET `/v1/anims/<id>`, GET `/v1/images/<id>` | all | present (`PlayerView.tsx`, `PlayerScene.tsx` on MapScene + `MapRenderer` actors / `setView` / `pickActor` / new `texture`, `avatar.ts` ported 1:1, `ext-replay.ts` ported 1:1, `assets.ts` = anim-clips + asset-images): viewport at the recorded aspect (≤ 50% of the screen height), Recorded / Free camera, UI toggle, tap rings, caption, AFK, legend, on-screen list with tracks, entity / UI properties. Hover name = shown where a person was tapped. Clothing goes through the map image cache (PNG / JPEG only: expo-gl's stb_image has no WebP, so a WebP-only clothing image stays body colours); the default face is a drawn DataTexture (no canvas). tt-ext-1 is decoded by the backend (JSON), so no binary decoding on the phone. Not yet run on a device (typechecked; avatar / ui-state / ext-replay smoke-run in Node) |
| UI overlay: recorded GuiObjects at their absolute rects, clipping, gradients, image tint, fonts, rich text, select a node | `recording-replay` (tt-ext-1 `ui`) | all | present (`UiOverlay.tsx`, `ui-state.ts` ported 1:1): rects scaled to the viewport, inset, rotation, clipping (a holder view at the ancestors' clip rect, overflow hidden), UIGradient (RN `experimental_backgroundImage` linear-gradient painted over the background colour, like the web), corner, UIStroke (boxShadow spread; a node's own box never clips, like the web: unwrapped text runs past its box, and the image is drawn in an inner overflow-hidden layer with the box's corner radius, the web's `borderRadius: inherit`, so a stroke stays visible while UICorner rounds the image), image tint (tintColor copy with `mixBlendMode: multiply`), ImageRect, 9-slice / Tile / Fit / Crop from cut-out pieces, rich text as nested Text, tap a node to select (tap again clears: no Escape). Images via RN Image from cached files (PNG / JPEG / WebP / GIF). Fonts: phone fonts only (monospace / serif / system), not the web's font stacks. Text stroke (TextStrokeColor3): the web's 4-direction hard text-shadow outline at d = max(0.5, scale) is four copies of the text in the stroke colour at ±d in x and y under it (RN has one blurred textShadow only), so it matches the web's outline, not Roblox's round stroke |
| Quit autopsy tab: last seconds before quitting classified vs stayers; tutorial step, screen open, where they stood, how it ended | `/v1/query/quit-autopsy` | all | present: 5 / 10 / 20 / 30 s (`win`), stats, reasons with share bar (red at lift ≥ 1.5), of the others, lift / only quitters, example replays; screen / tutorial / map-part sections. Rows are two-line list rows, not a table |
| First actions tab: seconds from spawn to first move / screen / button / prompt / round, by device and build | `/v1/query/first-action` | all | present: per action median, reached, middle half, histogram bars, slowest / never replays; by build / by device as sideways-scrolling tables |
| Sampling note; tab / map / layers / view / session in the URL | – | all | present: sampling / notes lines; `tab`, `map`, `layers`, `mode`, `draw`, `cell`, `band`, `sid`, `cam`, `why`, `q`, `signal`, `zone`, `target`, `win` in the route params (2D / 3D and Points / Heatmap fall back to the backend's shared map view when absent); value / split / zone / screen filters are screen state, as on the web |

## 6. Shared interaction pieces

| Item | Web file | App |
| --- | --- | --- |
| DataTable (used by ~40 tables): click-sort asc / desc / off, shift multi-sort by raw value; global search; per-column filters (checklist, range, last 24 h, contains) with chips; Columns picker + reset; drag widths; sticky header; "12 of 340 rows"; paging; copy cell / row JSON; CSV export of the filtered view; copy link to the view; view remembered per table id (localStorage) and in the URL (`<id>.sort=-players`) | `components/data-table/{DataTable.tsx,model.ts,use-table-view.ts,clipboard.ts}` | present (`features/typetorch/table/`: model.ts ported, DataTable.tsx, view.ts, export.ts): tap = sort, long-press = add to the sort, search, filter sheets (checklist, range, since, contains) with chips, Columns (show / hide, wider / narrower, reset), "x of y rows", paging, long-press / ⋯ = copy cell / row JSON, Export sheet (CSV / JSON file via expo-file-system + expo-sharing, CSV / TSV / JSON copy, copy link, reset), views per backend + table id in AsyncStorage and in links (`<id>.sort`, `<id>.f.<col>`); no drag widths (− / + in Columns), no sticky header (pages instead of an inner scroll). Tables switched: every former MiniTable plus players, player purchases / sessions / events / errors, events, funnels, experiments (variants, comparisons, list), economy, monetization, flow, audit, deploys, server history, errors kinds and players, Performance live servers, First session signals, churn; Fleet / server / deploy-detail / bundle lists stay lists (ops pages) |
| Deploy markers on every time chart: release, rollback, promote, resign, kernel, backup, live-event start / end; grouped per bar; hover card; click → deploy page; one remembered show / hide toggle | `components/DeployMarkers.tsx`, `lib/perf.ts` | present (`features/typetorch/marks.tsx`, `charts/LineChart.tsx`): every kind incl. live-event start / end, flags + labels (≤ 6), grouped per bar, tap a line for its card (title, time, from, place version, results, open deploy / live events), one remembered show / hide switch (AsyncStorage); on Overview, error kind bars, server status, Performance (+ live servers), Backend stats, Monetization |
| Player hover card (headshot, display / user name, UserId, pid; after a short hover) | `components/PlayerHover.tsx` | present: long-press (headshot, names, UserId, pid, Open player, Copy pid / UserId) |
| Product id card (icon, name, type, price, Show only this) | `components/ProductId.tsx` | present: tap an id (`features/typetorch/cards.tsx` `ProductId`: icon, name, type, price, Show only this inside a DataTable, Copy id), `ProductKind` filter |
| Compare toggle `vs=prev` + change chips | `components/CompareToggle.tsx`, `components/ChangeChip.tsx`, `lib/compare.ts` | present on Overview, Errors, Performance (`vs=prev` in each route) and Session time / Roblox realtime (always against the period before, like the web); `api/tt/compare.ts`, `features/typetorch/bits.tsx` `ChangeChip` |
| Explain panel (`explain=<metric>`, headline, per dimension rate / mix diverging chart, tables, one-level drill) | `components/ExplainPanel.tsx`, `lib/explain.ts` | present (analytics): `features/typetorch/explain.tsx` (bottom sheet): metric chips, headline (`api/tt/explain.ts`, ported), before / now, dimension chips ranked, diverging rate / mix bars, segments with both periods, one-level drill and "All players"; on Overview and Retention |
| Drawn node graph (React Flow + dagre, pan / zoom, facet, moments) + Copy Mermaid | `components/GraphView.tsx`, `components/LazyGraph.tsx`, `lib/graph.ts` | present: dagre + react-native-svg, gesture-handler pan / pinch + reanimated, zoom / fit / direction / full screen buttons, tap a state for its details and moves; list view as a toggle; Copy Mermaid. Full screen is a react-native Modal, which on Android is its own native root outside the app's GestureHandlerRootView, so its content has its own GestureHandlerRootView (`graph-view.tsx`). Pan / pinch / tap in full screen are not yet tested on a device |
| Charts: DayBars (per day / step, previous dashed, bar click), PerfChart, Sparkline, recharts | `components/DayBars.tsx`, `PerfChart.tsx`, `Sparkline.tsx` | present: LineChart (scrub, tappable marks), BarChart (tap a bar, previous period dashed with `previous`, tappable marks), Sparkline, ShareBars |
| 3D / 2D map renderer (three.js instanced meshes, orbit + fly keys, ortho 2D, clipping band, see-through looks, textures) | `components/maps/{map-renderer.ts,MapScene.tsx,BandControls.tsx}` | present: `features/maps/{renderer.ts,MapScene.tsx,BandControls.tsx}` on expo-gl + three (one finger turns / pans, two fingers pan, pinch zooms toward the fingers, tap picks, Fit, `focus`; actors / `setView` / `pickActor` / `texture` used by the recordings' Player view through MapScene's `onRenderer` / `onTap`); WASD fly keys have no phone twin. Types for three in `src/types/three.d.ts`. A new view size remounts the GLView (expo-gl never resizes the drawing buffer); no updates while the screen is not focused. Not yet run on a device (typechecked only) |
| Shareable / persisted state (every `useParam`) | `lib/hooks.ts` | present: page params in the route (`usePageParam` / `usePageParams`), filters + table views on the phone, "Copy link to this view" / Share (Linking.createURL, `backend=<url>` so another phone with the backend opens it). An installed build (APK / dev build) makes typetorch://tt/… links. In Expo Go, Linking.createURL ignores the scheme and makes exp://<dev server>:<port>/--/tt/…, which opens only in Expo Go on a phone that reaches that same Metro server; the share sheet says so there and also offers the typetorch:// form (built by hand, `view-link.tsx` `toAppLink`) for a phone with the installed app. Neither form has been tested between two phones |
| Benchmarks (50th / 90th) kept per browser | `lib/benchmarks.ts` | present per backend on the phone (secure store) + export / import (copy JSON, save a file, paste JSON; the web's `tt-explorer-benchmarks` format) |

## 7. Live streams and polls

| Stream | Route | Web user | App |
| --- | --- | --- | --- |
| Fleet SSE (server, alert, alert_ack, report, deploy) | GET `/v1/fleet/stream?branch` | Fleet | present (XHR streaming, `api/tt/sse.ts`; servers poll 5 s while down, 60 s while live; only while Fleet is focused; no `?branch`) |
| Errors SSE | GET `/v1/live?topics=error` | Errors | present (30 s poll while down; only while Errors is focused, one refetch on return) |
| Server watch (20 s) + command result poll (600 ms) | POST `.../watch`, GET `.../commands/<id>` | Server | missing |
| Server streams (~1 s) | GET `/v1/fleet/servers/<job>/streams?since` | Server Game / Live map tabs | present for the live map (`features/maps/live-streams.ts` useServerStreams, + useServerWatch 20 s; both only while the screen is focused and the app in front); Game tab is ops |
| Live map watch (20 s) + poll (3 s) | POST `/v1/fleet/live-map/watch`, GET `/v1/fleet/live-map` | Live | present (`useLiveMap`; paused while the app is in the background or another screen is on top (useIsFocused), watch renewed on return) |
| Health 30 s, storage 30 s, busy note 30 s, realtime 30 s, notify status / inbox 15 s, live events 60 s, alert rules 60 s, backups 60 s, backend stats 2 s | various | various | health (on open), realtime, backend stats; storage 30 s, busy note 30 s, live events 60 s (analytics) |

## 8. API client gaps (`src/api/backend.ts` vs `web/src/lib/api.ts`)

Missing methods: `errorDropRules`, `previewDropRule`, `fleetColumns`, `migrateAction`,
`migrateResolve`, `migrateStart`, `notifyConfig`, `notifyRecent`, `notifyStatus`, `notifyTest`, `notifyUser`,
`notifyUsers` (+ CSV), `downloadBackup`. (Added by analytics: `experimentChange`, `migrateStatus`, `robloxDemographics`; the live
events methods are used by `tt/live-events.tsx`, `storage` by the Overview's Storage card, `backendStats("1m")` by the busy note. Added by recordings: `anim` = GET `/v1/anims/<id>`. Added by maps-live: `liveMap`,
`watchLiveMap`, `serverStreams`, `eventStream` (SSE), `maps`, `exportMaps`, `setMapOverride`, `removeMapOverride`,
`mapGeometry`, `image`.) Defined but unused: `remoteCommand`, `remoteResult`, `watchServer`, `debugAudit`, `saveSettings`,
`testAlert`, `alertRules`, `backups`, `backupNow`, `devices`, `revokeDevice`, `storage`, `fleetReport`,
`robloxServerLogs`, `liveUrl`, `streamUrl`. Types added by analytics (`api/tt/types.ts`): Ltv*, Explain*, RobloxDemographic*,
SessionTime*, Feedback*, AssignmentCheck, ExperimentChangeRequest, PreparedExperimentChange, IngestPressure, MigrateStatus /
MigrateDay (the banner's part), Comparison p-values / mde / days, RealtimeResult `devices`, TrendsResult `bucketHours` /
`partial`, RetentionCohort `partial`; Churn* and Demographic* stay in `api/tt/audience.ts` and are re-exported from types.ts and
in QueryResults (with ltv, explain, session-time, feedback-summary, feedback-list); LiveEvent* / LiftReport are in
`api/tt/live-events.ts`. Still missing types: Notify*, Migrate* (the Settings card's actions), GameColumn* (GameCommand / GameStream / StreamFrame / StreamPoint / ServerStreams / LiveMapServer /
LivePlayer / MapPositionsResult added by maps-live),
ErrorDropRule*/DropPreview, QueueStats (`AccountAge` and the audience `Filters` keys are in, from interaction 2).

## 9. Open Cloud / Creator Hub side (brief)

Present: project list (API key universes, own and group games, added by link), Overview, Analytics (Open Cloud
Analytics Query API, 20+ metrics, breakdowns), Tools (data stores incl. edit / delete / revisions, ordered data stores,
memory stores read, messaging publish, restart servers, bans, passes / products / badges). Obvious gaps against "every
Roblox project + Creator Hub": place versions / publish history (no read API), Luau execution (Open Cloud
`luau-execution-sessions`), universe / place config editing (PATCH universe, place), secrets store, subscriptions,
memory store writes, creator-store assets / inventory, notifications send through Open Cloud
(`user-notifications`), Creator Hub Demographics and server logs outside a TypeTorch backend, and per-project revenue
payouts (no Open Cloud API).

---

## Build groups (every non-present item)

### maps-live

Done on `feat/phone-parity` (typechecked; not yet run on a device: expo-gl texture upload from `{ localUri }` through three's texStorage path and the XHR SSE streaming are the parts to check first).

- [x] Maps page `tt/maps.tsx` (web `pages/Maps.tsx`): export card + Export (owner) — GET `/v1/maps`, POST `/v1/maps/export`
- [x] Maps: map picker, 2D / 3D, Y band floors / range, decorative / marker toggles — GET `/v1/maps/<name>/geometry` (TTMP decoder `lib/maps.ts`)
- [x] Maps: positioned-event layers, dots / heat 0.5 / 1 / 2 studs — `/v1/query/map-positions`, `/v1/query/recording-layers`
- [x] Maps: alignment, apply offset / model path / remove (owner) — PUT / DELETE `/v1/maps/<name>/override`
- [x] Maps: textures — GET `/v1/images/<id>` (`lib/map-textures.ts`)
- [x] 3D map renderer on expo-gl + three (port `components/maps/map-renderer.ts`, `MapScene.tsx`, `BandControls.tsx`): instanced meshes, orbit / pan / pinch, ortho 2D, clipping band, see-through looks
- [x] Live map page `tt/live.tsx` (web `pages/Live.tsx`, `pages/live/LiveMap.tsx`, `lib/live-map.ts`): watch 20 s + poll 3 s, interpolated dots, per-server list, map switcher, follow, trail, `points` (owner) — POST `/v1/fleet/live-map/watch`, GET `/v1/fleet/live-map`
- [x] Server Live map tab (web `pages/server/LiveMapTab.tsx`): positions 2 Hz, 20 s trail — GET `/v1/fleet/servers/<job>/streams`
- [x] Live streams hooks (port `lib/live-streams.ts`): server stream poll ~1 s, live-map watch / poll, ticker; Fleet SSE `/v1/fleet/stream` and Errors SSE `/v1/live?topics=error` via fetch streaming or polling fallback
- [x] Types: LiveMapServer, LivePlayer, ServerStreams, StreamFrame, StreamPoint, GameStream; API: `liveMap`, `watchLiveMap`, `serverStreams`, maps client

### recordings

Done on `feat/phone-parity` (typechecked; the pure ports (`ext-replay.ts`, `ui-state.ts`, `avatar.ts`) smoke-run in Node; not yet run on a device: the Player view's GL scene with avatars, clothing textures through `MapRenderer.texture`, and the UI overlay's `experimental_backgroundImage` / `mixBlendMode` / `boxShadow` are the parts to check first).

- [x] Recordings page `tt/recordings.tsx` (web `pages/Recordings.tsx`), 4 tabs, state in params (menu entry in `features/typetorch/pages.ts`)
- [x] Map layers tab: layers, value / zone / screen filters, cell → sessions — `/v1/query/recording-layers`
- [x] SVG silhouette fallback map (`features/recordings/MapView.tsx`, `map.ts`)
- [x] Real map on exported geometry 2D / 3D (`features/recordings/RealMap.tsx`, reusing `features/maps` MapScene / renderer / BandControls) — GET `/v1/maps`, `/v1/maps/<name>/geometry`
- [x] Replay session list + search — `/v1/query/recording-sessions`
- [x] Replay player (`features/recordings/ReplayPlayer.tsx`): path, dot, camera cone, timeline, scrubber, play / pause, speed, previous / next mark, AFK, captions, FPS strip — `/v1/query/recording-replay`
- [x] ext-replay port (`features/recordings/ext-replay.ts`: camera, entities, poses slerp, anim clip sampling / blend); tt-ext-1 bytes are decoded by the backend, the phone reads JSON
- [x] Player view (`PlayerView.tsx`, `PlayerScene.tsx`, `avatar.ts`): 3D from recorded camera, R6 / R15 avatars, clothing, free camera, tap rings, legend, properties — GET `/v1/anims/<id>`, GET `/v1/images/<id>` (`features/recordings/assets.ts`); MapScene got `onRenderer` / `onTap` / `hint` / `fitButton` / children, MapRenderer got `texture`
- [x] UI overlay (`UiOverlay.tsx`, `ui-state.ts`): GuiObject rects, clipping, gradient, tint, fonts (phone fonts), rich text, node select
- [x] Quit autopsy tab — `/v1/query/quit-autopsy`
- [x] First actions tab — `/v1/query/first-action`
- [x] First session signals → Recordings links (`tt/first-session.tsx`)
- [x] Player page → Recordings: "Replay" in the Sessions table (`recorded`) and "Replay (if recorded)" on first sessions in the Timeline (`features/recordings/links.ts`: filter bar to the session's days, then `tab=replay&sid=`)
- [x] Page description note on every tab
- [x] UI overlay parity fixes: gradient over the background colour, no clipping by a node's own box (image layer rounded to the corner instead), text stroke as a 4-copy outline
- [x] Types: Rec*, RecordingLayersResult, RecordingSessionsResult, RecordingReplayResult, ExtendedReplay, Ext*, QuitAutopsy*, FirstAction*; API `anim`

### analytics
Done on `feat/phone-parity` (typechecked; not run on a device yet). Notes: the Errors list has no total trend on the web (its trend is per kind and on the kind sheet); the phone adds one over the listed kinds. The project tab keeps its compact day summary; the Overview page is the web's.
- [x] Demographics page `tt/demographics.tsx` (web `pages/Demographics.tsx`) — GET `/v1/roblox/demographics`, `/v1/query/demographics`
- [x] Session time page `tt/session-time.tsx` (web `pages/SessionTime.tsx`) — `/v1/query/session-time` (by, split, metric, merge, bucket, smooth, histogram, per-step table)
- [x] Retention Revenue / LTV tab (web `pages/RetentionLtv.tsx`) — `/v1/query/ltv`
- [x] Live events page `tt/live-events.tsx` (web `pages/LiveEvents.tsx`, `lib/live-events.ts`): lists, schedule + cancel (owner), signing CLI card, lift report — GET / POST `/v1/live-events`, POST `/v1/live-events/<id>/cancel`, GET `/v1/live-events/<id>/lift`
- [x] Feedback page `tt/feedback.tsx` (web `pages/Feedback.tsx`, `pages/feedback/shared.tsx`) — `/v1/query/feedback-summary`, `/v1/query/feedback-list`
- [x] Player detail Feedback view (web `components/player-detail/PlayerDetail.tsx`) — `/v1/query/feedback-list`
- [x] Player detail Join data `jd` (web `components/player-detail/JoinData.tsx`, `TimelineView.tsx`)
- [x] Audience filters country / lang / age / prem / source (interaction 2, `features/typetorch/filters.tsx` AudienceSection) + `3d` and `deploy` range presets (interaction)
- [x] Churn risk on Players (done by interaction 2, `features/typetorch/churn.tsx`)
- [x] Explain panel + "Why?" on Overview tiles and Retention (web `components/ExplainPanel.tsx`, `lib/explain.ts`) — `/v1/query/explain`
- [x] Overview parity (web `pages/Overview.tsx`): filter bar, pinned saved-query tiles (8 tiles, vs previous period, 4 DayBars with previous dashed and deploy marks: done by interaction 2) — `/v1/query/overview`, `/v1/saved-queries`, `/v1/sql`
- [x] Overview owner cards: Storage (GET `/v1/storage`), ingest-busy note (GET `/v1/admin/stats?window=1m`), history-importing banner (GET `/v1/admin/migrate`)
- [x] Roblox: Concurrent players by device (live chips, hourly avg / peak, `devCcu`) — `/v1/query/realtime`
- [x] Roblox: trends granularity 6 h / 12 h / daily / 7-day MA and ranges 0 / 3 / 7 d — `/v1/query/trends`; Realtime → Session time link
- [x] Experiments: SRM check alert — `/v1/query/experiment` ("Can detect" / time-to-tell columns: done by interaction 2)
- [x] Experiments control (owner): Start / Stop / Clear / Change split / Settle → prepared CLI command — POST `/v1/experiments/<e>/change`
- [x] Errors: total trend with step + deploy marks — GET `/v1/errors` (vs previous period chips, build / branch / sort filters, players who hit a kind: done by interaction 2)
- [x] Deploy detail: error kinds before vs after (GET `/v1/errors` ×2), key performance before vs after (`/v1/query/perf-compare` around)
- [x] Deploys: branch filter — GET `/v1/fleet/deploys?branch`
- [x] Types: Churn*, Ltv*, Explain*, Demographic*, RobloxDemographics, SessionTime*, Feedback*, AssignmentCheck, ExperimentChangeRequest, PreparedExperimentChange, LiveEvent*, LiftReport, AccountAge + audience Filters

### ops
- Notifications page `tt/notifications.tsx` (web `pages/Notifications.tsx`): header status chip / dry run / range / kind / Send a test, 4 KPIs — GET `/v1/notify/status`, `/v1/query/notify-funnel`, `/v1/query/notify-optin`
- Notifications Health tab (web `notifications/HealthTab.tsx`, `attention.ts`)
- Notifications Funnel tab (web `notifications/FunnelTab.tsx`) — `notify-funnel`, `notify-optin`
- Notifications Inbox tab (owner, web `notifications/InboxTab.tsx`) — GET `/v1/notify/recent`, `/v1/notify/user`
- Notifications Player panel (owner, web `notifications/PlayerPanel.tsx`) — GET `/v1/notify/user?uid|pid|name`
- Notifications Subscribers tab + CSV (owner, web `notifications/SubscribersTab.tsx`) — GET `/v1/notify/users[?format=csv]`
- Notifications Kinds tab + on / off switch (web `notifications/KindsTab.tsx`) — `notify-funnel`, PATCH `/v1/admin/settings`
- Notifications Queue & errors tab (web `notifications/QueueTab.tsx`) — `/v1/query/notify-queue`, GET `/v1/notify/status`
- Notifications Settings tab (owner, web `notifications/SettingsTab.tsx`) — PATCH `/v1/admin/settings` `notify.*`, POST `/v1/notify/test`, GET `/v1/notify/config`
- Player detail Notifications view (owner) — GET `/v1/notify/user?pid=`
- Server debug session: watch 20 s + connection state + command runner (web `pages/Server.tsx`, `lib/remote-debug.ts`) — POST `.../watch`, POST `.../commands`, GET `.../commands/<id>` (owner)
- Server Status tab: kernel `status` op + deploy marks on TPS / memory / players (web `server/StatusTab.tsx`)
- Server Logs tab: server ring + Fetch newer, player client logs (web `server/LogsTab.tsx`) — ops `logs`, `player.logs`
- Server Players tab (web `server/PlayersTab.tsx`) — op `players`
- Server Game tab: game commands + streams (web `server/GameTab.tsx`) — ops `game.<name>`, GET `.../streams`
- Server State tab (web `server/StateTab.tsx`) — op `state`
- Server Dex tab (web `server/DexTab.tsx`) — ops `dex.children`, `dex.props`
- Server Modules / Builds / Budget / Errors / Network tabs (web `server/InfoTabs.tsx`) — ops `modules`, `assets`, `builds`, `budget`, `errors`, `network`
- Server Audit tab (owner) — GET `/v1/fleet/debug/audit`
- Server Roblox logs (web `server/RobloxLogs.tsx`) — GET `/v1/roblox/servers/<job>/logs`
- Fleet: budget column, location / country column + By country table, IP (owner) — GET `/v1/fleet/servers`
- Fleet: game-declared columns — GET `/v1/fleet/columns`
- Fleet: live events feed — SSE `/v1/fleet/stream`
- Fleet: latest deploy results / reports / deploy errors — GET `/v1/fleet/reports`
- Fleet: full alerts list (90 d) with bundle links and ack — GET `/v1/fleet/alerts`, POST `/v1/fleet/alerts/<id>/ack`
- Errors drop rules: list, editor with preview, save (owner) — GET `/v1/errors/drop-rules`, POST `.../preview`, PATCH `/v1/admin/settings`
- Settings: edit runtime settings per group, Reset to env, write-only webhook — PATCH `/v1/admin/settings`
- Settings: Test alert — POST `/v1/admin/settings/test-alert`
- Settings: Backend alert rules editor + last run — GET `/v1/admin/alert-rules`, PATCH settings
- Settings: typetorch.dev trusted browsers (list, revoke) — GET `/v1/admin/devices`, DELETE `/v1/admin/devices/<id>`
- Settings: Backups (list, Back up now, Download via expo-file-system + expo-sharing), disk warning — GET / POST `/v1/admin/backups`, POST `/v1/admin/backups/download`
- Settings: Migration card (status, pause / resume / cancel / resolve, start) — GET / POST `/v1/admin/migrate`
- Settings: Recent changes table — GET `/v1/admin/audit`
- Shell: header health dot, place card with live players — `/healthz`, `/v1/place`
- Command palette (web `components/CommandPalette.tsx`, `lib/commands.ts`): pages by role, ranges, clear filters, copy link (typetorch:// URL), refresh, theme, sign out, open player, page commands
- Global Find player — GET `/v1/identity?uid=`
- Page menu: add the 8 missing pages, grouped like `lib/nav.ts`

### interaction (done; see §6 and the pages above)
- [x] Drawn graph for Flow and player Timeline: dagre layout + react-native-svg, pan / pinch-zoom, facet and moments, tap a node for its moves (`features/typetorch/graph-view.tsx`)
- [x] DataTable 1:1 (`features/typetorch/table/`): sort + multi-sort by raw value, search, per-column filters with chips, column picker + reset, row counts, paging, copy cell / row JSON
- [x] DataTable CSV export via expo-file-system + expo-sharing, copy via expo-clipboard
- [x] Persisted table views (AsyncStorage per backend + table id) and filter bar state (AsyncStorage per backend)
- [x] Shareable views: typetorch:// links with filter keys, page params and `<table>.sort/filter` params, "Copy link to this view"
- [x] Deploy marker cards, remembered toggle, live-event marks, marks on Overview, error kind bars, server status, bar charts
- [x] Previous-period dashed overlay on bar charts (`charts/LineChart.tsx` BarChart `previous`; on all 4 Overview charts)
- [x] Player cards on long-press (`features/typetorch/cards.tsx`)
- [x] Product id card on tap + "Show only this" in a table
- [x] Page params in the route: Funnels, Monetization, Economy, Experiments, Audit, Performance, Errors (+ Flow, Events, Players, player page)
- [x] Benchmarks: phone storage + export / import
- [x] Interaction 2 (verified gaps): Errors params / server sort / `error` column id / `errors-players` / kind page windows and filters; Overview 4 charts + 8 tiles with chips, `vs=prev` in the route; Errors vs previous period; view links reset missing filter keys (`backend=`); Audience filters; DataTables `experiments-list`, `experiment-comparisons`, `perf-live-servers`, `first-session-<id>`, `players-churn` (+ Churn risk panel); Players `find` / `pid`; Performance `marks`; GestureHandlerRootView in the full-screen graph Modal; Expo Go exp:// links explained + typetorch:// form offered
- [x] Analytics verified gaps: Retention LTV cell detail on tap; Errors total trend bucket times (backend bucketIndex); LineChart `gaps` (Session time, Roblox trends); fixed device colours (Session time, Concurrent players by device); Live events command boxes scroll, Download JSON failure message + Copy JSON; static country / language names for Hermes; kind page deploy marks by branch
- Untested on a device (Expo Go, Android): full-screen graph pan / pinch / tap; a shared link opened on a second phone (exp:// and typetorch://)
- Not done here (other groups' pages): Fleet / server / deploy-detail / bundle lists as DataTables (ops pages, still lists)