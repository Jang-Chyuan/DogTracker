package com.dogtracker.alerts

import org.json.JSONObject

/** One collar battery reading: the packet's percentage, its voltage (null: none) and time. */
data class BatteryReading(val percentage: Double, val millivolts: Double?, val at: Long)

data class AcceptedBattery(val percentage: Double, val at: Long)

/** A big drop waiting for agreeing packets. */
data class PendingBattery(val percentage: Double, val at: Long, val count: Int)

/**
 * A dog's battery judgement (src/tracking/BatteryPlausibility.js advanceBattery):
 * `accepted` is what is shown and alerted on, `judgedAt` the newest reading
 * looked at.
 */
data class BatteryState(
  val accepted: AcceptedBattery? = null,
  val pending: PendingBattery? = null,
  val judgedAt: Long? = null,
)

/**
 * Port of src/tracking/BatteryPlausibility.js, so the background low-battery
 * alert ignores the same bad packets as the app (a single bp=0, an
 * unconfirmed sudden drop). __tests__/BatteryPlausibilityParity.test.js writes
 * the cases BatteryPlausibilityParityTest.kt replays here.
 */
object BatteryPlausibility {
  // All of these await the collar firmware's confirmation; a first guess.
  // The largest percentage the collar reports (firmware confirmation pending).
  const val MAX_PERCENT = 100.0
  // 0% is believed only with a voltage at or below this, an empty cell
  // (firmware confirmation pending).
  const val EMPTY_MAX_MV = 3500.0
  // A drop of more than this many points from the last believed reading needs
  // confirming (firmware confirmation pending).
  const val DROP_POINTS = 30.0
  // How many packets in a row must agree on such a drop (firmware confirmation pending).
  const val DROP_PACKETS = 2
  // Packets agree within this many points of each other (firmware confirmation pending).
  const val AGREE_POINTS = 5.0

  fun inRange(percentage: Double?): Boolean =
    percentage != null && percentage.isFinite() && percentage >= 0 && percentage <= MAX_PERCENT

  /** Whether one reading on its own can be believed (range and the 0% voltage rule). */
  fun plausible(percentage: Double?, millivolts: Double?): Boolean {
    if (!inRange(percentage)) return false
    if (percentage != 0.0) return true
    return millivolts != null && millivolts.isFinite() && millivolts > 0 && millivolts <= EMPTY_MAX_MV
  }

  /** One more reading, oldest first; a reading not believed is skipped. */
  fun advance(state: BatteryState?, reading: BatteryReading?): BatteryState {
    val previous = state ?: BatteryState()
    if (reading == null) return previous
    if (previous.judgedAt != null && reading.at <= previous.judgedAt) return previous
    if (!plausible(reading.percentage, reading.millivolts)) return previous.copy(judgedAt = reading.at)
    val accepted = previous.accepted
    if (accepted == null || accepted.percentage - reading.percentage <= DROP_POINTS) {
      return BatteryState(AcceptedBattery(reading.percentage, reading.at), null, reading.at)
    }
    val agrees = previous.pending != null && kotlin.math.abs(previous.pending.percentage - reading.percentage) <= AGREE_POINTS
    val pending = PendingBattery(reading.percentage, reading.at, if (agrees) previous.pending!!.count + 1 else 1)
    if (pending.count >= DROP_PACKETS) return BatteryState(AcceptedBattery(reading.percentage, reading.at), null, reading.at)
    return BatteryState(accepted, pending, reading.at)
  }

  // ---- the app's JSON shape (advanceBattery's state) -------------------------------

  private fun JSONObject.number(name: String): Double? =
    if (!has(name) || isNull(name)) null else (opt(name) as? Number)?.toDouble()

  fun read(json: JSONObject?): BatteryState? {
    if (json == null) return null
    val accepted = json.optJSONObject("accepted")?.let { value ->
      val percentage = value.number("percentage") ?: return@let null
      val at = value.number("at")?.toLong() ?: return@let null
      AcceptedBattery(percentage, at)
    }
    val pending = json.optJSONObject("pending")?.let { value ->
      val percentage = value.number("percentage") ?: return@let null
      val at = value.number("at")?.toLong() ?: return@let null
      PendingBattery(percentage, at, value.number("count")?.toInt() ?: 1)
    }
    return BatteryState(accepted, pending, json.number("judgedAt")?.toLong())
  }

  fun write(state: BatteryState): JSONObject {
    val json = JSONObject()
    json.put("accepted", state.accepted?.let { JSONObject().put("percentage", it.percentage).put("at", it.at) } ?: JSONObject.NULL)
    json.put("pending", state.pending?.let {
      JSONObject().put("percentage", it.percentage).put("at", it.at).put("count", it.count)
    } ?: JSONObject.NULL)
    json.put("judgedAt", state.judgedAt ?: JSONObject.NULL)
    return json
  }
}
