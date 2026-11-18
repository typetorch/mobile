package dev.typetorch.live

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle

/**
 * The home-screen widget (one game each, or all games: backend id [Store.ALL]). Updates: updatePeriodMillis (30 min),
 * the refresh button (an explicit broadcast to this provider), refreshWidgets() from the app, and every live watch
 * poll of that game. A game tapped on an all-games widget ([WidgetUpdater.ACTION_TOGGLE]) redraws from the cache, and
 * so does an `action:*` tap of a widget program ([WidgetUpdater.ACTION_PROGRAM_TAP], after the program's tap()).
 * Network runs on a short-lived thread under goAsync(), never on the main thread.
 */
class TypeTorchWidgetProvider : AppWidgetProvider() {

  override fun onReceive(context: Context, intent: Intent) {
    try {
      if (intent.action == WidgetUpdater.ACTION_REFRESH) {
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID) WidgetUpdater.refresh(context, intArrayOf(id), goAsync(), true)
        return
      }
      if (intent.action == WidgetUpdater.ACTION_PROGRAM_TAP) {
        // An `action:*` tap of a program-drawn widget: the program's tap() saves its state, then a redraw (no fetch).
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val tap = intent.getStringExtra(WidgetUpdater.EXTRA_ACTION).orEmpty()
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID && tap.startsWith(WidgetProgram.ACTION_PREFIX) && tap.length <= 400) {
          WidgetUpdater.tapAsync(context, id, tap, goAsync())
        }
        return
      }
      if (intent.action == WidgetUpdater.ACTION_TOGGLE) {
        // A game of an all-games widget tapped: pick it (or clear the pick) and redraw from the cache, no fetch.
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val game = intent.getStringExtra(WidgetUpdater.EXTRA_GAME).orEmpty()
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID && Store.widgetBackend(context, id) == Store.ALL) {
          Store.toggleWidgetFilter(context, id, game)
          WidgetUpdater.renderAsync(context, id, goAsync())
        }
        return
      }
      super.onReceive(context, intent)
    } catch (t: Throwable) {
      Log.w("widget receive failed", t)
    }
  }

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    WidgetUpdater.refresh(context, appWidgetIds, goAsync(), false)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle,
  ) {
    // Resized (or the launcher reported new sizes): redraw at the new size from the cache (no network), on a worker
    // thread since it draws bitmaps.
    WidgetUpdater.renderAsync(context, appWidgetId, goAsync())
  }

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    for (id in appWidgetIds) Store.removeWidget(context, id)
  }
}
