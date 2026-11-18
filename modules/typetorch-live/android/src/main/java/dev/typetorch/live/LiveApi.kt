package dev.typetorch.live

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

internal sealed class FetchResult {
  /** [raw]: the answer's text (the widget program's cache keeps the live watch's polls). */
  class Ok(val data: LiveData, val raw: String? = null) : FetchResult()

  /** 401: the mobile token is dead (`{ "error": "mobile_token_dead" }`). */
  object SignedOut : FetchResult()

  /** Network, HTTP or parse error. [reason] never holds the token. */
  class Failed(val reason: String) : FetchResult()
}

/** A widget program request's outcome: [code] 0 = no HTTP answer; [body] the 2xx text; [tokenDead] a dead-token 401. */
internal class RawResult(val code: Int, val body: String?, val error: String?, val tokenDead: Boolean)

/**
 * `GET {url}/v1/mobile/live?minutes=N[&metrics=a,b,c]` (docs/WIDGET_STATS.md: an older backend ignores `metrics`).
 * Blocking: call it on a worker thread only. Never throws.
 */
internal object LiveApi {
  private const val TIMEOUT_MS = 10_000
  private const val MAX_BYTES = 2 * 1024 * 1024

  fun fetch(baseUrl: String, token: String, minutes: Int, metrics: List<String> = emptyList()): FetchResult {
    var conn: HttpURLConnection? = null
    try {
      val base = baseUrl.trim().trimEnd('/')
      if (!base.startsWith("https://", ignoreCase = true) && !base.startsWith("http://", ignoreCase = true)) {
        return FetchResult.Failed("bad url")
      }
      val ids = metrics.filter { it.isNotBlank() }.distinct().take(12)
      val query = if (ids.isEmpty()) "" else "&metrics=" + ids.joinToString(",") { URLEncoder.encode(it, "UTF-8") }
      val url = URL("$base/v1/mobile/live?minutes=${minutes.coerceIn(1, 360)}$query")
      val c = url.openConnection() as HttpURLConnection
      conn = c
      c.connectTimeout = TIMEOUT_MS
      c.readTimeout = TIMEOUT_MS
      c.requestMethod = "GET"
      // A redirect could carry the bearer token to another host: never follow one.
      c.instanceFollowRedirects = false
      c.useCaches = false
      c.setRequestProperty("Authorization", "Bearer $token")
      c.setRequestProperty("Accept", "application/json")
      val code = c.responseCode
      if (code == 401) return FetchResult.SignedOut
      if (code !in 200..299) return FetchResult.Failed("http $code")
      val text = c.inputStream.use { readLimited(it) } ?: return FetchResult.Failed("too large")
      val data = LiveData.parse(text) ?: return FetchResult.Failed("bad json")
      return FetchResult.Ok(data, text)
    } catch (t: Throwable) {
      // Only the class name: some exception messages quote request headers (the token).
      return FetchResult.Failed(t.javaClass.simpleName)
    } finally {
      try {
        conn?.disconnect()
      } catch (ignored: Throwable) {
      }
    }
  }

  /**
   * A widget program's request (docs/WIDGET_PROGRAM.md): `GET {url}{pathAndQuery}` with the backend's token, no
   * redirects, 10 s timeouts, at most 2 MB. [pathAndQuery] is already checked (`/v1/…`, encoded query), so the host
   * can't change. A 401's body is read (16 KB) only to tell a dead token (`mobile_token_dead`). Blocking: worker
   * threads only. Never throws; [RawResult.error] never holds the token.
   */
  fun get(baseUrl: String, token: String, pathAndQuery: String): RawResult {
    var conn: HttpURLConnection? = null
    try {
      val base = baseUrl.trim().trimEnd('/')
      if (!base.startsWith("https://", ignoreCase = true) && !base.startsWith("http://", ignoreCase = true)) {
        return RawResult(0, null, "bad url", false)
      }
      if (!pathAndQuery.startsWith("/v1/")) return RawResult(0, null, "bad path", false)
      val url = URL(base + pathAndQuery)
      if (!url.host.equals(URL(base).host, ignoreCase = true)) return RawResult(0, null, "bad url", false)
      val c = url.openConnection() as HttpURLConnection
      conn = c
      c.connectTimeout = TIMEOUT_MS
      c.readTimeout = TIMEOUT_MS
      c.requestMethod = "GET"
      c.instanceFollowRedirects = false
      c.useCaches = false
      c.setRequestProperty("Authorization", "Bearer $token")
      c.setRequestProperty("Accept", "application/json")
      val code = c.responseCode
      if (code == 401) {
        val text = try {
          c.errorStream?.use { readLimited(it, 16 * 1024) }
        } catch (t: Throwable) {
          null
        }
        return RawResult(code, null, "http 401", text?.contains("mobile_token_dead") == true)
      }
      if (code !in 200..299) return RawResult(code, null, "http $code", false)
      val text = c.inputStream.use { readLimited(it) } ?: return RawResult(code, null, "too large", false)
      return RawResult(code, text, null, false)
    } catch (t: Throwable) {
      return RawResult(0, null, t.javaClass.simpleName, false)
    } finally {
      try {
        conn?.disconnect()
      } catch (ignored: Throwable) {
      }
    }
  }

  private fun readLimited(input: InputStream, max: Int = MAX_BYTES): String? {
    val out = ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (true) {
      val n = input.read(buf)
      if (n < 0) break
      if (out.size() + n > max) return null
      out.write(buf, 0, n)
    }
    return String(out.toByteArray(), Charsets.UTF_8)
  }
}
