package com.dogtracker

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class BleUploadQueueTest {
  /** Answers BleUploadQueue's queries from a script and records its writes. */
  private class FakeSql(var pending: Long = 0, var thinned: Int = 0, var refused: Boolean = false,
    var mode: String = "phone", var owner: String = "alice") : BleUploadQueue.Sql {
    val changes = mutableListOf<String>()
    val inserts = mutableListOf<Map<String, Any?>>()
    var counts = 0
    override fun first(sql: String, vararg args: String): String? = when {
      sql.contains("key='owner'") -> owner
      sql.contains("FROM ble_upload_settings") -> mode
      sql == BleUploadQueue.REFUSED_SQL -> if (refused) "1" else null
      sql.contains("fingerprint=?") -> null
      sql == BleUploadQueue.PENDING_COUNT_SQL -> { counts++; pending.toString() }
      else -> error("unexpected query $sql")
    }
    override fun change(sql: String, vararg args: Any?): Int {
      changes += sql
      return if (sql == BleUploadQueue.THIN_SQL) thinned else 0
    }
    override fun insert(values: Map<String, Any?>) { inserts += values }
  }

  private val packet = JSONObject("""{"type":3,"mid":7,"sid":4,"seq":1}""")
  private fun enqueue(sql: FakeSql, at: Long = 1_000L, payload: String = "{\"seq\":$at}") =
    BleUploadQueue.enqueue(sql, packet, payload, at) { "event-$at" }

  @Before fun countNext() = BleUploadQueue.recount()

  @Test fun belowTheCapQueuesWithoutThinning() {
    val sql = FakeSql(pending = BleUploadQueue.CAP - 1L)
    assertEquals("alice", enqueue(sql))
    assertEquals(1, sql.inserts.size)
    assertFalse(sql.changes.contains(BleUploadQueue.THIN_SQL))
  }

  @Test fun atTheCapTheOldestAreThinnedAndTheNewPacketIsStillQueued() {
    val sql = FakeSql(pending = BleUploadQueue.CAP.toLong(), thinned = 2000)
    assertEquals("alice", enqueue(sql))
    assertEquals(listOf(BleUploadQueue.THIN_SQL, BleUploadQueue.THINNED_SQL), sql.changes.take(2))
    assertFalse(sql.changes.contains(BleUploadQueue.DROP_SQL))
    assertEquals("event-1000", sql.inserts.single()["event_id"])
  }

  @Test fun nothingLeftToThinDropsTheOldest() {
    val sql = FakeSql(pending = BleUploadQueue.CAP.toLong(), thinned = 0)
    enqueue(sql)
    assertEquals(listOf(BleUploadQueue.THIN_SQL, BleUploadQueue.DROP_SQL, BleUploadQueue.THINNED_SQL), sql.changes.take(3))
    assertEquals(1, sql.inserts.size)
  }

  @Test fun theCapIsCountedOnceEveryCheckEveryPackets() {
    val sql = FakeSql()
    for (i in 0 until BleUploadQueue.CHECK_EVERY * 2) enqueue(sql, at = 1_000L + i)
    assertEquals(2, sql.counts)
    assertEquals(BleUploadQueue.CHECK_EVERY * 2, sql.inserts.size)
  }

  @Test fun aRefusedReceiverQueuesNothing() {
    val sql = FakeSql(refused = true)
    assertNull(enqueue(sql))
    assertTrue(sql.inserts.isEmpty())
  }

  @Test fun wifiRouteOrNoAccountQueuesNothing() {
    assertNull(enqueue(FakeSql(mode = "wifi")))
    assertNull(enqueue(FakeSql(owner = "")))
  }

  @Test fun statementsMatchTheirLimits() {
    // Refused rows never count toward the cap; the batches are the documented sizes.
    assertTrue(BleUploadQueue.PENDING_COUNT_SQL.endsWith("WHERE status='pending'"))
    assertTrue(BleUploadQueue.THIN_SQL.endsWith("LIMIT ${BleUploadQueue.THIN_BATCH})"))
    assertTrue(BleUploadQueue.DROP_SQL.endsWith("LIMIT ${BleUploadQueue.DROP_BATCH})"))
    assertTrue(BleUploadQueue.THIN_SQL.contains("o.received_at%60000"))
    assertTrue(BleUploadQueue.NEXT_RETRY_SQL.contains("ble_upload_refusals"))
  }
}
