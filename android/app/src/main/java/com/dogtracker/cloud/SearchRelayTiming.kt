package com.dogtracker.cloud

internal object SearchRelayTiming {
  // Retry React startup without a busy loop or an active-pass wake lock.
  fun reactWaitMs(attempt: Int): Long = 1000L shl attempt.coerceIn(0, 4)
  const val ACTIVE_TIMEOUT_MS = 26_000L
  // null means no work: stop, rather than launching an empty JS pass.
  fun waitMs(nextRetry: Long?, now: Long, cooldownRemaining: Long = 0): Long? =
    nextRetry?.let { maxOf(0L, it - now, cooldownRemaining) }
}
