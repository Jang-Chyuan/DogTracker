package com.dogtracker

import org.json.JSONArray
import org.json.JSONObject

/**
 * How a foreground service's starts went, kept across process ends for
 * dumpsys: whether it was the system's START_STICKY restart after the process
 * ended (a null intent) or an ordinary start, and whether it ran or the
 * system refused it. Android 12+ may refuse a foreground service started
 * while the app is in the background, a sticky restart included
 * (ForegroundServiceStartNotAllowedException; Android 14 a SecurityException
 * for a type that needs a while-in-use permission). Counts, times and
 * exception class names only — never a position or an address.
 */
internal class ServiceStartLog(private val store: Store, private val max: Int = 20) {
  interface Store { fun get(): String?; fun put(value: String) }

  enum class Kind(val label: String) { START("start"), RESTART("restart") }

  companion object {
    /** A START_STICKY restart re-delivers no intent. */
    fun kindOf(intentWasNull: Boolean) = if (intentWasNull) Kind.RESTART else Kind.START
  }

  private var state = try { store.get()?.let(::JSONObject) ?: JSONObject() } catch (_: Exception) { JSONObject() }

  val restarts get() = state.optInt("restarts")
  val failures get() = state.optInt("failures")

  private fun add(entry: JSONObject) {
    val list = state.optJSONArray("entries") ?: JSONArray().also { state.put("entries", it) }
    list.put(entry)
    while (list.length() > max) list.remove(0)
    store.put(state.toString())
  }

  private fun counted(kind: Kind, failed: Boolean) {
    if (kind == Kind.RESTART) state.put("restarts", restarts + 1)
    if (failed) state.put("failures", failures + 1)
  }

  @Synchronized fun started(kind: Kind, wallMs: Long) {
    counted(kind, false)
    add(JSONObject().put("at", wallMs).put("kind", kind.label).put("outcome", "started"))
  }

  @Synchronized fun failed(kind: Kind, wallMs: Long, error: Throwable) {
    counted(kind, true)
    add(JSONObject().put("at", wallMs).put("kind", kind.label).put("outcome", "refused")
      .put("error", error.javaClass.simpleName).put("message", (error.message ?: "").take(160)))
  }

  /** Something later in a run worth keeping, e.g. a restart that got no fixes. */
  @Synchronized fun note(wallMs: Long, text: String) = add(JSONObject().put("at", wallMs).put("note", text))

  /**
   * Runs [start] (the service's startForeground); a refusal is recorded and
   * returned instead of ending the process.
   */
  fun attempt(kind: Kind, wallMs: Long, start: () -> Unit): Exception? = try {
    start(); started(kind, wallMs); null
  } catch (error: Exception) { failed(kind, wallMs, error); error }

  /** dumpsys lines, oldest first. */
  @Synchronized fun lines(format: (Long) -> String): List<String> {
    val out = mutableListOf("starts: restarts=$restarts refused=$failures (kept across process ends, oldest first)")
    val list = state.optJSONArray("entries") ?: JSONArray()
    for (i in 0 until list.length()) {
      val o = list.getJSONObject(i)
      out += "  ${format(o.optLong("at"))} " + if (o.has("note")) o.optString("note")
        else "${o.optString("kind")} ${o.optString("outcome")}" +
          (if (o.has("error")) " ${o.optString("error")}: ${o.optString("message")}" else "")
    }
    return out
  }
}

internal object ServiceStarts {
  const val BLE = "ble"
  const val LOCATION = "location"

  /** Both services' starts, for either one's dumpsys (a refused one is not running to dump its own). */
  fun lines(context: android.content.Context, format: (Long) -> String): List<String> =
    listOf(BLE to "receiver", LOCATION to "phone recording").flatMap { (name, label) ->
      val lines = runCatching { context.serviceStartLog(name).lines(format) }.getOrDefault(emptyList())
      lines.mapIndexed { i, line -> if (i == 0) "$label $line" else line }
    }
}

/** The app-private preferences one service's [ServiceStartLog] lives in. */
internal fun android.content.Context.serviceStartLog(name: String): ServiceStartLog {
  val preferences = getSharedPreferences("service_starts", 0)
  return ServiceStartLog(object : ServiceStartLog.Store {
    override fun get() = preferences.getString(name, null)
    // commit: a refused restart is often the last thing its process does.
    override fun put(value: String) { preferences.edit().putString(name, value).commit() }
  })
}
