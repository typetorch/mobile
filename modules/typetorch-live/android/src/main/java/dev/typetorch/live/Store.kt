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
 * - `dev.typetorch.live`: backends (with tokens), the watched list, notification ids, widget picks.
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

  fun widgetBackend(ctx: Context, widgetId: Int): String? = prefs(ctx).getString(K_WIDGET + widgetId, null)

  fun setWidgetBackend(ctx: Context, widgetId: Int, backendId: String) {
    prefs(ctx).edit().putString(K_WIDGET + widgetId, backendId).apply()
  }

  fun removeWidget(ctx: Context, widgetId: Int) {
    prefs(ctx).edit().remove(K_WIDGET + widgetId).apply()
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

  /** Saves a good answer; its series is merged with the cached one (so the 30-minute polls extend the 6-hour line). */
  fun saveSuccess(ctx: Context, id: String, data: LiveData, now: Long) {
    synchronized(lock) {
      val prev = snapshotLocked(ctx, id)?.data
      val merged = data.copy(series = LiveData.mergeSeries(prev?.series.orEmpty(), data.series, SERIES_WINDOW_MS))
      writeSnapshotLocked(ctx, id, Snapshot(merged, now, 0L), clearDead = true)
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

  /** Fetches one backend's live numbers and stores the outcome. Blocking (network): worker threads only. */
  fun fetchAndStore(ctx: Context, b: Backend, minutes: Int): FetchResult {
    val result = LiveApi.fetch(b.url, b.token, minutes)
    val now = System.currentTimeMillis()
    try {
      when (result) {
        is FetchResult.Ok -> saveSuccess(ctx, b.id, result.data, now)
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
