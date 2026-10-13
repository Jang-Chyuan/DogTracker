package com.dogtracker.location

/**
 * Why no row was saved (PR 116): each stretch of at least [minNanos] without a
 * saved row keeps what the provider and the pipeline did meanwhile — fixes
 * received, accepted, rejected by cause, the oldest stale fix and the best
 * rejected accuracy, and how many accuracy rejections still went to the
 * motion detector ([LocationPipeline.motionOnly]). Counts and times only, never a position. Read on a
 * release build with
 * `adb shell dumpsys activity service com.dogtracker/.location.LocationTrackerService`.
 */
internal class SaveGapLog(private val minNanos: Long = 60_000_000_000L, private val capacity: Int = 300) {
  data class Stretch(val startWallMs: Long, val endWallMs: Long?, val seconds: Long, val received: Int,
    val accepted: Int, val rejectedBy: Map<String, Int>, val writeErrors: Int,
    val maxStaleSeconds: Double?, val bestRejectedAccuracy: Float?, val motionOnly: Int = 0)

  private class Mark(val nanos: Long, val wallMs: Long, val received: Int, val accepted: Int,
    val rejectedBy: Map<String, Int>, val writeErrors: Int, val motionOnly: Int)

  private val done = ArrayDeque<Stretch>()
  private var mark: Mark? = null

  /** The recording started, or a row was saved: a new stretch begins now.
   * Returns the stretch this ended, when it was long enough to keep. */
  fun saved(nowNanos: Long, wallMs: Long, pipeline: LocationPipeline, writeErrors: Int): Stretch? {
    val ended = stretch(nowNanos, wallMs, pipeline, writeErrors, ended = true)?.also {
      done.addLast(it)
      while (done.size > capacity) done.removeFirst()
    }
    mark = Mark(nowNanos, wallMs, pipeline.received, pipeline.accepted, LinkedHashMap(pipeline.rejectedBy), writeErrors,
      pipeline.motionOnly)
    pipeline.markWindow()
    return ended
  }

  /** The current stretch, if it is already long. */
  fun ongoing(nowNanos: Long, wallMs: Long, pipeline: LocationPipeline, writeErrors: Int): Stretch? =
    stretch(nowNanos, wallMs, pipeline, writeErrors, ended = false)

  /** Finished stretches, then the current one if it is already long. */
  fun snapshot(nowNanos: Long, wallMs: Long, pipeline: LocationPipeline, writeErrors: Int): List<Stretch> =
    done.toList() + listOfNotNull(ongoing(nowNanos, wallMs, pipeline, writeErrors))

  private fun stretch(nowNanos: Long, wallMs: Long, pipeline: LocationPipeline, writeErrors: Int, ended: Boolean): Stretch? {
    val from = mark ?: return null
    if (nowNanos - from.nanos < minNanos) return null
    return Stretch(from.wallMs, if (ended) wallMs else null, (nowNanos - from.nanos) / 1_000_000_000L,
      pipeline.received - from.received, pipeline.accepted - from.accepted,
      pipeline.rejectedBy.mapValues { (cause, n) -> n - (from.rejectedBy[cause] ?: 0) }.filterValues { it > 0 },
      writeErrors - from.writeErrors, pipeline.windowMaxStaleSeconds, pipeline.windowBestRejectedAccuracy,
      pipeline.motionOnly - from.motionOnly)
  }
}
