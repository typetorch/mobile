package dev.typetorch.live

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Intents that open the app: a backend's deep link (`link`), else the launcher activity. */
internal object Links {
  const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  fun openIntent(ctx: Context, link: String?): Intent {
    if (!link.isNullOrBlank()) {
      try {
        // Pinned to this app, so a link never opens in another one.
        val view = Intent(Intent.ACTION_VIEW, Uri.parse(link))
          .setPackage(ctx.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (view.resolveActivity(ctx.packageManager) != null) return view
      } catch (t: Throwable) {
        Log.w("link intent failed", t)
      }
    }
    return launchIntent(ctx)
  }

  fun launchIntent(ctx: Context): Intent {
    val launch = try {
      ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    } catch (t: Throwable) {
      null
    }
    return (launch ?: Intent(Intent.ACTION_MAIN).setPackage(ctx.packageName))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }

  fun openPending(ctx: Context, requestCode: Int, link: String?): PendingIntent =
    PendingIntent.getActivity(ctx, requestCode, openIntent(ctx, link), FLAGS)
}
