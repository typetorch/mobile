package dev.typetorch.live

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ListView
import android.widget.SimpleAdapter

/**
 * Picks the game of a widget: "All games" first (backend id [Store.ALL]: the releases of every signed-in backend), then
 * the backends saved by setBackends (the stats it shows are picked in the app, Settings → Widgets). Started by the
 * launcher when the widget is
 * placed (and on reconfigure), or by the widget's own "Tap to pick a game". Dialog theme, dark in dark mode.
 */
class WidgetConfigureActivity : Activity() {
  private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    widgetId = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    // Backing out (or a crash below) must not leave a half-made widget: the launcher removes it on CANCELED.
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }
    try {
      setContentView(R.layout.ttl_configure)
      setTitle(R.string.ttl_configure_title)
      val backends = Store.backends(this)
      val list = findViewById<ListView>(R.id.ttl_c_list)
      val empty = findViewById<View>(R.id.ttl_c_empty)
      if (backends.isEmpty()) {
        list.visibility = View.GONE
        empty.visibility = View.VISIBLE
        findViewById<Button>(R.id.ttl_c_open).setOnClickListener {
          try {
            startActivity(Links.launchIntent(this))
          } catch (t: Throwable) {
            Log.w("open app failed", t)
          }
          finish()
        }
        return
      }
      val current = Store.widgetBackend(this, widgetId)
      val allSubtitle = getString(R.string.ttl_configure_all_subtitle)
      val rows: List<Map<String, String>> = listOf(
        mapOf(
          "title" to getString(R.string.ttl_configure_all),
          "subtitle" to (if (current == Store.ALL) "$allSubtitle · current" else allSubtitle),
        ),
      ) + backends.map { b ->
        val host = WatchNotifications.hostOf(b.url)
        mapOf(
          "title" to b.name.ifBlank { host },
          "subtitle" to (if (b.id == current) "$host · current" else host),
        )
      }
      list.adapter = SimpleAdapter(
        this,
        rows,
        android.R.layout.simple_list_item_2,
        arrayOf("title", "subtitle"),
        intArrayOf(android.R.id.text1, android.R.id.text2),
      )
      list.setOnItemClickListener { _, _, position, _ ->
        if (position == 0) pickAll() else backends.getOrNull(position - 1)?.let { pick(it) }
      }
    } catch (t: Throwable) {
      Log.w("configure failed", t)
      finish()
    }
  }

  private fun pick(b: Backend) {
    try {
      // From all games back to one game: the Releases slots go (they were set for all games), the defaults come.
      val wasAll = Store.widgetBackend(this, widgetId) == Store.ALL
      Store.setWidgetBackend(this, widgetId, b.id)
      // A new widget gets the default stat slots (the app's, else the built-in ones); a reconfigure keeps its own.
      if (wasAll || !Store.hasWidgetSlots(this, widgetId)) Store.setWidgetSlots(this, widgetId, Store.defaultSlots(this))
      done()
    } catch (t: Throwable) {
      Log.w("pick failed", t)
    }
    finish()
  }

  /** All games: the Releases style (an all-games widget shows the merged release garden). */
  private fun pickAll() {
    try {
      Store.setWidgetBackend(this, widgetId, Store.ALL)
      Store.setWidgetSlots(this, widgetId, Store.RELEASES_SLOTS)
      done()
    } catch (t: Throwable) {
      Log.w("pick failed", t)
    }
    finish()
  }

  private fun done() {
    // The configure activity owns the first draw (the launcher sends no update for it).
    WidgetUpdater.refresh(this, intArrayOf(widgetId), null, true)
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
  }
}
