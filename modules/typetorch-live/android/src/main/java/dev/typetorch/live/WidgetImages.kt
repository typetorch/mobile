package dev.typetorch.live

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.util.LruCache
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The widget spec's `image` elements (docs/WIDGET_SPEC.md): pictures by URL (the game's icon), downloaded on the widget
 * worker threads ([ensure], never the main thread), kept on disk in the app's cache dir keyed by URL and fetched again
 * after 24 hours. The renderer only reads the disk ([load]): a picture not there yet draws the placeholder.
 */
internal object WidgetImages {
  private const val DIR = "ttl_widget_images"
  private const val MAX_AGE_MS = 24 * 60 * 60 * 1000L
  /** After a failed download, wait this long before trying the same URL again (widgets refresh every 30 min anyway). */
  private const val RETRY_MS = 10 * 60 * 1000L
  /** Files unused this long are deleted. */
  private const val PRUNE_MS = 30L * 24 * 60 * 60 * 1000L
  private const val TIMEOUT_MS = 10_000
  private const val MAX_BYTES = 2 * 1024 * 1024
  private const val MAX_DECODE_PX = 512

  private val failedAt = ConcurrentHashMap<String, Long>()

  /** Decoded pictures at their drawn size (KB); a few icons at most. */
  private val memory = object : LruCache<String, Bitmap>(4 * 1024) {
    override fun sizeOf(key: String, value: Bitmap): Int = max(1, value.byteCount / 1024)
  }

  fun isWebUrl(url: String?): Boolean =
    url != null && (url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true))

  private fun dir(ctx: Context): File = File(ctx.applicationContext.cacheDir, DIR)

  private fun file(ctx: Context, url: String): File = File(dir(ctx), hash(url) + ".img")

  private fun hash(s: String): String = try {
    val d = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
    d.take(16).joinToString("") { "%02x".format(it.toInt() and 0xff) }
  } catch (t: Throwable) {
    Integer.toHexString(s.hashCode())
  }

  /**
   * Downloads [url] unless a copy younger than 24 h is on disk (or it failed in the last 10 minutes). Blocking (network):
   * worker threads only. Never throws; a failed download keeps the old copy.
   */
  fun ensure(ctx: Context, url: String) {
    try {
      if (!isWebUrl(url) || url.length > 2048) return
      val f = file(ctx, url)
      val now = System.currentTimeMillis()
      val age = now - f.lastModified()
      if (f.exists() && age in 0 until MAX_AGE_MS) return
      val failed = failedAt[url]
      if (failed != null && now - failed in 0 until RETRY_MS) return
      val bytes = download(url)
      if (bytes == null || !decodable(bytes)) {
        failedAt[url] = now
        return
      }
      val d = dir(ctx)
      if (!d.exists() && !d.mkdirs()) return
      val tmp = File(d, f.name + "." + System.nanoTime() + ".tmp")
      FileOutputStream(tmp).use { it.write(bytes) }
      if (!tmp.renameTo(f)) {
        f.delete()
        if (!tmp.renameTo(f)) tmp.delete()
      }
      failedAt.remove(url)
      prune(d, now)
    } catch (t: Throwable) {
      Log.w("widget image failed", t)
    }
  }

  /**
   * [url]'s picture from the disk, scaled to cover exactly [wPx] x [hPx] (centre-cropped), or null when it isn't
   * downloaded yet or doesn't decode. Any thread; no network.
   */
  fun load(ctx: Context, url: String, wPx: Int, hPx: Int): Bitmap? {
    if (!isWebUrl(url) || wPx <= 0 || hPx <= 0) return null
    return try {
      val f = file(ctx, url)
      if (!f.exists()) return null
      val key = "$url|$wPx|$hPx|${f.lastModified()}"
      memory.get(key)?.let { return it }
      val bounds = BitmapFactory.Options()
      bounds.inJustDecodeBounds = true
      BitmapFactory.decodeFile(f.absolutePath, bounds)
      val bw = bounds.outWidth
      val bh = bounds.outHeight
      if (bw <= 0 || bh <= 0) return null
      // Decode at about the drawn size (powers of two), never more than MAX_DECODE_PX across.
      var sample = 1
      while ((bw / (sample * 2) >= wPx && bh / (sample * 2) >= hPx) || max(bw, bh) / sample > MAX_DECODE_PX) sample *= 2
      val opts = BitmapFactory.Options()
      opts.inSampleSize = sample
      val src = BitmapFactory.decodeFile(f.absolutePath, opts) ?: return null
      val out = Bitmap.createBitmap(wPx, hPx, Bitmap.Config.ARGB_8888)
      // Centre crop: the largest part of the source with the target's aspect ratio.
      val scale = max(wPx.toFloat() / src.width, hPx.toFloat() / src.height)
      val cw = (wPx / scale).roundToInt().coerceIn(1, src.width)
      val ch = (hPx / scale).roundToInt().coerceIn(1, src.height)
      val cx = (src.width - cw) / 2
      val cy = (src.height - ch) / 2
      val p = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
      Canvas(out).drawBitmap(src, Rect(cx, cy, cx + cw, cy + ch), Rect(0, 0, wPx, hPx), p)
      if (src !== out) src.recycle()
      memory.put(key, out)
      out
    } catch (t: Throwable) {
      Log.w("widget image load failed", t)
      null
    }
  }

  /**
   * [url]'s whole picture from the disk (not cropped: the svg element places it by its preserveAspectRatio), decoded
   * at about [wPx] x [hPx] or more, at most [MAX_DECODE_PX] across; null when it isn't downloaded yet or doesn't
   * decode. Any thread; no network. The bitmap is shared (memory cache): draw it, never recycle it.
   */
  fun loadWhole(ctx: Context, url: String, wPx: Int, hPx: Int): Bitmap? {
    if (!isWebUrl(url)) return null
    return try {
      val f = file(ctx, url)
      if (!f.exists()) return null
      val bounds = BitmapFactory.Options()
      bounds.inJustDecodeBounds = true
      BitmapFactory.decodeFile(f.absolutePath, bounds)
      val bw = bounds.outWidth
      val bh = bounds.outHeight
      if (bw <= 0 || bh <= 0) return null
      val tw = wPx.coerceAtLeast(1)
      val th = hPx.coerceAtLeast(1)
      var sample = 1
      while (sample < 1024 && ((bw / (sample * 2) >= tw && bh / (sample * 2) >= th) || max(bw, bh) / sample > MAX_DECODE_PX)) sample *= 2
      val key = "$url|whole|$sample|${f.lastModified()}"
      memory.get(key)?.let { return it }
      val opts = BitmapFactory.Options()
      opts.inSampleSize = sample
      val src = BitmapFactory.decodeFile(f.absolutePath, opts) ?: return null
      memory.put(key, src)
      src
    } catch (t: Throwable) {
      Log.w("widget image load failed", t)
      null
    }
  }

  private fun decodable(bytes: ByteArray): Boolean = try {
    val o = BitmapFactory.Options()
    o.inJustDecodeBounds = true
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
    o.outWidth > 0 && o.outHeight > 0
  } catch (t: Throwable) {
    false
  }

  /** No token goes along (a plain public picture), so redirects may be followed. */
  private fun download(url: String): ByteArray? {
    var conn: HttpURLConnection? = null
    try {
      val c = URL(url).openConnection() as HttpURLConnection
      conn = c
      c.connectTimeout = TIMEOUT_MS
      c.readTimeout = TIMEOUT_MS
      c.requestMethod = "GET"
      c.instanceFollowRedirects = true
      c.setRequestProperty("Accept", "image/*")
      if (c.responseCode !in 200..299) return null
      if (c.contentLength > MAX_BYTES) return null
      return c.inputStream.use { readLimited(it) }
    } catch (t: Throwable) {
      return null
    } finally {
      try {
        conn?.disconnect()
      } catch (ignored: Throwable) {
      }
    }
  }

  private fun readLimited(input: InputStream): ByteArray? {
    val out = ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (true) {
      val n = input.read(buf)
      if (n < 0) break
      if (out.size() + n > MAX_BYTES) return null
      out.write(buf, 0, n)
    }
    return out.toByteArray()
  }

  /** Deletes pictures unused for 30 days and stray temp files. */
  private fun prune(d: File, now: Long) {
    try {
      for (f in d.listFiles() ?: return) {
        val age = now - f.lastModified()
        if (age > PRUNE_MS || (f.name.endsWith(".tmp") && age > 60 * 60 * 1000L)) f.delete()
      }
    } catch (t: Throwable) {
      // best effort
    }
  }
}
