package com.dogtracker.alerts

import org.json.JSONObject

/** A subscribed link or an established outage survives a process restart. */
data class ReceiverLinkState(val connected: Boolean = false, val disconnectedAt: Long = 0) {
  fun lost(now: Long) = copy(connected = false, disconnectedAt = if (connected) now else disconnectedAt)
  // No lock for a never-established link; elapsed outages are checked now.
  fun remainingGrace(now: Long, grace: Long): Long? =
    if (disconnectedAt <= 0) null else maxOf(0L, grace - (now - disconnectedAt))
  fun write() = JSONObject().put("connected", connected).put("disconnectedAt", disconnectedAt).toString()
  companion object {
    fun restore(saved: String?, now: Long): ReceiverLinkState {
      val value = runCatching { JSONObject(saved ?: "{}") }.getOrDefault(JSONObject())
      return ReceiverLinkState(value.optBoolean("connected"), value.optLong("disconnectedAt")).lost(now)
    }
  }
}
