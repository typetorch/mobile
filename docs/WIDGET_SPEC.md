# Widget spec: the home-screen widget's look as data

The Android home-screen widget (docs/PUSH_WATCH_WIDGETS.md, section 3) is drawn from a **widget spec**: a versioned
JSON description that the app's JS hands to the native module. The native side draws the spec into one bitmap with
Canvas at the widget's real size. Anything the spec can describe (layout, sizes, colours, wording, which numbers show
up and where) therefore ships as an **OTA update** (`eas update`, JS only), not a new APK.

| Piece | Where |
|---|---|
| The app's spec, typed | `src/features/live/widget-spec.ts` (`WIDGET_SPEC`, the TypeScript types) |
| Sent to native | `src/features/live/LiveSync.tsx`: `setWidgetSpec(WIDGET_SPEC_JSON)`, then `refreshWidgets()` |
| JS API | `modules/typetorch-live/index.ts`: `setWidgetSpec(json: string): boolean`; the stat slots: `widgets()`, `setWidgetConfig()`, `defaultSlots()`, `setDefaultSlots()` (docs/WIDGET_STATS.md) |
| Parser, built-in default | `modules/typetorch-live/android/.../WidgetSpec.kt` (`DEFAULT_JSON`) |
| Renderer | `.../WidgetRenderer.kt` (layout, text, chart, icons, pictures), `.../Chart.kt` (the CCU line), `.../Svg.kt` (the `svg` element) |
| Bindings, rich text | `.../WidgetValues.kt` (templates, slots, paths), `.../Units.kt` (unit formats, deltas, the metric catalog) |
| Pictures | `.../WidgetImages.kt` (download, disk cache, decode) |
| Widget plumbing | `.../WidgetUpdater.kt` (state, sizes, bitmaps, taps, the metrics to fetch), `res/layout{,-night}/ttl_widget_canvas.xml` |
| Stat slots | `.../Store.kt` (per widget and the defaults), the app's Settings → Widgets (`src/features/live/WidgetSettings.tsx`) |

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
  "format": {                           // optional number formats
    "ratioDecimals": 2                  // decimals of ratios shown as % (retention: 34.21%) and of their change in
                                        // points (▲1.10); 0..4, default 2. The `short` format stays rounded (34%).
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
minWidth x minHeight; when none fits, the smallest. Today's spec: `medium` from 240 x 120 dp (about 4x2 cells: the CCU,
its 6-hour line and four stat rows), `grid` from 100 x 115 dp (2x2: the CCU and a 2x2 grid of stats), `small` from
100 x 72 dp (2x1: the CCU and three stats, short), `tiny` otherwise (two stats). `"radius": "system"` is the launcher's widget corner radius on Android 12+, 16 dp before.

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
| `chart` | the CCU line: `bind: "series"`, `minutes` (1..360, default 360), `color` (default `brand`), `fill` (`true`: the line colour fading down, a colour, or `false`), `stroke` (dp, default 2), `dot` (newest point, default true), `zero` (the value axis from 0 to a round top: 1, 2, 2.5, 5 x 10ⁿ; `false`: fitted to the low and high values; default true), `bucket` (minutes averaged into one point, 0..60, 0/1 = every point; default 5), `smooth` (a curve through the points; default true), `labels` (the top, middle and bottom values on the left with light grid lines, in `text2`; default true). Without a `height` it takes `weight: 1`. |
| `spacer` | `size` (dp along the parent's axis) or a `weight` |
| `divider` | a line across the parent: `color` (default `divider`), `thickness` (dp, default 1) |
| `icon` | `name`: `flame`, `refresh`, `people`, `server`, `clock`; `size` (dp, default 16), `color` (default `text2`) |
| `image` | a picture by URL: `bind` (the binding holding the URL, default `game.iconUrl`), `size` (dp, a square, default 22; `width` / `height` override), `radius` (corner radius in dp, default 6), `placeholder` (the colour drawn while the picture is missing, default `divider`; `null` draws nothing). Centre-cropped, scaled to the drawn size. |
| `svg` | inline SVG drawn into the element's box: `svg` (the markup, a template; below), `fit` (`fill`: the viewBox stretched to the box, the default; `contain`: uniform, centred, all of it; `cover`: uniform, centred, cropped). Without a `height` it takes `weight: 1`. An older APK skips the element. |

### The `svg` element

```jsonc
{ "type": "svg", "height": 60, "fit": "fill",
  "svg": "<svg viewBox='0 0 {w} {h}'><path d='{chart.area:w,h}' fill='url(#g)'/><path d='{chart.path:w,h}' fill='none' stroke='var(--brand)' stroke-width='2'/><defs><linearGradient id='g' x2='0' y2='1'><stop offset='0' stop-color='var(--brand)' stop-opacity='.35'/><stop offset='1' stop-color='var(--brand)' stop-opacity='0'/></linearGradient></defs></svg>" }
```

**The template.** `svg` is filled at every draw like a text (`{name}`, `{name:format}`, `{name|fallback}`, `{{` / `}}`),
with every value XML-escaped (a game named `A & B` can't break the markup), plus these names:

| Name | Value |
|---|---|
| `{w}`, `{h}` | the element's box in dp (2 decimals at most), so `viewBox='0 0 {w} {h}'` makes one unit one dp. Also replaced inside other placeholders: `{chart.path:{w},{h}}` |
| `{chart.path:W,H,minutes,bucket,zero,smooth}` | the CCU line as SVG path data (`M`, `L`, `Q`) in a W x H box: x by time from 0 (oldest) to W (newest), y from 0 (axis top) to H (axis bottom). The same window, buckets, axis and smoothing as the `chart` element. Empty without points |
| `{chart.area:…}` | the same line closed down to H (a fill under the line) |
| `{chart.max:…}`, `{chart.mid:…}`, `{chart.min:…}` | the axis values as labels (`260`, `1.2K`): with `zero` the round top, half of it and 0 |
| `{chart.lastX:…}`, `{chart.lastY:…}` | the newest point in the W x H box (for a dot: `<circle cx='{chart.lastX:w,h}' cy='{chart.lastY:w,h}' r='3'/>`) |

All arguments are optional, by position: W and H a number, `w` / `h` or empty (the element's box); `minutes` 1..360
(default 360); `bucket` 0..60 (default 5); `zero` and `smooth` `1` / `0` (also `true` / `false`; default 1). So
`{chart.path}` is the 6-hour line, 5-minute buckets, zero-based and smooth, in the whole box; `{chart.path:w,h,60,1,0,0}`
the last hour, every point, fitted, straight. The path touches the box's edges: inset it with a `transform` or a smaller
W / H when the stroke must not be cut. A missing value is empty (`{chart.max|—}` shows `—`).

Slot values are plain text in SVG (no unit colours); colour units with tspans and these bindings:

| Binding | Value (`18m 40s` / `34.21%` / `R$2,140` / `1,830`) |
|---|---|
| `slot.N.number` | the value without its unit: `18m 40s` (a duration keeps its units), `34.21`, `2,140`, `1,830`; `—` when missing |
| `slot.N.unit` | the unit: empty, `%`, `R$`, empty (a unit's own spaces kept: ` h`) |
| `slot.N.unitBefore`, `slot.N.unitAfter` | the unit when it goes before the number (`R$`) / after it (`%`, ` h`), else empty |
| `slot.N.unitToken` | the unit's colour token: `unitTime`, `unitPercent`, `unitRobux`; empty for counts |

```xml
<text x="0" y="14" font-size="13" fill="var(--text)"><tspan fill="var(--{slot.1.unitToken})">{slot.1.unitBefore}</tspan>{slot.1.number}<tspan fill="var(--{slot.1.unitToken})">{slot.1.unitAfter}</tspan></text>
```

(`var(--)`, an empty token, is ignored: the tspan keeps the text's colour.)

**What is drawn** (SVG 1.1, a subset; anything else is skipped, never an error):

- `svg` (root: `viewBox`, mapped by `fit`; without one, user units are dp from the box's top left), `g`, `a`, nested
  `svg` (moved to its x / y; its own viewBox is ignored), `use` (`href="#id"`, x, y; `symbol` too), `defs`.
- `transform` on any element: `translate`, `scale`, `rotate` (with a centre), `skewX`, `skewY`, `matrix`.
- Shapes: `rect` (x, y, width, height, rx, ry), `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path` (`d`, every
  command, via androidx.core PathParser). Lengths: numbers, `px`, `pt`, `em`, `%` (of the viewBox).
- Paint: `fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`,
  `stroke-dasharray`, `stroke-dashoffset`, `fill-rule`, `opacity` (a group's in a layer), `fill-opacity`,
  `stroke-opacity`, `color` / `currentColor`, `display="none"`, `visibility`; as attributes or in a `style`
  attribute (no `<style>` sheets, no classes). Inherited as in SVG; the default fill is black.
- Colours: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (CSS order: alpha last, unlike the spec's `#AARRGGBB`), `rgb()`,
  `rgba()`, a few names (`black`, `white`, `red`, `gray`, …, `transparent`), `none`, the spec's tokens as
  `var(--text)` / `var(--brand, #f80)` (day or night, like everything else) or a bare token name, and `url(#id)` (with
  a fallback colour after it).
- `linearGradient` (x1, y1, x2, y2) and `radialGradient` (cx, cy, r; no focal point): `stop` (offset, stop-color,
  stop-opacity), `gradientUnits` (objectBoundingBox, the default, or userSpaceOnUse), `gradientTransform`,
  `spreadMethod`, stops from another gradient by `href`.
- `clipPath` (its rect / circle / ellipse / line / polygon / path children, `clipPathUnits`) through `clip-path` on
  shapes, groups, texts and images.
- `text` and `tspan`: x, y, dx, dy (the first of a list), `font-size` (in viewBox units; the system font scale doesn't
  apply), `font-weight` (100..900, `bold`, …), `font-style`, `font-family` (only `monospace` / `serif` / the default
  sans), `text-anchor` (start, middle, end; per chunk: a tspan with its own x or y starts one), `dominant-baseline`
  (`middle` / `central` / `hanging`), fill, stroke, opacity; tspans inherit and flow; white space as a browser shows it.
  The texts are added to the widget's TalkBack description.
- `image`: `href` (or `xlink:href`; an `https://` / `http://` URL, e.g. `{game.iconUrl}`), x, y, width, height,
  `preserveAspectRatio` (all alignments, meet / slice, none), `clip-path` (a rounded icon: a `clipPath` with a `rect`
  with `rx`; drawn with smooth edges). Same disk cache as the `image` element (section Pictures); nothing is drawn
  until it is downloaded.

Not drawn: `<style>`, classes, CSS selectors, `mask`, `pattern`, `filter`, `marker`, `foreignObject`, `textPath`,
per-glyph positions, `letter-spacing`, text decoration, gradient focal points, `vector-effect`, `data:` images,
DOCTYPE / entities (the whole svg is skipped), animation.

**Robustness.** Broken markup draws what was read before the error; an element that fails is skipped. At most 64,000
template characters (a longer one is dropped when the spec is read: the element draws nothing), 200,000 after filling,
2,000 elements and text runs, 32 levels, 4,000 drawn elements (with `use`). Problems go to logcat once each
(`adb logcat -s TypeTorchLive`, `svg: …`).

### Bindings (text templates)

A text is a literal with placeholders: `{name}`, `{name:format}` (another format), `{name|fallback}` (shown when the
value is missing), `{{` and `}}` for braces. A missing number shows `—` (a missing delta shows nothing). The format is
what follows the last `:` when that is a format's name (metric ids hold `:` too: `{metrics.revenue:72h.value:short}`).

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
| `game.iconUrl` | | the game's icon URL (for `image`; null from an older backend) |
| `slot.N` (N = 1..4) | | the slot's metric id (`dau`, `revenue:72h`); missing when the slot is empty, so `showIf: "slot.3"` hides an empty slot's elements |
| `slot.N.label` | | `DAU`, `Session 1h` (the backend's label, else the app's built-in one) |
| `slot.N.value` | `unit` | `18m 40s`, `34.2%`, `R$2,140`, `1,830` (rich: units coloured) |
| `slot.N.delta` | `delta` | `▲6%`, `▼14%`, ratios in points (`▲1.10`, `format.ratioDecimals`), `±0%`; coloured `up` / `down` (`text2` for ±0); missing when the backend has no `prev` |
| `slot.N.number`, `slot.N.unit`, `slot.N.unitBefore`, `slot.N.unitAfter`, `slot.N.unitToken` | | the parts of `slot.N.value` for the `svg` element's tspans (section The `svg` element) |
| any other name | | a path into the live answer: `metrics.mau.value`, `metrics.revenue:72h.delta`, `game.universeId`, `lastHour.at`, … (dots between keys, array items by index) |

Formats: `count` (214, 1.2K, 1.5M), `grouped` (1,240), `delta` (▲12), `duration` (45 s, 18 m 40 s, 2 h 5 m), `hours`
(1,240 h, 4.5 h, 35 m), `raw`; rich (units coloured, below): `seconds` (45s, 18m 40s, 2h 5m), `percent` (0.3421 →
34.21%, `format.ratioDecimals` decimals), `robux` (R$2,140); for metric values `unit` (the default: by the metric's
unit), `short` (34%, R$2.1K, 1.8K) and `plain` (`unit` without colours, e.g. for `description`).

### Stat slots and metrics

Each widget has up to four **stat slots**: metric ids (docs/WIDGET_STATS.md) picked in the app (Settings → Widgets),
saved natively per widget; a newly placed widget gets the default slots (`["session:1h", "dau", "d1", "revenue:72h"]`,
or what the app last set with `setDefaultSlots`). A widget refresh asks the backend `metrics=` for the union of the
slots of that backend's widgets (the live watch asks none and keeps the cached metrics). Units: `count`, `ratio` (shown
as %), `robux`, `seconds`, `hours`; an unknown unit shows the number and the unit's name.

A path binding into `metrics` makes a new backend metric usable without an APK: the number of a metric's `value` (or
`prev`) comes formatted by its `unit`, and `metrics.<id>.delta` is computed from `value` and `prev`. A metric is only in
the answer when some widget's slot asks for it.

An older backend (no `metrics`, no `game.iconUrl`) still draws: the slots `ccu`, `servers`, `peakToday`, `session:1h`,
`playtime:1h` and `sessions:1h` fall back to the answer's top-level and `lastHour` fields, the others show `—`, and the
icon shows its placeholder.

### Rich text

A value formatted by its unit becomes segments: the number in the element's `color`, the unit in a unit token (`m`/`s`/
`h` in `unitTime`, `%` in `unitPercent`, `R$` in `unitRobux`); a delta segment carries `up` / `down`. Literal text in
the template keeps the element's colour. To show a value without colours, use the `plain` format or set the unit
tokens to the text colour in `tokens`.

### Pictures

`image` elements (and the svg element's `<image>` URLs, up to 8, as filled with the answer's values: a slot binding
in an `href` isn't known there) are downloaded by the widget's background refresh (never while drawing, never on the main thread), kept
in the app's cache dir (`cache/ttl_widget_images/`, keyed by the URL's hash) and fetched again after 24 hours; a failed
download keeps the old copy and is retried after 10 minutes at the earliest. Drawing reads the disk only: until the
picture is there the `placeholder` shows. Pictures unused for 30 days are deleted. No token is sent with them.

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
| `unitTime` | #FFE2700F | #FFFB923C |
| `unitPercent` | #FF1F6FD1 | #FF5AA9FF |
| `unitRobux` | #FF1F8A4C | #FF4CC27A |

`tokens.day` / `tokens.night` override them (and may add new token names to use elsewhere in the spec). Today's spec
sets the agreed look: `text` near-black by day (#FF17171B) and near-white by night (#FFF2F0F5), `bg` #EFFFFFFF /
#FF1C1C20, `up` / `down` #FF1F8A4C / #FFC93C3C by day and #FF4CC27A / #FFEF6B6B by night.

### Example

A small widget with the game's icon, the CCU and the delta, and the first two stat slots under it (units coloured):

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
                { "type": "image", "bind": "game.iconUrl", "size": 18, "radius": 5 },
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
            { "type": "text", "text": "{slot.1.label} {slot.1.value} {slot.1.delta}", "size": 11, "showIf": "slot.1" },
            { "type": "text", "text": "{slot.2.label} {slot.2.value:short}", "size": 11, "showIf": "slot.2" }
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
looks right before the app first runs (generate it from `JSON.stringify(WIDGET_SPEC, null, 2)`; e.g. with bun:
`import { WIDGET_SPEC } from "./src/features/live/widget-spec.ts"; console.log(JSON.stringify(WIDGET_SPEC, null, 2))`,
pasted between the `"""` marks, and check that the JSON holds no `$`, which a Kotlin raw string would read as a template).

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
- A picture is downloaded right after the fetch that learnt its URL and shows in that refresh's final drawing (if both
  finish inside the refresh's 25 s), else at the next refresh; the live watch's redraws never download.
- Four slots at most, and the backend answers at most 12 metric ids per fetch (the union over a backend's widgets).
- The `svg` element draws a subset of SVG (section The `svg` element) and is parsed at every draw; keep it to a few
  hundred elements. Its look can differ from a browser's in details: font metrics, hairline anti-aliasing.
