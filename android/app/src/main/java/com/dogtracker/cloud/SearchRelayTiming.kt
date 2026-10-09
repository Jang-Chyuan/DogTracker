package com.dogtracker.cloud

internal object SearchRelayTiming {
  const val ACTIVE_TIMEOUT_MS = 26_000L
  // null means no work: stop, rather than launching an empty JS pass.
  fun waitMs(nextRetry: Long?, now: Long, cooldownRemaining: Long = 0): Long? =
    nextRetry?.let { maxOf(0L, it - now, cooldownRemaining) }
}
