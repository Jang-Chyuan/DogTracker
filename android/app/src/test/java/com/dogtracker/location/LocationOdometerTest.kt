package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

/**
 * The recording's odometer (2026-10-13): the per-second path of a walk, saved
 * with every row as odometer_m. Fictional fixes around an invented point near
 * Taoyuan Station; no real place or time.
 */
class LocationOdometerTest {
  private val originLat = 24.9890
  private val originLon = 121.3130
  private val metresPerDegLat = 111195.0
  private val metresPerDegLon = 111195.0 * cos(Math.toRadians(originLat))

  private fun at(second: Long, north: Double, east: Double, speed: Float?, accuracy: Float = 4f) =
    LocationSample(originLat + north / metresPerDegLat, originLon + east / metresPerDegLon, accuracy,
      second * 1_000_000_000L, second * 1000, speed, speedAccuracy = 0.2f)

  // A walk once a second at `speed` m/s around a circle of `radius` metres.
  private fun circle(pipe: LocationPipeline, seconds: Long, speed: Float = 1.3f, radius: Double = 20.0,
    accuracy: Float = 4f, every: Long = 1) {
    var t = 1L
    while (t <= seconds) {
      val angle = speed * t / radius
      pipe.accept(at(t, radius * sin(angle), radius * (1 - cos(angle)), speed, accuracy), t * 1_000_000_000L)
      t += every
    }
  }

  @Test fun aWalkAddsItsPerSecondPath() {
    val pipe = LocationPipeline()
    circle(pipe, 60)
    // 59 one-second steps of 1.3 m on the curve; the three-point smoothing
    // trims a little off the corners, the 5 s chords would trim more.
    assertEquals(59 * 1.3, pipe.odometerMeters, 3.0)
    assertEquals(pipe.odometerMeters, pipe.latest!!.odometer!!, 1e-9)
    // The saved rows 5 s apart: their chords add up to less than the odometer.
    val chord = 2 * 20.0 * sin(5 * 1.3 / 20.0 / 2) * 11
    assertTrue(pipe.odometerMeters > chord + 1.0)
  }

  @Test fun standingStillAddsNothing() {
    val pipe = LocationPipeline()
    for (t in 1L..120L) pipe.accept(at(t, 0.5 * sin(t.toDouble()), 0.5 * cos(t.toDouble()), 0.1f), t * 1_000_000_000L)
    assertEquals(0.0, pipe.odometerMeters, 1e-9)
    assertEquals(0.0, pipe.latest!!.odometer!!, 1e-9)
  }

  @Test fun coarseFixesAddNothing() {
    val pipe = LocationPipeline()
    circle(pipe, 60, accuracy = 25f)
    assertEquals(0.0, pipe.odometerMeters, 1e-9)
  }

  @Test fun noSpeedAddsNothing() {
    val pipe = LocationPipeline()
    var t = 1L
    while (t <= 60) { pipe.accept(at(t, 1.3 * t, 0.0, null), t * 1_000_000_000L); t++ }
    assertEquals(0.0, pipe.odometerMeters, 1e-9)
  }

  @Test fun stepsFurtherApartThanTenSecondsAreLeftToTheChord() {
    val pipe = LocationPipeline()
    circle(pipe, 120, every = 12)
    assertEquals(0.0, pipe.odometerMeters, 1e-9)
    val dense = LocationPipeline()
    circle(dense, 120, every = 5)
    assertTrue(dense.odometerMeters > 100.0)
  }

  @Test fun aNewRecordingStartsAtZero() {
    val first = LocationPipeline()
    circle(first, 30)
    assertTrue(first.odometerMeters > 30.0)
    val next = LocationPipeline()
    next.accept(at(1, 0.0, 0.0, 1.3f), 1_000_000_000L)
    assertEquals(0.0, next.latest!!.odometer!!, 1e-9)
  }
}
