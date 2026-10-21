package com.dogtracker.location

/**
 * What the 「手機位置記錄」 notification says, in a few user-facing states. The
 * pipeline's own reasons (accuracy thresholds, stale or duplicate fixes, write
 * errors) stay in 診斷 and dumpsys; they only decide which state this is.
 */
internal enum class RecordingNotice {
  RECORDING, NEEDS_PRECISE_LOCATION, LOCATION_OFF, POOR_SIGNAL, CANNOT_START;

  fun text(): String = com.dogtracker.NativeCopy.text(when (this) {
    RECORDING -> com.dogtracker.R.string.c1129
    NEEDS_PRECISE_LOCATION -> com.dogtracker.R.string.c1131
    LOCATION_OFF -> com.dogtracker.R.string.c1425
    POOR_SIGNAL -> com.dogtracker.R.string.c1426
    CANNOT_START -> com.dogtracker.R.string.c1427
  })

  companion object {
    /** No accepted fix for this long (from the start, or since the last one) is a poor signal. */
    const val POOR_SIGNAL_AFTER_SECONDS = 30.0

    /**
     * The state while recording. [sinceAcceptedSeconds] is the age of the newest
     * accepted fix, or null before the first one, then [sinceStartSeconds] counts.
     * Failing to save a row is retried every second and is not a state of its own.
     * [lowPower]: the recorder asks for a fix about every 30 s on a held stop
     * (StationaryPowerMode): poor only after two of them are missed as well.
     */
    fun during(locationOn: Boolean, sinceAcceptedSeconds: Double?, sinceStartSeconds: Double,
      lowPower: Boolean = false): RecordingNotice = when {
      !locationOn -> LOCATION_OFF
      (sinceAcceptedSeconds ?: sinceStartSeconds) > POOR_SIGNAL_AFTER_SECONDS +
        (if (lowPower) 2 * StationaryPowerMode.LOW_INTERVAL_MS / 1000.0 else 0.0) -> POOR_SIGNAL
      else -> RECORDING
    }
  }
}
