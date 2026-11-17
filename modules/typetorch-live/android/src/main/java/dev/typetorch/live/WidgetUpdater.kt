package dev.typetorch.live

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Draws the home-screen widgets from the cache and refreshes them from the network (off the main thread). The look
 * comes from the widget spec (docs/WIDGET_SPEC.md): [WidgetRenderer] draws it as a bitmap at the widget's size.
 */
internal object WidgetUpdater {
  const val ACTION_REFRESH = "dev.typetorch.live.action.REFRESH_WIDGET"

  /** The cache's series window (the spec's charts show up to 6 hours). */
  private const val SERIES_MINUTES = 360

  /** Drawings per update on Android 12+ (launchers report portrait and landscape sizes). */
  private const val MAX_SIZES = 2
  private const val MAX_PIXELS = 900_000
  private const val LEAN_MAX_PIXELS = 250_000
  private const val MIN_PIXELS = 40_000
  private const val MIN_DP = 40f
  private const val MAX_DP = 1200f

  /** Before the launcher reports a size (about a 2x1 cell). */
  private const val DEFAULT_W = 180f
  private const val DEFAULT_H = 80f

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
   * On a new thread: draws [ids] from the cache, fetches their backends (in parallel, 6 hours of series, the metrics of
   * their widgets' slots, then their pictures), draws again, then finishes [pending] (the goAsync() of a broadcast).
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
    val backends = ids.toList().mapNotNull { Store.widgetBackend(app, it) }
      .distinct()
      .mapNotNull { Store.backend(app, it) }
      .filter { !Store.isDead(app, it.id, it.token) }
    if (backends.isEmpty()) return
    val deadline = SystemClock.elapsedRealtime() + FETCH_DEADLINE_MS
    // Every placed widget of a backend counts (not only [ids]): one refreshed widget mustn't drop another's metrics.
    val all = (widgetIds(app).toList() + ids.toList()).distinct().toIntArray()
    val threads = backends.map { b ->
      Thread({
        try {
          Store.fetchAndStore(app, b, SERIES_MINUTES, Store.metricsFor(app, b.id, all))
        } catch (t: Throwable) {
          Log.w("widget fetch failed", t)
        }
        fetchImages(app, b)
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

  /** Downloads the pictures the spec's `image` elements show for [b] (the game's icon), when missing or a day old. */
  private fun fetchImages(app: Context, b: Backend) {
    try {
      val snap = Store.snapshot(app, b.id) ?: return
      if (snap.data == null) return
      val spec = WidgetSpecs.stored(app) ?: WidgetSpecs.default
      // The built-in spec's too: it draws whenever the sent one fails.
      val binds = WidgetSpecs.imageBinds(spec) + (if (spec !== WidgetSpecs.default) WidgetSpecs.imageBinds(WidgetSpecs.default) else emptySet())
      if (binds.isEmpty()) return
      val values = WidgetValues.of(app, spec, b, snap, false, emptyList())
      for (bind in binds) {
        val url = values.str(bind) ?: continue
        if (WidgetImages.isWebUrl(url)) WidgetImages.ensure(app, url)
      }
    } catch (t: Throwable) {
      Log.w("widget images failed", t)
    }
  }

  /**
   * Draws one widget from the cache. Any thread (a worker preferably: it draws bitmaps), no network, never throws.
   * If the launcher refuses the update (too much bitmap memory, or too big for Binder), it tries once more, lean.
   */
  fun render(ctx: Context, mgr: AppWidgetManager, widgetId: Int, refreshing: Boolean) {
    try {
      mgr.updateAppWidget(widgetId, build(ctx, mgr, widgetId, refreshing, false))
      return
    } catch (t: Throwable) {
      Log.w("widget update failed, retrying lean", t)
    }
    try {
      mgr.updateAppWidget(widgetId, build(ctx, mgr, widgetId, refreshing, true))
    } catch (t: Throwable) {
      Log.w("widget update failed", t)
    }
  }

  /** [render] on a new thread, then finishes [pending] (a resize: onAppWidgetOptionsChanged runs on the main thread). */
  fun renderAsync(ctx: Context, widgetId: Int, pending: BroadcastReceiver.PendingResult?) {
    val app = ctx.applicationContext
    try {
      Thread({
        try {
          val mgr = AppWidgetManager.getInstance(app)
          if (mgr != null) render(app, mgr, widgetId, false)
        } catch (t: Throwable) {
          Log.w("widget draw failed", t)
        } finally {
          finish(pending)
        }
      }, "TypeTorchLive-widget-draw").start()
    } catch (t: Throwable) {
      Log.w("widget thread failed", t)
      finish(pending)
    }
  }

  /** What one widget shows, whatever the spec: the state (a key of the spec's `layouts`), its inputs, where taps go. */
  private class Look(
    val state: String,
    val backend: Backend?,
    val snap: Snapshot?,
    val refreshing: Boolean,
    val click: PendingIntent,
    val refresh: PendingIntent?,
    val slots: List<String> = emptyList(),
  )

  private fun look(ctx: Context, widgetId: Int, refreshing: Boolean): Look {
    val backendId = Store.widgetBackend(ctx, widgetId)
      ?: return Look(WidgetSpecs.PICK, null, null, false, configurePending(ctx, widgetId), null)
    val b = Store.backend(ctx, backendId)
    if (b == null || Store.isDead(ctx, b.id, b.token)) {
      return Look(WidgetSpecs.SIGNED_OUT, b, null, false, Links.openPending(ctx, widgetId, null), null)
    }
    val open = Links.openPending(ctx, widgetId, b.link)
    val refresh = refreshPending(ctx, widgetId)
    val snap = Store.snapshot(ctx, b.id)
    val slots = Store.widgetSlots(ctx, widgetId)
    if (snap?.data == null) {
      val state = if (!refreshing && snap != null && snap.failedAt > 0) WidgetSpecs.UNREACHABLE else WidgetSpecs.LOADING
      return Look(state, b, snap, refreshing, open, refresh, slots)
    }
    return Look(WidgetSpecs.DATA, b, snap, refreshing, open, refresh, slots)
  }

  /** The sent spec, else (absent, unparseable or failing to draw) the built-in one, else a plain text widget. */
  private fun build(ctx: Context, mgr: AppWidgetManager, widgetId: Int, refreshing: Boolean, lean: Boolean): RemoteViews {
    val look = look(ctx, widgetId, refreshing)
    val sizes = sizes(ctx, mgr, widgetId, lean)
    val sent = WidgetSpecs.stored(ctx)
    if (sent != null) {
      try {
        return views(ctx, sent, look, sizes, lean)
      } catch (t: Throwable) {
        Log.w("sent widget spec failed to draw, using the built-in one", t)
      }
    }
    return try {
      views(ctx, WidgetSpecs.default, look, sizes, lean)
    } catch (t: Throwable) {
      Log.w("built-in widget spec failed to draw", t)
      message(ctx, plainText(ctx, look), look.click, look.refresh)
    }
  }

  /**
   * Android 12+ with several reported sizes (portrait and landscape cells): one drawing per size, the launcher picks.
   * Else one drawing at the current size.
   */
  private fun views(ctx: Context, spec: WidgetSpec, look: Look, sizes: List<SizeF>, lean: Boolean): RemoteViews {
    val values = WidgetValues.of(ctx, spec, look.backend, look.snap, look.refreshing, look.slots)
    val budget = pixelBudget(ctx, sizes.size * (if (lean) 1 else 2), lean)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && sizes.size > 1) {
      val map = LinkedHashMap<SizeF, RemoteViews>()
      for (sz in sizes) map[sz] = one(ctx, spec, look, values, sz, lean, budget)
      return RemoteViews(map)
    }
    return one(ctx, spec, look, values, sizes[0], lean, budget)
  }

  /**
   * One size: the day and the night drawing (the layout shows the one matching the system's mode, so a mode switch
   * needs no redraw), the tap, and the refresh hit area in the layout's corner. Lean: only the current mode's drawing.
   */
  private fun one(
    ctx: Context, spec: WidgetSpec, look: Look, values: WidgetValues, size: SizeF, lean: Boolean, budget: Int,
  ): RemoteViews {
    val w = size.width
    val h = size.height
    val layout = WidgetSpecs.pick(spec, look.state, w, h)
    val v = RemoteViews(ctx.packageName, R.layout.ttl_widget_canvas)
    val description: String
    if (lean) {
      val img = WidgetRenderer.render(ctx, spec, layout, values, WidgetRenderer.isNight(ctx), w, h, budget)
      v.setImageViewBitmap(R.id.ttl_w_img_day, img.bitmap)
      v.setImageViewBitmap(R.id.ttl_w_img_night, img.bitmap)
      description = img.description
    } else {
      val day = WidgetRenderer.render(ctx, spec, layout, values, false, w, h, budget)
      val night = WidgetRenderer.render(ctx, spec, layout, values, true, w, h, budget)
      v.setImageViewBitmap(R.id.ttl_w_img_day, day.bitmap)
      v.setImageViewBitmap(R.id.ttl_w_img_night, night.bitmap)
      description = day.description
    }
    v.setContentDescription(R.id.ttl_w_img_day, description)
    v.setContentDescription(R.id.ttl_w_img_night, description)
    v.setOnClickPendingIntent(android.R.id.background, look.click)
    val refresh = look.refresh
    val hit = if (refresh == null) 0 else when (layout.refresh) {
      "none" -> 0
      "topStart" -> R.id.ttl_w_hit_top_start
      "bottomEnd" -> R.id.ttl_w_hit_bottom_end
      "bottomStart" -> R.id.ttl_w_hit_bottom_start
      else -> R.id.ttl_w_hit_top_end
    }
    for (id in HIT_IDS) v.setViewVisibility(id, if (id == hit) View.VISIBLE else View.GONE)
    if (hit != 0 && refresh != null) v.setOnClickPendingIntent(hit, refresh)
    return v
  }

  private val HIT_IDS: IntArray
    get() = intArrayOf(
      R.id.ttl_w_hit_top_end,
      R.id.ttl_w_hit_top_start,
      R.id.ttl_w_hit_bottom_end,
      R.id.ttl_w_hit_bottom_start,
    )

  /**
   * Pixels per bitmap: the system refuses an update whose bitmaps take more than 6 x the screen's pixels in bytes
   * (1.5 screens of ARGB); all of this widget's bitmaps together stay under 40 % of that, each under a hard cap.
   */
  private fun pixelBudget(ctx: Context, bitmaps: Int, lean: Boolean): Int {
    val dm = ctx.resources.displayMetrics
    val screen = max(dm.widthPixels.toLong() * dm.heightPixels.toLong(), 720L * 1280L)
    val perBitmap = 6L * screen * 2L / 5L / 4L / max(1, bitmaps).toLong()
    val cap = if (lean) LEAN_MAX_PIXELS else MAX_PIXELS
    return min(perBitmap, cap.toLong()).toInt().coerceAtLeast(MIN_PIXELS)
  }

  /**
   * The widget's size(s) in dp. Android 12+: the sizes the launcher reports (OPTION_APPWIDGET_SIZES, up to
   * [MAX_SIZES]). Else (and lean): min/max width/height by orientation (portrait: min width x max height).
   */
  private fun sizes(ctx: Context, mgr: AppWidgetManager, widgetId: Int, lean: Boolean): List<SizeF> {
    val opts: Bundle? = try {
      mgr.getAppWidgetOptions(widgetId)
    } catch (t: Throwable) {
      null
    }
    if (!lean && opts != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val out = ArrayList<SizeF>()
      for (sz in reportedSizes(opts)) {
        val c = clampSize(sz.width, sz.height)
        if (out.none { abs(it.width - c.width) < 1f && abs(it.height - c.height) < 1f }) out.add(c)
        if (out.size >= MAX_SIZES) break
      }
      if (out.isNotEmpty()) return out
    }
    val minW = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
    val maxW = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0) ?: 0
    val minH = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
    val maxH = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) ?: 0
    val landscape = ctx.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val w = (if (landscape) maxW else minW).takeIf { it > 0 } ?: max(minW, maxW)
    val h = (if (landscape) minH else maxH).takeIf { it > 0 } ?: max(minH, maxH)
    return listOf(clampSize(if (w > 0) w.toFloat() else DEFAULT_W, if (h > 0) h.toFloat() else DEFAULT_H))
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun reportedSizes(opts: Bundle): List<SizeF> = try {
    // Bundle.get: no Parcelable generics needed (deprecated in 33, still works).
    @Suppress("DEPRECATION")
    val raw = opts.get(AppWidgetManager.OPTION_APPWIDGET_SIZES)
    (raw as? List<*>)?.filterIsInstance<SizeF>()?.filter { it.width > 0f && it.height > 0f }.orEmpty()
  } catch (t: Throwable) {
    emptyList()
  }

  private fun clampSize(w: Float, h: Float): SizeF = SizeF(w.coerceIn(MIN_DP, MAX_DP), h.coerceIn(MIN_DP, MAX_DP))

  /** The text of the last-resort widget (when even the built-in spec can't be drawn). */
  private fun plainText(ctx: Context, look: Look): String = try {
    val b = look.backend
    when (look.state) {
      WidgetSpecs.PICK -> ctx.getString(R.string.ttl_widget_pick)
      WidgetSpecs.SIGNED_OUT -> ctx.getString(R.string.ttl_widget_sign_in)
      WidgetSpecs.UNREACHABLE -> "Can't reach " + (b?.name?.takeIf { it.isNotBlank() } ?: "the backend")
      WidgetSpecs.DATA -> {
        val data = look.snap?.data
        val game = data?.gameName?.takeIf { it.isNotBlank() } ?: b?.name ?: ""
        (if (game.isEmpty()) "" else "$game\n") + Fmt.count(data?.ccu) + " playing"
      }
      else -> ctx.getString(R.string.ttl_loading)
    }
  } catch (t: Throwable) {
    "TypeTorch"
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
