package com.dogtracker

/**
 * When the user switched this phone's receiver off (BleBackground.stop) and
 * when it was receiving again afterwards, kept in the "ble_session" prefs and
 * reported by getState() as `receiverPauses`. The map uses them so dogs do not
 * turn 「沒有新位置」 while the user has disconnected on purpose, and get a
 * grace period after reconnecting (design v3 判定表「中斷連線時的狀態」). Plain
 * text "pausedAt:resumedAt,..." (resumedAt 0 = still off), oldest first, the
 * last MAX entries only. Pure, so it is unit-tested without Android.
 */
object ReceiverPauses {
  const val KEY = "receiverPauses"
  const val MAX = 8

  data class Pause(val pausedAt: Long, val resumedAt: Long)

  fun parse(text: String?): List<Pause> = (text ?: "").split(',').mapNotNull { entry ->
    val parts = entry.split(':')
    val paused = parts.getOrNull(0)?.toLongOrNull()
    val resumed = parts.getOrNull(1)?.toLongOrNull()
    if (paused == null || resumed == null || paused <= 0) null else Pause(paused, resumed)
  }

  fun format(pauses: List<Pause>): String =
    pauses.takeLast(MAX).joinToString(",") { "${it.pausedAt}:${it.resumedAt}" }

  /** The user switched the receiver off at `now` (a second stop while off changes nothing). */
  fun paused(text: String?, now: Long): String {
    val pauses = parse(text)
    if (pauses.lastOrNull()?.resumedAt == 0L) return format(pauses)
    return format(pauses + Pause(now, 0))
  }

  /** The receiver is delivering again at `now`: closes an open pause, if any. */
  fun resumed(text: String?, now: Long): String {
    val pauses = parse(text)
    val last = pauses.lastOrNull() ?: return format(pauses)
    if (last.resumedAt != 0L) return format(pauses)
    return format(pauses.dropLast(1) + last.copy(resumedAt = now))
  }
}
