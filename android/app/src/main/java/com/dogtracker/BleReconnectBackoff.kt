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

/**
 * The receiver's 「常駐」 notification text in field words (design 「常駐通知」:
 * 用現場用語). The service's internal status strings (GATT steps, delays) stay
 * out of it; only a widened wait after a long outage is said, in minutes.
 */
internal object ReceiverNotificationText {
  fun of(connected: Boolean, disconnected: Boolean, retryDelayMs: Long): String = when {
    connected -> "正在接收狗的位置"
    disconnected && retryDelayMs >= 60_000L -> "斷線了，${retryDelayMs / 60_000L} 分鐘後再試著連線"
    disconnected -> "斷線了，正在自動重連"
    else -> "正在連線接收器"
  }
}
