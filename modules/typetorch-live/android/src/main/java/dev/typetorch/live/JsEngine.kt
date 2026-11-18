package dev.typetorch.live

import android.content.Context
import android.os.Build
import android.os.Looper
import android.os.SystemClock
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.IsolateTerminatedException
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONObject
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** A widget program call that failed; [message] is one short line (drawn as `{error}`, logged once). */
internal class ProgramError(message: String) : Exception(message)

/**
 * The JavaScriptSandbox (androidx.javascriptengine: an isolated V8 in the WebView's sandbox process) the widget
 * program runs in (docs/WIDGET_PROGRAM.md). One per process, started on demand by the first [ProgramSession] call,
 * shared by every session, closed 60 s after the last session ended. All waits have timeouts and never run on the main
 * thread. Android 7.x (the library needs 8.0) and phones whose WebView has no sandbox: [supported] is false and
 * nothing here is touched.
 */
internal object JsEngine {
  /** Per program call (and for loading the program's source into a new isolate). */
  const val CALL_MS = 2_000L

  /** Binding the sandbox process (the first start can take a moment). */
  private const val CONNECT_MS = 5_000L
  private const val IDLE_MS = 60_000L

  const val MAX_HEAP_BYTES = 16L * 1024L * 1024L

  /** A call's output, as JSON text (checked in JS before it leaves the isolate, and again here). */
  const val MAX_OUTPUT_CHARS = 256 * 1024

  /** The isolate's limit on an evaluation's result in bytes (UTF-8 of [MAX_OUTPUT_CHARS] characters, or an error). */
  const val MAX_RETURN_BYTES = MAX_OUTPUT_CHARS * 3 + 4096

  /**
   * Without JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT the script travels in one Binder transaction (1 MB shared by
   * the process): a bigger input fails as "input too large" instead of a TransactionTooLargeException.
   */
  const val MAX_SCRIPT_CHARS_BINDER = 400_000

  private val lock = Any()
  private var sandbox: JavaScriptSandbox? = null
  private var connecting: ListenableFuture<JavaScriptSandbox>? = null
  private var users = 0
  private var lastUsed = 0L
  private var idle: ScheduledExecutorService? = null

  @Volatile
  private var supportedCache: Boolean? = null

  /** Android 8.0+ and the WebView provides the sandbox. Cached for the process. Any thread. */
  fun supported(): Boolean {
    val cached = supportedCache
    if (cached != null) return cached
    val s = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && try {
      JavaScriptSandbox.isSupported()
    } catch (t: Throwable) {
      Log.w("JavaScriptSandbox.isSupported failed", t)
      false
    }
    supportedCache = s
    return s
  }

  /**
   * The shared sandbox, connecting it first when needed (waits up to [CONNECT_MS]). Each successful call must be paired
   * with one [release]. Worker threads only.
   */
  fun acquire(ctx: Context): JavaScriptSandbox {
    if (!supported()) throw ProgramError("JavaScriptSandbox isn't supported on this phone")
    if (Looper.getMainLooper().isCurrentThread) throw ProgramError("widget program called on the main thread")
    val future: ListenableFuture<JavaScriptSandbox> = synchronized(lock) {
      users++
      lastUsed = SystemClock.elapsedRealtime()
      val ready = sandbox
      if (ready != null) return ready
      val pending = connecting
      if (pending != null) {
        pending
      } else {
        val created: ListenableFuture<JavaScriptSandbox> = try {
          JavaScriptSandbox.createConnectedInstanceAsync(ctx.applicationContext)
        } catch (t: Throwable) {
          users--
          throw ProgramError("sandbox failed to start (" + t.javaClass.simpleName + ")")
        }
        connecting = created
        created
      }
    }
    try {
      val sb = future.get(CONNECT_MS, TimeUnit.MILLISECONDS) ?: throw ProgramError("sandbox failed to start")
      return synchronized(lock) {
        if (connecting === future) connecting = null
        val cur = sandbox
        if (cur != null) {
          cur
        } else {
          sandbox = sb
          sb
        }
      }
    } catch (e: ProgramError) {
      release()
      throw e
    } catch (e: TimeoutException) {
      // Left in [connecting]: the next acquire waits on the same connection (only one sandbox may exist).
      release()
      throw ProgramError("sandbox start timed out")
    } catch (e: ExecutionException) {
      synchronized(lock) { if (connecting === future) connecting = null }
      release()
      throw ProgramError("sandbox failed to start (" + (e.cause?.javaClass?.simpleName ?: "error") + ")")
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      release()
      throw ProgramError("interrupted")
    } catch (e: CancellationException) {
      synchronized(lock) { if (connecting === future) connecting = null }
      release()
      throw ProgramError("sandbox start cancelled")
    }
  }

  /** The end of one [acquire]: the sandbox closes after [IDLE_MS] without users. */
  fun release() {
    synchronized(lock) {
      if (users > 0) users--
      lastUsed = SystemClock.elapsedRealtime()
    }
    scheduleIdleCheck()
  }

  /**
   * [sb] died (a crash, the memory limit, which takes the whole sandbox down) or runs a script that can't be stopped
   * otherwise: closed (the library asks for close() even on a dead sandbox) and the next acquire starts a new one.
   */
  fun discard(sb: JavaScriptSandbox) {
    val mine = synchronized(lock) {
      if (sandbox === sb) {
        sandbox = null
        true
      } else {
        false
      }
    }
    if (mine) closeQuietly(sb)
  }

  private fun scheduleIdleCheck() {
    try {
      val ex = synchronized(lock) {
        idle ?: Executors.newSingleThreadScheduledExecutor { r ->
          Thread(r, "TypeTorchLive-js-idle").apply { isDaemon = true }
        }.also { idle = it }
      }
      ex.schedule(Runnable { closeIfIdle() }, IDLE_MS + 1_000L, TimeUnit.MILLISECONDS)
    } catch (t: Throwable) {
      Log.w("js idle check failed", t)
    }
  }

  private fun closeIfIdle() {
    var toClose: JavaScriptSandbox? = null
    var orphan: ListenableFuture<JavaScriptSandbox>? = null
    synchronized(lock) {
      if (users > 0) return
      if (SystemClock.elapsedRealtime() - lastUsed < IDLE_MS) return
      toClose = sandbox
      sandbox = null
      val c = connecting
      if (c != null && c.isDone) {
        // A connection that finished after its acquire timed out and nobody took since.
        connecting = null
        orphan = c
      }
    }
    toClose?.let { closeQuietly(it) }
    orphan?.let { f ->
      try {
        val sb: JavaScriptSandbox? = f.get(0L, TimeUnit.MILLISECONDS)
        if (sb != null) closeQuietly(sb)
      } catch (t: Throwable) {
        // failed or cancelled: nothing to close
      }
    }
  }

  private fun closeQuietly(sb: JavaScriptSandbox) {
    try {
      sb.close()
    } catch (t: Throwable) {
      Log.w("sandbox close failed", t)
    }
  }
}

/**
 * The widget program loaded into one isolate, for one batch of work on one worker thread (a refresh of some widgets,
 * a tap, a resize, a live watch poll's redraw); [close] it after (the isolate is closed, the sandbox released).
 * The isolate is created and the program's source evaluated on the first [call]. A call that times out, kills the
 * sandbox or a program that fails to load makes every later call of this session fail at once with the same error
 * (so a hanging program costs one timeout per batch, not one per widget).
 */
internal class ProgramSession(private val app: Context, private val source: String) {
  private var sandbox: JavaScriptSandbox? = null
  private var acquired = false
  private var isolate: JavaScriptIsolate? = null
  private var broken: String? = null
  private var closed = false
  private var noBinderLimit = false
  private var canTerminate = false

  /** The requests `plan` returned per widget in this session ([WidgetProgram.plan]); forgotten when its state changes. */
  val plans = HashMap<Int, List<ProgramRequest>>()

  /**
   * Calls the program's global function [fn] (`plan`, `shape`, `tap`: a constant of ours, never program data) with
   * [input] and returns its result object. Throws [ProgramError] (exception, timeout, bad or too large output).
   */
  @Synchronized
  fun call(fn: String, input: JSONObject): JSONObject {
    val stop = broken
    if (stop != null) throw ProgramError(stop)
    if (closed) throw ProgramError("session closed")
    val iso = isolate ?: open()
    // The input crosses as a JS string literal (pure ASCII, see [jsString]) that the isolate parses with JSON.parse:
    // no program data is ever spliced into code.
    val script = "(function(){var f=globalThis[\"" + fn + "\"];" +
      "if(typeof f!==\"function\")throw new Error(\"" + fn + "() is not defined\");" +
      "var r=f(JSON.parse(" + jsString(input.toString()) + "));" +
      "var s=JSON.stringify(r===undefined?null:r);if(typeof s!==\"string\")s=\"null\";" +
      "if(s.length>" + JsEngine.MAX_OUTPUT_CHARS + ")throw new Error(\"" + fn + "() output over 256 KB\");" +
      "return s;})()"
    if (!noBinderLimit && script.length > JsEngine.MAX_SCRIPT_CHARS_BINDER) throw ProgramError("$fn() input too large")
    val text = evaluate(iso, script, "$fn()")
    if (text.length > JsEngine.MAX_OUTPUT_CHARS) throw ProgramError("$fn() output over 256 KB")
    return try {
      JSONObject(text)
    } catch (t: Throwable) {
      throw ProgramError("$fn() must return an object")
    }
  }

  /** Closes the isolate and releases the sandbox (it closes after 60 s idle). Never throws. */
  @Synchronized
  fun close() {
    if (closed) return
    closed = true
    val iso = isolate
    isolate = null
    try {
      iso?.close()
    } catch (t: Throwable) {
      Log.w("isolate close failed", t)
    }
    if (acquired) {
      acquired = false
      JsEngine.release()
    }
  }

  private fun open(): JavaScriptIsolate {
    val sb = sandbox ?: try {
      JsEngine.acquire(app).also {
        sandbox = it
        acquired = true
      }
    } catch (e: ProgramError) {
      broken = e.message ?: "sandbox failed"
      throw e
    }
    val iso: JavaScriptIsolate
    try {
      val params = IsolateStartupParameters()
      if (sb.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE)) {
        params.setMaxHeapSizeBytes(JsEngine.MAX_HEAP_BYTES)
      }
      if (sb.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT)) {
        noBinderLimit = true
        params.setMaxEvaluationReturnSizeBytes(JsEngine.MAX_RETURN_BYTES)
      }
      canTerminate = sb.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_ISOLATE_TERMINATION)
      iso = sb.createIsolate(params)
    } catch (t: Throwable) {
      val msg = "isolate failed (" + t.javaClass.simpleName + ")"
      broken = msg
      JsEngine.discard(sb)
      throw ProgramError(msg)
    }
    isolate = iso
    if (!noBinderLimit && source.length > JsEngine.MAX_SCRIPT_CHARS_BINDER) {
      val msg = "program too large for this phone's sandbox"
      broken = msg
      throw ProgramError(msg)
    }
    try {
      // The program's functions are globals (function declarations of a classic script). The trailing "" makes the
      // evaluation's value a string whatever the source ends with.
      evaluate(iso, source + "\n;\"\"", "program")
    } catch (e: ProgramError) {
      val msg = e.message ?: "program failed to load"
      broken = msg
      throw ProgramError(msg)
    }
    return iso
  }

  /** Evaluates [script] within [JsEngine.CALL_MS]; [what] names it in errors. */
  private fun evaluate(iso: JavaScriptIsolate, script: String, what: String): String {
    val future: ListenableFuture<String> = try {
      iso.evaluateJavaScriptAsync(script)
    } catch (t: Throwable) {
      val msg = "$what: " + t.javaClass.simpleName
      broken = msg
      kill(true)
      throw ProgramError(msg)
    }
    try {
      val out: String? = future.get(JsEngine.CALL_MS, TimeUnit.MILLISECONDS)
      return out ?: ""
    } catch (e: TimeoutException) {
      future.cancel(true)
      val msg = "$what timed out (2 s)"
      broken = msg
      kill(false)
      throw ProgramError(msg)
    } catch (e: ExecutionException) {
      val cause = e.cause
      if (cause is IsolateTerminatedException) {
        // The memory limit (it takes the whole sandbox down), a crash, or the sandbox died.
        val msg = "$what: " + (firstLine(cause.message) ?: cause.javaClass.simpleName)
        broken = msg
        kill(true)
        throw ProgramError(msg)
      }
      throw ProgramError(firstLine(cause?.message) ?: "$what: " + (cause?.javaClass?.simpleName ?: "error"))
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      broken = "interrupted"
      kill(false)
      throw ProgramError("interrupted")
    } catch (e: CancellationException) {
      broken = "$what cancelled"
      kill(false)
      throw ProgramError("$what cancelled")
    }
  }

  /**
   * Drops the isolate. The sandbox goes too when it died ([dead]) or when this WebView can't terminate a running
   * script by closing its isolate (JS_FEATURE_ISOLATE_TERMINATION), so a runaway loop doesn't keep a core busy.
   */
  private fun kill(dead: Boolean) {
    val iso = isolate
    isolate = null
    try {
      iso?.close()
    } catch (t: Throwable) {
      Log.w("isolate close failed", t)
    }
    val sb = sandbox
    if (sb != null && (dead || !canTerminate)) JsEngine.discard(sb)
  }

  companion object {
    /** The first line of [s], at most 200 characters; null when blank. */
    fun firstLine(s: String?): String? {
      if (s == null) return null
      val line = s.trim().lineSequence().firstOrNull()?.trim().orEmpty()
      if (line.isEmpty()) return null
      return if (line.length > 200) line.substring(0, 200) + "…" else line
    }

    /** [s] as a double-quoted JS string literal in pure ASCII: quotes, backslashes and every other character escaped. */
    fun jsString(s: String): String {
      val sb = StringBuilder(s.length + s.length / 8 + 2)
      sb.append('"')
      for (ch in s) {
        val c = ch.code
        when {
          ch == '"' -> sb.append("\\\"")
          ch == '\\' -> sb.append("\\\\")
          c in 0x20..0x7E -> sb.append(ch)
          else -> {
            sb.append("\\u")
            sb.append(HEX[(c shr 12) and 0xF])
            sb.append(HEX[(c shr 8) and 0xF])
            sb.append(HEX[(c shr 4) and 0xF])
            sb.append(HEX[c and 0xF])
          }
        }
      }
      sb.append('"')
      return sb.toString()
    }

    private const val HEX = "0123456789abcdef"
  }
}
