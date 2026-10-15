package com.dogtracker

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ReceiverMasterIdTest {
  private fun check(json: String, expected: Int = 3) = ReceiverMasterId.check(JSONObject(json), expected)

  @Test fun onlyAnotherReceiversNumberIsAMismatch() {
    assertEquals(ReceiverMasterId.Check.Same, check("""{"mid":3}"""))
    assertEquals(ReceiverMasterId.Check.Same, check("""{"master_id":3,"mid":5}"""))
    assertEquals(ReceiverMasterId.Check.Other(5), check("""{"mid":5}"""))
    assertEquals(ReceiverMasterId.Check.Other(5), check("""{"mid":"5"}"""))
  }

  @Test fun aFrameWithoutAUsableNumberIsNotAMismatch() {
    for (json in listOf("""{"sid":1}""", """{"mid":null}""", """{"mid":0}""", """{"mid":3.5}""",
      """{"mid":"x"}""", """{"master_id":null}""", """{"mid":{}}""")) {
      assertEquals(json, ReceiverMasterId.Check.Missing, check(json))
    }
  }

  @Test fun anOlderPairingWithoutAQrNumberAcceptsAnyReceiver() {
    assertEquals(ReceiverMasterId.Check.Same, check("""{"mid":5}""", expected = 0))
    assertEquals(ReceiverMasterId.Check.Missing, check("""{"sid":1}""", expected = 0))
  }

  private val position = """{"type":3,"sid":4,"seq":9,"lat":24.9892,"lon":121.3138}"""

  @Test fun aPositionPacketWithoutOneTakesTheQrMasterId() {
    val data = JSONObject(position)
    val filled = ReceiverMasterId.filled(data, 3)!!
    assertEquals(3, filled.getInt("mid"))
    assertEquals(3, ReceiverMasterId.of(filled))
    assertEquals(24.9892, filled.getDouble("lat"), 0.0)
    assertEquals(9, filled.getInt("seq"))
    // The packet as it came is left alone.
    assertFalse(data.has("mid"))
    // An unusable number of its own is replaced, and an unusable master_id
    // no longer shadows it.
    val odd = ReceiverMasterId.filled(JSONObject("""{"type":3,"sid":4,"mid":null,"master_id":"x"}"""), 3)!!
    assertEquals(3, odd.getInt("mid"))
    assertFalse(odd.has("master_id"))
  }

  @Test fun onlyPositionPacketsOfAQrPairingAreFilled() {
    // Its own number, an older pairing, not a position packet, no dog.
    assertNull(ReceiverMasterId.filled(JSONObject("""{"type":3,"sid":4,"mid":3}"""), 3))
    assertNull(ReceiverMasterId.filled(JSONObject(position), 0))
    assertNull(ReceiverMasterId.filled(JSONObject("""{"type":1,"sid":4}"""), 3))
    assertNull(ReceiverMasterId.filled(JSONObject("""{"status":"boot"}"""), 3))
    assertNull(ReceiverMasterId.filled(JSONObject("""{"type":3}"""), 3))
    assertNull(ReceiverMasterId.filled(JSONObject("""{"type":3,"sid":0}"""), 3))
  }

  @Test fun aFilledPacketIsQueuedForUploadUnderItsReceiver() {
    val sql = object : BleUploadQueue.Sql {
      val inserts = mutableListOf<Map<String, Any?>>()
      override fun first(sql: String, vararg args: String): String? = when {
        sql.contains("key='owner'") -> "alice"
        sql.contains("FROM ble_upload_settings") -> if (args.toList() == listOf("alice", "3")) "phone" else null
        else -> null
      }
      override fun change(sql: String, vararg args: Any?) = 0
      override fun insert(values: Map<String, Any?>) { inserts += values }
    }
    BleUploadQueue.recount()
    // As it came: not queued (no Master to route it by).
    assertNull(BleUploadQueue.enqueue(sql, JSONObject(position), position, 1_000L) { "e1" })
    val filled = ReceiverMasterId.filled(JSONObject(position), 3)!!
    assertEquals("alice", BleUploadQueue.enqueue(sql, filled, filled.toString(), 2_000L) { "e2" })
    assertEquals(3, sql.inserts.single()["master_id"])
    assertEquals(3, JSONObject(sql.inserts.single()["payload_json"] as String).getInt("mid"))
  }

  @Test fun frameCountsAreThisRunsOnly() {
    val run = ReceiverFrameStats()
    run.framed(framerResyncs = 2, framerLargest = 280)
    run.framed(framerResyncs = 3, framerLargest = 120)
    run.missingMasterId(filled = true)
    run.missingMasterId(filled = false)
    assertEquals(3, run.resyncs)
    assertEquals(280, run.largest)
    assertEquals(2, run.withoutMasterId)
    assertEquals(1, run.masterIdFilled)
    // The next service run (BleForegroundService.onCreate) starts from zero.
    val next = ReceiverFrameStats()
    assertEquals(listOf(0, 0, 0, 0), listOf(next.resyncs, next.largest, next.withoutMasterId, next.masterIdFilled))
  }
}
