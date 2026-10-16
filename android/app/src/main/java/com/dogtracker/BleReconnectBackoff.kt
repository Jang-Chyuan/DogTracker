package com.dogtracker

/** Monotonic failure duration; subscription, not merely a GATT link, resets it. */
internal class BleReconnectBackoff {
  private var firstFailure: Long? = null
  private var attempt = 0
  fun reset() { firstFailure = null; attempt = 0 }
  fun next(now: Long, override: Long? = null): Long {
    val since = firstFailure ?: now.also { firstFailure = it }
    val short = override ?: minOf(2_000L * (1L shl minOf(attempt, 4)), 30_000L)
    attempt = minOf(attempt + 1, 4)
    return when {
      now - since >= 20 * 60_000L -> maxOf(short, 300_000L)
      now - since >= 10 * 60_000L -> maxOf(short, 120_000L)
      else -> short
    }
  }
}

/** Why the receiver is not receiving, as far as the user can act on it (the notification's words). */
internal enum class ReceiverProblem { NONE, BLUETOOTH_OFF, NEEDS_PERMISSION, BAD_CONFIG, NO_DATA }

/**
 * The receiver's 「常駐」 notification text in field words (design 「常駐通知」:
 * 用現場用語). The service's internal status strings (GATT steps, error
 * messages, delays) stay out of it (they remain in 診斷 and dumpsys); every
 * internal state maps to one of a few sentences, with the fix where there is
 * one. Only a widened wait after a long outage is said, in minutes.
 */
internal object ReceiverNotificationText {
  fun of(
    connected: Boolean, disconnected: Boolean, retryDelayMs: Long,
    problem: ReceiverProblem = ReceiverProblem.NONE, lastDataAtMs: Long = 0L,
    zone: java.util.TimeZone = java.util.TimeZone.getDefault(),
  ): String = when {
    problem == ReceiverProblem.BAD_CONFIG -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1423)
    problem == ReceiverProblem.NEEDS_PERMISSION -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1422)
    problem == ReceiverProblem.BLUETOOTH_OFF -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1421)
    connected && lastDataAtMs > 0L -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1420, clock(lastDataAtMs, zone))
    connected -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1112)
    disconnected && retryDelayMs >= 60_000L -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1113, retryDelayMs / 60_000L)
    // A timeout or a silent link, being retried within the minute.
    problem == ReceiverProblem.NO_DATA && retryDelayMs < 60_000L -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1424)
    disconnected -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1114)
    // Never connected this time, and the wait has widened after long failures.
    retryDelayMs >= 60_000L -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1115, retryDelayMs / 60_000L)
    else -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1116)
  }

  private fun clock(at: Long, zone: java.util.TimeZone) =
    java.text.SimpleDateFormat("HH:mm", java.util.Locale.TAIWAN).apply { timeZone = zone }.format(java.util.Date(at))
}
