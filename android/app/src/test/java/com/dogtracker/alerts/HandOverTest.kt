package com.dogtracker.alerts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// F7: a dog this phone hears while a teammate's cloud row of it is newer.
class HandOverTest {
  private val m = 60000L
  private val now = 100 * m
  private val receiverAt = LatLng(24.9890, 121.3130)
  private fun north(metres: Double) = LatLng(receiverAt.latitude + metres / 111_195.0, receiverAt.longitude)
  private fun packet(time: Long, at: LatLng?, slave: Int = 4) = Packet(slave, time, at, receiverAt, null, null)
  private val out = RangeState(status = Range.OUT, judgedAt = now - m, outSince = now - 5 * m, lastLocalAt = now - m,
    lastTime = now - m)

  @Test fun theAppsDogsKeepTheirNameAndJudgement() {
    val handed = AlertDog(4, name = "豆豆", fixAt = now - m, packetAt = now - m, range = out)
    val result = HandOver.merge(emptyMap(), mapOf(4 to handed), now)
    assertEquals("豆豆", result[4]?.name)
    assertEquals(Range.OUT, result[4]?.range?.status)
  }

  @Test fun theServiceKeepsItsNewerPacketsButTakesTheName() {
    val mine = Dogs.apply(null, packet(now - 10_000, north(1500.0)))
    val handed = AlertDog(4, name = "豆豆", packetAt = now - m, range = out)
    val result = HandOver.merge(mapOf(4 to mine), mapOf(4 to handed), now)
    assertEquals(now - 10_000, result[4]?.packetAt)
    assertEquals("豆豆", result[4]?.name)
  }

  @Test fun aDogLeftOutIsDroppedUnlessThisPhoneJustHeardIt() {
    val old = Dogs.apply(null, packet(now - 30 * m, north(100.0), slave = 5))
    val fresh = Dogs.apply(null, packet(now - 20_000, north(100.0), slave = 6)).copy(name = "阿福")
    val result = HandOver.merge(mapOf(5 to old, 6 to fresh), emptyMap(), now)
    assertFalse(5 in result)
    assertTrue(6 in result)
    assertEquals("阿福", result[6]?.name)
    // Renamed by the app while it was the cloud's.
    val renamed = HandOver.merge(mapOf(6 to fresh), emptyMap(), now, mapOf(6 to OtherDog(6, "小福", RangeState())))
    assertEquals("小福", renamed[6]?.name)
  }

  @Test fun aPacketOfACloudDogStartsFromItsNameAndJudgement() {
    val other = OtherDog(4, "豆豆", out.copy(cloudOnly = true, cloudSince = now - m))
    // Heard again 1.2 km away: still out (it clears only within 900 m), named.
    val dog = Dogs.apply(HandOver.start(null, other), packet(now, north(1200.0)))
    assertEquals("豆豆", dog.name)
    assertEquals(Range.OUT, dog.range.status)
    assertEquals(now - 5 * m, dog.range.outSince)
    assertFalse(dog.range.cloudOnly)
    // Without one, as before: a new dog.
    assertNull(HandOver.start(null, null))
    val known = AlertDog(4, name = "已知")
    assertEquals(known, HandOver.start(known, other))
  }

  @Test fun othersRoundTripThroughTheCodec() {
    val others = listOf(OtherDog(4, "豆豆", out), OtherDog(7, null, RangeState()))
    val read = AlertCodec.readOthers(AlertCodec.writeOthers(others))
    assertEquals(others.associateBy { it.slaveId }, read)
  }
}
