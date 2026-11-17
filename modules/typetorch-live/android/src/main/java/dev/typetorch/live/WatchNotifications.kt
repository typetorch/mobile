package dev.typetorch.live

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/** The live watch notifications: channel `watch`, one per watched backend, decorated custom views. */
internal object WatchNotifications {
  const val CHANNEL = "watch"
  const val ACTION_STOP = "dev.typetorch.live.action.STOP_WATCH"
  const val ACTION_DISMISSED = "dev.typetorch.live.action.WATCH_DISMISSED"
  const val EXTRA_ID = "dev.typetorch.live.extra.BACKEND_ID"
  private const val WINDOW_MS = 30 * 60_000L

  private fun manager(ctx: Context): NotificationManager? = try {
    ctx.getSystemService(NotificationManager::class.java)
  } catch (t: Throwable) {
    null
  }

  fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try {
      val ch = NotificationChannel(CHANNEL, ctx.getString(R.string.ttl_channel_name), NotificationManager.IMPORTANCE_LOW)
      ch.description = ctx.getString(R.string.ttl_channel_description)
      ch.setShowBadge(false)
      ch.setSound(null, null)
      ch.enableVibration(false)
      ch.enableLights(false)
      manager(ctx)?.createNotificationChannel(ch)
    } catch (t: Throwable) {
      Log.w("channel failed", t)
    }
  }

  /** Posting without POST_NOTIFICATIONS is a silent no-op on Android 13+; anything else thrown is swallowed too. */
  fun notify(ctx: Context, id: Int, n: Notification) {
    try {
      manager(ctx)?.notify(id, n)
    } catch (t: Throwable) {
      Log.w("notify failed", t)
    }
  }

  fun cancel(ctx: Context, id: Int) {
    try {
      manager(ctx)?.cancel(id)
    } catch (t: Throwable) {
      Log.w("cancel failed", t)
    }
  }

  /** Only for startForeground when no backend is left to show (the service stops right after). */
  fun placeholder(ctx: Context): Notification {
    ensureChannel(ctx)
    return NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.ttl_ic_flame)
      .setColor(ContextCompat.getColor(ctx, R.color.ttl_brand))
      .setContentTitle(ctx.getString(R.string.ttl_placeholder_title))
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  /**
   * The notification of one watched backend from its cached numbers.
   * [signedOut]: the token got a 401 (polling stopped). [snap] stale: the last poll failed (keeps the last numbers).
   */
  fun build(ctx: Context, b: Backend, snap: Snapshot?, signedOut: Boolean, now: Long): Notification {
    val data = snap?.data
    val lh = data?.lastHour
    val name = data?.gameName?.takeIf { it.isNotBlank() } ?: b.name.ifBlank { hostOf(b.url) }
    val status: String? = when {
      signedOut -> ctx.getString(R.string.ttl_signed_out)
      snap != null && snap.stale ->
        if (snap.okAt > 0) ctx.getString(R.string.ttl_offline) + " · updated " + Fmt.ago(snap.okAt, now)
        else ctx.getString(R.string.ttl_offline)
      data == null -> ctx.getString(R.string.ttl_loading)
      else -> null
    }
    val deltaText = Fmt.delta(data?.delta)
    val deltaColor = ContextCompat.getColor(ctx, if ((data?.delta ?: 0) < 0) R.color.ttl_down else R.color.ttl_up)

    // Collapsed: "214 playing ▲12 · The Prison" / "Avg session 18 m 40 s (last hour) · 31 servers".
    val line1 = SpannableStringBuilder()
    if (data?.ccu != null) {
      line1.append(Fmt.count(data?.ccu)).append(" playing")
      if (deltaText != null) {
        line1.append(' ')
        val start = line1.length
        line1.append(deltaText)
        line1.setSpan(ForegroundColorSpan(deltaColor), start, line1.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
      line1.append(" · ")
    }
    line1.append(name)
    val line2 = status ?: buildString {
      append("Avg session ").append(Fmt.duration(lh?.avgSessionSeconds)).append(" (last hour)")
      val servers = data?.servers
      if (servers != null) append(" · ").append(Fmt.grouped(servers)).append(if (servers == 1) " server" else " servers")
    }

    val collapsed = RemoteViews(ctx.packageName, R.layout.ttl_notif_collapsed)
    collapsed.setTextViewText(R.id.ttl_n_line1, line1)
    collapsed.setTextViewText(R.id.ttl_n_line2, line2)

    // Expanded: big CCU, delta, game, status, 30-minute line, four rows.
    val expanded = RemoteViews(ctx.packageName, R.layout.ttl_notif_expanded)
    expanded.setTextViewText(R.id.ttl_n_big, Fmt.count(data?.ccu))
    if (deltaText != null) {
      expanded.setTextViewText(R.id.ttl_n_delta, deltaText)
      expanded.setTextColor(R.id.ttl_n_delta, deltaColor)
      expanded.setViewVisibility(R.id.ttl_n_delta, View.VISIBLE)
    } else {
      expanded.setViewVisibility(R.id.ttl_n_delta, View.GONE)
    }
    expanded.setTextViewText(R.id.ttl_n_game, name)
    if (status != null) {
      expanded.setTextViewText(R.id.ttl_n_status, status)
      expanded.setViewVisibility(R.id.ttl_n_status, View.VISIBLE)
    } else {
      expanded.setViewVisibility(R.id.ttl_n_status, View.GONE)
    }
    val points = data?.seriesWindow(WINDOW_MS).orEmpty()
    val chart = if (points.isEmpty()) null
    else Chart.render(points, 320f, 56f, ctx.resources.displayMetrics.density, 2.25f)
    if (chart != null) {
      expanded.setImageViewBitmap(R.id.ttl_n_chart, chart)
      expanded.setViewVisibility(R.id.ttl_n_chart, View.VISIBLE)
    } else {
      expanded.setViewVisibility(R.id.ttl_n_chart, View.GONE)
    }
    expanded.setTextViewText(R.id.ttl_n_avg, Fmt.duration(lh?.avgSessionSeconds))
    expanded.setTextViewText(R.id.ttl_n_median, Fmt.duration(lh?.medianSessionSeconds) + " · " + Fmt.grouped(lh?.sessionsEnded))
    expanded.setTextViewText(R.id.ttl_n_servers, Fmt.grouped(data?.servers) + " · " + Fmt.grouped(data?.peakToday))
    expanded.setTextViewText(R.id.ttl_n_played, Fmt.hours(lh?.playtimeHours))

    val nid = Store.notificationId(ctx, b.id)
    val open = Links.openPending(ctx, nid, b.link)
    val builder = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.ttl_ic_flame)
      .setColor(ContextCompat.getColor(ctx, R.color.ttl_brand))
      .setStyle(NotificationCompat.DecoratedCustomViewStyle())
      .setCustomContentView(collapsed)
      .setCustomBigContentView(expanded)
      // Plain text for accessibility, the lock screen's public version and anything that ignores custom views.
      .setContentTitle(line1.toString())
      .setContentText(line2)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setLocalOnly(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(open)
      .setDeleteIntent(actionIntent(ctx, ACTION_DISMISSED, b.id, nid))
      .addAction(0, ctx.getString(R.string.ttl_action_stop), actionIntent(ctx, ACTION_STOP, b.id, nid))
      .addAction(0, ctx.getString(R.string.ttl_action_open), open)
    if (snap != null && snap.okAt > 0) builder.setWhen(snap.okAt).setShowWhen(true) else builder.setShowWhen(false)
    return builder.build()
  }

  private fun actionIntent(ctx: Context, action: String, backendId: String, requestCode: Int): PendingIntent {
    val intent = Intent(ctx, WatchActionReceiver::class.java)
      .setAction(action)
      .setData(Uri.parse("typetorch-live://watch/" + Uri.encode(backendId)))
      .putExtra(EXTRA_ID, backendId)
    return PendingIntent.getBroadcast(ctx, requestCode, intent, Links.FLAGS)
  }

  /** Clears the notifications of a process that died with the service (they would stay as ongoing ghosts). */
  fun cancelAll(ctx: Context) {
    cancel(ctx, WatchService.FG_ID)
    for (id in Store.allNotificationIds(ctx)) cancel(ctx, id)
  }

  fun hostOf(url: String): String = try {
    Uri.parse(url).host ?: url
  } catch (t: Throwable) {
    url
  }
}
