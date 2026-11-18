package dev.typetorch.live

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * One cached answer of a widget program's request: the last good body ([body], at [okAt]) and the last failure
 * ([failedAt], [status], [error]); epoch ms, 0 = never.
 */
internal class ProgramAnswer(
  val okAt: Long,
  val failedAt: Long,
  val status: Int,
  val error: String?,
  val body: String?,
)

/**
 * The widget program's answers (docs/WIDGET_PROGRAM.md): per backend + `path?query`, one small JSON file in the app's
 * no-backup files (bodies can be up to 2 MB, too big for SharedPreferences), written atomically. Kept across restarts
 * (an offline widget still draws), at most [MAX_FILES] per backend (the oldest go), dropped with the backend
 * ([retain]) or the program ([clear]). Any thread; disk I/O.
 */
internal object ProgramCache {
  private const val DIR = "ttl_program_cache"
  private const val MAX_FILES = 64
  private val lock = Any()

  private fun root(ctx: Context): File = File(ctx.applicationContext.noBackupFilesDir, DIR)

  private fun backendDir(ctx: Context, backendId: String): File = File(root(ctx), hash(backendId))

  private fun file(ctx: Context, backendId: String, key: String): File =
    File(backendDir(ctx, backendId), hash(key) + ".json")

  fun get(ctx: Context, backendId: String, key: String): ProgramAnswer? = synchronized(lock) {
    read(file(ctx, backendId, key))
  }

  /** A 2xx answer (already checked to be JSON). */
  fun putSuccess(ctx: Context, backendId: String, key: String, body: String, now: Long) {
    synchronized(lock) {
      write(ctx, backendId, key, ProgramAnswer(now, 0L, 200, null, body))
    }
  }

  /** A failed fetch: the last good body stays (the widget keeps drawing it, marked stale). */
  fun putFailure(ctx: Context, backendId: String, key: String, status: Int, error: String, now: Long) {
    synchronized(lock) {
      val prev = read(file(ctx, backendId, key))
      write(ctx, backendId, key, ProgramAnswer(prev?.okAt ?: 0L, now, status, error, prev?.body))
    }
  }

  /** Drops the answers of backends not in [ids] (signed out, removed). */
  fun retain(ctx: Context, ids: Collection<String>) {
    synchronized(lock) {
      try {
        val keep = ids.map { hash(it) }.toSet()
        val dirs = root(ctx).listFiles() ?: return
        for (d in dirs) if (d.name !in keep) d.deleteRecursively()
      } catch (t: Throwable) {
        Log.w("program cache retain failed", t)
      }
    }
  }

  fun clear(ctx: Context) {
    synchronized(lock) {
      try {
        root(ctx).deleteRecursively()
      } catch (t: Throwable) {
        Log.w("program cache clear failed", t)
      }
    }
  }

  private fun read(f: File): ProgramAnswer? {
    if (!f.isFile) return null
    return try {
      val o = JSONObject(f.readText(Charsets.UTF_8))
      ProgramAnswer(
        okAt = o.optLong("okAt", 0L),
        failedAt = o.optLong("failedAt", 0L),
        status = o.optInt("status", 0),
        error = if (o.isNull("error")) null else o.optString("error", "").takeIf { it.isNotEmpty() },
        body = if (o.isNull("body")) null else o.optString("body", ""),
      )
    } catch (t: Throwable) {
      null
    }
  }

  private fun write(ctx: Context, backendId: String, key: String, a: ProgramAnswer) {
    try {
      val dir = backendDir(ctx, backendId)
      if (!dir.isDirectory && !dir.mkdirs()) return
      val f = File(dir, hash(key) + ".json")
      val o = JSONObject()
        .put("backend", backendId)
        .put("key", key)
        .put("okAt", a.okAt)
        .put("failedAt", a.failedAt)
        .put("status", a.status)
        .put("error", a.error ?: JSONObject.NULL)
        .put("body", a.body ?: JSONObject.NULL)
      val tmp = File(dir, f.name + "." + System.nanoTime() + ".tmp")
      tmp.writeText(o.toString(), Charsets.UTF_8)
      if (!tmp.renameTo(f)) {
        f.delete()
        if (!tmp.renameTo(f)) tmp.delete()
      }
      prune(dir)
    } catch (t: Throwable) {
      Log.w("program cache write failed", t)
    }
  }

  private fun prune(dir: File) {
    val files = dir.listFiles() ?: return
    if (files.size <= MAX_FILES) return
    files.sortBy { it.lastModified() }
    for (i in 0 until files.size - MAX_FILES) files[i].delete()
  }

  private fun hash(s: String): String = try {
    val d = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
    d.take(16).joinToString("") { "%02x".format(it.toInt() and 0xff) }
  } catch (t: Throwable) {
    Integer.toHexString(s.hashCode())
  }
}
