package dev.typetorch.live

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/** The CCU line as a Bitmap (RemoteViews can't draw): brand orange #fb7a32 with a light fill under it. */
internal object Chart {
  private const val BRAND = 0xFFFB7A32.toInt()
  private const val FILL_TOP = 0x55FB7A32

  /** The widget line's options (the spec's chart element); the notification draws with [PLAIN]. */
  class Options(val zero: Boolean, val smooth: Boolean, val labels: Boolean, val labelColor: Int, val fontScale: Float)

  private val PLAIN = Options(zero = false, smooth = false, labels = false, labelColor = 0, fontScale = 1f)

  /** 1, 2, 2.5, 5, 10 × a power of ten, at or above [v] (an axis top that reads well). */
  private fun niceCeil(v: Float): Float {
    if (v <= 1f) return 1f
    val exp = 10.0.pow(floor(log10(v.toDouble()))).toFloat()
    val f = v / exp
    val nice = when {
      f <= 1f -> 1f
      f <= 2f -> 2f
      f <= 2.5f -> 2.5f
      f <= 5f -> 5f
      else -> 10f
    }
    return nice * exp
  }

  /** An axis value as a label: 260, 1.2K, 25K. */
  fun label(v: Float): String = if (v >= 1000f) "${(v / 100f).roundToInt() / 10f}K".replace(".0K", "K") else v.roundToInt().toString()

  /**
   * The newest [minutes] of [series], averaged per [bucket] minutes (a per-minute line is mostly noise at small player
   * counts), each bucket at its newest point's time; [bucket] 0 or 1: every point. Shared by the chart element and the
   * svg element's `{chart.*}` helpers.
   */
  fun window(series: List<Point>, minutes: Int, bucket: Int): List<Point> {
    if (series.isEmpty()) return emptyList()
    val cutoff = series.last().t - minutes * 60_000L
    val window = series.filter { it.t >= cutoff }
    if (window.isEmpty() || bucket <= 1) return window
    val ms = bucket * 60_000L
    val out = ArrayList<Point>()
    var key = Long.MIN_VALUE
    var sum = 0L
    var cnt = 0
    var lastT = 0L
    for (p in window) {
      val k = p.t / ms
      if (k != key && cnt > 0) {
        out.add(Point(lastT, ((sum + cnt / 2) / cnt).toInt()))
        sum = 0L
        cnt = 0
      }
      key = k
      sum += p.ccu
      cnt++
      lastT = p.t
    }
    if (cnt > 0) out.add(Point(lastT, ((sum + cnt / 2) / cnt).toInt()))
    return out
  }

  /**
   * The value axis of [points] (not empty) as [lo, hi]: from 0 to a round top when [zero] (small changes stay small),
   * else the points' range with some air (never less than 2 wide).
   */
  fun bounds(points: List<Point>, zero: Boolean): FloatArray {
    var lo = points.minOf { it.ccu }.toFloat()
    var hi = points.maxOf { it.ccu }.toFloat()
    if (zero) {
      lo = 0f
      hi = niceCeil(hi)
    } else {
      val range = hi - lo
      if (range < 1f) {
        lo -= 1f
        hi += 1f
      } else {
        lo = max(0f, lo - range * 0.15f)
        hi += range * 0.1f
      }
    }
    return floatArrayOf(lo, hi)
  }

  /** Where [trace] draws: an android Path, or SVG path data. */
  interface Sink {
    fun move(x: Float, y: Float)
    fun line(x: Float, y: Float)
    fun quad(cx: Float, cy: Float, x: Float, y: Float)
  }

  /**
   * The line through [xs] / [ys] (at least 2 points): straight segments, or when [smooth] a curve through the
   * midpoints with each point as the control (quadratic curves: no overshoot), ending on the last point.
   */
  fun trace(xs: FloatArray, ys: FloatArray, smooth: Boolean, sink: Sink) {
    val n = min(xs.size, ys.size)
    if (n < 1) return
    sink.move(xs[0], ys[0])
    if (smooth && n > 2) {
      for (i in 1 until n - 1) {
        sink.quad(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2f, (ys[i] + ys[i + 1]) / 2f)
      }
      sink.line(xs[n - 1], ys[n - 1])
    } else {
      for (i in 1 until n) sink.line(xs[i], ys[i])
    }
  }

  private class PathSink(val path: Path) : Sink {
    override fun move(x: Float, y: Float) = path.moveTo(x, y)
    override fun line(x: Float, y: Float) = path.lineTo(x, y)
    override fun quad(cx: Float, cy: Float, x: Float, y: Float) = path.quadTo(cx, cy, x, y)
  }

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
      if (points.isNotEmpty()) draw(Canvas(bmp), points, w.toFloat(), h.toFloat(), s, BRAND, FILL_TOP, true, 2f, PLAIN)
      bmp
    } catch (t: Throwable) {
      Log.w("chart failed", t)
      null
    }
  }

  /**
   * The widget renderer's line: drawn into [c] inside the box [left], [top], [w], [h] (px) at [s] px per dp, in [color]
   * with a [fill] colour fading to transparent under it (null: no fill), a dot on the newest point when [dot].
   */
  fun drawInto(
    c: Canvas, points: List<Point>, left: Float, top: Float, w: Float, h: Float, s: Float,
    color: Int, fill: Int?, dot: Boolean, strokeDp: Float, options: Options = PLAIN,
  ) {
    if (points.isEmpty() || w <= 0f || h <= 0f) return
    val save = c.save()
    try {
      c.translate(left, top)
      draw(c, points, w, h, s, color, fill, dot, strokeDp, options)
    } finally {
      c.restoreToCount(save)
    }
  }

  /** With the notification's values (BRAND, FILL_TOP, dot, 2 dp) this draws exactly what it always did. */
  private fun draw(
    c: Canvas, points: List<Point>, w: Float, h: Float, s: Float,
    color: Int, fillTop: Int?, withDot: Boolean, strokeDp: Float, o: Options,
  ) {
    val stroke = strokeDp * s
    val dot = if (withDot) 1.5f * strokeDp * s else stroke / 2f
    val b = bounds(points, o.zero)
    val lo = b[0]
    val hi = b[1]

    // Labels: the top and middle values on the left, with light grid lines across.
    val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      this.color = o.labelColor
      textSize = 9f * s * o.fontScale
    }
    val labelW = if (o.labels) max(labelPaint.measureText(label(hi)), labelPaint.measureText(label(lo))) + 4f * s else 0f
    val padX = dot + s
    val padLeft = padX + labelW
    val padTop = if (o.labels) max(dot + s, labelPaint.textSize * 0.6f) else dot + s
    val padBottom = stroke

    val t0 = points.first().t
    val span = (points.last().t - t0).toFloat()
    val plotW = w - padLeft - padX
    val plotH = h - padTop - padBottom
    fun y(v: Int): Float = padTop + (1f - (v - lo) / (hi - lo)) * plotH
    if (plotW <= 0f || plotH <= 0f) return

    if (o.labels) {
      val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = max(1f, 0.6f * s)
        this.color = (o.labelColor and 0x00FFFFFF) or 0x33000000
      }
      val mid = (lo + hi) / 2f
      for (v in floatArrayOf(hi, mid, lo)) {
        val gy = padTop + (1f - (v - lo) / (hi - lo)) * plotH
        c.drawLine(padLeft, gy, w - padX, gy, grid)
        if (v != mid || hi - lo >= 2f) {
          c.drawText(label(v), padX, gy + labelPaint.textSize * 0.35f, labelPaint)
        }
      }
    }

    val xs = FloatArray(points.size)
    val ys = FloatArray(points.size)
    for (i in points.indices) {
      val f = when {
        span > 0f -> (points[i].t - t0) / span
        points.size > 1 -> i / (points.size - 1f)
        else -> 1f
      }
      xs[i] = padLeft + f * plotW
      ys[i] = y(points[i].ccu)
    }

    val line = Path()
    if (points.size == 1) {
      // One point: a flat line across.
      line.moveTo(padLeft, ys[0])
      line.lineTo(xs[0], ys[0])
    } else {
      trace(xs, ys, o.smooth, PathSink(line))
    }
    val startX = if (points.size == 1) padLeft else xs[0]
    val endX = xs[points.size - 1]

    val fill = Path(line)
    fill.lineTo(endX, h)
    fill.lineTo(startX, h)
    fill.close()
    if (fillTop != null) {
      val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        shader = LinearGradient(0f, padTop, 0f, h, fillTop, fillTop and 0x00FFFFFF, Shader.TileMode.CLAMP)
      }
      c.drawPath(fill, fillPaint)
    }

    val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = stroke
      strokeJoin = Paint.Join.ROUND
      strokeCap = Paint.Cap.ROUND
      this.color = color
    }
    c.drawPath(line, linePaint)

    if (withDot) {
      val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        this.color = color
      }
      c.drawCircle(endX, ys[points.size - 1], dot, dotPaint)
    }
  }
}
