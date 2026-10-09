package com.dogtracker.alerts

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertRulesTest {
  private val m = 60000L
  private val receiverAt = LatLng(24.9890, 121.3130)
  // About `metres` north of the receiver.
  private fun north(metres: Double) = LatLng(receiverAt.latitude + metres / 111_195.0, receiverAt.longitude)
  private fun packet(time: Long, at: LatLng?, battery: Int? = null, slave: Int = 4) =
    Packet(slave, time, at, receiverAt, battery, null)
  private val receiver = ReceiverInput(true, true, true, 0, 7, 62, null, emptyList())

  // 判定表「接收範圍的狀態轉換」: > 1 km out; back only after 2 positions within
  // 900 m spanning 2 minutes; 800 m–1 km is near.
  @Test fun rangeGoesOutAndClearsOnlyAfterTwoPositionsOverTwoMinutes() {
    var dog = Dogs.apply(null, packet(0, north(100.0)))
    assertEquals(Range.IN, dog.range.status)
    dog = Dogs.apply(dog, packet(1000, north(1200.0)))
    assertEquals(Range.OUT, dog.range.status)
    dog = Dogs.apply(dog, packet(2000, north(850.0)))
    dog = Dogs.apply(dog, packet(2000 + 1 * m, north(850.0)))
    assertEquals(Range.OUT, dog.range.status)
    dog = Dogs.apply(dog, packet(2000 + 2 * m, north(950.0)))
    assertEquals("beyond 900 m starts again", emptyList<Long>(), dog.range.clearing)
    dog = Dogs.apply(dog, packet(3000 + 2 * m, north(850.0)))
    dog = Dogs.apply(dog, packet(3000 + 4 * m, north(850.0)))
    assertEquals(Range.NEAR, dog.range.status)
  }

  @Test fun aReplayedOrPositionlessPacketDoesNotJudge() {
    val dog = Dogs.apply(null, packet(1000, north(1500.0)))
    assertEquals(dog, Dogs.apply(dog, packet(1000, north(10.0))))
    val quiet = Dogs.apply(dog, packet(2000, null, battery = 50))
    assertEquals(Range.OUT, quiet.range.status)
    assertEquals(1000L, quiet.fixAt)
    assertEquals(2000L, quiet.packetAt)
    assertEquals(50, quiet.batteryPercentage)
  }

  // A dog the app handed over as held indoors: timed by its packets, no range
  // judgement, until two positions clearly away let it go.
  @Test fun aHeldDogIsTimedByPacketsAndLetGoWhenItLeaves() {
    val held = AlertDog(4, "阿福", coordinate = north(10.0), fixAt = 0, packetAt = 0, held = true,
      range = RangeState(status = Range.IN, lastLocalAt = 0))
    var dog = Dogs.apply(held, packet(11 * m, north(30.0)))
    assertTrue(dog.held)
    assertFalse(FreshnessRule.of(dog.copy(fixAt = 0), 12 * m, emptyList()).stale)
    dog = Dogs.apply(dog, packet(12 * m, north(1500.0)))
    assertTrue(dog.held)
    assertEquals(Range.IN, dog.range.status)
    dog = Dogs.apply(dog, packet(13 * m, north(1500.0)))
    assertFalse(dog.held)
    assertEquals(Range.OUT, dog.range.status)
    assertEquals(north(1500.0), dog.coordinate)
  }

  // Codex review: weak indoor drift never lets a hold go; an invalid
  // battery reading is no reading (DogMerge).
  @Test fun weakFixesKeepTheHoldAndAnInvalidBatteryIsNone() {
    val held = AlertDog(4, coordinate = north(10.0), fixAt = 0, packetAt = 0, held = true, batteryPercentage = 15)
    var dog = Dogs.apply(held, packet(1000, north(1500.0)).copy(good = false))
    dog = Dogs.apply(dog, packet(2000, north(1500.0)).copy(good = false))
    assertTrue(dog.held)
    assertNull(dog.batteryPercentage)
    assertFalse(Dogs.good(3.0, 1.0))
    assertFalse(Dogs.good(8.0, 350.0))
    assertTrue(Dogs.good(8.0, 120.0))
    assertTrue(Dogs.good(null, 65535.0))
  }

  // 判定表「中斷連線時的狀態」: no 沒有新位置 while the user has the receiver off.
  @Test fun theUsersOwnDisconnectHoldsTheStaleClock() {
    val dog = AlertDog(4, coordinate = north(10.0), fixAt = 0, packetAt = 0)
    assertTrue(FreshnessRule.of(dog, 11 * m, emptyList()).stale)
    assertFalse(FreshnessRule.of(dog, 30 * m, listOf(ReceiverPause(5 * m, null))).stale)
    assertFalse(FreshnessRule.of(dog, 30 * m, listOf(ReceiverPause(5 * m, 25 * m))).stale)
    assertTrue(FreshnessRule.of(dog, 36 * m, listOf(ReceiverPause(5 * m, 25 * m))).stale)
    assertFalse("never located: not drawn, no problems", FreshnessRule.of(AlertDog(4), 60 * m, emptyList()).drawn)
  }

  // 「暫停」: only the problems known at that moment; a new dog still alerts.
  @Test fun aPauseSilencesTheKnownProblemsOnly() {
    val stale = AlertDog(4, "豆豆", coordinate = north(10.0), fixAt = 0, packetAt = 0)
    var state = Events.update(AlertState(), listOf(stale), receiver, 11 * m)
    state = Scheduler.schedule(state, 11 * m, AlertPreferences(), true).first
    state = Scheduler.pause(state, 12 * m)
    assertEquals(42 * m, state.pause!!.until)
    val other = AlertDog(5, "小黑", coordinate = north(10.0), fixAt = 13 * m, packetAt = 13 * m, batteryPercentage = 15)
    state = Events.update(state, listOf(stale, other), receiver, 13 * m)
    val (_, effects) = Scheduler.schedule(state, 13 * m, AlertPreferences(), true)
    assertEquals(listOf("dog-battery:5"), effects.delivered)
    assertEquals("notify", effects.notification)
    val quiet = Scheduler.schedule(Events.update(AlertState(pause = state.pause, seen = state.seen,
      active = state.active), listOf(stale), receiver, 14 * m), 14 * m, AlertPreferences(), true).second
    assertEquals("cancel", quiet.notification)
  }

  // A cloud dog (not heard here) keeps the app's judgement until the app is back.
  @Test fun aDogNotHeardHereKeepsItsStateAndIsNotAlerted() {
    val previous = AlertCodec.readState(JSONObject().put("version", 1)
      .put("active", JSONObject().put("dog-stale:9", JSONObject().put("key", "dog-stale:9").put("startedAt", 5).put("level", 1)))
      .put("seen", JSONObject().put("dog-stale:9", JSONObject().put("token", "5:1").put("at", 5).put("reminded", false)))
      .toString())
    val state = Events.update(previous, emptyList(), receiver, 60 * m)
    assertFalse(state.active.getValue("dog-stale:9").present)
    val (next, effects) = Scheduler.schedule(state, 60 * m, AlertPreferences(), true)
    assertEquals("cancel", effects.notification)
    assertEquals("5:1", next.seen.getValue("dog-stale:9").token)
  }

  @Test fun packetsInTheStoresLongAndShortKeys() {
    val short = AlertCodec.readPacket(JSONObject("""{"sid":4,"slat":24.99,"slon":121.31,"mlat":24.98,"mlon":121.31,"bp":18,"bv":1,"usbPresent":0}"""), 1000)!!
    assertEquals(4, short.slaveId)
    assertEquals(18, short.batteryPercentage)
    assertEquals(false, short.usb)
    val long = AlertCodec.readPacket(JSONObject("""{"slave_id":5,"slave_lat":0,"slave_lon":0,"battery_pct":40,"battery_valid":0}"""), 1000)!!
    assertNull("0,0 is no fix", long.dog)
    assertNull("an invalid battery reading is not used", long.batteryPercentage)
    assertNull(AlertCodec.readPacket(JSONObject("""{"sid":0}"""), 1))
    assertEquals(55, AlertCodec.readReceiverBattery(JSONObject("""{"mbp":55,"mbv":1}""")))
    assertNull(AlertCodec.readReceiverBattery(JSONObject("""{"mbp":55,"mbv":0}""")))
  }

  @Test fun theHandedOverDogReadsBack() {
    val dog = AlertDog(4, "豆豆", north(5.0), 10, 20, true, 1, 30, true,
      RangeState(Range.OUT, 10, 9, listOf(11L), 0, 20, 20, false, null))
    assertEquals(dog, AlertCodec.readDog(AlertCodec.writeDog(dog)))
  }

  @Test fun theNotificationWordsAndDurations() {
    assertEquals("0 分鐘", Content.duration(0))
    assertEquals("59 分鐘", Content.duration(59 * m + 59000))
    assertEquals("125 分鐘", Content.duration(125 * m))
    assertEquals("4320 分鐘", Content.duration(3 * 24 * 60 * m))
    val storage = AlertEvent("storage:phone", "storage", "phone", 0, storageFull = false)
    assertEquals(Target("diagnostics"), Content.target(storage))
    assertEquals(Target("system-storage"), Content.target(storage.copy(storageFull = true)))
    assertTrue(Events.isFull("database or disk is full"))
    assertEquals("接收器 斷線了", Content.line(AlertEvent("receiver-disconnected:receiver", "receiver-disconnected", "receiver", 0)))
  }
}
