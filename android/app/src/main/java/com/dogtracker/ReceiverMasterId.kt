package com.dogtracker

import android.os.SystemClock
import org.json.JSONObject

/** When a notification arrived: the wall clock (stored) and the monotonic one (framing). */
data class Arrival(val wallMs: Long, val elapsedMs: Long) {
  companion object {
    fun now() = Arrival(System.currentTimeMillis(), SystemClock.elapsedRealtime())
  }
}

/**
 * The QR's Master ID against a frame's own (`master_id`, else `mid`). Only a
 * frame naming another receiver is a mismatch; one without a usable number
 * (missing, null, not a whole number) is [Check.Missing] and is not.
 */
object ReceiverMasterId {
  sealed class Check {
    object Same : Check()
    object Missing : Check()
    data class Other(val masterId: Int) : Check()
  }

  fun of(data: JSONObject): Int? {
    val raw = if (data.has("master_id") && !data.isNull("master_id")) data.opt("master_id")
      else if (data.has("mid") && !data.isNull("mid")) data.opt("mid") else null
    val number = when (raw) {
      is Number -> raw.toDouble()
      is String -> raw.trim().toDoubleOrNull()
      else -> null
    } ?: return null
    if (!number.isFinite() || number < 1 || number > 65535 || number % 1.0 != 0.0) return null
    return number.toInt()
  }

  /** `expected` 0: an older pairing without a QR Master ID, any receiver is fine. */
  fun check(data: JSONObject, expected: Int): Check {
    val found = of(data) ?: return Check.Missing
    return if (expected > 0 && found != expected) Check.Other(found) else Check.Same
  }
}
