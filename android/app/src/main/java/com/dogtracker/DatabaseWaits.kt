package com.dogtracker

/**
 * How long the native writers (BLE packets, the phone route) waited for the
 * one database lock, and how long each kind of work held it (稽核 A F3).
 * Milliseconds and counts only, never SQL or values. dumpsys prints [lines].
 *
 * The time comes from the caller, so JVM tests drive it directly.
 */
class DatabaseWaits(private val window: Int = 512) {
  private class Series(window: Int) {
    val recent = LongArray(window)
    var count = 0L
    var max = 0L
    var over1s = 0L
    var over5s = 0L
    var over15s = 0L
    fun add(ms: Long) {
      recent[(count % recent.size).toInt()] = ms
      count++
      if (ms > max) max = ms
      if (ms >= 1_000) over1s++
      if (ms >= 5_000) over5s++
      if (ms >= 15_000) over15s++
    }
    fun summary(): Summary {
      val n = minOf(count, recent.size.toLong()).toInt()
      val sorted = recent.copyOf(n).also { it.sort() }
      fun q(p: Double) = if (n == 0) 0L else sorted[((n - 1) * p).toInt()]
      return Summary(count, q(0.5), q(0.95), max, over1s, over5s, over15s)
    }
  }

  /** p50/p95 cover the most recent `window` samples; max and the counts cover the whole process. */
  data class Summary(val count: Long, val p50: Long, val p95: Long, val max: Long,
    val over1s: Long, val over5s: Long, val over15s: Long)

  private val waits = linkedMapOf<String, Series>()
  private val holds = linkedMapOf<String, Series>()
  private var oversizedReads = 0L

  @Synchronized fun waited(writer: String, ms: Long) = waits.getOrPut(writer) { Series(window) }.add(maxOf(0, ms))
  @Synchronized fun held(work: String, ms: Long) = holds.getOrPut(work) { Series(window) }.add(maxOf(0, ms))
  /** A read too large for one cursor window: it ran again holding the lock (as every read did before). */
  @Synchronized fun oversizedRead() { oversizedReads++ }
  @Synchronized fun wait(writer: String): Summary? = waits[writer]?.summary()
  @Synchronized fun hold(work: String): Summary? = holds[work]?.summary()

  @Synchronized fun lines(): List<String> {
    fun text(name: String, s: Summary) = "$name n=${s.count} p50=${s.p50}ms p95=${s.p95}ms max=${s.max}ms " +
      ">=1s=${s.over1s} >=5s=${s.over5s} >=15s=${s.over15s}"
    return buildList {
      add("database lock waits (last $window for p50/p95):")
      if (waits.isEmpty()) add("  none yet")
      for ((name, series) in waits) add("  " + text(name, series.summary()))
      add("database lock holds:")
      if (holds.isEmpty()) add("  none yet")
      for ((name, series) in holds) add("  " + text(name, series.summary()))
      add("reads re-run under the lock (too large for one cursor window): $oversizedReads")
    }
  }
}
