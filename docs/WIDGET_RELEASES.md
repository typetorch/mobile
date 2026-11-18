# Release garden widgets (agreed 2026-11-18)

A GitHub-style grid of days: green = prod-channel releases, blue = dev-channel releases, darker = fewer, a day with both
split diagonally (green top-left, blue bottom-right), today outlined. GitHub order (7 rows per week, a week top to bottom, today bottom right); the
number of weeks per size is in docs/WIDGET_HTML.md "The release garden" (e.g. 4×2: 14 weeks, 2×2: 11). Counts (prod, dev) and "last prod 2 d ago". Mockups:
`/tmp/claude-1000/-home-phasenull-projects-TypeTorch/e405e7e5-0a6b-4ef4-af03-8946c7b4ba9d/scratchpad/widget/garden.html`
(per game) and `garden-all.html` (all games, tappable game filter).

## 1. Backend: `releases` on `GET /v1/mobile/live`

Sent as the top-level `releases` of every answer (what the widgets read, docs/WIDGET_HTML.md) and as the metric
`releases` when asked (`metrics=releases`), same shape:

```jsonc
"releases": {
  "value": 54, "prev": null, "unit": "count", "label": "Releases",   // value = prod releases in the 182 days
  "prod": 54, "dev": 155, "prod30": 27, "dev30": 83,                   // counts over the 182 days and the last 30
  "lastProd": "2 d ago",            // "today", "1 d ago", "12 d ago"; null when none in the 182 days
  "lastProdLabel": "#142 · v0.9.3",  // the last prod release's seq and version as the dashboard shows them; null
  "days": [                          // 182 (26 weeks; older backends 60), oldest first, UTC days, the last one is today;
                                     // days before the game's deploy history began: bg / tri "rnone"
    { "date": "2026-09-20", "p": 0, "d": 2, "bg": "rb2", "tri": "rnone" }
  ]
}
```

A release = a deploy record the dashboard's Deploys page lists (same source), counted on the UTC day it was made; the
channel is prod or dev as the dashboard shows it (anything else counts as dev). Cell tokens (the widget's colour names):
`level(n)` = 0 for 0, 1 for 1, 2 for 2–3, 3 for 4+. p > 0: `bg = "rg" + level(p)`, `tri = d > 0 ? "rb" + level(d) :
"rnone"`; p = 0 and d > 0: `bg = "rb" + level(d)`, `tri = "rnone"`; neither: `bg = "r0"`, `tri = "rnone"`. Cached 5
minutes like the other metrics.

## 2. Widget (OTA): per-game style

- Settings → Widgets gets a style per widget: **Stats** (today's) or **Releases**. Releases is stored as the slots
  `["", "", "", "releases"]` (slot 1 empty is the marker; the native side keeps empty positions and fetches `releases`).
- The widget HTML (src/features/live/widgets/default-widget.ts) gets, in every data size class, the garden variant shown
  when `!slot.1` and the stats variant when `slot.1`. Cells are drawn with the `svg` element: per cell a `rect` with
  `fill="var(--{metrics.releases.days.N.bg})"` and a top-left/bottom-right split `polygon` with
  `fill="var(--{metrics.releases.days.N.tri})"`; tokens `r0`, `rg1`–`rg3`, `rb1`–`rb3`, `rnone` (transparent) in the
  widget tokens (day and night). Today (the last index, 181) outlined.
- (`{a:b}` in a template is "binding a, format b", so binding names must not contain `:`; that's why the metric id is
  `releases`, not `releases:60d`.)

## 3. All games (native, one APK)

- A widget whose backend is `*` (picked as "All games" in the configure screen and in Settings → Widgets) fetches
  `metrics=releases` from every signed-in backend and draws from a merged live object:
  `game.name` ("All games" or the picked game's name), `game.iconUrl` (the picked game's or null),
  `metrics.releases` (same shape, per-day p/d summed over all games or only the picked one, tokens recomputed with the
  same rule), `games` (up to 6: `{ id, name, iconUrl, picked: "1" | "", alpha: "1" | "0.4" }`), `filter` (the picked
  backend id or absent).
- Tap areas from the spec: any element can have `tap` = `"open"`, `"refresh"` or `"toggle:games.N"` (pick game N, or
  clear when it's already picked). The native side records each tappable element's box while rendering and overlays
  transparent hit areas (Android 12+: positioned views; older: whole widget only). A toggle is a broadcast to the
  provider that saves the widget's filter and redraws from the cache (no fetch). The pick persists per widget.
- Game icons in all-games layouts come through `games.N.iconUrl` (downloaded and cached like `game.iconUrl`).
