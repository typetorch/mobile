package dev.typetorch.live

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS API (docs/PUSH_WATCH_WIDGETS.md, section 3):
 *   setBackends(list), startWatch(id), stopWatch(id), watching(), refreshWidgets(), setWidgetSpec(json)
 * Synchronous functions (they run on the JS thread); nothing here touches the network.
 */
class TypeTorchLiveModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TypeTorchLive")

    OnActivityEntersForeground {
      // Clear ghosts of a killed service and restart a saved watch (the app is in the foreground, so it may).
      try {
        WatchService.resumeIfNeeded(context)
      } catch (t: Throwable) {
        Log.w("resume failed", t)
      }
    }

    Function("setBackends") { list: List<Map<String, Any?>> ->
      val ctx = context
      val backends = list.map { m ->
        Backend(
          id = str(m["id"]),
          name = str(m["name"]),
          url = str(m["url"]),
          token = str(m["token"]),
          link = str(m["link"]),
        )
      }.filter { it.id.isNotEmpty() }
      Store.setBackends(ctx, backends)
      // Watches of removed backends end; a new token resumes a signed-out watch; names and links refresh.
      WatchService.sync(ctx)
      Unit
    }

    Function("startWatch") { id: String ->
      val ctx = context
      if (Store.backend(ctx, id) == null) {
        throw CodedException("ERR_TYPETORCH_LIVE_UNKNOWN_BACKEND", "No backend with this id: call setBackends first", null)
      }
      Store.addWatched(ctx, id)
      if (!WatchService.sync(ctx)) {
        Store.removeWatched(ctx, id)
        throw CodedException("ERR_TYPETORCH_LIVE_START", "The live watch could not start (is the app in the background?)", null)
      }
      Unit
    }

    Function("stopWatch") { id: String ->
      val ctx = context
      Store.removeWatched(ctx, id)
      if (WatchService.instance == null) WatchNotifications.cancel(ctx, Store.notificationId(ctx, id))
      WatchService.sync(ctx)
      Unit
    }

    Function("watching") {
      val ctx = context
      val known = Store.backends(ctx).map { it.id }.toSet()
      Store.watched(ctx).filter { it in known }
    }

    Function("refreshWidgets") {
      WidgetUpdater.refreshAll(context)
      Unit
    }

    // The widget's look (docs/WIDGET_SPEC.md). Saved when it parses (else rejected, the saved one stays); "" goes back
    // to the built-in default. Draws nothing: call refreshWidgets() after.
    Function("setWidgetSpec") { json: String ->
      val ctx = context
      val text = json.trim()
      if (text.isEmpty()) {
        Store.setWidgetSpecJson(ctx, null)
      } else if (text != Store.widgetSpecJson(ctx)) {
        val error = WidgetSpecs.validate(text)
        if (error != null) throw CodedException("ERR_TYPETORCH_LIVE_SPEC", "Widget spec rejected: $error", null)
        Store.setWidgetSpecJson(ctx, text)
      }
      Unit
    }
  }

  private fun str(v: Any?): String = when (v) {
    null -> ""
    is String -> v
    is Double -> if (v % 1.0 == 0.0 && !v.isInfinite()) v.toLong().toString() else v.toString()
    else -> v.toString()
  }
}
