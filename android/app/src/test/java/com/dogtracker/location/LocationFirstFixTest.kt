package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test

// #200 (audit A): one wrong first fix after a reset blocked every right fix
// as a "jump" for about distance / 70 s (up to the 30 s reset). Invented
// positions; no real place.
class LocationFirstFixTest {
  private val s = 1_000_000_000L
  private fun fix(second: Long, north: Double, accuracy: Float = 8f, speed: Float? = 1.2f) =
    LocationSample(25.0 + north / 111_195.0, 121.0, accuracy, second * s, second * 1000, speed, speedAccuracy = 0.4f)

  @Test fun twoAgreeingFixesOutvoteAWrongFirstFix() {
    val pipe = LocationPipeline()
    assertTrue(pipe.accept(fix(1, 2_000.0), 1 * s)) // wrong: 2 km off
    assertFalse(pipe.accept(fix(2, 0.0), 2 * s)) // the right place: a jump from it, as before
    assertTrue(pipe.accept(fix(3, 1.2), 3 * s)) // agrees with the fix before: starts again here
    assertEquals(25.0 + 1.2 / 111_195.0, pipe.latest!!.rawLatitude, 1e-9)
    assertEquals(1, pipe.rejectedBy["jump"])
    // The wrong fix is no part of the smoothed position nor of the odometer.
    assertEquals(pipe.latest!!.rawLatitude, pipe.latest!!.latitude, 1e-9)
    assertEquals(0.0, pipe.odometerMeters, 1e-9)
    assertTrue(pipe.accept(fix(4, 2.4), 4 * s))
  }

  @Test fun beforeTheFixTheRightFixesWaitedDistanceOver70Seconds() {
    // What the rule above replaces: without a second agreeing fix (they
    // disagree with each other), the right fixes are still jumps.
    val pipe = LocationPipeline()
    assertTrue(pipe.accept(fix(1, 2_000.0), 1 * s))
    assertFalse(pipe.accept(fix(2, 0.0), 2 * s))
    assertFalse(pipe.accept(fix(3, 900.0), 3 * s))
    assertEquals(2, pipe.rejectedBy["jump"])
  }

  @Test fun aJumpOutlierInAnEstablishedTrackIsStillRejected() {
    val pipe = LocationPipeline()
    for (i in 1L..5L) assertTrue(pipe.accept(fix(i, i * 1.2), i * s))
    // Two wrong fixes in a row that agree with each other: the track of five
    // accepted fixes is not outvoted.
    assertFalse(pipe.accept(fix(6, 3_000.0), 6 * s))
    assertFalse(pipe.accept(fix(7, 3_001.0), 7 * s))
    assertTrue(pipe.accept(fix(8, 9.6), 8 * s))
    assertEquals(25.0 + 9.6 / 111_195.0, pipe.latest!!.rawLatitude, 1e-9)
  }

  @Test fun aRightFirstFixAndOneOutlierKeepTheTrack() {
    val pipe = LocationPipeline()
    assertTrue(pipe.accept(fix(1, 0.0), 1 * s))
    assertFalse(pipe.accept(fix(2, 2_000.0), 2 * s)) // a lone outlier
    assertTrue(pipe.accept(fix(3, 2.4), 3 * s)) // agrees with the track: accepted as ever
    assertEquals(25.0 + 2.4 / 111_195.0, pipe.latest!!.rawLatitude, 1e-9)
  }
}
