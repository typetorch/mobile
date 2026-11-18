# Widget program: widget logic over OTA (agreed 2026-11-18)

Widgets draw from the widget spec (docs/WIDGET_SPEC.md, authored as HTML: docs/WIDGET_HTML.md), which ships over OTA. The
data logic (what to fetch, how to combine several games, the colour rules) was native Kotlin, so changing it needed an
APK. From this APK on, a **widget program** (JavaScript, sent by the app like the spec, so OTA) does it; the native side
only fetches, runs the program in a sandbox, and draws.

Engine: `androidx.javascriptengine:javascriptengine` (JavaScriptSandbox: an isolated V8 in the WebView's sandbox process,
off the main thread). Phones where `JavaScriptSandbox.isSupported()` is false (or older than the library's minimum API,
guarded at run time) keep today's native path, so nothing regresses.

## The program (JS, OTA)

Plain JavaScript (ES2020, no imports, no I/O), one source string defining three global functions. Everything in and out
is JSON.

```js
// What to fetch for one widget. backends: the signed-in ones [{ id, name, url }]; widget: { id, backendId ("*" = all
// games), slots, state (the program's own JSON, from taps) }.
function plan({ widget, backends, now }) {
  return { requests: [{ backend: "<id>", path: "/v1/mobile/live", query: { minutes: "360", metrics: "dau,releases" } }] };
}

// The object the spec's bindings read (today: the live JSON, or AllGames.kt's merged object), from the answers.
// responses: { "<backend id>": { "<path>?<query>": { ok: true, body } | { ok: false, status, error } } } (from the
// cache: the newest answer of each request, even an old one, with its time), size: { w, h } dp, night: boolean.
function shape({ widget, backends, responses, size, night, now }) {
  return { live: { game: {...}, ccu: 214, metrics: {...}, releases: {...}, games: [...] }, state: widget.state };
}

// A tap on an element with `tap: "action:<anything>"` (the spec's tap field, new kind). Returns the widget's new state;
// the widget is shaped and drawn again from the cache (no fetch).
function tap({ widget, action, now }) {
  return { state: { ...widget.state } };
}
```

- `live` replaces the fetched JSON as what bindings read; the native side still adds what it computes today (slot.N.*
  from `live.metrics` and the widget's slots, status / updated / refreshing from the cache times).
- `state`: at most 4 KB of JSON per widget, kept by the native side (survives restarts).
- Limits: each call ≤ 2 s and ≤ 16 MB of heap (`IsolateStartupParameters`), output ≤ 256 KB; a failure (exception,
  timeout, bad output) draws the spec's `unreachable` state with the error's first line in `{error}` and logs once;
  the previous good drawing isn't lost (cache).
- Requests: GET only, only to signed-in backends' URLs, path must start with `/v1/`, at most 8 per widget per refresh,
  the backend's token added natively (the program never sees tokens). Answers cached per backend + path + query.

## Native (Kotlin, one APK)

- `setWidgetProgram(source: string): boolean` (JS API; false when the engine isn't supported on this phone) stores the
  source; "" clears it (native path again).
- With a program: refresh = `plan` per widget → fetch (worker threads, the existing deadline, one backend failing doesn't
  stop the others) → cache → `shape` → draw. Taps `action:*` → `tap` → `shape` → draw. Watch polls feed the same cache.
- One sandbox, started on demand, one isolate per call (or reused while a watch runs), closed after 60 s idle.
- Without a program, or unsupported: today's path, unchanged.

## App (JS)

- `src/features/live/widgets/program/` (TypeScript), built by `scripts/widgets/build-program.ts` (bun build, one
  self-contained file) into `program.generated.ts` (an exported string, committed), sent by LiveSync with
  `setWidgetProgram` after `setWidgetSpec`. Hermes compiles app functions to bytecode, so `Function.toString` can't be
  used; the program must be a string built at dev time.
- The default program reproduces today exactly: per-game widgets pass the live answer through (asking for the slots'
  metrics); all-games widgets merge every game's releases by date with the colour rule, **keeping "rnone" for days no
  game has history**, games[] with picked/alpha, the filter as program state (tap `action:toggle:<backend id>`).
- A check script runs the program in node/bun against recorded answers (fixtures) and compares `live` with today's
  native output for the same input.

## Editing the widget program

The default program lives in `src/features/live/widgets/program/` (TypeScript; `index.ts` has plan / shape / tap,
`all-games.ts` the all-games merge, `releases.ts` the release garden merge, `answers.ts` the requests and how a widget
finds its answer in the cache). It must stay ES2020, with no imports at run time (the files import each other, the
bundle inlines them) and no I/O: no `fetch`, timers, `console` or globals of the app.

1. Edit the files above. What it does today:
   - per-game widgets: one `GET /v1/mobile/live?minutes=360&metrics=<the non-empty slots, deduplicated, ≤ 12>`, the
     answer passed through as `live` (a newer answer of the same path, e.g. a live watch poll, brings fresh live
     numbers; the widget's metrics and `releases` stay);
   - all-games widgets (`*`): the same request per signed-in backend (at most 8) with `metrics=releases,<slots>`,
     merged as AllGames.kt did, except that a day no game has history for stays `rnone`;
   - taps: `action:toggle:<backend id>` picks a game (or clears the pick); also accepted, by games[] position:
     `toggle:games.N`, `action:toggle:N` and an unfilled `action:toggle:{games.N.id}` (shape keeps the games' ids in
     the state as `games` for this).
2. Build: `timeout 60 bun scripts/widgets/build-program.ts` writes `src/features/live/widgets/program.generated.ts`
   (one self-contained script defining the global `plan`, `shape` and `tap`; commit it). `--check` only tells whether
   it is current.
3. Check: `timeout 60 bun scripts/widgets/check-program.ts` runs the built script in a fresh V8 context (JSON in, JSON
   out) against made-up answers (3 games with 182 days and history starts, an older backend's 60 days, a failing
   backend, a watch poll) and checks the requests, the pass-through, the merge day by day, the filter and the toggles;
   also that the generated file is current and parses as ES2020. Add a case there for every behaviour you change.
   Then `timeout 400 npx tsc --noEmit -p .`.
4. Ship over OTA like the widget HTML. LiveSync sends the program after the spec; where `setWidgetProgram` is missing
   (an older APK) or returns false (no engine), it sends the spec with the chips' taps as `toggle:games.N`, which the
   native path knows.
