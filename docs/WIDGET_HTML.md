# Widgets in HTML (option B, agreed 2026-11-18)

Goal: widget changes ship over OTA, written almost like the HTML mockups. Two parts:

1. **App (JS, OTA):** widgets are authored as a small HTML + inline-CSS subset (`src/features/live/widgets/*.html.ts`,
   template strings) and compiled in JS to the widget spec JSON (docs/WIDGET_SPEC.md) that the app already sends with
   `setWidgetSpec`. The same HTML previews in a desktop browser with sample data (a preview page), so a design can be
   tuned before it ships.
2. **Native (one APK):** a new `svg` spec element drawn by our renderer, data helpers for it, and the chart/format
   options (axis labels, zero-based scale, buckets, smoothing, `format.ratioDecimals`).

## The `svg` spec element (native)

```jsonc
{ "type": "svg", "svg": "<svg viewBox='0 0 {w} {h}'>…</svg>", "fit": "fill", /* + Common: weight, width, height, margin, … */ }
```

- The `svg` string is a template: `{binding}` / `{binding:format}` / `{a|fallback}` placeholders are filled with the
  same values as text elements (escaped for XML), plus:
  - `{w}`, `{h}`: the element's box in dp (so the SVG can lay itself out to its box);
  - `{chart.path:W,H[,minutes][,bucket][,zero][,smooth]}`: the CCU line as SVG path data fitted to a W×H box
    (minutes default 360, bucket 5, zero 1, smooth 1); `{chart.area:…}` the same closed down to the bottom (for a fill);
    `{chart.max:…}`, `{chart.mid:…}`, `{chart.min:…}` the axis values (nice-rounded top when zero=1) and
    `{chart.lastX:…}`, `{chart.lastY:…}` the newest point;
  - `{slot.N.value}` etc. stay plain text here (no unit colouring); use `<tspan>` with `{slot.N.number}` and
    `{slot.N.unit}` for coloured units (new bindings: the formatted number part and the unit part; `unitColor` token name
    via `{slot.N.unitToken}`).
- `fit`: `fill` (default; viewBox stretched to the box), `contain`, `cover` (preserveAspectRatio meet / slice).
- Supported SVG subset (anything else is skipped, never a crash): `svg` (viewBox), `g` (transform: translate, scale,
  rotate, matrix; opacity), `rect` (x, y, width, height, rx, ry), `circle`, `ellipse`, `line`, `polyline`, `polygon`,
  `path` (d: all commands, via androidx.core PathParser), `text` + `tspan` (x, y, dx, dy, font-size, font-weight,
  text-anchor start/middle/end, fill, opacity; tspans inherit and flow), `image` (href: a URL or a binding such as
  `{game.iconUrl}`, x, y, width, height, preserveAspectRatio, clip-path to a rounded rect via `rx` on a `clipPath rect`),
  `defs` with `linearGradient` / `radialGradient` (stops with offset, stop-color, stop-opacity; x1/y1/x2/y2, cx/cy/r;
  objectBoundingBox and userSpaceOnUse) and `clipPath` (rect/circle/path). Paint attributes: fill, stroke, stroke-width,
  stroke-linecap, stroke-linejoin, stroke-dasharray, opacity, fill-opacity, stroke-opacity; colours as #rgb, #rrggbb,
  #rrggbbaa, rgb(), rgba(), `none`, `url(#id)`, and spec tokens as `var(--text)`, `var(--brand)`, … (day/night).
- Images in SVG use the same disk cache as the `image` element.

## The HTML subset (app)

Built (2026-11-18). The app's widget is `src/features/live/widgets/default-widget.ts` (one exported template string),
compiled by `src/features/live/widgets/compile.ts` (no dependencies) into the spec that LiveSync sends. The compiler
never throws: anything it can't map is left out and reported as a warning (`line N: …`), listed in the dev console and
in Settings → Widgets in dev builds.

| File | What |
|---|---|
| `src/features/live/widgets/default-widget.ts` | the widget (all size classes and states) |
| `src/features/live/widgets/compile.ts` | `compileWidgetHtml(html) → { spec, warnings }` |
| `src/features/live/widgets/index.ts` | compiled once: `WIDGET_SPEC`, `WIDGET_SPEC_JSON` (sent by LiveSync), `WIDGET_WARNINGS` |
| `src/features/live/widget-spec.ts` | the spec's TypeScript types (incl. `svg`, the chart options, `format`) |
| `scripts/widgets/check.ts` | compiles the widget, fails on a warning or a structure change against `reference.json` |
| `scripts/widgets/preview.ts` → `docs/widgets-preview.html` | the desktop preview (self-contained page) |

### A file

Top-level elements, in any order (comments allowed anywhere):

```html
<!-- Colour tokens per system mode (literal colours; #rrggbbaa = alpha last). No mode: both. -->
<widget-tokens mode="day" style="--bg: #ffffffef; --text: #17171b; --brand: #fb7a32"></widget-tokens>
<widget-tokens mode="night" style="--bg: #1c1c20; --text: #f2f0f5"></widget-tokens>
<!-- The `status` binding's wording. -->
<widget-strings refreshing="refreshing…" offline="offline · {updated}"></widget-strings>
<!-- Number formatting → "format": { "ratioDecimals": 2 } (0..4): 34.25 %, ▲1.12 points. -->
<widget-format ratio-decimals="2"></widget-format>

<!-- One size class of one state; several per state. -->
<widget state="data" name="tiny" min-width="0" min-height="0" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="display: flex; align-items: baseline">
			<span style="font-size: 22px; font-weight: 600">{ccu}</span>
			<span style="margin-left: 4px; font-size: 12px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
		</div>
		<tt-chart minutes="360" bucket="5" labels zero smooth dot fill style="flex: 1; color: var(--brand)"></tt-chart>
	</div>
</widget>
```

`<widget>` attributes: `state` (data, loading, unreachable, signedOut, pick; default data), `name`, `min-width`,
`min-height` (dp, default 0), `refresh` (topEnd, topStart, bottomEnd, bottomStart, none), `background` (a colour) and
`radius` (dp or `system`) for the widget's own background, `description` (TalkBack template). Exactly one root element
inside (more are wrapped in a column, with a warning).

### Elements → spec

| HTML | Spec |
|---|---|
| `<div>` (block) | `column` |
| `<div style="display: flex">` | `row`; with `flex-direction: column`: `column` |
| `<div style="display: grid">` | `stack`; children placed with `place-self: <vertical> <horizontal>` (or `align-self` / `justify-self`): start / center / end, `stretch` on both = fill. Default top-start. |
| an empty `<div>` without a background | `spacer`: `flex: N` → weight, the width (in a row) or height (in a column) → size |
| `<span>`, `<p>`, bare text in a div | `text`; `{bindings}` in the content, whitespace collapsed like HTML; `{{` / `}}` literal braces |
| `<img src="{binding}">` | `image`: `bind` from the src; width = height → `size`, else width / height; `border-radius` → radius; `background` → placeholder (`none` → no placeholder) |
| `<hr>` | `divider`: colour from `background` / `border-color` / `border-top`, thickness from `height` / `border-width` |
| `<tt-icon name="refresh">` | `icon` (flame, refresh, people, server, clock): size from `size="15"` or width / height; `color` |
| `<tt-chart>` | `chart`: `minutes` (1..360), `bucket` (0..60), `stroke`, `fill` (empty = on, `none` = off, or a colour), colour from `style="color: …"`. `dot`, `zero`, `smooth`, `labels` are HTML boolean attributes: present = on, absent (or `="false"`) = off, always written to the spec. |
| `<svg>…</svg>` | `svg`: kept verbatim (its `style` and `data-*` attributes removed); layout from its style (or numeric width / height attributes); `data-fit="fill\|contain\|cover"` |
| `data-show-if="slot.4"` on anything | `showIf` (`!name` for the opposite; `series`: the chart has points) |
| `data-tap="toggle:games.0"` on anything | `tap`: `open`, `refresh` or `toggle:games.N` (docs/WIDGET_SPEC.md, Tap areas; Android 12+, 8 per drawing, ~32 dp targets; an older APK ignores it). In the preview a tap area is clickable and outlined with "hit areas" |
| `style="display: none"` | left out |

### CSS → spec

| CSS | Spec |
|---|---|
| `flex: N` / `flex-grow: N` | `weight` |
| `width`, `height` (px / dp / sp / unitless) | `width`, `height` |
| `padding`, `margin` (1–4 values, `-top/-right/-bottom/-left`, `-inline`, `-block`, `-inline-start/-end`) | `padding`, `margin` (left = start, right = end) |
| `gap` (`row-gap` / `column-gap`) | `gap` |
| `align-items` (flex-start/start, center, flex-end/end, stretch, baseline in rows) | `align` (default: column stretch, row center, as the renderer; not CSS's stretch) |
| `justify-content` (start, center, end, space-between) | `justify` |
| `align-self` in a row / column | `alignSelf` |
| `background` / `background-color` (+ `border-radius`: px or `system`) | `background` (`{ color, radius }` with a radius) |
| `font-size`, `font-weight` (100..900, normal, medium, semibold, bold), `color`, `text-align` (left, center, right) | text `size`, `fontWeight`, `color`, `align`; inherited from containers like CSS (also an icon's colour) |
| `-webkit-line-clamp: N` / `line-clamp` | `maxLines` (default 1) |
| `text-overflow: clip` | `ellipsis: false` |

Colours: `var(--token)` (any token, built-in or added in `<widget-tokens>`; `var(--delta)` = up / down by the delta's
sign), `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `white`, `black`, `transparent`; literals become the
spec's `#AARRGGBB`.

Accepted and ignored silently (browser layout hints): `overflow`, `min-width`, `min-height`, `box-sizing`,
`flex-shrink`, `flex-basis`, `white-space: nowrap`, `text-overflow: ellipsis`, `word-break`, `-webkit-box-orient`,
`display: -webkit-box`.

Warned about and left out: any other CSS (`line-height`, `letter-spacing`, `font-family`, `position`, `border` on
non-dividers, `%` / `em` / `auto` sizes and margins, `space-around`, `flex-wrap`, reverse directions…), `class`
attributes (only inline `style` is read), unknown attributes, unknown elements (`<b>`, `<br>`, `<table>`…; inline
elements inside a text keep only their text: one text has one style, units are coloured by the renderer), an `<img>`
with a literal URL, unknown icon names, out-of-range chart attributes, unbalanced `{` `}`, unclosed / stray tags, text
outside a `<widget>`, a `<widget>` with a bad state, and specs the renderer would reject (no data layout, more than 400
elements, over 200,000 characters, nesting over 24).

## The release garden (Releases style)

A widget's style is Stats or Releases (Settings → Widgets; docs/WIDGET_RELEASES.md). Releases is stored as the slots
`["", "", "", "releases"]`: an empty slot 1 is the marker, slot 4 makes the native side fetch the `releases` metric. Every
data size class in `default-widget.ts` therefore has two bodies: the stats (`data-show-if="slot.1"`) and the garden
(`data-show-if="!slot.1"`).

**The data** is the live answer's top-level `releases` (`const R` in `default-widget.ts`): the backend sends it with every
answer (the same shape as `metrics.releases`), and every APK keeps unknown top-level fields for the path bindings (the
older ones keep only a metric's value / prev / unit / label, so `metrics.releases.days` wouldn't reach them; the live
watch's polls ask no metrics either). `days` holds 182 days (26 weeks, `const DAYS`), oldest first, the last one today;
the days before the game's deploy history began are `bg` / `tri` `rnone` (nothing drawn: blank space, not grey squares).
`prod` / `dev` count all of them (about the whole history), `prod30` / `dev30` the last 30. The garden shows when
`releases.prod` has a value, else "Loading releases…" (a path to an object has no value, so `releases` itself can't be
tested).

**The cells** are one `<svg>` per size, generated by `garden(cols, style)`: GitHub order, 7 rows per column, a column
filled top to bottom, columns oldest left, today the bottom-right cell (outlined in `text`). Column c, row r shows
`days[DAYS − 7·cols + 7·c + r]`; a missing day falls back to `rnone`. The svg templates have no arithmetic, so the
geometry is fixed (cell 10, gap 2, radius 2 in viewBox units) and `data-fit="contain"` scales it uniformly into the box:
`cols` is picked per size from the box's aspect. A rounded `rect` (`#c`) and the split `path` (`#t`, the bottom-right half
below the top-right → bottom-left diagonal, following the rounded corners) are in `<defs>` once and every day places them
with `<use … fill='var(--{releases.days.N.bg|rnone})'>` / `…tri|rnone…` (the fill is inherited), which keeps the spec at
about 155k of the 200k characters.

| Size class | Weeks (cols) | Typical grid box → cell | Beside / under | All games |
|---|---|---|---|---|
| medium (4×2) | 14 | 225 × 117 dp → 13.6 dp | prod / dev, last prod, its label (its game on all games) | 6 chips above the grid, the picked one with its name |
| wide (4×1) | 12 | the full height (380 × 115 widget: 95 dp → cells ≈ 12 dp), right-aligned (`gardenRight`) | no title row; a 168 dp column right of the grid: icon, name, ↻; prod / dev; last prod and its label | the same column: up to 5 chips (28 dp) and ↻; a line per game (up to 3: icon, name, its prod / dev, its last prod, from the program's `games.N.prod` / `dev` / `lastProd`); the totals |
| grid (2×2) | 11 | 144 × 93 dp → 11 dp | prod30 / dev30 under | the first 4 games' chips above |
| small4 (2×1 tall) | 24 | 144 × 41 dp → 5 dp | prod30 / dev30 under | no chips |
| small (2×1) | 26 | 176 × 41 dp → 5 dp | prod30 / dev30 in the header (in place of the status) | no chips |
| tiny (2×1 short) | 26 | 144 × 27 dp → 3.3 dp | prod30 / dev30 in the header | no chips |

An older backend that sends 60 days: the cell indices count from 182, so its days don't reach the grid (no arithmetic
to align them to today): the grid stays blank, the counts show.

**The all-games 4×2** (variant C) has no title row: 8 weeks at a fixed 132 × 114 dp (cells ≈ 14 dp) with today's cell
ringed in `var(--{health.todayRing|rnone})` (`garden(cols, style, ring)`), and beside it the game chips and ↻, a health
line (`{health.errors1h}` red with ▲ when `health.errorsHigh`, servers ok / total green when `health.serversAllOk` else
amber, open alerts amber when `health.hasAlertsOpen`: each colour is a pair of spans with opposite `data-show-if`, since
element colours can't be bound), up to 3 alert lines (an 8 dp dot in `var(--{health.alerts.N.dot})`, the text ellipsized,
the age), "No alerts in 24 h" when there are none, and the totals at the bottom. Without `health` (older backends) the
health part is hidden and the last prod shows instead. Tokens `bad` / `warn` by day / night: #d64545 / #ef6b6b,
#c77c12 / #f0a03a.

**The 4×1** draws the grid with `gardenRight(cols, style)`: `viewBox="0 0 {w} {h}"` (the box in dp, fit fill) and the
grid moved to the right edge and scaled to the box's height with `transform='translate({w}) scale({h}) scale(1/82)
translate(-gridWidth)'` (the svg templates have no arithmetic, but transforms compose), so it fills the height and sits
next to the side column on any widget size; a box narrower than 12 weeks cuts the oldest columns. The side column's
middle (the game lines, or one game's prod / dev) has `flex: 1`, so on a short 4×1 (330 × 78) the chips and the totals
keep their place and the lines are clipped (one fits). The game lines need the widget program (`games.N.prod` is only in
its games[]); without it (an older APK) they are hidden.

**All games** (backend `*`, docs/WIDGET_SPEC.md, All games; the next APK): the merged live object has `allGames: "1"`,
`game` = "All games" or the picked game, the merged top-level `releases` (plus `lastProdGame`) and `games.N`. The header
hides the game icon (`!allGames`) and puts "Releases ·" before `{game}` (`allGames`); the grid and counts are the same
markup as a single game's. A game chip (`chips(count, named, style)`) is a `<div data-show-if="games.N.id"
data-tap="toggle:games.N">` around a 32 dp `<svg>`: the icon (`<image href='{games.N.iconUrl}'>` clipped to a circle over
a `chip`-coloured disc) in a group with `opacity='{games.N.alpha|1}'` (0.4 when another game is picked), and a ring with
`stroke-opacity='{games.N.picked|0}'` (shown only on the picked one). On the 4×2 the picked chip is a pill with the name
(`width: 70px`, ellipsized).

Colour tokens, by day / by night: `r0` (no release) #ebedf0 / #2b2b31; `rg1`–`rg3` (prod 1, 2–3, 4+) #9be9a8 #40c463
#216e39 / #1f6f45 #2fa463 #4cc27a; `rb1`–`rb3` (dev) #b3d1fa #4a8fe0 #1d5cb3 / #24508a #3a7fd0 #5aa9ff; `rnone`
transparent; `chip` #ececf0 / #2b2b31. The counts use `rg3` / `rb3` as text colours.

The preview's Style menu switches the per-game samples between Stats, Releases and Releases without data; the sample
"All games" has four games whose chips toggle the pick like the widget.

## Health on the Stats widgets

The per-game Stats variants (`slot.1`) show the game's health from the widget program's `live.health`
(program/health.ts `gameHealth`, docs/WIDGET_PROGRAM.md): errors in the last hour with the trend against the hour before
(`errorsTrend`: ▲4× when ≥ 2× and at least 1 error, ▲38% for a rise over 10%, ▼61% for a fall over 10%, nothing within
±10%; red up, green down), servers ok / total (amber when any isn't ok, else muted) and open alerts (amber when any, else
muted). No alert list (that stays in the release widget). Everything is behind `health.on`, which only the program sets:
no health (an older backend) or no program (the native path) hides it, the rest is as before.

| Size class | Health |
|---|---|
| medium (4×2) | a divider and one line at the bottom: "143▲4× err 1h  5/6 srv  2 alerts"; the stat rows put the delta left of the value in a 34 dp right-aligned slot |
| wide (4×1) | three lines under the CCU (err, srv, alerts) in the height left (a short 4×1 shows the first); the stat rows as the 4×2 (30 dp delta slot) |
| grid (2×2) | three pills under the CCU (errors with the trend, servers, "N al"); the "· N servers" after the CCU hides |
| small4 / small (2×1) | a right-aligned line over the stats: "143▲ err · 5/6 srv" (the arrow only); the last stat row hides (small4 3 stats, small 2) |
| tiny (2×1 short) | the same line in the header in place of the status |

The lines are `<svg>` texts: one element whatever the colours, each part's fill a token name the program picked
(`var(--{health.errorsTone})`, `trendTone`, `serversTone`, `alertsTone`). The 2×2 pills are native texts, so each colour
is a pair of spans with opposite flags (`errorsUp` / `errorsDown`, `serversAllOk`, `hasAlertsOpen`).

## Editing the widget

1. Edit `src/features/live/widgets/default-widget.ts` (the HTML above, in a template string).
2. Preview on the desktop: `timeout 60 bun scripts/widgets/preview.ts`, open `docs/widgets-preview.html` in a browser
   (`--watch` rebuilds on save; reload the page). It draws every size class (4x2, 4x1, 2x2, 2x1 and two other 2x1
   heights, plus a custom size) and the message states, by day and by night, with three samples (growing, falling,
   sparse: offline, two slots, no icon, no line), and shows the warnings and the compiled spec. The page has its own
   editor for quick tries (kept in the browser's storage; paste the result back into `default-widget.ts`). It's an
   approximation of the Android drawing (fonts and line heights differ slightly).
3. Check: `timeout 60 bun scripts/widgets/check.ts`: no warnings, and the structure against
   `scripts/widgets/reference.json` (the spec the HTML was ported from). After an intended design change, accept it with
   `bun scripts/widgets/check.ts --update`. It also compares with the APK's built-in default (`DEFAULT_JSON`, info only).
   Then `timeout 400 npx tsc --noEmit -p .`.
4. Try it on a phone with a dev build (the app sends the spec when the accounts are ready; a rejected spec logs
   `[typetorch-live] setWidgetSpec failed: …`).
5. Ship: `npx eas-cli@latest update --channel production --message "widget: …"`. Elements or options a phone's APK
   doesn't know yet (e.g. `svg`, the new chart options before the APK that brings them) are skipped / ignored there.
6. At the next APK, put `bun scripts/widgets/check.ts --print` into `WidgetSpec.kt`'s `DEFAULT_JSON` (no `$` in it).
