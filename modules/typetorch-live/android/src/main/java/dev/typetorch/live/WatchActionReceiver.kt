package dev.typetorch.live

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Stop action and delete intent (swipe-away) of the watch notifications. Runs on the main thread, like the service. */
class WatchActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      val id = intent.getStringExtra(WatchNotifications.EXTRA_ID) ?: return
      when (intent.action) {
        WatchNotifications.ACTION_STOP -> {
          Store.removeWatched(context, id)
          val service = WatchService.instance
          if (service != null) {
            service.onWatchListChanged()
          } else {
            // A notification left behind by a killed process.
            WatchNotifications.cancel(context, Store.notificationId(context, id))
          }
        }
        WatchNotifications.ACTION_DISMISSED -> WatchService.instance?.onNotificationDismissed(id)
      }
    } catch (t: Throwable) {
      Log.w("watch action failed", t)
    }
  }
}
