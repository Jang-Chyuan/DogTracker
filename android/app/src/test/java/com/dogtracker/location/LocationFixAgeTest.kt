package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test

/**
 * Fused Wi-Fi fixes while the phone is still (Samsung stops GPS): seconds to
 * minutes apart and about 4.5–5 s old on arrival. PR 116 diagnostics: one
 * night dropped 1004 as stale (the oldest 5.1 s); a 377 s stretch with 41
 * fixes saved none.
 */
class LocationFixAgeTest {
  private val s = 1_000_000_000L
  // Wall clock of the test "phone": elapsedRealtime 0 is this Unix time.
  private val bootWallMs = 1_700_000_000_000L

  private fun fix(elapsed: Long, lat: Double = 25.0, accuracy: Float = 20f, speed: Float? = 0.1f,
    speedAccuracy: Float? = 0.3f) =
    LocationSample(lat, 121.0, accuracy, elapsed, bootWallMs + elapsed / 1_000_000L, speed,
      speedAccuracy = speedAccuracy, provider = "play-fused")

  private data class Row(val recordedAt: Long, val sample: LocationSample)

  /** LocationTrackerService: fixes delivered `lateBy` after they were taken, writer ticks once a second. */
  private fun record(fixes: List<LocationSample>, lateBy: Long, until: Long,
    pipeline: LocationPipeline = LocationPipeline()): List<Row> {
    val rows = mutableListOf<Row>()
    val pending = ArrayDeque(fixes.sortedBy { it.elapsedNanos + lateBy })
    var now = 0L
    while (now <= until) {
      while (pending.isNotEmpty() && pending.first().elapsedNanos + lateBy <= now)
        pipeline.accept(pending.removeFirst(), now)
      if (now % s == s / 2) pipeline.candidate(now)?.let {
        rows.add(Row(LocationPipeline.fixWallTime(it, now, bootWallMs + now / 1_000_000L), it))
        pipeline.written(it, now)
      }
      now += s / 10
    }
    return rows
  }

  @Test fun stationaryFixesFiveSecondsApartAndUpToFiveSecondsOldAreSaved() {
    val fixes = (1L..40L).map { fix(it * 5 * s) }
    val pipeline = LocationPipeline()
    val rows = record(fixes, lateBy = 4_800_000_000L, until = 210 * s, pipeline = pipeline)
    assertEquals(0, pipeline.rejectedBy["stale"])
    assertEquals(40, pipeline.accepted)
    assertEquals(40, rows.size) // each fix once
    // Every row carries its fix's own time, not when it was written.
    for (row in rows) assertEquals(bootWallMs + row.sample.elapsedNanos / 1_000_000L, row.recordedAt)
    assertEquals((1L..40L).map { bootWallMs + it * 5000 }, rows.map { it.recordedAt })
  }

  @Test fun theGapFromThePhoneNowSavesARowForEachFix() {
    // The 377 s stretch: about 41 fixes, 9 s apart, each arriving 4.7 s old.
    val fixes = (1L..41L).map { fix(it * 9 * s) }
    val pipeline = LocationPipeline()
    val rows = record(fixes, lateBy = 4_700_000_000L, until = 380 * s, pipeline = pipeline)
    assertEquals(41, rows.size)
    assertTrue(rows.zipWithNext().all { (a, b) -> b.recordedAt - a.recordedAt == 9000L })
  }

  @Test fun deliveryDelayDoesNotChangeWhatIsDecided() {
    // Same fixes, fresh or late: the same smoothing, motion states and fix times.
    val fixes = (1L..60L).map { fix(it * 5 * s, lat = 25.0 + (it % 3) * 0.000005, accuracy = 8f) }
    val fresh = record(fixes, lateBy = 200_000_000L, until = 320 * s)
    val late = record(fixes, lateBy = 4_800_000_000L, until = 320 * s)
    assertEquals(fresh.map { it.recordedAt to it.sample }, late.map { it.recordedAt to it.sample })
    assertEquals("stationary", late.last().sample.motionState)
  }

  @Test fun stillRejectsCachedFixesOlderThanTheLimit() {
    val pipeline = LocationPipeline()
    assertFalse(pipeline.accept(fix(10 * s), 130 * s)) // a two-minute-old cached fix
    assertEquals(120.0, pipeline.windowMaxStaleSeconds!!, 1e-9)
    assertFalse(pipeline.accept(fix(120 * s), 120 * s + LocationPipeline.MAX_FIX_AGE_NANOS + 1))
    assertEquals(2, pipeline.rejectedBy["stale"])
    assertNull(pipeline.latest)
    assertTrue(pipeline.accept(fix(140 * s), 140 * s + LocationPipeline.MAX_FIX_AGE_NANOS))
  }

  @Test fun anAcceptedFixIsSavedOnlyWhileItIsWithinTheLimit() {
    val pipeline = LocationPipeline()
    assertTrue(pipeline.accept(fix(10 * s), 15 * s))
    assertNull(pipeline.candidate(10 * s + LocationPipeline.MAX_FIX_AGE_NANOS + 1))
    assertNotNull(pipeline.candidate(10 * s + LocationPipeline.MAX_FIX_AGE_NANOS))
  }

  @Test fun anOlderFixThanTheLastAcceptedOneIsStillRejected() {
    val pipeline = LocationPipeline()
    assertTrue(pipeline.accept(fix(100 * s), 105 * s))
    // Delivered later but taken earlier (another provider's late fix).
    assertFalse(pipeline.accept(fix(98 * s), 106 * s))
    assertFalse(pipeline.accept(fix(100 * s), 106 * s))
    assertEquals(2, pipeline.rejectedBy["duplicate"])
    assertEquals(100 * s, pipeline.candidate(106 * s)!!.elapsedNanos)
  }

  @Test fun fixWallTimeSubtractsTheFixAge() {
    val sample = fix(100 * s)
    assertEquals(1_000_000L - 4_800L, LocationPipeline.fixWallTime(sample, 104_800_000_000L, 1_000_000L))
  }

  @Test fun aNewRecordingDoesNotSaveTheCachedFixAgain() {
    val savedLocationAt = bootWallMs + 100_000L
    assertTrue(LocationPipeline.repeatsSavedRow(fix(100 * s), savedLocationAt))
    assertTrue(LocationPipeline.repeatsSavedRow(fix(96 * s), savedLocationAt))
    assertFalse(LocationPipeline.repeatsSavedRow(fix(101 * s), savedLocationAt))
    assertFalse(LocationPipeline.repeatsSavedRow(fix(100 * s), null))
    // A clock set back by an hour does not stop recording.
    assertFalse(LocationPipeline.repeatsSavedRow(fix(100 * s), savedLocationAt + 3_600_000L))
    // The skipped fix does not use the write slot: the next, newer one is saved at once.
    val pipeline = LocationPipeline()
    assertTrue(pipeline.accept(fix(100 * s), 103 * s))
    pipeline.skipped(pipeline.candidate(103 * s)!!)
    assertNull(pipeline.candidate(104 * s))
    assertTrue(pipeline.accept(fix(102 * s), 104 * s))
    assertEquals(102 * s, pipeline.candidate(104 * s)!!.elapsedNanos)
  }
}
