package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test

class MotionDetectorTest {
  private fun point(t: Long, meters: Double = 0.0, speed: Float? = 0.6f, uncertainty: Float? = 0.4f) =
    LocationSample(25 + meters / 111195, 121.0, 3f, t * 1_000_000_000, t * 1000,
      speed, speedAccuracy = uncertainty)
  @Test fun invalidQualityCannotConfirmGeometricMovement() {
    for (accuracy in listOf(Float.NaN, -1f, 50f)) {
      val detector = MotionDetector()
      for (t in 1L..360L) assertEquals("unknown", detector.accept(point(t, t.toDouble(), null).copy(accuracy = accuracy)))
    }
  }
  @Test fun backwardElapsedTimeDiscardsStationaryAndTail() {
    val detector = MotionDetector()
    for (t in 1L..21L) detector.accept(point(t, 0.0, 0f))
    assertEquals("moving", detector.accept(point(2L, 100.0, 0f)))
  }
  @Test fun stationaryLocksCoordinatesAfterTwentySecondsAndPreservesRawSamples() {
    val pipe = LocationPipeline()
    for (t in 1L..21L) {
      val p = point(t, if (t % 2 == 0L) 0.5 else 0.0)
      pipe.accept(p, p.elapsedNanos)
      val value = pipe.latest!!
      assertEquals(if (t >= 21) "stationary" else if (t >= 16) "suspected_stationary" else "moving", value.motionState)
      assertEquals(0.6f, value.rawSpeed)
      assertEquals(if (t >= 21) 0f else 0.6f, value.speed)
    }
    val before = pipe.latest!!.latitude
    val next = point(22, 1.0)
    pipe.accept(next, next.elapsedNanos)
    assertEquals(before, pipe.latest!!.latitude, 0.0)
    assertEquals(next.rawLatitude, pipe.latest!!.rawLatitude, 0.0)
    assertEquals(next.timestamp, pipe.latest!!.timestamp)
    val later = point(26, 2.0)
    assertNull(pipe.candidate(later.elapsedNanos))
    pipe.accept(later, later.elapsedNanos)
    // A fresh fix after a four-second callback gap does not discard a lock.
    // candidate still refuses stale positions after three seconds.
    assertEquals("stationary", pipe.latest!!.motionState)
    assertEquals(before, pipe.latest!!.latitude, 0.0)
    assertEquals(0f, pipe.latest!!.speed)
    for (t in 27L..45L) pipe.accept(point(t, 2.0), t * 1_000_000_000L)
    assertEquals("stationary", pipe.latest!!.motionState)
    pipe.accept(point(46, 2.0), 46_000_000_000L)
    assertEquals("stationary", pipe.latest!!.motionState)
  }
  @Test fun slowDirectionalWalkIsNotStationary() {
    val detector = MotionDetector()
    for (t in 1L..60L) assertNotEquals("stationary", detector.accept(point(t, t * 0.4)))
  }
  @Test fun reliableMovementNeedsThreeSecondsAndGapsReset() {
    val detector = MotionDetector()
    for (t in 1L..21L) detector.accept(point(t))
    for (t in 22L..24L) assertEquals("stationary", detector.accept(point(t, speed = 2f, uncertainty = 0.1f)))
    assertEquals("moving", detector.accept(point(25, speed = 2f, uncertainty = 0.1f)))
    for (t in 26L..46L) detector.accept(point(t))
    assertEquals("moving", detector.accept(point(80)))
    assertEquals("unknown", detector.accept(point(81, speed = null)))
    assertEquals("unknown", detector.accept(point(82, uncertainty = null)))
    assertEquals("moving", detector.accept(point(83).copy(accuracy = 30f)))
  }
  @Test fun uncertainCompactRelocationCannotReleaseButMissingEvidenceExpires() {
    val detector = MotionDetector()
    for (t in 1L..21L) detector.accept(point(t))
    for (t in 22L..24L) assertEquals("stationary", detector.accept(point(t, 8.0, 0.2f, null)))
    assertEquals("stationary", detector.accept(point(25, 9.0, 0.2f, null)))
    for (t in 26L..205L) assertEquals("stationary", detector.accept(point(t, 9.0, null, null)))
    assertEquals("unknown", detector.accept(point(206, 9.0, null, null)))
  }
}
