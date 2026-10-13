package com.dogtracker.alerts

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Replays __tests__/BatteryPlausibilityParity.test.js's fixture (fictional
 * packets): the port judges every packet as the app's
 * src/tracking/BatteryPlausibility.js does, and the background check's dog
 * (AlertCodec.readPacket → Dogs.apply, across a process restart) shows the
 * same reading the app's DogMerge would.
 */
class BatteryPlausibilityParityTest {
  private val fixture = JSONObject(javaClass.classLoader!!.getResourceAsStream("battery-plausibility-parity.json")!!
    .bufferedReader().readText())

  @Test fun theThresholdsAreTheApps() {
    val constants = fixture.getJSONObject("constants")
    assertEquals(constants.getDouble("maxPercent"), BatteryPlausibility.MAX_PERCENT, 0.0)
    assertEquals(constants.getDouble("emptyMaxMillivolts"), BatteryPlausibility.EMPTY_MAX_MV, 0.0)
    assertEquals(constants.getDouble("dropPoints"), BatteryPlausibility.DROP_POINTS, 0.0)
    assertEquals(constants.getInt("dropPackets"), BatteryPlausibility.DROP_PACKETS)
    assertEquals(constants.getDouble("agreePoints"), BatteryPlausibility.AGREE_POINTS, 0.0)
  }

  @Test fun everyPacketIsJudgedAsTheAppJudgesIt() {
    IndoorEnvironment.model = JSONObject(java.io.File("src/main/res/raw/indoor_model.json").readText())
    val cases: JSONArray = fixture.getJSONArray("cases")
    var steps = 0
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      var state: BatteryState? = null
      var dog: AlertDog? = null
      val rows = case.getJSONArray("steps")
      for (j in 0 until rows.length()) {
        val step = rows.getJSONObject(j)
        val label = case.getString("name") + ", step " + j
        val time = step.getLong("time")
        val packet = step.getJSONObject("packet")
        val valid = packet.optDouble("bv", 1.0) != 0.0
        val reading = if (!valid) null else BatteryReading(packet.getDouble("bp"),
          if (packet.has("bmv")) packet.getDouble("bmv") else null, time)
        state = BatteryPlausibility.advance(state, reading)
        val expected = step.getJSONObject("expect")
        val want = expected.optJSONObject("state")
        val accepted = want?.optJSONObject("accepted")
        if (accepted == null) assertNull(label, state.accepted) else {
          assertEquals(label, accepted.getDouble("percentage"), state.accepted!!.percentage, 0.0)
          assertEquals(label, accepted.getLong("at"), state.accepted!!.at)
        }
        val pending = want?.optJSONObject("pending")
        if (pending == null) assertNull(label, state.pending) else {
          assertEquals(label, pending.getDouble("percentage"), state.pending!!.percentage, 0.0)
          assertEquals(label, pending.getLong("at"), state.pending!!.at)
          assertEquals(label, pending.getInt("count"), state.pending!!.count)
        }
        if (want == null || want.isNull("judgedAt")) assertNull(label, state.judgedAt)
        else assertEquals(label, want.getLong("judgedAt"), state.judgedAt)
        // The background check's dog, through a process restart after every packet.
        dog = Dogs.apply(dog, AlertCodec.readPacket(packet, time)!!)
        dog = AlertCodec.readDog(AlertCodec.writeDog(dog))!!
        val shown = if (expected.isNull("batteryPercentage")) null else expected.getInt("batteryPercentage")
        assertEquals(label, shown, dog.batteryPercentage)
        steps += 1
      }
    }
    assertTrue(steps >= 30)
  }
}
