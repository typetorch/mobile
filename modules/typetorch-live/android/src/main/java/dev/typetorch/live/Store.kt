package dev.typetorch.live

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** One TypeTorch backend as the app hands it to [TypeTorchLiveModule] `setBackends`. */
internal data class Backend(
  val id: String,
  val name: String,
  val url: String,
  val token: String,
  val link: String,
)

/** The last answer of a backend plus when it last worked ([okAt]) and last failed ([failedAt]); epoch ms, 0 = never. */
internal data class Snapshot(val data: LiveData?, val okAt: Long, val failedAt: Long) {
  /** The last attempt failed: the numbers are the last good ones. */
  val stale: Boolean get() = failedAt > okAt
}

/**
 * Everything lives in the app's private SharedPreferences (MODE_PRIVATE); the token is never logged.
 * - `dev.typetorch.live`: backends (with tokens), the watched list, notification ids, widget picks and stat slots, the
 *   default slots, the widget spec.
 * - `dev.typetorch.live.cache`: last answers per backend and the dead-token marks (written on every poll).
 * Read-modify-write sequences hold [lock] (the service worker, widget threads and the JS thread all write).
 */
internal object Store {
  private const val PREFS = "dev.typetorch.live"
  private const val CACHE = "dev.typetorch.live.cache"
  private const val K_BACKENDS = "backends"
  private const val K_WATCHED = "watched"
  private const val K_NOTIF_IDS = "notifIds"
  private const val K_WIDGET = "widget:"
  private const val K_WIDGET_SPEC = "widgetSpec"
  private const val K_WIDGET_SLOTS = "widgetSlots:"
  private const val K_WIDGET_FILTER = "widgetFilter:"
  private const val K_DEFAULT_SLOTS = "defaultSlots"
  private const val K_WIDGET_PROGRAM = "widgetProgram"
  private const val K_PROGRAM_STATE = "programState:"
  private const val K_SNAP = "snap:"
  private const val K_DEAD = "dead:"

  /** Notification ids of the watched backends; [WatchService.FG_ID] (41000) is the foreground slot. */
  private const val FIRST_NOTIF_ID = 41001

  /** The cache keeps 6 hours of series (the medium widget's line). */
  private const val SERIES_WINDOW_MS = 6 * 60 * 60 * 1000L + 60_000L

  private val lock = Any()

  private fun prefs(ctx: Context): SharedPreferences =
    ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun cache(ctx: Context): SharedPreferences =
    ctx.applicationContext.getSharedPreferences(CACHE, Context.MODE_PRIVATE)

  // region backends

  fun backends(ctx: Context): List<Backend> = synchronized(lock) {
    val raw = prefs(ctx).getString(K_BACKENDS, null) ?: return@synchronized emptyList()
    try {
      val arr = JSONArray(raw)
      val out = ArrayList<Backend>(arr.length())
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val id = o.optString("id", "")
        if (id.isEmpty()) continue
        out.add(
          Backend(
            id = id,
            name = o.optString("name", ""),
            url = o.optString("url", ""),
            token = o.optString("token", ""),
            link = o.optString("link", ""),
          ),
        )
      }
      out
    } catch (t: Throwable) {
      emptyList()
    }
  }

  fun backend(ctx: Context, id: String): Backend? = backends(ctx).firstOrNull { it.id == id }

  /** Replaces the list. Watches of backends that are gone end; their cached numbers are dropped. */
  fun setBackends(ctx: Context, list: List<Backend>): Unit = synchronized(lock) {
    val arr = JSONArray()
    val seen = HashSet<String>()
    for (b in list) {
      if (b.id.isEmpty() || !seen.add(b.id)) continue
      arr.put(
        JSONObject()
          .put("id", b.id)
          .put("name", b.name)
          .put("url", b.url)
          .put("token", b.token)
          .put("link", b.link),
      )
    }
    val watched = watchedLocked(ctx).filter { it in seen }
    prefs(ctx).edit()
      .putString(K_BACKENDS, arr.toString())
      .putString(K_WATCHED, JSONArray(watched).toString())
      .apply()
    val c = cache(ctx)
    val edit = c.edit()
    for (key in c.all.keys) {
      val id = when {
        key.startsWith(K_SNAP) -> key.removePrefix(K_SNAP)
        key.startsWith(K_DEAD) -> key.removePrefix(K_DEAD)
        else -> continue
      }
      if (id !in seen) edit.remove(key)
    }
    edit.apply()
  }

  // endregion

  // region watched list

  fun watched(ctx: Context): List<String> = synchronized(lock) { watchedLocked(ctx) }

  private fun watchedLocked(ctx: Context): List<String> {
    val raw = prefs(ctx).getString(K_WATCHED, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).mapNotNull { i -> arr.optString(i, "").takeIf { it.isNotEmpty() } }.distinct()
    } catch (t: Throwable) {
      emptyList()
    }
  }

  private fun saveWatchedLocked(ctx: Context, ids: List<String>) {
    prefs(ctx).edit().putString(K_WATCHED, JSONArray(ids.distinct()).toString()).apply()
  }

  fun addWatched(ctx: Context, id: String) {
    synchronized(lock) {
      val ids = watchedLocked(ctx)
      if (id !in ids) saveWatchedLocked(ctx, ids + id)
    }
  }

  fun removeWatched(ctx: Context, id: String) {
    synchronized(lock) {
      val ids = watchedLocked(ctx)
      if (id in ids) saveWatchedLocked(ctx, ids - id)
    }
  }

  fun clearWatched(ctx: Context) {
    synchronized(lock) { saveWatchedLocked(ctx, emptyList()) }
  }

  // endregion

  // region notification ids

  /** A stable notification id per backend (allocated on first use, kept across restarts). */
  fun notificationId(ctx: Context, backendId: String): Int = synchronized(lock) {
    val map = notifIdsLocked(ctx)
    if (map.has(backendId)) {
      val v = map.optInt(backendId, 0)
      if (v >= FIRST_NOTIF_ID) return@synchronized v
    }
    var next = FIRST_NOTIF_ID
    val keys = map.keys()
    while (keys.hasNext()) next = maxOf(next, map.optInt(keys.next(), 0) + 1)
    map.put(backendId, next)
    prefs(ctx).edit().putString(K_NOTIF_IDS, map.toString()).apply()
    next
  }

  /** Every id ever allocated (to clear notifications left behind by a killed process). */
  fun allNotificationIds(ctx: Context): List<Int> = synchronized(lock) {
    val map = notifIdsLocked(ctx)
    val out = ArrayList<Int>()
    val keys = map.keys()
    while (keys.hasNext()) out.add(map.optInt(keys.next(), 0))
    out.filter { it >= FIRST_NOTIF_ID }
  }

  private fun notifIdsLocked(ctx: Context): JSONObject = try {
    JSONObject(prefs(ctx).getString(K_NOTIF_IDS, null) ?: "{}")
  } catch (t: Throwable) {
    JSONObject()
  }

  // endregion

  // region widgets

  /** The backend id of an all-games widget (docs/WIDGET_SPEC.md, All games): every signed-in backend, merged. */
  const val ALL = "*"

  /** The slots of an all-games widget: the Releases style (slot 1 empty is its marker; docs/WIDGET_RELEASES.md). */
  val RELEASES_SLOTS = listOf("", "", "", "releases")

  fun widgetBackend(ctx: Context, widgetId: Int): String? = prefs(ctx).getString(K_WIDGET + widgetId, null)

  /** Sets the widget's backend ([ALL] for all games); another backend than before clears the game filter. */
  fun setWidgetBackend(ctx: Context, widgetId: Int, backendId: String) {
    synchronized(lock) {
      val p = prefs(ctx)
      val edit = p.edit().putString(K_WIDGET + widgetId, backendId)
      if (p.getString(K_WIDGET + widgetId, null) != backendId) {
        edit.remove(K_WIDGET_FILTER + widgetId)
        edit.remove(K_PROGRAM_STATE + widgetId)
      }
      edit.apply()
    }
  }

  fun removeWidget(ctx: Context, widgetId: Int) {
    prefs(ctx).edit()
      .remove(K_WIDGET + widgetId)
      .remove(K_WIDGET_SLOTS + widgetId)
      .remove(K_WIDGET_FILTER + widgetId)
      .remove(K_PROGRAM_STATE + widgetId)
      .apply()
  }

  /** The game an all-games widget is filtered to (a backend id), or null: all games. */
  fun widgetFilter(ctx: Context, widgetId: Int): String? =
    prefs(ctx).getString(K_WIDGET_FILTER + widgetId, null)?.takeIf { it.isNotEmpty() }

  /** A tap on game [backendId] of an all-games widget: picks it, or clears the filter when it is already picked. */
  fun toggleWidgetFilter(ctx: Context, widgetId: Int, backendId: String) {
    synchronized(lock) {
      val p = prefs(ctx)
      val key = K_WIDGET_FILTER + widgetId
      if (backendId.isEmpty() || p.getString(key, null) == backendId) p.edit().remove(key).apply()
      else p.edit().putString(key, backendId).apply()
    }
  }

  /** The stat slots new widgets get until the app sets others (docs/WIDGET_STATS.md). */
  val BUILT_IN_SLOTS = listOf("session:1h", "dau", "d1", "revenue:72h")
  const val MAX_SLOTS = 4

  /** Metric ids per fetch (the backend answers at most 12). */
  private const val MAX_METRICS = 12

  /** A metric id: letters, digits and `: _ -` (e.g. `dau`, `revenue:72h`), at most 40 characters. */
  private val METRIC_ID = Regex("^[A-Za-z0-9:_-]{1,40}$")

  /**
   * At most [MAX_SLOTS] slots; anything that isn't a metric id becomes "" (an empty slot, so positions keep), and
   * trailing empty slots are dropped.
   */
  fun sanitizeSlots(list: List<*>): List<String> {
    val out = ArrayList<String>(MAX_SLOTS)
    for (v in list) {
      if (out.size >= MAX_SLOTS) break
      val id = (v as? String)?.trim().orEmpty()
      out.add(if (METRIC_ID.matches(id)) id else "")
    }
    while (out.isNotEmpty() && out.last().isEmpty()) out.removeAt(out.size - 1)
    return out
  }

  private fun parseSlots(raw: String?): List<String>? {
    if (raw == null) return null
    return try {
      val arr = JSONArray(raw)
      sanitizeSlots((0 until arr.length()).map { arr.opt(it) })
    } catch (t: Throwable) {
      null
    }
  }

  /** The slots new widgets get: the app's last setDefaultSlots, else [BUILT_IN_SLOTS]. */
  fun defaultSlots(ctx: Context): List<String> = parseSlots(prefs(ctx).getString(K_DEFAULT_SLOTS, null)) ?: BUILT_IN_SLOTS

  fun setDefaultSlots(ctx: Context, slots: List<String>) {
    prefs(ctx).edit().putString(K_DEFAULT_SLOTS, JSONArray(sanitizeSlots(slots)).toString()).apply()
  }

  /** True when this widget has its own slots (else it shows the defaults). */
  fun hasWidgetSlots(ctx: Context, widgetId: Int): Boolean = prefs(ctx).contains(K_WIDGET_SLOTS + widgetId)

  /** The widget's stat slots (metric ids, "" = empty); a widget placed before slots existed shows the defaults. */
  fun widgetSlots(ctx: Context, widgetId: Int): List<String> =
    parseSlots(prefs(ctx).getString(K_WIDGET_SLOTS + widgetId, null)) ?: defaultSlots(ctx)

  fun setWidgetSlots(ctx: Context, widgetId: Int, slots: List<String>) {
    prefs(ctx).edit().putString(K_WIDGET_SLOTS + widgetId, JSONArray(sanitizeSlots(slots)).toString()).apply()
  }

  /**
   * The metric ids to ask [backendId] for: the union of the slots of its widgets among [widgetIds], at most 12. An
   * all-games widget counts for every backend and adds `releases`.
   */
  fun metricsFor(ctx: Context, backendId: String, widgetIds: IntArray): List<String> {
    val out = LinkedHashSet<String>()
    for (id in widgetIds.distinct()) {
      val w = widgetBackend(ctx, id)
      if (w != backendId && w != ALL) continue
      if (w == ALL) out.add("releases")
      for (slot in widgetSlots(ctx, id)) if (slot.isNotEmpty()) out.add(slot)
    }
    return out.take(MAX_METRICS)
  }

  /** The widget spec JSON the app sent (docs/WIDGET_SPEC.md), or null: the built-in default. */
  fun widgetSpecJson(ctx: Context): String? = prefs(ctx).getString(K_WIDGET_SPEC, null)

  /** Saves [json] (already validated), or removes the sent spec when null (back to the built-in default). */
  fun setWidgetSpecJson(ctx: Context, json: String?) {
    val edit = prefs(ctx).edit()
    if (json == null) edit.remove(K_WIDGET_SPEC) else edit.putString(K_WIDGET_SPEC, json)
    edit.apply()
  }

  /** The widget program's source (docs/WIDGET_PROGRAM.md), or null: none (the native path). */
  fun widgetProgram(ctx: Context): String? = prefs(ctx).getString(K_WIDGET_PROGRAM, null)

  fun setWidgetProgram(ctx: Context, source: String?) {
    val edit = prefs(ctx).edit()
    if (source == null) edit.remove(K_WIDGET_PROGRAM) else edit.putString(K_WIDGET_PROGRAM, source)
    edit.apply()
  }

  /** A widget's program state (JSON text, at most 4 KB), or null before the program first ran for it. */
  fun programState(ctx: Context, widgetId: Int): String? = prefs(ctx).getString(K_PROGRAM_STATE + widgetId, null)

  fun setProgramState(ctx: Context, widgetId: Int, json: String) {
    prefs(ctx).edit().putString(K_PROGRAM_STATE + widgetId, json).apply()
  }

  // endregion

  // region cache: last answers, dead tokens

  fun snapshot(ctx: Context, id: String): Snapshot? = synchronized(lock) { snapshotLocked(ctx, id) }

  private fun snapshotLocked(ctx: Context, id: String): Snapshot? {
    val raw = cache(ctx).getString(K_SNAP + id, null) ?: return null
    return try {
      val o = JSONObject(raw)
      val data = o.optJSONObject("data")?.let { LiveData.fromJson(it) }
      Snapshot(data, o.optLong("okAt", 0L), o.optLong("failedAt", 0L))
    } catch (t: Throwable) {
      null
    }
  }

  private fun writeSnapshotLocked(ctx: Context, id: String, snap: Snapshot, clearDead: Boolean) {
    val o = JSONObject()
    o.put("okAt", snap.okAt)
    o.put("failedAt", snap.failedAt)
    o.put("data", snap.data?.toJson() ?: JSONObject.NULL)
    val edit = cache(ctx).edit().putString(K_SNAP + id, o.toString())
    if (clearDead) edit.remove(K_DEAD + id)
    edit.apply()
  }

  /**
   * Saves a good answer; its series is merged with the cached one (so the 30-minute polls extend the 6-hour line).
   * Metrics: an answer to a fetch that asked some ([askedMetrics]) replaces them (what no widget shows any more goes);
   * one that asked none (the live watch) keeps the cached ones. The icon URL stays when the answer has none.
   */
  fun saveSuccess(ctx: Context, id: String, data: LiveData, now: Long, askedMetrics: Boolean) {
    synchronized(lock) {
      val prev = snapshotLocked(ctx, id)?.data
      val merged = data.copy(
        series = LiveData.mergeSeries(prev?.series.orEmpty(), data.series, SERIES_WINDOW_MS),
        metrics = if (askedMetrics) data.metrics else (prev?.metrics ?: data.metrics),
        iconUrl = data.iconUrl ?: prev?.iconUrl,
        extra = keepReleases(data.extra, prev?.extra),
      )
      writeSnapshotLocked(ctx, id, Snapshot(merged, now, 0L), clearDead = true)
    }
  }

  /**
   * The answer's unknown top-level fields (kept for path bindings: `releases`, the release garden); an answer without
   * `releases` (an older backend, a failed part) keeps the cached one.
   */
  private fun keepReleases(now: JSONObject?, prev: JSONObject?): JSONObject? {
    if (now != null && now.has("releases") && !now.isNull("releases")) return now
    val old = prev?.opt("releases") ?: return now
    if (old == JSONObject.NULL) return now
    return try {
      JSONObject((now ?: JSONObject()).toString()).put("releases", old)
    } catch (t: Throwable) {
      now
    }
  }

  /** Keeps the last good numbers and marks them stale. */
  fun saveFailure(ctx: Context, id: String, now: Long) {
    synchronized(lock) {
      val prev = snapshotLocked(ctx, id)
      writeSnapshotLocked(ctx, id, Snapshot(prev?.data, prev?.okAt ?: 0L, now), clearDead = false)
    }
  }

  /** A 401 for [token]: dead until the app hands over another token for this backend. Stores a hash, not the token. */
  fun markDead(ctx: Context, id: String, token: String) {
    cache(ctx).edit().putString(K_DEAD + id, fingerprint(token)).apply()
  }

  fun isDead(ctx: Context, id: String, token: String): Boolean =
    token.isEmpty() || cache(ctx).getString(K_DEAD + id, null) == fingerprint(token)

  private fun fingerprint(token: String): String = try {
    val d = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8))
    d.take(12).joinToString("") { "%02x".format(it.toInt() and 0xff) }
  } catch (t: Throwable) {
    token.hashCode().toString()
  }

  // endregion

  /**
   * Fetches one backend's live numbers (and [metrics], the widgets' stat ids) and stores the outcome. Blocking
   * (network): worker threads only.
   */
  fun fetchAndStore(ctx: Context, b: Backend, minutes: Int, metrics: List<String> = emptyList()): FetchResult {
    val result = LiveApi.fetch(b.url, b.token, minutes, metrics)
    val now = System.currentTimeMillis()
    try {
      when (result) {
        is FetchResult.Ok -> saveSuccess(ctx, b.id, result.data, now, metrics.isNotEmpty())
        is FetchResult.SignedOut -> markDead(ctx, b.id, b.token)
        is FetchResult.Failed -> saveFailure(ctx, b.id, now)
      }
    } catch (t: Throwable) {
      Log.w("store failed", t)
    }
    return result
  }
}

/** Logging that never prints exception messages (some quote request headers, i.e. tokens). */
internal object Log {
  private const val TAG = "TypeTorchLive"

  fun w(what: String, t: Throwable? = null) {
    try {
      android.util.Log.w(TAG, if (t == null) what else "$what: ${t.javaClass.name}")
    } catch (ignored: Throwable) {
    }
  }
}
