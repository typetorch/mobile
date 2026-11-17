# Push milestones, live watch and widgets

Three Android features that show a game's live numbers outside the app. Agreed with the user on 2026-11-17.

| Feature | Runs on | Needs |
|---|---|---|
| CCU milestone push ("Reached 160 CCU") | the backend (alert rule) → Expo push → FCM | Firebase (docs/FIREBASE_SETUP.md), `expo-notifications` |
| Live watch (ongoing notification, one per game, until Stop) | the phone: a foreground service in `modules/typetorch-live` | the backend's `/v1/mobile/live` endpoint |
| Home-screen widgets (small and medium, one game each) | the phone: an AppWidgetProvider in `modules/typetorch-live` | the same endpoint |

## 1. Backend

Every route takes the mobile token as today (`Authorization: Bearer ttm_…`) and answers JSON. A dead token answers 401
`{ "error": "mobile_token_dead" }` like the other routes.

### `GET /v1/mobile/live?minutes=30`

The live numbers of the backend's game, cheap enough to call every 30 s per phone (the session part is cached on the
server for 5 minutes, the CCU part comes from the fleet's live state).

```jsonc
{
  "at": "2026-11-17T12:00:00.000Z",
  "game": { "name": "The Prison", "universeId": 123 },
  "ccu": 214,                       // players on live servers now (the dashboard's fleet count)
  "servers": 31,
  "delta": 12,                      // ccu now minus ccu about 5 minutes ago (null when unknown)
  "peakToday": 260,                 // highest ccu since 00:00 UTC (null when unknown)
  "series": [{ "t": 1794917000000, "ccu": 202 }],  // one point per minute, the last `minutes` (1..360, default 30)
  "lastHour": {                     // cached up to 5 minutes; `at` says when it was computed
    "at": "2026-11-17T11:58:00.000Z",
    "avgSessionSeconds": 1120,      // sessions that ended in the last 60 minutes: mean length (null when none)
    "medianSessionSeconds": 545,
    "sessionsEnded": 412,
    "playtimeHours": 1240.5         // time all players spent in the game during the last 60 minutes, running sessions included
  }
}
```

### `POST /v1/mobile/push`

Registers this phone for push. Body `{ "token": "ExponentPushToken[…]", "milestones": true }`. One registration per
mobile token (a second call replaces it). Logout, revoke and token expiry remove it. Answer `{ "ok": true, "milestones": true }`.

### `DELETE /v1/mobile/push`

Removes this mobile token's registration. Answer `{ "ok": true }`.

### Alert rule `ccuMilestone`

In `src/alerts` beside `ccuDrop`, editable on the Settings page like the others:

- milestones 10, 20, 40, 80, … (`start`, default 10; ×2 each);
- a milestone fires when the live CCU first reaches it, and re-arms once the CCU has dropped below `rearmPercent`
  (default 70) % of it; at most once every `cooldownMinutes` (default 30) per milestone;
- the alert goes wherever alerts go today (Discord etc.) and, as a push, to every registration with `milestones: true`.

Push message (Expo push API, `https://exp.host/--/api/v2/push/send`):

```jsonc
{
  "to": "ExponentPushToken[…]",
  "title": "Reached 160 CCU",
  "body": "The Prison · last hour: 18 m 40 s avg session · 1,240 h played",
  "channelId": "milestones",
  "priority": "high",
  "sound": "default",
  "data": { "kind": "ccuMilestone", "backendUrl": "https://…", "universeId": 123, "ccu": 163, "milestone": 160 }
}
```

A `DeviceNotRegistered` answer (in the ticket or the receipt) removes that registration.

## 2. App (JS)

- `expo-notifications`: the `milestones` channel (high importance, sound) is made at start. Settings → Notifications has a
  milestone switch per backend (asks for the notification permission, registers or removes the push token). A tapped
  milestone opens that backend's Fleet page (found by `data.backendUrl`).
- The Expo push token needs Firebase in the build (`google-services.json`). Without it the app says so and the switch is
  off; the live watch and the widgets work without Firebase.
- The app keeps the native module's list of backends (id, name, url, token, deep link) in step with its accounts:
  at start, after sign-in, sign-out and every token refresh (a refresh revokes the old token at once).
- A Watch (eye) button in a TypeTorch page's header starts or stops that backend's watch.

## 3. Native module `modules/typetorch-live` (Kotlin, Android only)

A local Expo module (autolinked from `modules/`). No third-party libraries.

### JS API

```ts
setBackends(list: { id: string; name: string; url: string; token: string; link: string }[]): void
startWatch(id: string): void       // asks nothing: the app requests POST_NOTIFICATIONS before
stopWatch(id: string): void
watching(): string[]
refreshWidgets(): void             // redraw every widget now (after setBackends, on app foreground)
```

The list is kept in the app's private SharedPreferences (the service and widgets read it without JS).

### Live watch

- A foreground service (`specialUse`, with the subtype property set), one ongoing notification per watched backend.
- Every 30 s: `GET {url}/v1/mobile/live?minutes=30` with the backend's token (on a worker thread, 10 s timeout).
- Notification: decorated custom view. Collapsed: "214 playing ▲12 · The Prison" / "Avg session 18 m 40 s (last hour) ·
  31 servers". Expanded: the big CCU, the delta, the game name, a 30-minute CCU line (a bitmap drawn with Canvas), then
  rows "Avg session, last hour", "Median · sessions ended", "Servers · peak today", "Played, last hour". Actions:
  Stop, Open (the backend's `link`). Silent, low importance channel `watch`, `setOngoing(true)`, `setOnlyAlertOnce`.
- Swiped away anyway (Android 14+): the delete intent posts it again. Only Stop ends a watch.
- A 401 shows "Signed out: open TypeTorch" on that game's notification and stops polling it. Network errors keep the last
  numbers and show "offline, retrying".
- The watched list is saved; the service stops itself when the list is empty. It does not restart after a reboot.

### Widgets

- One provider, resizable: small (2×1: game, CCU, delta, updated time) and medium (4×2 and up: also the line for the last
  6 hours, avg session and playtime of the last hour, servers). Android 12+ picks the layout by size; older picks by
  minimum size.
- A configure activity lists the backends (from `setBackends`) to pick the game; the pick is saved per widget id.
- Updates: every 30 minutes (`updatePeriodMillis`), a refresh button on the widget, `refreshWidgets()` from the app, and
  every poll of the live watch for that game. Tap: open the game (`link`).
- A 401 or no backend shows "Open TypeTorch to sign in"; errors keep the last numbers with a stale time.
