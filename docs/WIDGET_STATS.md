# Widget stats: configurable metrics, icons, coloured units

Agreed with the user on 2026-11-17 (design: small game icon in the header; values white (dark by day) with coloured units:
time units orange, `%` blue, `R$` green; a small ▲/▼ against the period before; sizes 2×1, 2×2, 4×2). Each widget shows
stats the person picks in the app (four slots; the 2×1 shows the first three in short form).

## 1. Backend: `GET /v1/mobile/live?minutes=N&metrics=a,b,c`

Everything in docs/PUSH_WATCH_WIDGETS.md stays; added:

- `game.iconUrl`: the game's icon (Roblox thumbnail, 150×150 or 256×256 PNG URL), cached by the backend (6 h), null when
  unknown.
- `metrics`: only the ids asked for in `metrics=` (comma-separated, at most 12; unknown ids answer `null` for that key,
  never a 400, so an older backend and a newer app keep working):

```jsonc
"metrics": {
  "dau":          { "value": 1830, "prev": 1702, "unit": "count",   "label": "DAU" },
  "d1":           { "value": 0.342, "prev": 0.331, "unit": "ratio", "label": "D1" },
  "revenue:72h":  { "value": 2140, "prev": 2350, "unit": "robux",   "label": "Revenue 72h" },
  "session:1h":   { "value": 1120, "prev": 1056, "unit": "seconds", "label": "Session 1h" },
  "playtime:7d":  { "value": 9120.5, "prev": 8800, "unit": "hours", "label": "Playtime 7d" }
}
```

`prev` is the same metric for the window right before (null when unknown). Units: `count`, `ratio` (0..1, shown as %),
`robux`, `seconds`, `hours`.

### Metric ids

Windows are `<n>h` (1..72) or `<n>d` (1..90).

| id | value | prev |
|---|---|---|
| `ccu`, `servers`, `peakToday` | as the endpoint's top-level fields | `ccu`: 5 min ago; others null |
| `dau` | unique players, last 24 h (rolling) | the 24 h before |
| `wau` | unique players, last 7 days | the 7 days before |
| `mau` | unique players, last 30 days | the 30 days before |
| `new:<w>` | new players in the window | the window before |
| `d1` | D1 retention of the latest complete cohort (joined two UTC days ago, came back the next day) | the cohort the day before |
| `d7` | D7 retention of the latest complete cohort | the cohort the day before |
| `session:<w>` | mean session length (sessions that ended in the window), seconds | the window before |
| `playtime:<w>` | total time played in the window (running sessions included), hours | the window before |
| `sessions:<w>` | sessions that ended in the window | the window before |
| `revenue:<w>` | Robux spent in the window (purchases) | the window before |
| `payers:<w>` | unique paying players in the window | the window before |

Reuse the existing named queries (overview, retention, session-time, monetization, …) and the filter conventions (prod
branch rules as the dashboard's default). Cache each metric 5 minutes (heavier ones, `mau` and `d7`, 15 minutes); the
endpoint must stay cheap (polled every 30 s by a live watch, every 30 min by widgets).

## 2. Native (`modules/typetorch-live`)

- Per-widget config, saved natively: `{ backendId, slots: string[] }` (metric ids, up to 4). The configure activity keeps
  picking the game; new widgets get the default slots `["session:1h", "dau", "d1", "revenue:72h"]` (or the defaults the
  app last set).
- A fetch asks `metrics=` for the union of the slots of that backend's widgets (and the live watch, which asks none).
- Widget spec additions (docs/WIDGET_SPEC.md): an `image` element (source binding `game.iconUrl`, size, corner radius;
  downloaded once, cached on disk, refreshed every 24 h; a placeholder while missing); rich text: a value formatted by
  its unit becomes segments (number, unit) and the spec colours units by token (`unitTime` orange, `unitPercent` blue,
  `unitRobux` green; day and night values); generic bindings: `{slot.1.label}`, `{slot.1.value}` (formatted with units),
  `{slot.1.delta}` (▲6% / ▼2.4 for ratios in points, coloured up/down), and any path into the live JSON
  (`{metrics.mau.value:count}`), so a new backend metric needs no APK.
- JS API additions: `widgets(): { id: number; backendId: string; slots: string[] }[]`,
  `setWidgetConfig(id: number, config: { backendId?: string; slots?: string[] }): boolean`,
  `setDefaultSlots(slots: string[]): void`.

## 3. App

- Settings → Widgets: the widgets on the home screen (game, size class unknown is fine), each with its four stat slots:
  pick a metric from the catalog (DAU, WAU, MAU, new players, D1, D7, session length, playtime, sessions, revenue,
  payers, CCU, servers, peak today) and, for windowed ones, the window ("last X hours / days"); "Default for new widgets".
  Changes apply at once (refreshWidgets).
- The widget spec (src/features/live/widget-spec.ts) becomes the design above, using the slots.
