package dev.typetorch.live

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat

/** Draws the home-screen widgets from the cache and refreshes them from the network (off the main thread). */
internal object WidgetUpdater {
  const val ACTION_REFRESH = "dev.typetorch.live.action.REFRESH_WIDGET"

  /** Medium from about 4x2 cells (launchers report a bit less than the nominal 250 x 110 dp). */
  private const val MEDIUM_W = 220f
  private const val MEDIUM_H = 95f
  private const val SMALL_W = 100f
  private const val SMALL_H = 40f
  private const val SERIES_MINUTES = 360
  private const val WINDOW_MS = 6 * 60 * 60 * 1000L

  /** A broadcast may run 60 s with goAsync (background); stay well inside it. */
  private const val FETCH_DEADLINE_MS = 25_000L

  fun widgetIds(ctx: Context): IntArray = try {
    val mgr = AppWidgetManager.getInstance(ctx)
    mgr?.getAppWidgetIds(ComponentName(ctx, TypeTorchWidgetProvider::class.java)) ?: IntArray(0)
  } catch (t: Throwable) {
    IntArray(0)
  }

  /** Every widget now, from the network (refreshWidgets() from JS). */
  fun refreshAll(ctx: Context) {
    val app = ctx.applicationContext
    refresh(app, widgetIds(app), null, false)
  }

  /** Redraws the widgets of one backend from the cache (after a live watch poll). Any thread, no network. */
  fun renderForBackend(ctx: Context, backendId: String) {
    val app = ctx.applicationContext
    val mgr = AppWidgetManager.getInstance(app) ?: return
    for (id in widgetIds(app)) if (Store.widgetBackend(app, id) == backendId) render(app, mgr, id, false)
  }

  /**
   * On a new thread: draws [ids] from the cache, fetches their backends (in parallel, 6 hours of series), draws again,
   * then finishes [pending] (the goAsync() of a broadcast) if given.
   */
  fun refresh(ctx: Context, ids: IntArray, pending: BroadcastReceiver.PendingResult?, showRefreshing: Boolean) {
    val app = ctx.applicationContext
    if (ids.isEmpty()) {
      finish(pending)
      return
    }
    try {
      Thread({
        try {
          val mgr = AppWidgetManager.getInstance(app)
          if (mgr != null) {
            for (id in ids) render(app, mgr, id, showRefreshing)
            fetchFor(app, ids)
            for (id in ids) render(app, mgr, id, false)
          }
        } catch (t: Throwable) {
          Log.w("widget refresh failed", t)
        } finally {
          finish(pending)
        }
      }, "TypeTorchLive-widgets").start()
    } catch (t: Throwable) {
      Log.w("widget thread failed", t)
      finish(pending)
    }
  }

  private fun finish(pending: BroadcastReceiver.PendingResult?) {
    try {
      pending?.finish()
    } catch (t: Throwable) {
      Log.w("finish failed", t)
    }
  }

  private fun fetchFor(app: Context, ids: IntArray) {
    val backends = ids.mapNotNull { Store.widgetBackend(app, it) }
      .distinct()
      .mapNotNull { Store.backend(app, it) }
      .filter { !Store.isDead(app, it.id, it.token) }
    if (backends.isEmpty()) return
    val deadline = SystemClock.elapsedRealtime() + FETCH_DEADLINE_MS
    val threads = backends.map { b ->
      Thread({
        try {
          Store.fetchAndStore(app, b, SERIES_MINUTES)
        } catch (t: Throwable) {
          Log.w("widget fetch failed", t)
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

  /** Draws one widget from the cache. Any thread, no network, never throws. */
  fun render(ctx: Context, mgr: AppWidgetManager, widgetId: Int, refreshing: Boolean) {
    try {
      mgr.updateAppWidget(widgetId, build(ctx, mgr, widgetId, refreshing))
    } catch (t: Throwable) {
      Log.w("widget update failed", t)
    }
  }

  private fun build(ctx: Context, mgr: AppWidgetManager, widgetId: Int, refreshing: Boolean): RemoteViews {
    val backendId = Store.widgetBackend(ctx, widgetId)
      ?: return message(ctx, ctx.getString(R.string.ttl_widget_pick), configurePending(ctx, widgetId), null)
    val b = Store.backend(ctx, backendId)
    if (b == null || Store.isDead(ctx, b.id, b.token)) {
      return message(ctx, ctx.getString(R.string.ttl_widget_sign_in), Links.openPending(ctx, widgetId, null), null)
    }
    val open = Links.openPending(ctx, widgetId, b.link)
    val refresh = refreshPending(ctx, widgetId)
    val snap = Store.snapshot(ctx, b.id)
    val data = snap?.data
    if (snap == null || data == null) {
      val text = if (!refreshing && snap != null && snap.failedAt > 0) "Can't reach ${b.name.ifBlank { "the backend" }}"
      else ctx.getString(R.string.ttl_loading)
      return message(ctx, text, open, refresh)
    }
    val small = small(ctx, b, snap, data, open, refresh, refreshing)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Android 12+: the launcher picks the layout by the widget's current size.
      val medium = medium(ctx, b, snap, data, open, refresh, refreshing)
      return RemoteViews(mapOf(SizeF(SMALL_W, SMALL_H) to small, SizeF(MEDIUM_W, MEDIUM_H) to medium))
    }
    // Older: by the minimum size the launcher reports.
    val opts = try {
      mgr.getAppWidgetOptions(widgetId)
    } catch (t: Throwable) {
      null
    }
    val w = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
    val h = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
    return if (w >= MEDIUM_W && h >= MEDIUM_H) medium(ctx, b, snap, data, open, refresh, refreshing) else small
  }

  private fun small(
    ctx: Context, b: Backend, snap: Snapshot, data: LiveData,
    open: PendingIntent, refresh: PendingIntent, refreshing: Boolean,
  ): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.ttl_widget_small)
    fillCommon(ctx, v, b, snap, data, refreshing)
    v.setOnClickPendingIntent(android.R.id.background, open)
    v.setOnClickPendingIntent(R.id.ttl_w_refresh, refresh)
    return v
  }

  private fun medium(
    ctx: Context, b: Backend, snap: Snapshot, data: LiveData,
    open: PendingIntent, refresh: PendingIntent, refreshing: Boolean,
  ): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.ttl_widget_medium)
    fillCommon(ctx, v, b, snap, data, refreshing)
    val servers = data.servers
    v.setTextViewText(
      R.id.ttl_w_servers,
      if (servers == null) "" else Fmt.grouped(servers) + if (servers == 1) " server" else " servers",
    )
    val points = data.seriesWindow(WINDOW_MS)
    val chart = if (points.isEmpty()) null
    else Chart.render(points, 300f, 72f, ctx.resources.displayMetrics.density, 2f)
    if (chart != null) {
      v.setImageViewBitmap(R.id.ttl_w_chart, chart)
      v.setViewVisibility(R.id.ttl_w_chart, View.VISIBLE)
    } else {
      v.setViewVisibility(R.id.ttl_w_chart, View.INVISIBLE)
    }
    val lh = data.lastHour
    v.setTextViewText(
      R.id.ttl_w_footer,
      "Last hour: avg session " + Fmt.duration(lh?.avgSessionSeconds) + " · " + Fmt.hours(lh?.playtimeHours) + " played",
    )
    v.setOnClickPendingIntent(android.R.id.background, open)
    v.setOnClickPendingIntent(R.id.ttl_w_refresh, refresh)
    return v
  }

  private fun fillCommon(ctx: Context, v: RemoteViews, b: Backend, snap: Snapshot, data: LiveData, refreshing: Boolean) {
    v.setTextViewText(R.id.ttl_w_name, data.gameName?.takeIf { it.isNotBlank() } ?: b.name)
    v.setTextViewText(R.id.ttl_w_ccu, Fmt.count(data.ccu))
    val delta = Fmt.delta(data.delta)
    if (delta != null) {
      v.setTextViewText(R.id.ttl_w_delta, delta)
      v.setTextColor(
        R.id.ttl_w_delta,
        ContextCompat.getColor(ctx, if ((data.delta ?: 0) < 0) R.color.ttl_down else R.color.ttl_up),
      )
      v.setViewVisibility(R.id.ttl_w_delta, View.VISIBLE)
    } else {
      v.setViewVisibility(R.id.ttl_w_delta, View.GONE)
    }
    // A widget isn't redrawn every second, so a relative "3 min ago" would go wrong: the clock time of the data
    // instead, prefixed when the last refresh failed.
    val updated = when {
      refreshing -> ctx.getString(R.string.ttl_widget_refreshing)
      snap.okAt <= 0L -> ""
      snap.stale -> "offline · " + Fmt.clock(ctx, snap.okAt)
      else -> Fmt.clock(ctx, snap.okAt)
    }
    v.setTextViewText(R.id.ttl_w_updated, updated)
  }

  private fun message(ctx: Context, text: String, click: PendingIntent, refresh: PendingIntent?): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.ttl_widget_message)
    v.setTextViewText(R.id.ttl_w_message, text)
    v.setOnClickPendingIntent(android.R.id.background, click)
    if (refresh != null) {
      v.setViewVisibility(R.id.ttl_w_refresh, View.VISIBLE)
      v.setOnClickPendingIntent(R.id.ttl_w_refresh, refresh)
    } else {
      v.setViewVisibility(R.id.ttl_w_refresh, View.GONE)
    }
    return v
  }

  private fun refreshPending(ctx: Context, widgetId: Int): PendingIntent {
    val intent = Intent(ctx, TypeTorchWidgetProvider::class.java)
      .setAction(ACTION_REFRESH)
      .setData(Uri.parse("typetorch-live://widget/$widgetId"))
      .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
    return PendingIntent.getBroadcast(ctx, widgetId, intent, Links.FLAGS)
  }

  private fun configurePending(ctx: Context, widgetId: Int): PendingIntent {
    val intent = Intent(ctx, WidgetConfigureActivity::class.java)
      .setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
      .setData(Uri.parse("typetorch-live://widget/$widgetId"))
      .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(ctx, widgetId, intent, Links.FLAGS)
  }
}
