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
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Draws the home-screen widgets from the cache and refreshes them from the network (off the main thread). The look
 * comes from the widget spec (docs/WIDGET_SPEC.md): [WidgetRenderer] draws it as a bitmap at the widget's size.
 */
internal object WidgetUpdater {
  const val ACTION_REFRESH = "dev.typetorch.live.action.REFRESH_WIDGET"

  /** A tap on `toggle:games.N` of an all-games widget: [EXTRA_GAME] is the game's backend id. */
  const val ACTION_TOGGLE = "dev.typetorch.live.action.TOGGLE_GAME"
  const val EXTRA_GAME = "dev.typetorch.live.extra.GAME"

  /** A tap on `action:*` (widget program, docs/WIDGET_PROGRAM.md): [EXTRA_ACTION] is the tap value, templates filled. */
  const val ACTION_PROGRAM_TAP = "dev.typetorch.live.action.PROGRAM_TAP"
  const val EXTRA_ACTION = "dev.typetorch.live.extra.ACTION"

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

  /**
   * Redraws the widgets of one backend (and the all-games ones, which show it too) from the cache (after a live watch
   * poll). Any thread, no network.
   */
  fun renderForBackend(ctx: Context, backendId: String) {
    val app = ctx.applicationContext
    val mgr = AppWidgetManager.getInstance(app) ?: return
    // With a widget program: one sandbox session for the batch (a worker thread: the live watch's).
    val session = openSession(app)
    try {
      for (id in widgetIds(app)) {
        val w = Store.widgetBackend(app, id)
        if (w == backendId || w == Store.ALL) render(app, mgr, id, false, session)
      }
    } finally {
      session?.close()
    }
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
        // A widget program set and supported: plan → fetch → shape → draw (docs/WIDGET_PROGRAM.md); else today's path.
        val session = openSession(app)
        try {
          val mgr = AppWidgetManager.getInstance(app)
          if (mgr != null) {
            for (id in ids) render(app, mgr, id, showRefreshing, session)
            if (session == null) {
              fetchFor(app, ids)
              for (id in ids) render(app, mgr, id, false)
            } else {
              val deadline = SystemClock.elapsedRealtime() + FETCH_DEADLINE_MS
              WidgetProgram.fetch(app, session, ids, deadline)
              for (id in ids) render(app, mgr, id, false, session, deadline)
            }
          }
        } catch (t: Throwable) {
          Log.w("widget refresh failed", t)
        } finally {
          session?.close()
          finish(pending)
        }
      }, "TypeTorchLive-widgets").start()
    } catch (t: Throwable) {
      Log.w("widget thread failed", t)
      finish(pending)
    }
  }

  /** The widget program's session for one batch, or null (no program, unsupported, or failing to read): today's path. */
  private fun openSession(app: Context): ProgramSession? = try {
    WidgetProgram.open(app)
  } catch (t: Throwable) {
    Log.w("widget program open failed", t)
    null
  }

  private fun finish(pending: BroadcastReceiver.PendingResult?) {
    try {
      pending?.finish()
    } catch (t: Throwable) {
      Log.w("finish failed", t)
    }
  }

  /**
   * Fetches the backends of [ids] in parallel (an all-games widget: every signed-in backend; one failing doesn't stop
   * the others), each answer cached on its own, within [FETCH_DEADLINE_MS].
   */
  private fun fetchFor(app: Context, ids: IntArray) {
    val picked = ids.toList().mapNotNull { Store.widgetBackend(app, it) }.distinct()
    val wantsAll = Store.ALL in picked
    val backends = (if (wantsAll) Store.backends(app) else picked.mapNotNull { Store.backend(app, it) })
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
      if (!join(t, deadline)) break
    }
    if (wantsAll && SystemClock.elapsedRealtime() < deadline) {
      val t = Thread({ fetchAllImages(app) }, "TypeTorchLive-images").apply {
        isDaemon = true
        start()
      }
      join(t, deadline)
    }
  }

  /** Waits for [t] until [deadline] (elapsedRealtime); false when the time is up or the wait was interrupted. */
  private fun join(t: Thread, deadline: Long): Boolean {
    val left = deadline - SystemClock.elapsedRealtime()
    if (left <= 0) return false
    return try {
      t.join(left)
      true
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      false
    }
  }

  /**
   * The pictures of all-games widgets: every game's icon (`games.N.iconUrl`, usually already there from its own
   * backend's refresh) and what the spec's images and svg `<image>`s show with the merged values.
   */
  private fun fetchAllImages(app: Context) {
    try {
      val view = AllGames.view(app, null)
      val urls = LinkedHashSet<String>()
      for (g in view.games) {
        val icon = Store.snapshot(app, g.id)?.data?.iconUrl
        if (icon != null && WidgetImages.isWebUrl(icon)) urls.add(icon)
      }
      val snap = view.snap
      if (snap?.data != null) {
        val spec = WidgetSpecs.stored(app) ?: WidgetSpecs.default
        val values = WidgetValues.of(app, spec, allBackend(null), snap, false, Store.RELEASES_SLOTS)
        for (bind in WidgetSpecs.imageBinds(spec)) {
          val url = values.str(bind) ?: continue
          if (WidgetImages.isWebUrl(url)) urls.add(url)
        }
        for (t in WidgetSpecs.svgTemplates(spec)) {
          if (urls.size >= 16) break
          urls.addAll(Svg.imageUrls(t, values))
        }
      }
      for (url in urls.take(16)) WidgetImages.ensure(app, url)
    } catch (t: Throwable) {
      Log.w("all-games images failed", t)
    }
  }

  /** The backend an all-games widget's bindings see: the picked game's, else a stand-in named "All games". */
  private fun allBackend(picked: Backend?): Backend = picked ?: Backend(Store.ALL, AllGames.NAME, "", "", "")

  /** Downloads the pictures the spec's `image` elements show for [b] (the game's icon), when missing or a day old. */
  private fun fetchImages(app: Context, b: Backend) {
    try {
      val snap = Store.snapshot(app, b.id) ?: return
      if (snap.data == null) return
      val spec = WidgetSpecs.stored(app) ?: WidgetSpecs.default
      // The built-in spec's too: it draws whenever the sent one fails.
      val binds = WidgetSpecs.imageBinds(spec) + (if (spec !== WidgetSpecs.default) WidgetSpecs.imageBinds(WidgetSpecs.default) else emptySet())
      // The svg elements' <image href> pictures (only the sent spec's: the built-in one has no svg).
      val svgs = WidgetSpecs.svgTemplates(spec)
      if (binds.isEmpty() && svgs.isEmpty()) return
      val values = WidgetValues.of(app, spec, b, snap, false, emptyList())
      for (bind in binds) {
        val url = values.str(bind) ?: continue
        if (WidgetImages.isWebUrl(url)) WidgetImages.ensure(app, url)
      }
      val urls = LinkedHashSet<String>()
      for (t in svgs) {
        if (urls.size >= 8) break
        urls.addAll(Svg.imageUrls(t, values))
      }
      for (url in urls.take(8)) WidgetImages.ensure(app, url)
    } catch (t: Throwable) {
      Log.w("widget images failed", t)
    }
  }

  /**
   * Draws one widget from the cache. Any thread (a worker preferably: it draws bitmaps), no network, never throws.
   * If the launcher refuses the update (too much bitmap memory, or too big for Binder), it tries once more, lean.
   * [session]: the widget program's (its `shape` gives the values; worker threads only), null: today's path.
   * [imagesUntil] (elapsedRealtime, with a session): first download the pictures the drawing shows, until then.
   */
  fun render(
    ctx: Context, mgr: AppWidgetManager, widgetId: Int, refreshing: Boolean, session: ProgramSession? = null,
    imagesUntil: Long = 0L,
  ) {
    var got: Look? = null
    try {
      val l = look(ctx, mgr, widgetId, refreshing, session)
      got = l
      if (session != null && imagesUntil > 0L) programImages(ctx, l, imagesUntil)
      mgr.updateAppWidget(widgetId, build(ctx, mgr, widgetId, l, false))
      return
    } catch (t: Throwable) {
      Log.w("widget update failed, retrying lean", t)
    }
    try {
      val l = got ?: look(ctx, mgr, widgetId, refreshing, session)
      mgr.updateAppWidget(widgetId, build(ctx, mgr, widgetId, l, true))
    } catch (t: Throwable) {
      Log.w("widget update failed", t)
    }
  }

  /** [render] on a new thread, then finishes [pending] (a resize: onAppWidgetOptionsChanged runs on the main thread). */
  fun renderAsync(ctx: Context, widgetId: Int, pending: BroadcastReceiver.PendingResult?) {
    val app = ctx.applicationContext
    try {
      Thread({
        val session = openSession(app)
        try {
          val mgr = AppWidgetManager.getInstance(app)
          if (mgr != null) render(app, mgr, widgetId, false, session)
        } catch (t: Throwable) {
          Log.w("widget draw failed", t)
        } finally {
          session?.close()
          finish(pending)
        }
      }, "TypeTorchLive-widget-draw").start()
    } catch (t: Throwable) {
      Log.w("widget thread failed", t)
      finish(pending)
    }
  }

  /**
   * An `action:*` tap ([tap], templates filled) on a new thread: the program's `tap` saves the widget's new state,
   * then `shape` and a redraw from the cache (no fetch). Without a program (cleared since the drawing): a redraw.
   */
  fun tapAsync(ctx: Context, widgetId: Int, tap: String, pending: BroadcastReceiver.PendingResult?) {
    val app = ctx.applicationContext
    try {
      Thread({
        val session = openSession(app)
        try {
          if (session != null) WidgetProgram.tap(app, session, widgetId, tap)
          val mgr = AppWidgetManager.getInstance(app)
          if (mgr != null) render(app, mgr, widgetId, false, session)
        } catch (t: Throwable) {
          Log.w("widget tap failed", t)
        } finally {
          session?.close()
          finish(pending)
        }
      }, "TypeTorchLive-widget-tap").start()
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
    /** All-games widgets: `games[]` (`toggle:games.N` picks games[N]); else empty. */
    val games: List<Backend> = emptyList(),
    /** Drawn from a widget program's `shape`: `action:*` taps (and toggles) go to its `tap`. */
    val program: Boolean = false,
    /** The program's failure (`{error}`, the unreachable state). */
    val error: String? = null,
  )

  private fun look(
    ctx: Context, mgr: AppWidgetManager, widgetId: Int, refreshing: Boolean, session: ProgramSession?,
  ): Look {
    val backendId = Store.widgetBackend(ctx, widgetId)
      ?: return Look(WidgetSpecs.PICK, null, null, false, configurePending(ctx, widgetId), null)
    if (session != null) return programLook(ctx, mgr, widgetId, backendId, refreshing, session)
    if (backendId == Store.ALL) return allLook(ctx, widgetId, refreshing)
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

  /**
   * An all-games widget: the cached answers of every signed-in backend merged ([AllGames]), filtered to the picked
   * game. Signed out of every backend: the signedOut state. A tap opens the picked game, else the app.
   */
  private fun allLook(ctx: Context, widgetId: Int, refreshing: Boolean): Look {
    val view = AllGames.forWidget(ctx, widgetId)
    if (view.games.isEmpty()) {
      return Look(WidgetSpecs.SIGNED_OUT, null, null, false, Links.openPending(ctx, widgetId, null), null)
    }
    val picked = view.picked
    val b = allBackend(picked)
    val open = Links.openPending(ctx, widgetId, picked?.link)
    val refresh = refreshPending(ctx, widgetId)
    val slots = Store.widgetSlots(ctx, widgetId)
    val snap = view.snap
    if (snap?.data == null) {
      val state = if (!refreshing && view.anyFailed) WidgetSpecs.UNREACHABLE else WidgetSpecs.LOADING
      return Look(state, b, snap, refreshing, open, refresh, slots, view.games)
    }
    return Look(WidgetSpecs.DATA, b, snap, refreshing, open, refresh, slots, view.games)
  }

  /**
   * A widget with a program (docs/WIDGET_PROGRAM.md): signed out / no backend as today; else `plan` + `shape` on the
   * cached answers, `live` read by the bindings like the fetched answer (the slots, status and updated still native,
   * from the answers' times). `live` null: loading, or unreachable once a fetch failed and none worked. The call
   * failing: unreachable with `{error}`. The whole widget's tap: the program's `open` backend, else (all games) the
   * picked game (`live.filter`), else the game.
   */
  private fun programLook(
    ctx: Context, mgr: AppWidgetManager, widgetId: Int, backendId: String, refreshing: Boolean, session: ProgramSession,
  ): Look {
    val signedIn = AllGames.signedIn(ctx)
    val all = backendId == Store.ALL
    val own: Backend? = if (all) null else Store.backend(ctx, backendId)
    if (all) {
      if (signedIn.isEmpty()) {
        return Look(WidgetSpecs.SIGNED_OUT, null, null, false, Links.openPending(ctx, widgetId, null), null)
      }
    } else if (own == null || Store.isDead(ctx, own.id, own.token)) {
      return Look(WidgetSpecs.SIGNED_OUT, own, null, false, Links.openPending(ctx, widgetId, null), null)
    }
    val size = sizes(ctx, mgr, widgetId, false).first()
    val shaped = WidgetProgram.shape(ctx, session, widgetId, backendId, signedIn, size, WidgetRenderer.isNight(ctx))
    val live = shaped.live
    var error = shaped.error
    var data: LiveData? = null
    if (live != null && error == null) {
      try {
        data = LiveData.fromJson(live, WidgetProgram.MAX_LIVE_FIELD_CHARS)
      } catch (t: Throwable) {
        error = "shape(): bad live object"
        WidgetProgram.logOnce("shape(): bad live object")
      }
    }
    val pickedId = live?.optString("filter", "")?.takeIf { it.isNotEmpty() }
    val picked = if (pickedId == null) null else signedIn.firstOrNull { it.id == pickedId }
    val openId = shaped.open ?: (if (all) pickedId else null)
    val openB = if (openId == null) null else signedIn.firstOrNull { it.id == openId }
    val b: Backend = own ?: allBackend(picked)
    val click = Links.openPending(ctx, widgetId, openB?.link ?: own?.link)
    val refresh = refreshPending(ctx, widgetId)
    val slots = Store.widgetSlots(ctx, widgetId)
    val games = if (all) gamesOf(live, signedIn) else emptyList()
    val err = error
    if (err != null) {
      val snap = Snapshot(null, shaped.okAt, shaped.failedAt)
      return Look(WidgetSpecs.UNREACHABLE, b, snap, false, click, refresh, slots, games, true, err)
    }
    val d = data
    if (d == null) {
      val state = if (!refreshing && shaped.anyFailed && !shaped.anyOk) WidgetSpecs.UNREACHABLE else WidgetSpecs.LOADING
      val snap = Snapshot(null, shaped.okAt, shaped.failedAt)
      return Look(state, b, snap, refreshing, click, refresh, slots, games, true, null)
    }
    return Look(WidgetSpecs.DATA, b, Snapshot(d, shaped.okAt, shaped.failedAt), refreshing, click, refresh, slots, games, true)
  }

  /** `live.games[]` as backends (for the toggles' labels): the signed-in one with that id, else a stand-in. */
  private fun gamesOf(live: JSONObject?, signedIn: List<Backend>): List<Backend> {
    val arr = live?.optJSONArray("games") ?: return emptyList()
    val out = ArrayList<Backend>()
    for (i in 0 until min(arr.length(), 16)) {
      val o = arr.optJSONObject(i)
      val id = o?.optString("id", "").orEmpty()
      val known = if (id.isEmpty()) null else signedIn.firstOrNull { it.id == id }
      out.add(known ?: Backend(id, o?.optString("name", "").orEmpty(), "", "", ""))
    }
    return out
  }

  /** The pictures a program-drawn widget shows (its spec's images and svg `<image>`s), downloaded until [until]. */
  private fun programImages(ctx: Context, look: Look, until: Long) {
    if (look.state != WidgetSpecs.DATA) return
    try {
      val spec = WidgetSpecs.stored(ctx) ?: WidgetSpecs.default
      val values = WidgetValues.of(ctx, spec, look.backend, look.snap, false, look.slots, look.error)
      val binds = WidgetSpecs.imageBinds(spec) +
        (if (spec !== WidgetSpecs.default) WidgetSpecs.imageBinds(WidgetSpecs.default) else emptySet())
      val urls = LinkedHashSet<String>()
      for (bind in binds) {
        val url = values.str(bind) ?: continue
        if (WidgetImages.isWebUrl(url)) urls.add(url)
      }
      for (t in WidgetSpecs.svgTemplates(spec)) {
        if (urls.size >= 16) break
        urls.addAll(Svg.imageUrls(t, values))
      }
      for (url in urls.take(16)) {
        if (SystemClock.elapsedRealtime() >= until) break
        WidgetImages.ensure(ctx, url)
      }
    } catch (t: Throwable) {
      Log.w("program images failed", t)
    }
  }

  /** The sent spec, else (absent, unparseable or failing to draw) the built-in one, else a plain text widget. */
  private fun build(ctx: Context, mgr: AppWidgetManager, widgetId: Int, look: Look, lean: Boolean): RemoteViews {
    val sizes = sizes(ctx, mgr, widgetId, lean)
    val sent = WidgetSpecs.stored(ctx)
    if (sent != null) {
      try {
        return views(ctx, sent, look, sizes, lean, widgetId)
      } catch (t: Throwable) {
        Log.w("sent widget spec failed to draw, using the built-in one", t)
      }
    }
    return try {
      views(ctx, WidgetSpecs.default, look, sizes, lean, widgetId)
    } catch (t: Throwable) {
      Log.w("built-in widget spec failed to draw", t)
      message(ctx, plainText(ctx, look), look.click, look.refresh)
    }
  }

  /**
   * Android 12+ with several reported sizes (portrait and landscape cells): one drawing per size, the launcher picks.
   * Else one drawing at the current size.
   */
  private fun views(
    ctx: Context, spec: WidgetSpec, look: Look, sizes: List<SizeF>, lean: Boolean, widgetId: Int,
  ): RemoteViews {
    val values = WidgetValues.of(ctx, spec, look.backend, look.snap, look.refreshing, look.slots, look.error)
    val budget = pixelBudget(ctx, sizes.size * (if (lean) 1 else 2), lean)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && sizes.size > 1) {
      val map = LinkedHashMap<SizeF, RemoteViews>()
      for (sz in sizes) map[sz] = one(ctx, spec, look, values, sz, lean, budget, widgetId)
      return RemoteViews(map)
    }
    return one(ctx, spec, look, values, sizes[0], lean, budget, widgetId)
  }

  /**
   * One size: the day and the night drawing (the layout shows the one matching the system's mode, so a mode switch
   * needs no redraw), the tap, and the refresh hit area in the layout's corner. Lean: only the current mode's drawing.
   */
  private fun one(
    ctx: Context, spec: WidgetSpec, look: Look, values: WidgetValues, size: SizeF, lean: Boolean, budget: Int,
    widgetId: Int,
  ): RemoteViews {
    val w = size.width
    val h = size.height
    val layout = WidgetSpecs.pick(spec, look.state, w, h)
    val v = RemoteViews(ctx.packageName, R.layout.ttl_widget_canvas)
    val description: String
    val taps: List<TapBox>
    if (lean) {
      val img = WidgetRenderer.render(ctx, spec, layout, values, WidgetRenderer.isNight(ctx), w, h, budget)
      v.setImageViewBitmap(R.id.ttl_w_img_day, img.bitmap)
      v.setImageViewBitmap(R.id.ttl_w_img_night, img.bitmap)
      description = img.description
      taps = img.taps
    } else {
      val day = WidgetRenderer.render(ctx, spec, layout, values, false, w, h, budget)
      val night = WidgetRenderer.render(ctx, spec, layout, values, true, w, h, budget)
      v.setImageViewBitmap(R.id.ttl_w_img_day, day.bitmap)
      v.setImageViewBitmap(R.id.ttl_w_img_night, night.bitmap)
      description = day.description
      taps = day.taps
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
    applyTaps(ctx, v, look, values, widgetId, taps)
    return v
  }

  /**
   * The spec's tap areas: Android 12+ places one view of the pool per tappable box (in dp from the top left; the
   * bitmap is stretched to the widget, so a box can be off by the few dp the launcher's real size differs from the
   * drawn one). Older Android can't move views in RemoteViews: no tap areas, the whole widget's tap only.
   */
  private fun applyTaps(
    ctx: Context, v: RemoteViews, look: Look, values: WidgetValues, widgetId: Int, taps: List<TapBox>,
  ) {
    val pool = TAP_IDS
    var used = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      for (t in taps) {
        if (used >= pool.size) break
        val pending = tapPending(ctx, look, values, widgetId, t.tap) ?: continue
        val id = pool[used]
        try {
          placeTap(v, id, t)
        } catch (e: Throwable) {
          Log.w("tap area failed", e)
          break
        }
        v.setOnClickPendingIntent(id, pending)
        val label = tapLabel(ctx, look, t)
        if (label.isNotEmpty()) v.setContentDescription(id, label)
        v.setViewVisibility(id, View.VISIBLE)
        used++
      }
    }
    for (i in used until pool.size) v.setViewVisibility(pool[i], View.GONE)
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun placeTap(v: RemoteViews, id: Int, t: TapBox) {
    val dip = TypedValue.COMPLEX_UNIT_DIP
    v.setViewLayoutMargin(id, RemoteViews.MARGIN_LEFT, t.x, dip)
    v.setViewLayoutMargin(id, RemoteViews.MARGIN_TOP, t.y, dip)
    v.setViewLayoutWidth(id, t.w, dip)
    v.setViewLayoutHeight(id, t.h, dip)
  }

  /**
   * `open`: the widget's own tap (the picked game, the game, or the app); `refresh`; `toggle:games.N`: a broadcast
   * (drawn by a program: its `tap` with `action:toggle:games.N`); `action:*`: the program's `tap` (its `{…}` filled
   * with the widget's values; nothing without a program).
   */
  private fun tapPending(ctx: Context, look: Look, values: WidgetValues, widgetId: Int, tap: String): PendingIntent? {
    if (tap == "open") return look.click
    if (tap == "refresh") return look.refresh
    if (tap.startsWith(WidgetProgram.ACTION_PREFIX)) {
      if (!look.program) return null
      val filled = if (tap.indexOf('{') >= 0) values.template(tap) else tap
      return actionPending(ctx, widgetId, filled)
    }
    if (tap.startsWith(TOGGLE_PREFIX)) {
      val n = tap.substring(TOGGLE_PREFIX.length).toIntOrNull() ?: return null
      val game = look.games.getOrNull(n) ?: return null
      if (look.program) return actionPending(ctx, widgetId, WidgetProgram.ACTION_PREFIX + tap)
      if (game.id.isEmpty()) return null
      return togglePending(ctx, widgetId, n, game.id)
    }
    return null
  }

  private fun tapLabel(ctx: Context, look: Look, t: TapBox): String {
    if (t.label.isNotBlank()) return t.label
    return when {
      t.tap == "refresh" -> ctx.getString(R.string.ttl_widget_refresh)
      t.tap == "open" -> ctx.getString(R.string.ttl_action_open)
      t.tap.startsWith(TOGGLE_PREFIX) -> {
        val n = t.tap.substring(TOGGLE_PREFIX.length).toIntOrNull()
        val game = if (n == null) null else look.games.getOrNull(n)
        game?.name.orEmpty()
      }
      else -> ""
    }
  }

  private const val TOGGLE_PREFIX = "toggle:games."

  /** The hit areas for the spec's taps (res/layout{,-night}/ttl_widget_canvas.xml). */
  private val TAP_IDS: IntArray
    get() = intArrayOf(
      R.id.ttl_w_tap_0,
      R.id.ttl_w_tap_1,
      R.id.ttl_w_tap_2,
      R.id.ttl_w_tap_3,
      R.id.ttl_w_tap_4,
      R.id.ttl_w_tap_5,
      R.id.ttl_w_tap_6,
      R.id.ttl_w_tap_7,
    )

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

  /**
   * Picks game [n] ([gameId]) of an all-games widget, or clears the pick (the provider saves it and redraws from the
   * cache). A request code per widget and area, and the area in the data, so each is its own PendingIntent.
   */
  private fun togglePending(ctx: Context, widgetId: Int, n: Int, gameId: String): PendingIntent {
    val intent = Intent(ctx, TypeTorchWidgetProvider::class.java)
      .setAction(ACTION_TOGGLE)
      .setData(Uri.parse("typetorch-live://widget/$widgetId/toggle/$n"))
      .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      .putExtra(EXTRA_GAME, gameId)
    val code = 0x10000000 or ((widgetId and 0x00FFFFFF) shl 4) or (n and 0xF)
    return PendingIntent.getBroadcast(ctx, code, intent, Links.FLAGS)
  }

  /**
   * An `action:*` tap ([tap], templates filled) of a program-drawn widget: a broadcast to the provider. The tap is in
   * the data, so each tap value is its own PendingIntent (two drawings' areas never overwrite each other's extras).
   */
  private fun actionPending(ctx: Context, widgetId: Int, tap: String): PendingIntent {
    val data = Uri.Builder()
      .scheme("typetorch-live")
      .authority("widget")
      .appendPath(widgetId.toString())
      .appendPath("action")
      .appendQueryParameter("tap", tap)
      .build()
    val intent = Intent(ctx, TypeTorchWidgetProvider::class.java)
      .setAction(ACTION_PROGRAM_TAP)
      .setData(data)
      .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      .putExtra(EXTRA_ACTION, tap)
    val code = 0x20000000 or ((widgetId and 0x00FFFFFF) shl 4) or (tap.hashCode() and 0xF)
    return PendingIntent.getBroadcast(ctx, code, intent, Links.FLAGS)
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
