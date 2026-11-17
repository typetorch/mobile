package dev.typetorch.live

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle

/**
 * The home-screen widget (one game each). Updates: updatePeriodMillis (30 min), the refresh button (an explicit
 * broadcast to this provider), refreshWidgets() from the app, and every live watch poll of that game.
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
