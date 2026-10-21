package com.dogtracker.location

/**
 * Whether the phone recorder asks for high-accuracy or low-power fixes
 * (2026-10-21, user). On the user's phone, 11.5 h on battery: DogTracker was
 * the top app, 350 mAh, 312 of them GNSS, with the request at HIGH_ACCURACY
 * 1 s all day; Samsung stops GPS by itself only with the screen off.
 *
 * - HIGH (every start): high accuracy, 1 s ([LocationSource.fusedRequest]).
 * - LOW: balanced power, about every [LOW_INTERVAL_MS]. Entered once the
 *   motion detector has called the phone stationary for [DOWNSHIFT_AFTER_NANOS]
 *   on fresh fixes and the recorder has been in HIGH at least
 *   [HIGH_DWELL_NANOS] (after its start or the last LOW), so a stay is
 *   confirmed and saved at full rate before anything changes and the mode
 *   cannot flap: every return to HIGH restarts the detector (it needs 20 s
 *   to confirm a stop again) and the dwell.
 * - Back to HIGH at once on the significant-motion sensor, on a low-power fix
 *   that left the stop or measures a reliable speed (LocationPipeline), on
 *   [SILENCE_NANOS] without a usable low-power fix, or when the request fails.
 * Pure (JUnit); LocationTrackerService does the Android calls, all on its
 * worker thread.
 */
internal class StationaryPowerMode(startedNanos: Long) {
  companion object {
    const val LOW_INTERVAL_MS = 30_000L
    const val DOWNSHIFT_AFTER_NANOS = 180_000_000_000L
    const val HIGH_DWELL_NANOS = 180_000_000_000L
    /** LOW with no usable (saved) fix this long: back to HIGH to look. */
    const val SILENCE_NANOS = 300_000_000_000L
    /** The live snapshot's "last position expired" in LOW: the fix age limit and two low-power intervals. */
    const val LOW_FRESH_NANOS = LocationPipeline.MAX_FIX_AGE_NANOS + 2 * LOW_INTERVAL_MS * 1_000_000L
  }

  enum class Exit(val label: String) {
    SIGNIFICANT_MOTION("significant-motion"), LEFT_STOP("left-stop"), SPEED("speed"),
    SILENCE("silence"), REQUEST_FAILED("request-failed"),
  }

  var low = false; private set
  private var highSince = startedNanos
  private var lowSince = 0L
  private var lowNanos = 0L
  var downshifts = 0; private set
  val exits = linkedMapOf<String, Int>()

  /**
   * In HIGH: whether to go LOW now. [stationarySince] is when the detector's
   * current stationary run began (null while it is not stationary);
   * [judgedAt] the newest fix it judged (its monotonic time).
   */
  fun shouldDownshift(nowNanos: Long, stationarySince: Long?, judgedAt: Long?): Boolean =
    !low && stationarySince != null && judgedAt != null &&
      nowNanos - judgedAt <= LocationPipeline.MAX_FIX_AGE_NANOS &&
      nowNanos - stationarySince >= DOWNSHIFT_AFTER_NANOS && nowNanos - highSince >= HIGH_DWELL_NANOS

  fun enterLow(nowNanos: Long) {
    if (low) return
    low = true; lowSince = nowNanos; downshifts++
  }

  /** In LOW: [lastUsable] is the newest usable low-power fix (or the downshift's fix). */
  fun silent(nowNanos: Long, lastUsable: Long): Boolean = low && nowNanos - lastUsable > SILENCE_NANOS

  /** Back to HIGH; false when already there. */
  fun exitLow(nowNanos: Long, reason: Exit): Boolean {
    if (!low) return false
    low = false; highSince = nowNanos; lowNanos += nowNanos - lowSince
    exits[reason.label] = (exits[reason.label] ?: 0) + 1
    return true
  }

  /** Time spent in LOW so far (diagnostics: the battery estimate). */
  fun lowSeconds(nowNanos: Long): Long = (lowNanos + if (low) nowNanos - lowSince else 0L) / 1_000_000_000L
}
