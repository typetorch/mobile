# Widget spec: the home-screen widget's look as data

The Android home-screen widget (docs/PUSH_WATCH_WIDGETS.md, section 3) is drawn from a **widget spec**: a versioned
JSON description that the app's JS hands to the native module. The native side draws the spec into one bitmap with
Canvas at the widget's real size. Anything the spec can describe (layout, sizes, colours, wording, which numbers show
up and where) therefore ships as an **OTA update** (`eas update`, JS only), not a new APK.

| Piece | Where |
|---|---|
| The app's spec, typed | `src/features/live/widget-spec.ts` (`WIDGET_SPEC`, the TypeScript types) |
| Sent to native | `src/features/live/LiveSync.tsx`: `setWidgetSpec(WIDGET_SPEC_JSON)`, then `refreshWidgets()` |
| JS API | `modules/typetorch-live/index.ts`: `setWidgetSpec(json: string): boolean` |
| Parser, built-in default | `modules/typetorch-live/android/.../WidgetSpec.kt` (`DEFAULT_JSON`) |
| Renderer | `.../WidgetRenderer.kt` (layout, text, chart, icons, bindings) |
| Widget plumbing | `.../WidgetUpdater.kt` (state, sizes, bitmaps, taps), `res/layout{,-night}/ttl_widget_canvas.xml` |

## How it is drawn

- **One bitmap per size and mode.** The widget layout (`ttl_widget_canvas.xml`) is a FrameLayout with an ImageView for
  the day drawing, one for the night drawing (`layout-night/` shows the night one, so the system's dark mode switch
  needs no redraw), and four transparent corner hit areas for refresh.
- **Size.** Android 12+: the sizes the launcher reports (`OPTION_APPWIDGET_SIZES`, up to 2, typically portrait and
  landscape); each is drawn and the launcher picks. Older: min/max width/height by orientation (portrait: min width x
  max height). A resize (`onAppWidgetOptionsChanged`) redraws from the cache.
- **Crisp.** Everything is measured and drawn in pixels at the screen density (at most 3 px/dp), text with StaticLayout,
  the font scale followed (clamped to 0.8..1.3).
- **Memory.** All bitmaps of one update stay under 40 % of the system's limit (6 x screen pixels in bytes), each at most
  900k pixels; beyond that the drawing is scaled down and the ImageView scales it back up. If the launcher still
  refuses the update, it is retried lean: one size, only the current mode, at most 250k pixels.
- **Never blank.** A sent spec that fails to parse is rejected by `setWidgetSpec` (the saved one stays). A saved spec
  that fails to draw falls back to the built-in default (`DEFAULT_JSON`, the same as `WIDGET_SPEC`); if even that fails,
  a plain text widget (`ttl_widget_message.xml`). Errors go to logcat (`adb logcat -s TypeTorchLive`).
- **Taps.** The whole widget opens the game (the backend's `link`; the pick state opens the game picker, signed out
  opens the app). The refresh hit area is a fixed 36 dp square in the corner the size layout names (`refresh`); draw a
  refresh icon there yourself.

## Format

```jsonc
{
  "version": 1,                         // the renderer understands 1; a higher version is ignored (built-in default)
  "tokens": {                           // optional colour overrides per mode
    "day":   { "brand": "#FFFB7A32" },
    "night": { "bg": "#F21E1E22" }
  },
  "strings": {                          // optional wording of the `status` binding
    "refreshing": "refreshing…",
    "offline": "offline · {updated}"
  },
  "layouts": {
    "data":        [ /* size layouts */ ],   // required: the numbers
    "loading":     [ ],                      // no numbers yet
    "unreachable": [ ],                      // no numbers and the last fetch failed
    "signedOut":   [ ],                      // the backend is gone or its token is dead (no refresh area)
    "pick":        [ ]                       // no game picked yet (no refresh area; a tap opens the picker)
  }
}
```

A missing state uses the built-in default's. Unknown fields are ignored and unknown element types are skipped, so a
newer spec degrades instead of failing on an older APK; bump `version` only for changes an older renderer would draw
wrong.

### Size layouts (size classes)

```jsonc
{
  "name": "medium",              // for humans
  "minWidth": 220, "minHeight": 95,   // dp
  "background": { "color": "bg", "radius": "system" },  // default; a colour string works too
  "refresh": "topEnd",           // topEnd (default) | topStart | bottomEnd | bottomStart | none
  "description": "{game}: {ccu:grouped} playing",       // TalkBack; default: the drawn texts joined with ", "
  "root": { "type": "column", "children": [] }
}
```

The renderer picks, among the entries whose minimums fit the widget's size, the one with the largest
minWidth x minHeight; when none fits, the smallest. Today's spec: `medium` from 220 x 95 dp (about 4x2 cells), `small`
otherwise. `"radius": "system"` is the launcher's widget corner radius on Android 12+, 16 dp before.

### Elements

Every element takes these (all optional):

| Field | Meaning |
|---|---|
| `weight` | share of the parent row/column's leftover space (like `layout_weight` with a 0 size) |
| `width`, `height` | fixed size in dp |
| `padding`, `margin` | dp: a number, or `{ top, bottom, start, end, horizontal, vertical }` |
| `alignSelf` | `start` \| `center` \| `end` \| `stretch`: cross-axis placement, overriding the parent's `align` |
| `gravity` | placement inside a `stack`: `topStart` (default), `top`, `topEnd`, `start`, `center`, `end`, `bottomStart`, `bottom`, `bottomEnd`, `fill` |
| `showIf` | a binding name: drawn only when it has a value (`series`: the chart has points); `!name` for the opposite |
| `background` | a colour, or `{ color, radius }` (radius in dp or `"system"`) |

| Type | Fields |
|---|---|
| `column`, `row` | `children`, `gap` (dp), `align` (cross axis: `start`, `center`, `end`, `stretch`, rows also `baseline`; default column `stretch`, row `center`), `justify` (main axis when no child has a weight: `start`, `center`, `end`, `spaceBetween`) |
| `stack` | `children` drawn on top of each other, each placed by its `gravity` |
| `text` | `text` (template, below), `size` (sp, default 12), `fontWeight` (`normal`, `medium`, `semibold`, `bold` or 100..900), `color` (default `text`; `delta` = up/down colour by the delta's sign), `align` (`start`, `center`, `end`), `maxLines` (default 1), `ellipsis` (default true). An empty result hides the element. |
| `chart` | the CCU line: `bind: "series"`, `minutes` (1..360, default 360), `color` (default `brand`), `fill` (`true`: the line colour fading down, a colour, or `false`), `stroke` (dp, default 2), `dot` (newest point, default true). Without a `height` it takes `weight: 1`. |
| `spacer` | `size` (dp along the parent's axis) or a `weight` |
| `divider` | a line across the parent: `color` (default `divider`), `thickness` (dp, default 1) |
| `icon` | `name`: `flame`, `refresh`, `people`, `server`, `clock`; `size` (dp, default 16), `color` (default `text2`) |

### Bindings (text templates)

A text is a literal with placeholders: `{name}`, `{name:format}` (another format), `{name|fallback}` (shown when the
value is missing), `{{` and `}}` for braces. A missing number shows `—` (a missing delta shows nothing).

| Binding | Default format | Example |
|---|---|---|
| `game` | | The Prison (falls back to the backend's name) |
| `backend` | | the backend's name as saved in the app |
| `ccu` | `count` | 214, 1.2K |
| `delta` | `delta` | ▲12, ▼3, ±0 |
| `servers` | `grouped` | 31 |
| `serversLabel` | | 31 servers, 1 server |
| `peakToday` | `grouped` | 260 |
| `lastHour.avgSessionSeconds` | `duration` | 18 m 40 s |
| `lastHour.medianSessionSeconds` | `duration` | 9 m 5 s |
| `lastHour.sessionsEnded` | `grouped` | 412 |
| `lastHour.playtimeHours` | `hours` | 1,240 h |
| `updated` | | 12:04 (the user's 12/24 h setting; when the numbers were last fetched) |
| `status` | | `refreshing…`, `offline · 12:04` or `12:04` (wording from `strings`) |
| `state` | | `fresh`, `refreshing`, `offline` or empty |

Formats: `count` (214, 1.2K, 1.5M), `grouped` (1,240), `delta` (▲12), `duration` (45 s, 18 m 40 s, 2 h 5 m), `hours`
(1,240 h, 4.5 h, 35 m), `raw`.

### Colour tokens

A colour is a token, `#RRGGBB`, `#AARRGGBB` or `transparent`. Tokens follow the system's day/night mode:

| Token | Day | Night |
|---|---|---|
| `bg` | #F7FFFFFF | #F21E1E22 |
| `text` | #FF1B1B1F | #FFECECEE |
| `text2` | #FF5F6368 | #FFA8A8AD |
| `brand` | #FFFB7A32 | #FFFB7A32 |
| `up` | #FF2E9D57 | #FF4CC27A |
| `down` | #FFD64545 | #FFF06A6A |
| `divider` | #1F000000 | #33FFFFFF |

`tokens.day` / `tokens.night` override them (and may add new token names to use elsewhere in the spec).

### Example

A small widget with the flame, the CCU and the delta, and the last hour's sessions under it:

```json
{
  "version": 1,
  "layouts": {
    "data": [
      {
        "minWidth": 0,
        "minHeight": 0,
        "refresh": "topEnd",
        "root": {
          "type": "column",
          "padding": 12,
          "gap": 2,
          "children": [
            {
              "type": "row",
              "gap": 6,
              "children": [
                { "type": "icon", "name": "flame", "size": 14, "color": "brand" },
                { "type": "text", "text": "{game}", "color": "text2", "weight": 1 },
                { "type": "icon", "name": "refresh", "size": 16 }
              ]
            },
            {
              "type": "row",
              "align": "baseline",
              "gap": 6,
              "children": [
                { "type": "text", "text": "{ccu}", "size": 26, "fontWeight": "medium" },
                { "type": "text", "text": "{delta}", "size": 13, "fontWeight": "bold", "color": "delta", "showIf": "delta" }
              ]
            },
            { "type": "text", "text": "{lastHour.sessionsEnded} sessions · avg {lastHour.avgSessionSeconds}", "size": 11, "color": "text2" }
          ]
        }
      }
    ]
  }
}
```

## Shipping a change

1. Edit `WIDGET_SPEC` in `src/features/live/widget-spec.ts` (the types catch most mistakes); run
   `npx tsc --noEmit -p .`.
2. Try it in a dev build: reload the app (LiveSync sends the spec when the accounts are ready, then redraws). If the
   spec is rejected, the JS console shows `[typetorch-live] setWidgetSpec failed: Widget spec rejected: …`.
3. Ship it: `npx eas-cli@latest update --channel production --message "widget: …"` (or `preview` / `development`).
   Phones pick the update up at app start and apply it at the next start (`checkAutomatically: ON_LOAD`,
   `fallbackToCacheTimeout: 0`); the widget changes once the app has run with it. Widgets keep the last sent spec
   while the app isn't running.

A new element type, binding, icon or format, or a change to the drawing itself, needs native code and therefore an
APK (the runtime version is the native fingerprint, so `eas update` won't reach older APKs with it anyway). The APK
that introduced the widget spec is itself such a build.

If you change the **default** look, also update `DEFAULT_JSON` in `WidgetSpec.kt` at the next APK, so a fresh install
looks right before the app first runs (generate it from `JSON.stringify(WIDGET_SPEC, null, 2)`).

## Limits

- One bitmap: no per-element taps (only the whole widget and the corner refresh area), no text selection, and
  TalkBack reads the widget as one image with its `description`.
- The refresh area is a fixed 36 dp corner square; it can't follow an icon placed elsewhere.
- Laid out left to right (`start` = left) even in RTL languages.
- The widget is redrawn only on updates (30 minutes, refresh, the app, live watch polls, resizes), so text shows the
  clock time, never a relative "3 min ago".
- A drawing scaled down by the memory budget (a very large widget on a small-screen phone) is slightly soft.
- On Android 12+ some launchers clip widgets to their own corner radius: a smaller `radius` than the system's may not
  show.
