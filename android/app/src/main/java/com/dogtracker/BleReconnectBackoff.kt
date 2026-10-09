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
