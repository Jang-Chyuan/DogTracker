package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test

class LocationPipelineTest {
  private fun sample(second: Long, lat: Double = 25.0, speed: Float? = 0f, accuracy: Float = 10f) =
    LocationSample(lat, 121.0, accuracy, second * 1_000_000_000L, second * 1000, speed)
  @Test fun threePointsAndHighSpeedWeight() {
    val slow = LocationPipeline(); val fast = LocationPipeline()
    for (i in 1L..3L) {
      slow.accept(sample(i, 25 + i * 0.00001), i * 1_000_000_000L)
      fast.accept(sample(i, 25 + i * 0.00001, 5f), i * 1_000_000_000L)
    }
    assertEquals(25.00002, slow.latest!!.latitude, 1e-8)
    assertTrue(fast.latest!!.latitude > slow.latest!!.latitude)
    assertEquals(25.00003, slow.latest!!.rawLatitude, 1e-8)
    assertEquals(10f, slow.latest!!.accuracy)
  }
  @Test fun writesEveryFiveSecondsAndNeverReplaysAnOldFix() {
    val pipe = LocationPipeline()
    for (i in 1L..11L) {
      val now = i * 1_000_000_000L
      pipe.accept(sample(i), now)
      val candidate = pipe.candidate(now)
      if (i in listOf(1L, 6L, 11L)) { assertNotNull(candidate); pipe.written(candidate!!, now) }
      else assertNull(candidate)
    }
    assertNull(pipe.candidate(20_000_000_000L))
  }
  @Test fun adaptiveBoundariesAccelerationAndDeceleration() {
    for ((kmh, interval) in listOf(0f to 5, 10f to 5, 10.1f to 3, 20f to 3, 20.1f to 1, 60f to 1)) {
      val pipe = LocationPipeline()
      pipe.accept(sample(1, speed = kmh / 3.6f), 1_000_000_000L)
      assertEquals(interval, pipe.intervalSeconds)
    }
    val pipe = LocationPipeline()
    for (i in 1L..21L) pipe.accept(sample(i, speed = 0f), i * 1_000_000_000L)
    pipe.written(pipe.candidate(21_000_000_000L)!!, 21_000_000_000L)
    pipe.accept(sample(22, speed = 30f), 22_000_000_000L)
    // Departure is still in the stationary grace period, but raw speed controls writes.
    assertEquals(0f, pipe.latest!!.speed)
    assertEquals(1, pipe.intervalSeconds)
    val fast = pipe.candidate(22_000_000_000L)!!
    pipe.written(fast, 22_000_000_000L)
    assertNull(pipe.candidate(23_000_000_000L)) // Never duplicate the saved sample.
    pipe.accept(sample(23, speed = 0f), 23_000_000_000L)
    assertEquals(5, pipe.intervalSeconds)
    assertNull(pipe.candidate(23_000_000_000L))
    pipe.accept(sample(27, speed = null), 27_000_000_000L)
    assertEquals(5, pipe.intervalSeconds)
    assertNotNull(pipe.candidate(27_000_000_000L))
  }
  @Test fun rejectsBadAccuracyStaleAndJumpingFixesWithoutConsumingWriteSlot() {
    val pipe = LocationPipeline()
    assertFalse(pipe.accept(sample(1, accuracy = 31f), 1_000_000_000L))
    assertFalse(pipe.accept(sample(1), 5_000_000_000L))
    assertTrue(pipe.accept(sample(6, accuracy = 30f), 6_000_000_000L))
    assertFalse(pipe.accept(sample(7, lat = 26.0), 7_000_000_000L))
    assertNotNull(pipe.candidate(7_000_000_000L))
    assertEquals(3, pipe.rejected)
    // Long outages reset rather than dragging the old location forward.
    assertTrue(pipe.accept(sample(50, lat = 26.0), 50_000_000_000L))
    assertEquals(26.0, pipe.latest!!.latitude, 0.0)
    assertEquals(mapOf("stale" to 1, "duplicate" to 0, "invalid" to 0, "accuracy" to 1, "jump" to 1), pipe.rejectedBy)
  }
  // PR 116: a stretch with no saved row records why, without any position.
  @Test fun noSaveStretchRecordsRejectionCausesOnly() {
    val pipe = LocationPipeline(); val log = SaveGapLog(minNanos = 60_000_000_000L)
    val s = 1_000_000_000L
    log.saved(0, 1_000L, pipe, 0)
    assertTrue(pipe.accept(sample(1), 1 * s)); log.saved(1 * s, 2_000L, pipe, 0)
    // Wi-Fi-only fixes that arrive late or coarse while GPS is stopped.
    assertFalse(pipe.accept(sample(10), 14 * s + 400_000_000L))
    assertFalse(pipe.accept(sample(20, accuracy = 42f), 20 * s))
    assertFalse(pipe.accept(sample(30, accuracy = 35f), 30 * s))
    assertTrue(log.snapshot(50 * s, 51_000L, pipe, 0).isEmpty()) // shorter than a minute
    val ongoing = log.snapshot(100 * s, 101_000L, pipe, 2).single()
    assertNull(ongoing.endWallMs)
    assertEquals(99L, ongoing.seconds)
    assertEquals(3, ongoing.received); assertEquals(0, ongoing.accepted); assertEquals(2, ongoing.writeErrors)
    assertEquals(mapOf("stale" to 1, "accuracy" to 2), ongoing.rejectedBy)
    assertEquals(4.4, ongoing.maxStaleSeconds!!, 1e-6)
    assertEquals(35f, ongoing.bestRejectedAccuracy)
    assertTrue(pipe.accept(sample(101), 101 * s)); log.saved(101 * s, 102_000L, pipe, 2)
    val done = log.snapshot(102 * s, 103_000L, pipe, 2).single()
    assertEquals(2_000L, done.startWallMs); assertEquals(102_000L, done.endWallMs)
    assertEquals(1, done.accepted)
    assertNull(pipe.windowMaxStaleSeconds) // the next stretch starts clean
  }
}
