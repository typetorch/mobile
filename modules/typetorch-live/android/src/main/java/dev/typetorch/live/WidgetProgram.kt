package dev.typetorch.live

import android.content.Context
import android.os.SystemClock
import android.util.SizeF
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * One request of a widget program's `plan`, checked: [backend] a signed-in backend's id, [path] under `/v1/`, [query]
 * canonical (keys sorted, `encodeURIComponent`-encoded, `&`-joined). [key] (`path`, or `path?query`) is its cache key and
 * its key in `shape`'s `responses[backend]`.
 */
internal class ProgramRequest(val backend: String, val path: String, val query: String) {
  val key: String get() = if (query.isEmpty()) path else "$path?$query"
}

/** What `shape` gave one widget, with the cache times of its planned answers. [error]: the call failed. */
internal class Shaped(
  val live: JSONObject?,
  val okAt: Long,
  val failedAt: Long,
  val anyOk: Boolean,
  val anyFailed: Boolean,
  val error: String?,
  val open: String?,
)

/**
 * The widget program (docs/WIDGET_PROGRAM.md): JavaScript the app sends (setWidgetProgram, OTA like the spec) that
 * says what to fetch for a widget (`plan`), what its bindings read (`shape`) and what an `action:*` tap does (`tap`).
 * The native side fetches (GET, signed-in backends only, `/v1/` paths, at most [MAX_REQUESTS] per widget, the token
 * added here: the program never sees tokens), caches the answers ([ProgramCache]), runs the program in the sandbox
 * ([ProgramSession]) and draws `live` with the spec as usual. Without a program, or where the sandbox isn't supported,
 * nothing here runs ([open] is null) and the widgets take today's native path.
 */
internal object WidgetProgram {
  /** The live watch's poll of a backend (`GET /v1/mobile/live?minutes=30`), cached under this key for `shape`. */
  const val WATCH_KEY = "/v1/mobile/live?minutes=30"

  const val MAX_REQUESTS = 8
  const val MAX_STATE_BYTES = 4096
  const val MAX_SOURCE_CHARS = 1_000_000

  /** `live`'s unknown fields kept for path bindings (the native cache keeps 16,000 characters; `live` may hold more). */
  const val MAX_LIVE_FIELD_CHARS = 200_000

  private const val MAX_QUERY_CHARS = 1_000

  /** `/v1/` then path characters; no `?`, `#`, `%`, `..` segments or `//` (checked in [parsePlan]). */
  private val PATH = Regex("^/v1/[A-Za-z0-9._~:@+,=/-]{0,200}$")

  private val logged = HashSet<String>()

  fun source(ctx: Context): String? = Store.widgetProgram(ctx)?.takeIf { it.isNotBlank() }

  /** A session when a program is set and the sandbox is supported, else null (today's native path). */
  fun open(ctx: Context): ProgramSession? {
    val src = source(ctx) ?: return null
    if (!JsEngine.supported()) return null
    return ProgramSession(ctx.applicationContext, src)
  }

  /** Logs [msg] once per distinct text (until the program changes): a widget redraws often. */
  fun logOnce(msg: String) {
    val first = synchronized(logged) { logged.size < 64 && logged.add(msg) }
    if (first) Log.w("widget program: $msg")
  }

  fun resetLog() {
    synchronized(logged) { logged.clear() }
  }

  // region inputs

  private fun backendsJson(signedIn: List<Backend>): JSONArray {
    val arr = JSONArray()
    for (b in signedIn) arr.put(JSONObject().put("id", b.id).put("name", b.name).put("url", b.url))
    return arr
  }

  /**
   * `{ id, backendId, slots, state, filter }`. The first time (no saved state), the state starts as `{ filter }` from
   * the pick the native all-games widget saved (Store's widget filter), so a pick survives the switch to the program.
   */
  private fun widgetJson(ctx: Context, id: Int, backendId: String): JSONObject {
    val filter = Store.widgetFilter(ctx, id)
    val saved = Store.programState(ctx, id)
    var state: Any = JSONObject.NULL
    if (saved != null) {
      try {
        state = JSONTokener(saved).nextValue() ?: JSONObject.NULL
      } catch (t: Throwable) {
        state = JSONObject.NULL
      }
    } else if (filter != null) {
      state = JSONObject().put("filter", filter)
    }
    return JSONObject()
      .put("id", id)
      .put("backendId", backendId)
      .put("slots", JSONArray(Store.widgetSlots(ctx, id)))
      .put("state", state)
      .put("filter", filter ?: "")
  }

  // endregion

  // region plan

  /** The widget's requests (from this session's memo, else `plan`). Throws [ProgramError]. */
  fun plan(ctx: Context, s: ProgramSession, id: Int, backendId: String, signedIn: List<Backend>): List<ProgramRequest> {
    s.plans[id]?.let { return it }
    val input = JSONObject()
      .put("widget", widgetJson(ctx, id, backendId))
      .put("backends", backendsJson(signedIn))
      .put("now", System.currentTimeMillis())
    val out = s.call("plan", input)
    val reqs = parsePlan(out, signedIn)
    s.plans[id] = reqs
    return reqs
  }

  /** `plan`'s requests that pass the rules (others are dropped), at most [MAX_REQUESTS], duplicates once. */
  private fun parsePlan(out: JSONObject, signedIn: List<Backend>): List<ProgramRequest> {
    val arr = out.optJSONArray("requests") ?: return emptyList()
    val ids = signedIn.map { it.id }.toSet()
    val seen = LinkedHashMap<String, ProgramRequest>()
    var dropped = 0
    for (i in 0 until arr.length()) {
      if (seen.size >= MAX_REQUESTS) break
      val o = arr.optJSONObject(i)
      if (o == null) {
        dropped++
        continue
      }
      val backend = o.optString("backend", "")
      val path = o.optString("path", "").trim()
      val query = canonicalQuery(o.opt("query"))
      if (backend !in ids || !validPath(path) || query == null) {
        dropped++
        continue
      }
      val r = ProgramRequest(backend, path, query)
      val k = backend + "\n" + r.key
      if (!seen.containsKey(k)) seen[k] = r
    }
    if (dropped > 0) logOnce("plan(): $dropped request(s) dropped (not a signed-in backend, a path outside /v1/, or a bad query)")
    return seen.values.toList()
  }

  private fun validPath(path: String): Boolean {
    if (!PATH.matches(path) || path.contains("//")) return false
    for (seg in path.split('/')) if (seg == "." || seg == "..") return false
    return true
  }

  /** The query object as `k=v&…` (keys sorted, encodeURIComponent); "" for none; null when invalid. */
  private fun canonicalQuery(v: Any?): String? {
    if (v == null || v == JSONObject.NULL) return ""
    if (v !is JSONObject) return null
    val keys = ArrayList<String>()
    val it = v.keys()
    while (it.hasNext()) keys.add(it.next())
    keys.sort()
    val sb = StringBuilder()
    for (k in keys) {
      val value: String = when (val x = v.opt(k)) {
        is String -> x
        is Boolean -> x.toString()
        is Int, is Long -> x.toString()
        is Number -> {
          val d = x.toDouble()
          if (d.isNaN() || d.isInfinite()) return null
          if (d % 1.0 == 0.0 && kotlin.math.abs(d) < 1e15) d.toLong().toString() else d.toString()
        }
        else -> return null
      }
      if (sb.isNotEmpty()) sb.append('&')
      sb.append(encodeComponent(k)).append('=').append(encodeComponent(value))
    }
    return if (sb.length > MAX_QUERY_CHARS) null else sb.toString()
  }

  /** JS `encodeURIComponent`: UTF-8, everything but `A-Z a-z 0-9 - _ . ! ~ * ' ( )` percent-encoded. */
  private fun encodeComponent(s: String): String {
    val sb = StringBuilder(s.length + 8)
    for (b in s.toByteArray(Charsets.UTF_8)) {
      val c = b.toInt() and 0xff
      val ch = c.toChar()
      if ((ch in 'A'..'Z') || (ch in 'a'..'z') || (ch in '0'..'9') || "-_.!~*'()".indexOf(ch) >= 0) {
        sb.append(ch)
      } else {
        sb.append('%').append(HEX[c shr 4]).append(HEX[c and 0xF])
      }
    }
    return sb.toString()
  }

  private const val HEX = "0123456789ABCDEF"

  // endregion

  // region fetch

  /**
   * Plans [ids] and fetches their requests (each once), one thread per backend, within [deadline] (elapsedRealtime);
   * one backend failing or timing out doesn't stop the others. Worker thread.
   */
  fun fetch(app: Context, s: ProgramSession, ids: IntArray, deadline: Long) {
    val signedIn = AllGames.signedIn(app)
    if (signedIn.isEmpty()) return
    val byId = signedIn.associateBy { it.id }
    val want = LinkedHashMap<String, LinkedHashMap<String, ProgramRequest>>()
    for (id in ids) {
      val backendId = Store.widgetBackend(app, id) ?: continue
      if (backendId != Store.ALL && !byId.containsKey(backendId)) continue
      val reqs = try {
        plan(app, s, id, backendId, signedIn)
      } catch (e: ProgramError) {
        logOnce("plan(): " + (e.message ?: "failed"))
        continue
      }
      for (r in reqs) {
        val m = want.getOrPut(r.backend) { LinkedHashMap() }
        if (!m.containsKey(r.key)) m[r.key] = r
      }
    }
    val threads = want.mapNotNull { (backendId, reqs) ->
      val b = byId[backendId] ?: return@mapNotNull null
      val list = reqs.values.toList()
      Thread({
        for (r in list) {
          if (SystemClock.elapsedRealtime() >= deadline) break
          fetchOne(app, b, r)
        }
      }, "TypeTorchLive-fetch").apply {
        isDaemon = true
        start()
      }
    }
    for (t in threads) {
      val left = deadline - SystemClock.elapsedRealtime()
      if (left <= 0) break
      try {
        t.join(left)
      } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
        break
      }
    }
  }

  private fun fetchOne(app: Context, b: Backend, r: ProgramRequest) {
    try {
      val res = LiveApi.get(b.url, b.token, r.key)
      val now = System.currentTimeMillis()
      val body = res.body
      when {
        res.code == 401 -> {
          // Only the backend's own "this token is dead" answer signs the widget out (another 401 is just a failure).
          if (res.tokenDead) Store.markDead(app, b.id, b.token)
          ProgramCache.putFailure(app, b.id, r.key, 401, "unauthorized", now)
        }
        body != null && isJson(body) -> ProgramCache.putSuccess(app, b.id, r.key, body, now)
        body != null -> ProgramCache.putFailure(app, b.id, r.key, res.code, "bad json", now)
        else -> ProgramCache.putFailure(app, b.id, r.key, res.code, res.error ?: "failed", now)
      }
    } catch (t: Throwable) {
      Log.w("program fetch failed", t)
    }
  }

  private fun isJson(text: String): Boolean = try {
    val v = JSONTokener(text).nextValue()
    v is JSONObject || v is JSONArray
  } catch (t: Throwable) {
    false
  }

  /** A live watch poll's outcome, cached under [WATCH_KEY] for `shape` (only while a program is set). */
  fun recordWatch(ctx: Context, b: Backend, result: FetchResult) {
    try {
      if (source(ctx) == null || !JsEngine.supported()) return
      val now = System.currentTimeMillis()
      when (result) {
        is FetchResult.Ok -> {
          val raw = result.raw
          if (raw != null) ProgramCache.putSuccess(ctx, b.id, WATCH_KEY, raw, now)
        }
        is FetchResult.SignedOut -> ProgramCache.putFailure(ctx, b.id, WATCH_KEY, 401, "unauthorized", now)
        is FetchResult.Failed -> ProgramCache.putFailure(ctx, b.id, WATCH_KEY, 0, result.reason, now)
      }
    } catch (t: Throwable) {
      Log.w("program watch record failed", t)
    }
  }

  // endregion

  // region shape, tap

  /**
   * `{ ok: true, body, at }` (at = when it was fetched), or `{ ok: false, status, error, at, body?, okAt? }` (at = the
   * failed fetch; body = the last good one, from okAt). Null when there's nothing usable.
   */
  private fun answerJson(a: ProgramAnswer): JSONObject? {
    val text = a.body
    val body: Any? = if (text == null) null else try {
      JSONTokener(text).nextValue()
    } catch (t: Throwable) {
      null
    }
    val good = body is JSONObject || body is JSONArray
    if (good && a.okAt > 0L && a.failedAt <= a.okAt) {
      return JSONObject().put("ok", true).put("body", body).put("at", a.okAt)
    }
    if (a.failedAt <= 0L) return null
    val o = JSONObject()
      .put("ok", false)
      .put("status", a.status)
      .put("error", a.error ?: "failed")
      .put("at", a.failedAt)
    if (good) o.put("body", body).put("okAt", a.okAt)
    return o
  }

  /**
   * Runs `plan` (or this session's memo) and `shape` for one widget on the cached answers. Never throws: a failure
   * comes back as [Shaped.error] (and is logged once).
   */
  fun shape(
    ctx: Context, s: ProgramSession, id: Int, backendId: String, signedIn: List<Backend>, size: SizeF, night: Boolean,
  ): Shaped {
    return try {
      val reqs = plan(ctx, s, id, backendId, signedIn)
      val responses = JSONObject()
      var oldestOk = Long.MAX_VALUE
      var newestFail = 0L
      var anyOk = false
      var anyFailed = false
      var stale = false
      val planned = LinkedHashSet<String>()
      for (r in reqs) {
        planned.add(r.backend)
        val a = ProgramCache.get(ctx, r.backend, r.key) ?: continue
        val entry = answerJson(a) ?: continue
        byBackend(responses, r.backend).put(r.key, entry)
        if (a.body != null && a.okAt > 0L) {
          anyOk = true
          if (a.okAt < oldestOk) oldestOk = a.okAt
          if (a.failedAt > a.okAt) {
            stale = true
            if (a.failedAt > newestFail) newestFail = a.failedAt
          }
        } else if (a.failedAt > 0L) {
          anyFailed = true
        }
      }
      // The live watch's last poll of a planned backend, also when the plan didn't ask for it (newer live numbers).
      for (b in planned) {
        val by = byBackend(responses, b)
        if (by.has(WATCH_KEY)) continue
        val a = ProgramCache.get(ctx, b, WATCH_KEY) ?: continue
        val entry = answerJson(a) ?: continue
        by.put(WATCH_KEY, entry)
      }
      val input = JSONObject()
        .put("widget", widgetJson(ctx, id, backendId))
        .put("backends", backendsJson(signedIn))
        .put("responses", responses)
        .put("size", JSONObject().put("w", size.width.toDouble()).put("h", size.height.toDouble()))
        .put("night", night)
        .put("now", System.currentTimeMillis())
      val out = s.call("shape", input)
      val stateError = saveState(ctx, s, id, out)
      if (stateError != null) logOnce("shape(): $stateError")
      val live = if (out.isNull("live")) null else out.optJSONObject("live")
      val open = out.optString("open", "").takeIf { it.isNotEmpty() && !out.isNull("open") }
      val okAt = if (anyOk) oldestOk else 0L
      val failedAt = if (stale) maxOf(okAt + 1L, newestFail) else 0L
      Shaped(live, okAt, failedAt, anyOk, anyFailed, null, open)
    } catch (e: ProgramError) {
      val msg = e.message ?: "widget program failed"
      logOnce(msg)
      Shaped(null, 0L, 0L, false, false, msg, null)
    } catch (t: Throwable) {
      Log.w("widget program shape failed", t)
      Shaped(null, 0L, 0L, false, false, t.javaClass.simpleName, null)
    }
  }

  private fun byBackend(responses: JSONObject, backendId: String): JSONObject {
    val cur = responses.optJSONObject(backendId)
    if (cur != null) return cur
    val o = JSONObject()
    responses.put(backendId, o)
    return o
  }

  /**
   * An `action:*` tap ([tap]: the whole value, templates already filled): `tap` → the new state saved. False when it
   * failed (the old state stays; logged once). Worker thread.
   */
  fun tap(ctx: Context, s: ProgramSession, id: Int, tap: String): Boolean {
    val backendId = Store.widgetBackend(ctx, id) ?: return false
    return try {
      val input = JSONObject()
        .put("widget", widgetJson(ctx, id, backendId))
        .put("action", tap.removePrefix(ACTION_PREFIX))
        .put("tap", tap)
        .put("backends", backendsJson(AllGames.signedIn(ctx)))
        .put("now", System.currentTimeMillis())
      val out = s.call("tap", input)
      val err = saveState(ctx, s, id, out)
      if (err != null) logOnce("tap(): $err")
      err == null
    } catch (e: ProgramError) {
      logOnce("tap(): " + (e.message ?: "failed"))
      false
    }
  }

  const val ACTION_PREFIX = "action:"

  /** Saves [out]'s `state` (when it has one, at most 4 KB as JSON); a changed state forgets the memoized plan. */
  private fun saveState(ctx: Context, s: ProgramSession, id: Int, out: JSONObject): String? {
    if (!out.has("state")) return null
    val text = try {
      val wrapped = JSONArray().put(out.opt("state")).toString()
      wrapped.substring(1, wrapped.length - 1)
    } catch (t: Throwable) {
      return "state is not JSON"
    }
    if (text.toByteArray(Charsets.UTF_8).size > MAX_STATE_BYTES) return "state over 4 KB (not saved)"
    if (text != Store.programState(ctx, id)) {
      Store.setProgramState(ctx, id, text)
      s.plans.remove(id)
    }
    return null
  }

  // endregion
}
