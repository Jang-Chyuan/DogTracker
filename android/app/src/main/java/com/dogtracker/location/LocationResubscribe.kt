package com.dogtracker.location

/**
 * When the recorder asks for location updates again because none arrived.
 *
 * Right after `am force-stop` (or any process death) and an immediate
 * relaunch, Play services can still be dropping the dead process's request
 * while the new one registers: the new service then gets no callback at all
 * (received=0 for minutes) although Play services keeps the GPS on for it and
 * receives fixes itself. The map showed no 「手機」 or a fix that never
 * updated; switching 位置記錄 off and on (a new request in the same process)
 * fixed it at once, and so did waiting 5–8 s before relaunching.
 *
 * So while nothing arrives the request is made again: first [FIRST_MS] after
 * the start or the last fix, then each wait doubles up to [MAX_MS] (indoors
 * without any fix it stays cheap). Any fix resets the schedule.
 * Pure (JUnit); LocationTrackerService does the Android calls.
 */
class LocationResubscribe(startedAtNanos: Long) {
  companion object {
    const val FIRST_MS = 15_000L
    const val MAX_MS = 120_000L
  }
  private var quietSince = startedAtNanos
  private var attempts = 0

  /** A fix arrived (any provider, accepted or not): the request works. */
  fun received(nowNanos: Long) {
    quietSince = nowNanos
    attempts = 0
  }

  /** How long to wait in silence before the next request (ms). */
  fun waitMs(): Long = minOf(MAX_MS, FIRST_MS shl minOf(attempts, 10))

  /** True when a new request is due now; the caller then re-registers. */
  fun due(nowNanos: Long): Boolean {
    if ((nowNanos - quietSince) / 1_000_000L < waitMs()) return false
    quietSince = nowNanos
    attempts += 1
    total += 1
    return true
  }

  /** Requests made again since the last fix. */
  val resubscribed: Int get() = attempts
  /** Requests made again since the start (diagnostics). */
  var total = 0
    private set
}
