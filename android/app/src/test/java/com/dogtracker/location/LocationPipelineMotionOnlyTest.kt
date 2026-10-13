package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test

// Fixes rejected only for accuracy (30–50 m Wi-Fi fixes once Samsung stops GPS
// on a still phone) reach the motion detector while it holds a stop; never a row.
class LocationPipelineMotionOnlyTest {
  private val s = 1_000_000_000L
  private fun fix(t: Double, north: Double = 0.0, accuracy: Float = 8f, speed: Float? = 0f, spread: Float? = null) =
    LocationSample(25 + north / 111195, 121.0, accuracy, (t * s).toLong(), (t * 1000).toLong(), speed, speedAccuracy = spread)
  private fun LocationPipeline.feed(sample: LocationSample) = accept(sample, sample.elapsedNanos)
  /** 21 s of still, fine fixes: the stop is confirmed and its coordinate locked; the last fix is saved. */
  private fun lockedStop() = LocationPipeline().apply {
    for (t in 1..21) assertTrue(feed(fix(t.toDouble())))
    assertEquals("stationary", latest!!.motionState)
    written(candidate(21 * s)!!, 21 * s)
  }

  @Test fun aCoarseOnlyStretchKeepsTheLockedStopAndItsCoordinateWithoutSavingAnything() {
    val pipe = lockedStop()
    val locked = pipe.latest!!
    var coarse = 0
    for (t in 26..496 step 5) {
      // Wi-Fi fixes wandering a few metres around the stop.
      assertFalse(pipe.feed(fix(t.toDouble(), north = (t % 3) * 3.0, accuracy = 40f)))
      coarse++
      assertSame(locked, pipe.latest) // the save candidate never changes
      assertNull(pipe.candidate(t * s))
    }
    assertEquals(coarse, pipe.motionOnly)
    assertEquals(coarse, pipe.rejectedBy["accuracy"])
    assertEquals(coarse, pipe.rejected)
    assertEquals(21, pipe.accepted)
    // GPS returns: still the same stop, at the same locked coordinate (no jump).
    assertTrue(pipe.feed(fix(500.0, north = 4.0)))
    assertEquals("stationary", pipe.latest!!.motionState)
    assertEquals(locked.latitude, pipe.latest!!.latitude, 0.0)
    assertEquals(0f, pipe.latest!!.speed)

    // Without those fixes (as before): the 8-minute silence reset the detector and the dot jumped.
    val before = lockedStop()
    assertTrue(before.feed(fix(500.0, north = 4.0)))
    assertNotEquals("stationary", before.latest!!.motionState)
    assertEquals(25 + 4.0 / 111195, before.latest!!.latitude, 1e-9)
  }

  @Test fun coarseFixesWithoutSpeedCannotHoldTheStopForever() {
    // PR 140 holds a stop only on a fix that measures the phone still.
    val pipe = lockedStop()
    for (t in 26..496 step 5) assertFalse(pipe.feed(fix(t.toDouble(), accuracy = 40f, speed = null)))
    // Fed until the 3-minute expiry (the last still evidence was at 21 s), then nothing more.
    assertEquals((26..206 step 5).count(), pipe.motionOnly)
    assertTrue(pipe.feed(fix(500.0, north = 4.0)))
    assertNotEquals("stationary", pipe.latest!!.motionState)
    assertEquals(25 + 4.0 / 111195, pipe.latest!!.latitude, 1e-9)
  }

  @Test fun realMovementStillEndsTheStop() {
    // Measured walking speed on coarse fixes: 3 s of it ends the stop.
    val walk = lockedStop()
    for (t in 22..25) assertFalse(walk.feed(fix(t.toDouble(), north = (t - 21) * 1.5, accuracy = 40f, speed = 1.5f, spread = 0.4f)))
    assertTrue(walk.feed(fix(26.0, north = 7.5, speed = 1.5f, spread = 0.4f)))
    assertEquals("moving", walk.latest!!.motionState)
    assertEquals(25 + 7.5 / 111195, walk.latest!!.rawLatitude, 1e-9)
    assertTrue(walk.latest!!.latitude > 25.0) // the lock is released
    assertEquals(1.5f, walk.latest!!.speed)

    // Still coarse fixes, but 100 m away for over 3 minutes: no longer this stop.
    val away = lockedStop()
    for (t in 26..256 step 5) assertFalse(away.feed(fix(t.toDouble(), north = 100.0, accuracy = 40f)))
    assertTrue(away.feed(fix(260.0, north = 100.0)))
    assertNotEquals("stationary", away.latest!!.motionState)
    assertEquals(25 + 100.0 / 111195, away.latest!!.latitude, 1e-9)

    // Fine fixes walking away after a coarse stretch are judged as before.
    val after = lockedStop()
    for (t in 26..121 step 5) assertFalse(after.feed(fix(t.toDouble(), accuracy = 40f)))
    for (t in 122..126) after.feed(fix(t.toDouble(), north = (t - 121) * 1.5, speed = 1.5f, spread = 0.4f))
    assertEquals("moving", after.latest!!.motionState)
  }

  @Test fun beforeAStopIsConfirmedCoarseFixesChangeNothing() {
    val mixed = LocationPipeline(); val fine = LocationPipeline()
    for (t in 1..30) {
      // Indoors the accuracy hovers around 30 m: these would clear the evidence being gathered.
      if (t in 5..15) assertFalse(mixed.feed(fix(t - 0.5, accuracy = 35f)))
      assertTrue(mixed.feed(fix(t.toDouble()))); assertTrue(fine.feed(fix(t.toDouble())))
      assertEquals("t=$t", fine.latest!!.motionState, mixed.latest!!.motionState)
    }
    assertEquals("stationary", mixed.latest!!.motionState)
    assertEquals(0, mixed.motionOnly)
    assertEquals(11, mixed.rejectedBy["accuracy"])
  }

  @Test fun aSavedFixOlderThanAJudgedCoarseOneDoesNotResetTheDetector() {
    // Separate providers (framework GPS + network) can deliver out of order.
    val pipe = lockedStop()
    assertFalse(pipe.feed(fix(30.5, accuracy = 40f)))
    assertTrue(pipe.feed(fix(30.2)))
    assertEquals("stationary", pipe.latest!!.motionState)
    for (t in 31..40) assertTrue(pipe.feed(fix(t.toDouble())))
    assertEquals("stationary", pipe.latest!!.motionState)
  }

  @Test fun onlyFreshValidFixesUnderFiftyMetresAreJudgedAndAllAreCountedAsAccuracyRejections() {
    val pipe = lockedStop(); val log = SaveGapLog(minNanos = 60_000_000_000L)
    log.saved(21 * s, 21_000L, pipe, 0)
    assertFalse(pipe.feed(fix(26.0, accuracy = 40f)))
    assertFalse(pipe.feed(fix(31.0, accuracy = 50f))) // no evidence to the detector either
    assertFalse(pipe.feed(fix(36.0, accuracy = Float.NaN)))
    assertFalse(pipe.feed(fix(41.0, accuracy = 49.9f)))
    assertFalse(pipe.accept(fix(42.0, accuracy = 40f), 60 * s)) // stale: dropped before the accuracy gate
    assertFalse(pipe.feed(fix(46.0, north = 5_000.0, accuracy = 40f))) // a jump from the last judged fix
    for (t in 51..121 step 5) assertFalse(pipe.feed(fix(t.toDouble(), accuracy = 45f)))
    assertEquals(2 + 15, pipe.motionOnly)
    val stretch = log.snapshot(125 * s, 125_000L, pipe, 0).single()
    assertEquals(mapOf("stale" to 1, "accuracy" to 20), stretch.rejectedBy)
    assertEquals(17, stretch.motionOnly)
    assertEquals(0, stretch.accepted)
    assertEquals(40f, stretch.bestRejectedAccuracy)
    assertEquals("stationary", pipe.latest!!.motionState)
  }
}
