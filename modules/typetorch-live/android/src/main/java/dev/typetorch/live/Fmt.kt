package dev.typetorch.live

import android.content.Context
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToLong

/** Number and time text, as in docs/PUSH_WATCH_WIDGETS.md: "214", "1.2K", "18 m 40 s", "1,240 h", "12 s ago". */
internal object Fmt {
  private const val DASH = "—"
  private val US = Locale.US

  /** 214, 1.2K, 12K, 1.5M. */
  fun count(n: Int?): String {
    if (n == null) return DASH
    val sign = if (n < 0) "-" else ""
    val a = abs(n.toLong())
    return sign + when {
      a < 1_000L -> a.toString()
      a < 9_950L -> oneDecimal(a / 1_000.0) + "K"
      a < 999_500L -> (a / 1_000.0).roundToLong().toString() + "K"
      a < 9_950_000L -> oneDecimal(a / 1_000_000.0) + "M"
      else -> (a / 1_000_000.0).roundToLong().toString() + "M"
    }
  }

  /** 1,240 */
  fun grouped(n: Int?): String = if (n == null) DASH else String.format(US, "%,d", n)

  /** ▲12, ▼3, ±0; null when unknown. */
  fun delta(d: Int?): String? = when {
    d == null -> null
    d > 0 -> "▲" + String.format(US, "%,d", d)
    d < 0 -> "▼" + String.format(US, "%,d", -d.toLong())
    else -> "±0"
  }

  /** 45 s, 18 m 40 s, 2 h 5 m. */
  fun duration(seconds: Double?): String {
    if (seconds == null || seconds.isNaN() || seconds < 0) return DASH
    val s = seconds.roundToLong()
    return when {
      s < 60 -> "$s s"
      s < 3600 -> "${s / 60} m ${s % 60} s"
      else -> "${s / 3600} h ${(s % 3600) / 60} m"
    }
  }

  /** 1,240 h, 4.5 h, 35 m. */
  fun hours(h: Double?): String {
    if (h == null || h.isNaN() || h < 0) return DASH
    return when {
      h >= 10 -> String.format(US, "%,d", floor(h).toLong()) + " h"
      h >= 1 -> oneDecimal(h) + " h"
      else -> "${(h * 60).roundToLong()} m"
    }
  }

  /** just now, 12 s ago, 3 min ago, 2 h ago, 4 d ago. */
  fun ago(thenMs: Long, nowMs: Long): String {
    if (thenMs <= 0L) return "never"
    val s = ((nowMs - thenMs) / 1000L).coerceAtLeast(0L)
    return when {
      s < 5 -> "just now"
      s < 60 -> "$s s ago"
      s < 3600 -> "${s / 60} min ago"
      s < 86_400 -> "${s / 3600} h ago"
      else -> "${s / 86_400} d ago"
    }
  }

  /** The clock time in the user's 12/24 h setting ("12:04" / "12:04 PM"). */
  fun clock(ctx: Context, ms: Long): String = try {
    android.text.format.DateFormat.getTimeFormat(ctx).format(Date(ms))
  } catch (t: Throwable) {
    ""
  }

  private fun oneDecimal(v: Double): String {
    val s = String.format(US, "%.1f", v)
    return if (s.endsWith(".0")) s.dropLast(2) else s
  }
}
