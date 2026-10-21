package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.cos

// 2026-10-21 (user): on a confirmed stop the recorder asks for balanced-power
// fixes about every 30 s instead of high accuracy every second, and goes back
// to 1 s as soon as the phone moves. The pipeline holds the stop meanwhile:
// coarse fixes add no distance and no move. Fictional positions only.
class StationaryPowerModeTest {
  private val s = 1_000_000_000L
  private val north = 1 / 111195.0
  private val east = 1 / (111195.0 * cos(Math.toRadians(25.0)))
  private fun fix(t: Double, n: Double = 0.0, e: Double = 0.0, accuracy: Float = 6f, speed: Float? = 0f,
    spread: Float? = 0.2f) = LocationSample(25 + n * north, 121.0 + e * east, accuracy, (t * s).toLong(),
      (t * 1000).toLong(), speed, speedAccuracy = spread, provider = "play-fused")

  /** The service's loop: each fix through the pipeline, then the mode's decision. */
  private class Recorder(start: Long = 0L) {
    val pipe = LocationPipeline()
    val power = StationaryPowerMode(start)
    val saved = mutableListOf<LocationSample>()
    var lowAt: Long? = null
    var highAt: Long? = null
    fun feed(sample: LocationSample): Boolean {
      val now = sample.elapsedNanos
      val ok = pipe.accept(sample, now)
      if (pipe.lowPower) {
        pipe.lowExit?.let { exit(now, it) }
      } else if (power.shouldDownshift(now, pipe.stationarySince, pipe.judgedAt) && pipe.enterLowPower()) {
        power.enterLow(now); lowAt = now
      }
      // The writer's tick right after the fix.
      pipe.candidate(now)?.let { saved += it; pipe.written(it, now) }
      return ok
    }
    fun exit(now: Long, reason: StationaryPowerMode.Exit) {
      pipe.exitLowPower(); if (power.exitLow(now, reason)) highAt = now
    }
  }

  /** Still, fine fixes once a second from 1 s to `until` s. */
  private fun Recorder.still(from: Int, until: Int) { for (t in from..until) feed(fix(t.toDouble())) }

  @Test fun theRequestsAreHighOneSecondAndBalancedThirtySeconds() {
    assertEquals(LocationSource.Request(com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY, 1000L, 1000L),
      LocationSource.fusedRequest(false))
    assertEquals(LocationSource.Request(com.google.android.gms.location.Priority.PRIORITY_BALANCED_POWER_ACCURACY,
      30_000L, 30_000L), LocationSource.fusedRequest(true))
    assertEquals("play-fused-low", LocationSource.label(LocationSource.Choice.PlayFused, "fused", true))
    assertEquals("play-fused", LocationSource.label(LocationSource.Choice.PlayFused, "fused"))
  }

  @Test fun aStillPhoneDownshiftsThreeMinutesAfterTheStopIsConfirmed() {
    val r = Recorder()
    r.still(1, 200)
    // Confirmed at 21 s (20 s of still fixes); three minutes later, not before.
    assertFalse(r.pipe.lowPower)
    r.feed(fix(201.0))
    assertTrue(r.pipe.lowPower)
    assertEquals(201 * s, r.lowAt)
    assertEquals(1, r.power.downshifts)
  }

  @Test fun aStopThatKeepsBreakingNeverDownshifts() {
    val r = Recorder()
    // Still for 2 min, a few steps, still again for 2 min: never 3 min in a row.
    r.still(1, 120)
    for (t in 121..130) r.feed(fix(t.toDouble(), n = (t - 120) * 1.3, speed = 1.3f))
    for (t in 131..250) r.feed(fix(t.toDouble(), n = 13.0))
    assertFalse(r.pipe.lowPower)
    assertNull(r.lowAt)
  }

  @Test fun walkingAwayGoesBackToHighOnTheFirstLowPowerFixOutsideTheStop() {
    val r = Recorder()
    r.still(1, 201)
    assertTrue(r.pipe.lowPower)
    // Low power: Wi-Fi fixes ~30 s apart, 20 m, wandering a few metres.
    var t = 231.0
    while (t < 1800) { assertTrue(r.feed(fix(t, n = (t % 7) - 3, accuracy = 20f))); t += 30 }
    assertTrue(r.pipe.lowPower)
    // Sets off at 1800 s, 1.3 m/s north; the coarse fix measures no speed.
    val left = 1800.0
    var exitAt: Double? = null
    t = left + 30
    while (exitAt == null && t < left + 300) {
      r.feed(fix(t, n = (t - left) * 1.3, accuracy = 20f, speed = 0f, spread = 1.2f))
      if (!r.pipe.lowPower) exitAt = t
      t += 30
    }
    // 39 m out, beyond max(25, 1.5 × 20) m: the first fix after leaving.
    assertEquals(left + 30, exitAt!!, 0.0)
    assertEquals(mapOf("left-stop" to 1), r.power.exits)
    assertEquals(1, r.pipe.rejectedBy["moved"])
  }

  @Test fun aReliableSpeedOrTheSensorGoesBackAtOnce() {
    val r = Recorder()
    r.still(1, 201)
    r.feed(fix(231.0, n = 5.0, accuracy = 15f, speed = 1.4f, spread = 0.3f))
    assertFalse(r.pipe.lowPower)
    assertEquals(mapOf("speed" to 1), r.power.exits)

    val q = Recorder()
    q.still(1, 201)
    // The significant-motion trigger right after the downshift: back without any fix.
    q.exit(205 * s, StationaryPowerMode.Exit.SIGNIFICANT_MOTION)
    assertFalse(q.pipe.lowPower)
    assertEquals(mapOf("significant-motion" to 1), q.power.exits)
  }

  @Test fun heldRowsKeepTheLockedCoordinateAndAddNoDistance() {
    val r = Recorder()
    r.still(1, 201)
    val locked = r.pipe.latest!!
    val odometer = r.pipe.odometerMeters
    val before = r.saved.size
    // One hour of Wi-Fi fixes 25–35 s apart, 10–45 m, up to 20 m off the stop, 0 ± 1 m/s.
    var t = 230.0; var k = 0
    while (t < 3800) {
      val accuracy = floatArrayOf(12f, 28f, 45f, 18f, 30f)[k % 5]
      r.feed(fix(t, n = ((k * 7) % 41 - 20).toDouble() * 0.5, e = ((k * 11) % 31 - 15).toDouble() * 0.5,
        accuracy = accuracy, speed = 0f, spread = 1f))
      t += 25.0 + (k * 3) % 11; k++
    }
    assertTrue(r.pipe.lowPower)
    assertNull(r.pipe.lowExit)
    val held = r.saved.drop(before)
    // Every fix that passes the 30 m gate is a held row; the 45 m ones are not saved.
    assertEquals((0 until k).count { it % 5 != 2 }, held.size)
    held.forEach {
      assertEquals(locked.latitude, it.latitude, 0.0)
      assertEquals(locked.longitude, it.longitude, 0.0)
      assertEquals("stationary", it.motionState)
      assertEquals(0f, it.speed)
      assertEquals(odometer, it.odometer!!, 0.0)
      assertEquals("play-fused", it.provider) // the service labels it play-fused-low
      assertTrue(it.accuracy <= 30f)
    }
    // Their own raw fix is kept (not the lock).
    assertTrue(held.any { it.rawLatitude != locked.latitude })
    assertEquals(odometer, r.pipe.odometerMeters, 0.0)
  }

  @Test fun backInHighTheWalkStartsAfreshAndOnlyItCounts() {
    val r = Recorder()
    r.still(1, 201)
    for (t in listOf(231.0, 262.0, 293.0)) r.feed(fix(t, accuracy = 20f))
    val odometer = r.pipe.odometerMeters
    r.exit(300 * s, StationaryPowerMode.Exit.SIGNIFICANT_MOTION)
    // The first 1 s fix 8 s later and 10 m away: no jump test against the held row, no step counted.
    assertTrue(r.feed(fix(301.0, n = 10.0, accuracy = 5f, speed = 1.3f)))
    assertEquals("moving", r.pipe.latest!!.motionState)
    assertEquals(odometer, r.pipe.odometerMeters, 0.0)
    for (t in 302..360) r.feed(fix(t.toDouble(), n = 10.0 + (t - 301) * 1.3, accuracy = 5f, speed = 1.3f))
    // 59 s at 1.3 m/s, smoothed: about 77 m, all of it the walk.
    assertEquals(59 * 1.3, r.pipe.odometerMeters - odometer, 3.0)
  }

  @Test fun theDwellHoldsHighForThreeMinutesAfterAnExit() {
    val power = StationaryPowerMode(0L)
    power.enterLow(200 * s)
    power.exitLow(210 * s, StationaryPowerMode.Exit.SIGNIFICANT_MOTION)
    // Stationary evidence alone is not enough within three minutes of the exit.
    assertFalse(power.shouldDownshift(389 * s, 0L, 389 * s))
    assertTrue(power.shouldDownshift(390 * s, 0L, 390 * s))
    // Nor on a stale judgement.
    assertFalse(power.shouldDownshift(400 * s, 0L, 384 * s))
  }

  @Test fun noFlappingAfterAnExit() {
    val r = Recorder()
    r.still(1, 201)
    r.exit(202 * s, StationaryPowerMode.Exit.SIGNIFICANT_MOTION)
    // Picked up and put down again: still from 203 s. The detector confirms
    // at 223 s (20 s), then three more minutes; the dwell (three minutes from
    // the exit, 382 s) is over by then.
    r.still(203, 402)
    assertFalse(r.pipe.lowPower)
    r.still(403, 403)
    assertTrue(r.pipe.lowPower)
    assertEquals(403 * s, r.lowAt)
  }

  @Test fun silenceWithoutUsableFixesGoesBackToHigh() {
    val r = Recorder()
    r.still(1, 201)
    // Only 40 m Wi-Fi fixes: consistent, never saved, never usable.
    var t = 231.0
    while (t <= 501) { r.feed(fix(t, accuracy = 40f)); t += 30 }
    assertTrue(r.pipe.lowPower)
    assertFalse(r.power.silent(501 * s, r.pipe.lowUsableAt))
    assertTrue(r.power.silent(502 * s, r.pipe.lowUsableAt))
    // A stale fix (22 s old on arrival) does not count as usable either.
    assertFalse(r.pipe.accept(fix(480.0, accuracy = 10f), 502 * s))
    assertEquals(1, r.pipe.rejectedBy["stale"])
    assertTrue(r.power.silent(502 * s, r.pipe.lowUsableAt))
    r.exit(502 * s, StationaryPowerMode.Exit.SILENCE)
    assertEquals(mapOf("silence" to 1), r.power.exits)
    assertEquals(301L, r.power.lowSeconds(600 * s))
  }

  @Test fun aJumpInLowPowerIsNoMoveAndNoRow() {
    val r = Recorder()
    r.still(1, 201)
    val locked = r.pipe.latest
    val rows = r.saved.size
    assertFalse(r.feed(fix(231.0, n = 500.0, accuracy = 25f)))
    assertSame(locked, r.pipe.latest)
    assertEquals(rows, r.saved.size)
    assertFalse(r.pipe.lowPower)
    assertEquals(mapOf("left-stop" to 1), r.power.exits)
  }

  @Test fun theNoticeWaitsForTwoMissedLowPowerFixes() {
    assertEquals(RecordingNotice.POOR_SIGNAL, RecordingNotice.during(true, 45.0, 600.0))
    assertEquals(RecordingNotice.RECORDING, RecordingNotice.during(true, 45.0, 600.0, lowPower = true))
    assertEquals(RecordingNotice.RECORDING, RecordingNotice.during(true, 90.0, 600.0, lowPower = true))
    assertEquals(RecordingNotice.POOR_SIGNAL, RecordingNotice.during(true, 91.0, 600.0, lowPower = true))
    assertEquals(RecordingNotice.LOCATION_OFF, RecordingNotice.during(false, 5.0, 600.0, lowPower = true))
  }
}
