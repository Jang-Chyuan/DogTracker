package com.dogtracker.location

import org.json.JSONArray
import org.json.JSONObject

/**
 * [SaveGapLog] survives the process (PR 116): a night's counts must still be
 * there after Android or the user ends the app. Stored in app-private
 * preferences, bounded (the last [maxRuns] recordings and [maxStretches]
 * stretches), counts and times only — never a position. The running
 * recording is checkpointed; a recording found unfinished at the next start
 * ended with its process (no onDestroy), at its last checkpoint.
 */
internal class SaveGapHistory(private val store: Store, private val maxRuns: Int = 30, private val maxStretches: Int = 200) {
  interface Store { fun get(): String?; fun put(value: String, now: Boolean = false) }

  data class Counters(val received: Int, val accepted: Int, val rejectedBy: Map<String, Int>, val saved: Int, val writeErrors: Int)

  private var state = load()

  private fun load(): JSONObject = try {
    store.get()?.let(::JSONObject) ?: JSONObject()
  } catch (_: Exception) { JSONObject() }
  private fun array(name: String) = state.optJSONArray(name) ?: JSONArray().also { state.put(name, it) }
  private fun append(name: String, value: JSONObject, max: Int) {
    val list = array(name); list.put(value)
    while (list.length() > max) list.remove(0)
  }
  private fun save(now: Boolean = false) = store.put(state.toString(), now)

  /** A recording starts: close one its process left unfinished. */
  fun begin(startedAtMs: Long) {
    state.optJSONObject("current")?.let { previous ->
      previous.optJSONObject("ongoing")?.let { append("stretches", it.put("cutByProcessEnd", true), maxStretches) }
      previous.remove("ongoing")
      append("runs", previous.put("end", "process ended without stopping (last checkpoint)"), maxRuns)
    }
    state.put("current", JSONObject().put("startedAtMs", startedAtMs).put("checkpointAtMs", startedAtMs))
    save(now = true)
  }

  /** The running recording's counters and any long stretch still going. */
  fun checkpoint(wallMs: Long, counters: Counters, ongoing: SaveGapLog.Stretch?) {
    val current = state.optJSONObject("current") ?: return
    current.put("checkpointAtMs", wallMs).put("counters", json(counters))
    if (ongoing != null) current.put("ongoing", json(ongoing).put("lastSeenMs", wallMs)) else current.remove("ongoing")
    save()
  }

  fun stretchDone(stretch: SaveGapLog.Stretch) { append("stretches", json(stretch), maxStretches); save() }

  /** The recording was stopped (onDestroy). */
  fun end(wallMs: Long, counters: Counters) {
    val current = state.optJSONObject("current") ?: return
    current.remove("ongoing")
    append("runs", current.put("checkpointAtMs", wallMs).put("counters", json(counters)).put("end", "stopped"), maxRuns)
    state.remove("current")
    save(now = true)
  }

  /** dumpsys lines, oldest first. */
  fun lines(format: (Long) -> String): List<String> {
    val out = mutableListOf<String>()
    val runs = array("runs")
    for (i in 0 until runs.length()) out += "  run ${run(runs.getJSONObject(i), format)}"
    state.optJSONObject("current")?.let { out += "  run (this one) ${run(it, format)}" }
    val stretches = array("stretches")
    for (i in 0 until stretches.length()) out += "  stretch ${stretch(stretches.getJSONObject(i), format)}"
    return out
  }

  private fun run(o: JSONObject, format: (Long) -> String) =
    "${format(o.optLong("startedAtMs"))} -> ${format(o.optLong("checkpointAtMs"))} ${o.optString("end", "running")} " +
      (o.optJSONObject("counters")?.toString() ?: "{}")
  private fun stretch(o: JSONObject, format: (Long) -> String) =
    "${format(o.optLong("startWallMs"))} -> ${if (o.has("endWallMs")) format(o.optLong("endWallMs")) else format(o.optLong("lastSeenMs")) + "+"} " +
      "${o.optLong("seconds")}s received=${o.optInt("received")} accepted=${o.optInt("accepted")} " +
      "rejected=${o.optJSONObject("rejectedBy") ?: "{}"} writeErrors=${o.optInt("writeErrors")}" +
      (if (o.has("maxStaleSeconds")) " maxStale=${"%.1f".format(o.getDouble("maxStaleSeconds"))}s" else "") +
      (if (o.has("bestRejectedAccuracy")) " bestRejectedAccuracy=${o.getDouble("bestRejectedAccuracy")}m" else "") +
      (if (o.optBoolean("cutByProcessEnd")) " (process ended)" else "")

  private fun json(c: Counters) = JSONObject().put("received", c.received).put("accepted", c.accepted)
    .put("rejectedBy", JSONObject(c.rejectedBy)).put("saved", c.saved).put("writeErrors", c.writeErrors)
  private fun json(s: SaveGapLog.Stretch) = JSONObject().put("startWallMs", s.startWallMs).apply {
    if (s.endWallMs != null) put("endWallMs", s.endWallMs)
    if (s.maxStaleSeconds != null) put("maxStaleSeconds", s.maxStaleSeconds)
    if (s.bestRejectedAccuracy != null) put("bestRejectedAccuracy", s.bestRejectedAccuracy.toDouble())
  }.put("seconds", s.seconds).put("received", s.received).put("accepted", s.accepted)
    .put("rejectedBy", JSONObject(s.rejectedBy)).put("writeErrors", s.writeErrors)
}
