package dev.typetorch.live

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import kotlin.math.max
import kotlin.math.roundToInt

/** The CCU line as a Bitmap (RemoteViews can't draw): brand orange #fb7a32 with a light fill under it. */
internal object Chart {
  private const val BRAND = 0xFFFB7A32.toInt()
  private const val FILL_TOP = 0x55FB7A32
  private const val FILL_BOTTOM = 0x00FB7A32

  /**
   * [widthDp] x [heightDp] drawn at the screen density, capped at [maxScale] px per dp (RemoteViews bitmaps cross
   * Binder: an uncapped 3.5x bitmap per notification would get close to the transaction limit). The ImageView scales
   * it back up (fitXY). Null only if the bitmap can't be made.
   */
  fun render(points: List<Point>, widthDp: Float, heightDp: Float, density: Float, maxScale: Float): Bitmap? {
    return try {
      val s = density.coerceIn(1f, maxScale)
      val w = (widthDp * s).roundToInt().coerceAtLeast(8)
      val h = (heightDp * s).roundToInt().coerceAtLeast(8)
      val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      if (points.isNotEmpty()) draw(Canvas(bmp), points, w.toFloat(), h.toFloat(), s)
      bmp
    } catch (t: Throwable) {
      Log.w("chart failed", t)
      null
    }
  }

  private fun draw(c: Canvas, points: List<Point>, w: Float, h: Float, s: Float) {
    val stroke = 2f * s
    val dot = 3f * s
    val padX = dot + s
    val padTop = dot + s
    val padBottom = stroke

    var lo = points.minOf { it.ccu }.toFloat()
    var hi = points.maxOf { it.ccu }.toFloat()
    val range = hi - lo
    if (range < 1f) {
      lo -= 1f
      hi += 1f
    } else {
      lo = max(0f, lo - range * 0.15f)
      hi += range * 0.1f
    }

    val t0 = points.first().t
    val span = (points.last().t - t0).toFloat()
    val plotW = w - 2 * padX
    val plotH = h - padTop - padBottom
    fun y(v: Int): Float = padTop + (1f - (v - lo) / (hi - lo)) * plotH

    val xs = FloatArray(points.size)
    val ys = FloatArray(points.size)
    for (i in points.indices) {
      val f = when {
        span > 0f -> (points[i].t - t0) / span
        points.size > 1 -> i / (points.size - 1f)
        else -> 1f
      }
      xs[i] = padX + f * plotW
      ys[i] = y(points[i].ccu)
    }

    val line = Path()
    if (points.size == 1) {
      // One point: a flat line across.
      line.moveTo(padX, ys[0])
      line.lineTo(xs[0], ys[0])
    } else {
      line.moveTo(xs[0], ys[0])
      for (i in 1 until points.size) line.lineTo(xs[i], ys[i])
    }
    val startX = if (points.size == 1) padX else xs[0]
    val endX = xs[points.size - 1]

    val fill = Path(line)
    fill.lineTo(endX, h)
    fill.lineTo(startX, h)
    fill.close()
    val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      shader = LinearGradient(0f, padTop, 0f, h, FILL_TOP, FILL_BOTTOM, Shader.TileMode.CLAMP)
    }
    c.drawPath(fill, fillPaint)

    val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = stroke
      strokeJoin = Paint.Join.ROUND
      strokeCap = Paint.Cap.ROUND
      color = BRAND
    }
    c.drawPath(line, linePaint)

    val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      color = BRAND
    }
    c.drawCircle(endX, ys[points.size - 1], dot, dotPaint)
  }
}
