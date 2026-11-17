package dev.typetorch.live

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The live watch: a `specialUse` foreground service with one ongoing notification per watched backend.
 *
 * - The foreground notification is a fixed slot ([FG_ID]) that shows one backend (the "primary"); the others post
 *   under their own ids. When the primary is stopped and others remain, the next one moves into the slot (no second
 *   startForeground call, which Android 12+ may refuse while the app is in the background).
 * - Every 30 s each backend is fetched on a single worker thread (10 s timeouts); all state lives on the main thread.
 * - A 401 stops polling that backend until [Store] has another token for it; network errors keep the last numbers.
 * - The watched list is in [Store]; the service stops itself when it is empty. START_NOT_STICKY: no restart after a
 *   kill or a reboot (the module restarts it when the app comes to the foreground and the list is not empty).
 */
class WatchService : Service() {

  private class WatchState {
    var notification: Notification? = null
    var inFlight = false
  }

  private val main = Handler(Looper.getMainLooper())
  private val states = LinkedHashMap<String, WatchState>()
  private var primaryId: String? = null
  private var executor: ExecutorService? = null
  private var destroyed = false

  @Volatile
  private var stopping = false

  private val tick = Runnable { safe("poll") { poll() } }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    executor = Executors.newSingleThreadExecutor { r -> Thread(r, "TypeTorchLive-watch").apply { isDaemon = true } }
    WatchNotifications.ensureChannel(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    stopping = false
    // First thing, every time: startForegroundService() must be answered by startForeground() within a few seconds,
    // even when there is nothing to watch (a stop before it would crash the app).
    if (!enterForeground()) {
      stopping = true
      stopSelf()
      return START_NOT_STICKY
    }
    safe("sync") { onWatchListChanged() }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    destroyed = true
    stopping = true
    main.removeCallbacks(tick)
    try {
      executor?.shutdownNow()
    } catch (t: Throwable) {
      Log.w("executor shutdown failed", t)
    }
    for (id in states.keys) if (id != primaryId) WatchNotifications.cancel(this, Store.notificationId(this, id))
    states.clear()
    primaryId = null
    WatchNotifications.cancel(this, FG_ID)
    if (instance === this) instance = null
    super.onDestroy()
  }

  private fun currentIds(): List<String> {
    val known = Store.backends(this).map { it.id }.toSet()
    return Store.watched(this).filter { it in known }
  }

  private fun enterForeground(): Boolean {
    val ids = try {
      currentIds()
    } catch (t: Throwable) {
      emptyList()
    }
    val target = primaryId?.takeIf { it in ids } ?: ids.firstOrNull()
    val n = try {
      target?.let { states[it]?.notification ?: buildFor(it) } ?: WatchNotifications.placeholder(this)
    } catch (t: Throwable) {
      Log.w("build failed", t)
      WatchNotifications.placeholder(this)
    }
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        // Android 14+: the type is required and must match the manifest.
        startForeground(FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        // Android 10-13 take the manifest's type; 8-9 have no types.
        startForeground(FG_ID, n)
      }
      if (target != null && target != primaryId) {
        // The slot now shows [target]: drop its own notification.
        WatchNotifications.cancel(this, Store.notificationId(this, target))
        primaryId = target
      }
      true
    } catch (t: Throwable) {
      Log.w("startForeground failed", t)
      false
    }
  }

  private fun buildFor(id: String): Notification? {
    val b = Store.backend(this, id) ?: return null
    val dead = Store.isDead(this, id, b.token)
    return WatchNotifications.build(this, b, Store.snapshot(this, id), dead, System.currentTimeMillis())
  }

  /** Brings the notifications in line with the saved list and backends. Main thread. */
  internal fun onWatchListChanged() {
    if (destroyed) return
    val ids = currentIds()
    if (ids.isEmpty()) {
      stopEverything()
      return
    }
    for (id in states.keys.toList()) if (id !in ids) removeState(id)
    for (id in ids) {
      val st = states.getOrPut(id) { WatchState() }
      // Rebuilt from the cache every time: names, links and tokens may have changed.
      st.notification = buildFor(id) ?: st.notification
    }
    val primary = primaryId
    if (primary == null || primary !in states) promote(states.keys.first())
    for (id in states.keys) post(id)
    main.removeCallbacks(tick)
    main.post(tick)
  }

  /** The user swiped a watch notification away (Android 14+ allows it): only Stop ends a watch, so post it again. */
  internal fun onNotificationDismissed(id: String) {
    if (destroyed || stopping) return
    if (id in states) post(id)
  }

  private fun removeState(id: String) {
    states.remove(id)
    if (id == primaryId) primaryId = null // the slot is reused by the next primary right after
    else WatchNotifications.cancel(this, Store.notificationId(this, id))
  }

  private fun promote(id: String) {
    primaryId = id
    WatchNotifications.cancel(this, Store.notificationId(this, id))
  }

  private fun post(id: String) {
    val n = states[id]?.notification ?: return
    val slot = if (id == primaryId) FG_ID else Store.notificationId(this, id)
    WatchNotifications.notify(this, slot, n)
  }

  private fun poll() {
    main.removeCallbacks(tick)
    if (destroyed || stopping) return
    val exec = executor ?: return
    for ((id, st) in states) {
      if (st.inFlight) continue
      val b = Store.backend(this, id) ?: continue
      // 401 earlier with this very token: stopped until the app hands over a new one (setBackends).
      if (Store.isDead(this, id, b.token)) continue
      st.inFlight = true
      try {
        exec.execute { fetch(b) }
      } catch (t: Throwable) {
        st.inFlight = false
        Log.w("execute failed", t)
      }
    }
    main.postDelayed(tick, POLL_MS)
  }

  /** Worker thread. Never throws (an uncaught exception on a worker would kill the app). */
  private fun fetch(b: Backend) {
    val app = applicationContext
    var n: Notification? = null
    try {
      val result = Store.fetchAndStore(app, b, 30)
      n = WatchNotifications.build(
        app,
        Store.backend(app, b.id) ?: b,
        Store.snapshot(app, b.id),
        result is FetchResult.SignedOut,
        System.currentTimeMillis(),
      )
    } catch (t: Throwable) {
      Log.w("watch fetch failed", t)
    }
    try {
      WidgetUpdater.renderForBackend(app, b.id)
    } catch (t: Throwable) {
      Log.w("widget render failed", t)
    }
    val built = n
    main.post {
      safe("fetched") {
        val st = states[b.id] ?: return@safe
        st.inFlight = false
        if (destroyed || stopping) return@safe
        if (built != null) st.notification = built
        post(b.id)
      }
    }
  }

  private fun stopEverything() {
    stopping = true
    main.removeCallbacks(tick)
    for (id in states.keys) if (id != primaryId) WatchNotifications.cancel(this, Store.notificationId(this, id))
    states.clear()
    primaryId = null
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    } catch (t: Throwable) {
      Log.w("stopForeground failed", t)
    }
    WatchNotifications.cancel(this, FG_ID)
    stopSelf()
  }

  private inline fun safe(what: String, block: () -> Unit) {
    try {
      block()
    } catch (t: Throwable) {
      Log.w("$what failed", t)
    }
  }

  companion object {
    const val FG_ID = 41000
    private const val POLL_MS = 30_000L

    @Volatile
    internal var instance: WatchService? = null
      private set

    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

    /**
     * Makes the running service match the saved list, or starts it. Any thread; call it while the app is in the
     * foreground (Android 12+ refuses to start a foreground service from the background). False when it can't start.
     */
    internal fun sync(ctx: Context): Boolean {
      val app = ctx.applicationContext
      val running = instance
      if (running != null && !running.stopping) {
        mainHandler.post {
          try {
            val cur = instance
            if (cur != null && !cur.stopping) cur.onWatchListChanged() else start(app)
          } catch (t: Throwable) {
            Log.w("sync failed", t)
          }
        }
        return true
      }
      if (Store.watched(app).isEmpty()) {
        WatchNotifications.cancelAll(app)
        return true
      }
      return start(app)
    }

    /** App came to the foreground: clear ghosts of a killed service, restart a saved watch. */
    internal fun resumeIfNeeded(ctx: Context) {
      val app = ctx.applicationContext
      if (instance != null) return
      WatchNotifications.cancelAll(app)
      val known = Store.backends(app).map { it.id }.toSet()
      if (Store.watched(app).none { it in known }) return
      if (!start(app)) Store.clearWatched(app)
    }

    private fun start(app: Context): Boolean = try {
      ContextCompat.startForegroundService(app, Intent(app, WatchService::class.java))
      true
    } catch (t: Throwable) {
      // ForegroundServiceStartNotAllowedException (app in the background, Android 12+), SecurityException, …
      Log.w("start failed", t)
      false
    }
  }
}
