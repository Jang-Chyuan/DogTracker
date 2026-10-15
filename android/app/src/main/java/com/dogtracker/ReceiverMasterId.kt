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

  fun of(data: JSONObject): Int? = whole(data, "master_id", "mid", 65535)

  /**
   * A packet's dog (slave) ID the way DogStatusStore stores it: `slave_id`,
   * else `sid`; a number or a numeric string (`"sid":"4"`), whole, 1 or more.
   */
  fun slaveOf(data: JSONObject): Int? = whole(data, "slave_id", "sid", Int.MAX_VALUE)

  private fun whole(data: JSONObject, long: String, short: String, max: Int): Int? {
    val raw = if (data.has(long) && !data.isNull(long)) data.opt(long)
      else if (data.has(short) && !data.isNull(short)) data.opt(short) else null
    val number = when (raw) {
      is Number -> raw.toDouble()
      is String -> raw.trim().toDoubleOrNull()
      else -> null
    } ?: return null
    if (!number.isFinite() || number < 1 || number > max || number % 1.0 != 0.0) return null
    return number.toInt()
  }

  /**
   * A position packet ([Check.Missing]) as the paired receiver's: a copy with
   * `mid` set to the QR's Master ID, or null to keep it as it came.
   *
   * Safe because the packet came over the link to the receiver paired from
   * that QR, and a packet naming any other Master stops the session (so a
   * wrong receiver is still caught by its own packets that carry one).
   * Without it the row is stored with master_id NULL, apart from its
   * receiver's (display smoothing, 設定's receiver rows), and never queued
   * for upload. Only type-3 position packets with a dog (slave) id: anything
   * else without one is not uploadable anyway and stays as it came, and so
   * does every packet of an older pairing without a QR Master ID (`expected` 0).
   */
  fun filled(data: JSONObject, expected: Int): JSONObject? {
    if (expected !in 1..65535 || of(data) != null) return null
    if ((data.opt("type") as? Number)?.toDouble() != 3.0) return null
    slaveOf(data) ?: return null
    return JSONObject(data.toString()).apply {
      // An unusable master_id would otherwise shadow mid (DogStatusStore reads master_id first).
      remove("master_id")
      put("mid", expected)
    }
  }

  /**
   * A packet whose Master ID ([of]) or dog ID ([slaveOf]) is usable but not
   * a whole JSON number in `mid`／`sid` (`"mid":"5"`, `"sid":"4"`, or only
   * `master_id`／`slave_id`): a copy with `mid` and `sid` (and `master_id`,
   * `slave_id` when it has them) set to those numbers, or null when they
   * already are. The upload queue routes by `mid`, DogStatusStore only
   * stores a numeric dog ID and the JS encoder (BleUploadPayload) reads
   * both as numbers, so without this the packet passed the check but was
   * never queued (`mid`, 2026-10-15) or never stored (`sid`). The BLE
   * protocol does not change: only how the phone reads what came.
   */
  fun normalized(data: JSONObject): JSONObject? {
    val ids = listOf(Triple(of(data), "mid", "master_id"), Triple(slaveOf(data), "sid", "slave_id"))
      .filter { it.first != null }
    // Already the whole number itself (an Int as JSONObject parses `5`).
    fun same(key: String, id: Int) = (data.opt(key) as? Number)?.toString() == id.toString()
    if (ids.all { (id, short, long) -> same(short, id!!) && (!data.has(long) || same(long, id)) }) return null
    return JSONObject(data.toString()).apply {
      for ((id, short, long) in ids) {
        put(short, id)
        if (has(long)) put(long, id)
      }
    }
  }

  /** `expected` 0: an older pairing without a QR Master ID, any receiver is fine. */
  fun check(data: JSONObject, expected: Int): Check {
    val found = of(data) ?: return Check.Missing
    return if (expected > 0 && found != expected) Check.Other(found) else Check.Same
  }
}

/** One service run's receiver frames, for diagnostics (counts only); a new run starts from zero. */
class ReceiverFrameStats {
  /** Open frames the framer dropped for a new packet (BleJsonFramer.resyncs). */
  @Volatile var resyncs = 0; private set
  /** The longest complete frame, in bytes. */
  @Volatile var largest = 0; private set
  /** Frames without a usable Master ID of their own. */
  @Volatile var withoutMasterId = 0; private set
  /** Of those, the position packets given the QR's (ReceiverMasterId.filled). */
  @Volatile var masterIdFilled = 0; private set

  fun framed(framerResyncs: Int, framerLargest: Int) {
    resyncs = framerResyncs
    largest = maxOf(largest, framerLargest)
  }

  fun missingMasterId(filled: Boolean) {
    withoutMasterId++
    if (filled) masterIdFilled++
  }
}
