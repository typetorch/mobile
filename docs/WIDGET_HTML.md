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

Built (2026-11-18). The app's widget is `src/features/live/widgets/default.html.ts` (one exported template string),
compiled by `src/features/live/widgets/compile.ts` (no dependencies) into the spec that LiveSync sends. The compiler
never throws: anything it can't map is left out and reported as a warning (`line N: …`), listed in the dev console and
in Settings → Widgets in dev builds.

| File | What |
|---|---|
| `src/features/live/widgets/default.html.ts` | the widget (all size classes and states) |
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

## Editing the widget

1. Edit `src/features/live/widgets/default.html.ts` (the HTML above, in a template string).
2. Preview on the desktop: `timeout 60 bun scripts/widgets/preview.ts`, open `docs/widgets-preview.html` in a browser
   (`--watch` rebuilds on save; reload the page). It draws every size class (4x2, 4x1, 2x2, 2x1 and two other 2x1
   heights, plus a custom size) and the message states, by day and by night, with three samples (growing, falling,
   sparse: offline, two slots, no icon, no line), and shows the warnings and the compiled spec. The page has its own
   editor for quick tries (kept in the browser's storage; paste the result back into `default.html.ts`). It's an
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
