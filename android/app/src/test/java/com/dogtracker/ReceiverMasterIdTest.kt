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

  // 2026-10-15: `"mid":"5"` passed the check but was never queued (the queue
  // and the JS encoder wanted a number): the packet is stored and queued with
  // its Master ID as the whole number.
  @Test fun aMasterIdThatPassedTheCheckIsNormalisedToAWholeNumber() {
    val text = ReceiverMasterId.normalized(JSONObject("""{"type":3,"sid":4,"mid":"5"}"""))!!
    assertEquals(5, text.get("mid"))
    val onlyMasterId = ReceiverMasterId.normalized(JSONObject("""{"type":3,"sid":4,"master_id":" 5 "}"""))!!
    assertEquals(5, onlyMasterId.get("mid"))
    assertEquals(5, onlyMasterId.get("master_id"))
    // master_id wins, as in the check.
    assertEquals(3, ReceiverMasterId.normalized(JSONObject("""{"master_id":3,"mid":5}"""))!!.get("mid"))
    assertEquals(5, ReceiverMasterId.normalized(JSONObject("""{"mid":5.0}"""))!!.get("mid"))
    // Already whole numbers, or nothing usable: left as they came.
    assertNull(ReceiverMasterId.normalized(JSONObject("""{"type":3,"sid":4,"mid":5}""")))
    assertNull(ReceiverMasterId.normalized(JSONObject("""{"master_id":5,"mid":5}""")))
    assertNull(ReceiverMasterId.normalized(JSONObject("""{"mid":"x"}""")))
    assertNull(ReceiverMasterId.normalized(JSONObject("""{"sid":4}""")))
  }

  @Test fun aStringMasterIdIsQueuedForUploadAsANumber() {
    val sql = object : BleUploadQueue.Sql {
      val inserts = mutableListOf<Map<String, Any?>>()
      override fun first(sql: String, vararg args: String): String? = when {
        sql.contains("key='owner'") -> "alice"
        sql.contains("FROM ble_upload_settings") -> if (args.toList() == listOf("alice", "5")) "phone" else null
        else -> null
      }
      override fun change(sql: String, vararg args: Any?) = 0
      override fun insert(values: Map<String, Any?>) { inserts += values }
    }
    BleUploadQueue.recount()
    val raw = """{"type":3,"sid":4,"seq":9,"mid":"5"}"""
    assertEquals(ReceiverMasterId.Check.Same, ReceiverMasterId.check(JSONObject(raw), 5))
    val packet = ReceiverMasterId.normalized(JSONObject(raw))!!
    assertEquals("alice", BleUploadQueue.enqueue(sql, packet, packet.toString(), 1_000L) { "e1" })
    assertEquals(5, sql.inserts.single()["master_id"])
    assertEquals(5, JSONObject(sql.inserts.single()["payload_json"] as String).get("mid"))
  }

  // `"sid":"4"`, like `"mid":"5"` (#204): DogStatusStore only stored a
  // numeric dog ID and the JS encoder wanted a number, so the packet was
  // neither stored nor uploaded. Read the same way, handed over as numbers.
  @Test fun aStringDogIdIsNormalisedToAWholeNumber() {
    assertEquals(4, ReceiverMasterId.slaveOf(JSONObject("""{"sid":"4"}""")))
    assertEquals(4, ReceiverMasterId.slaveOf(JSONObject("""{"sid":" 4 "}""")))
    assertEquals(6, ReceiverMasterId.slaveOf(JSONObject("""{"slave_id":6,"sid":"4"}""")))
    for (json in listOf("""{"sid":"x"}""", """{"sid":""}""", """{"sid":0}""", """{"sid":"4.5"}""", """{"sid":-1}""", """{}"""))
      assertNull(json, ReceiverMasterId.slaveOf(JSONObject(json)))
    val both = ReceiverMasterId.normalized(JSONObject("""{"type":3,"sid":"4","mid":"5"}"""))!!
    assertEquals(4, both.get("sid"))
    assertEquals(5, both.get("mid"))
    val onlySid = ReceiverMasterId.normalized(JSONObject("""{"type":3,"sid":"4","mid":5}"""))!!
    assertEquals(4, onlySid.get("sid"))
    assertEquals(5, onlySid.get("mid"))
    val longKey = ReceiverMasterId.normalized(JSONObject("""{"slave_id":"4","mid":5}"""))!!
    assertEquals(4, longKey.get("sid"))
    assertEquals(4, longKey.get("slave_id"))
    // Without a Master ID of its own, the dog ID alone is still made a number.
    assertEquals(4, ReceiverMasterId.normalized(JSONObject("""{"type":3,"sid":"4"}"""))!!.get("sid"))
    assertEquals(4, ReceiverMasterId.normalized(JSONObject("""{"sid":4.0}"""))!!.get("sid"))
    assertNull(ReceiverMasterId.normalized(JSONObject("""{"type":3,"sid":"x","mid":5}""")))
    assertNull(ReceiverMasterId.normalized(JSONObject("""{"type":3,"sid":4,"mid":5}""")))
  }

  @Test fun aPositionPacketWithAStringDogIdTakesTheQrMasterIdAndIsQueuedWithNumbers() {
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
    val raw = JSONObject("""{"type":3,"sid":"4","seq":9,"lat":24.9892,"lon":121.3138}""")
    assertEquals(ReceiverMasterId.Check.Missing, ReceiverMasterId.check(raw, 3))
    // As BleForegroundService: fill the QR's Master ID, then normalise.
    val filled = ReceiverMasterId.filled(raw, 3)!!
    val packet = ReceiverMasterId.normalized(filled)!!
    assertEquals("alice", BleUploadQueue.enqueue(sql, packet, packet.toString(), 1_000L) { "e1" })
    assertEquals(3, sql.inserts.single()["master_id"])
    assertEquals(4, sql.inserts.single()["slave_id"])
    val queued = JSONObject(sql.inserts.single()["payload_json"] as String)
    assertEquals(4, queued.get("sid"))
    assertEquals(3, queued.get("mid"))
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
