package com.dogtracker.alerts

import com.dogtracker.NativeCopy
import com.dogtracker.R
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The background check judges exactly as the app in front: every step of the
 * scenarios in alert-parity.json (written by __tests__/AlertParity.test.js
 * from the JavaScript) through the Kotlin port.
 */
class AlertParityTest {
  private fun scenarios(): JSONArray {
    val text = javaClass.classLoader!!.getResourceAsStream("alert-parity.json")!!.bufferedReader().readText()
    return JSONArray(text)
  }

  @Test fun notificationResourcesAgreeWithZhTw() {
    val loader = javaClass.classLoader!!
    val js = JSONObject(loader.getResourceAsStream("zh-TW.json")!!.bufferedReader().use { it.readText() })
    val pairs = JSONArray(loader.getResourceAsStream("native-parity.json")!!.bufferedReader().use { it.readText() })
    val placeholder = Regex("\\{\\{([^{}]+)\\}\\}")
    for (index in 0 until pairs.length()) {
      val pair = pairs.getJSONObject(index)
      val nativeName = pair.getString("native")
      val template = js.getString(pair.getString("js"))
      val params = placeholder.findAll(template).mapIndexed { i, _ -> "copy-${i + 1}" }.toList()
      var at = 0
      val expected = placeholder.replace(template) { params[at++] }
      val id = R.string::class.java.getField(nativeName).getInt(null)
      assertEquals(nativeName, expected, NativeCopy.text(id, *params.toTypedArray()))
    }
  }

  // JSON as plain values (numbers as Double), for a comparison that ignores key order.
  private fun plain(value: Any?): Any? = when (value) {
    is JSONObject -> value.keys().asSequence().associateWith { plain(value.opt(it)) }
    is JSONArray -> (0 until value.length()).map { plain(value.opt(it)) }
    is Number -> value.toDouble()
    JSONObject.NULL -> null
    else -> value
  }

  private fun strings(array: JSONArray) = (0 until array.length()).map { array.getString(it) }

  @Test fun everyStepAgreesWithTheApp() {
    val all = scenarios()
    var steps = 0
    for (index in 0 until all.length()) {
      val scenario = all.getJSONObject(index)
      val name = scenario.getString("name")
      val preferences = AlertCodec.readPreferences(scenario.getJSONObject("preferences"))
      var state = AlertState()
      val list = scenario.getJSONArray("steps")
      for (step in 0 until list.length()) {
        val value = list.getJSONObject(step)
        val at = value.getLong("at")
        val rx = value.getJSONObject("receiver")
        val pauses = value.optJSONArray("pauses")?.let { array ->
          (0 until array.length()).map { array.getJSONObject(it) }.map {
            ReceiverPause(it.getLong("pausedAt"), if (it.isNull("resumedAt")) null else it.getLong("resumedAt"))
          }
        } ?: emptyList()
        val receiver = ReceiverInput(
          enabled = rx.getBoolean("enabled"), running = rx.getBoolean("running"), connected = rx.getBoolean("connected"),
          disconnectedAt = rx.getLong("disconnectedAt"), number = rx.getInt("number"),
          batteryPercentage = if (rx.isNull("batteryPercentage")) null else rx.getInt("batteryPercentage"),
          storageError = if (value.has("storageError") && !value.isNull("storageError")) value.getString("storageError") else null,
          pauses = pauses,
        )
        val dogs = AlertCodec.readDogs(value.getJSONArray("dogs")).values
        val events = Events.update(state, dogs, receiver, at)
        val (next, effects) = Scheduler.schedule(events, at, preferences, value.optBoolean("allowed", true))
        state = if (value.optString("action") == "pause") Scheduler.pause(next, at) else next
        if (value.optString("action") == "restart") state = AlertCodec.readState(AlertCodec.writeState(state))
        val expect = value.getJSONObject("expect")
        val label = "$name, step $step"
        assertEquals(label, expect.getString("notification"), effects.notification)
        assertEquals(label, if (expect.isNull("title")) null else expect.getString("title"), effects.content?.title)
        assertEquals(label, strings(expect.getJSONArray("lines")), effects.content?.lines ?: emptyList<String>())
        if (!expect.isNull("target")) {
          val target = expect.getJSONObject("target")
          assertEquals(label, target.getString("screen"), effects.content?.target?.screen)
          assertEquals(label, if (target.has("dogId")) target.get("dogId").toString() else null, effects.content?.target?.dogId)
        }
        assertEquals(label, strings(expect.getJSONArray("delivered")), effects.delivered)
        val vibration = if (expect.isNull("vibration")) null else expect.getJSONArray("vibration").let { array ->
          LongArray(array.length()) { array.getLong(it) }
        }
        if (vibration == null) assertEquals(label, null, effects.vibration)
        else assertArrayEquals(label, vibration, effects.vibration)
        assertEquals(label, expect.getBoolean("critical"), effects.critical)
        assertEquals(label, expect.getBoolean("sound"), effects.sound)
        // The saved state, in the app's format.
        val written = JSONObject(AlertCodec.writeState(state))
        assertEquals(label, plain(expect.getJSONObject("state")), plain(written))
        // And it reads back the same.
        assertEquals(label, AlertCodec.writeState(state), AlertCodec.writeState(AlertCodec.readState(written.toString())))
        steps += 1
      }
    }
    assertTrue(steps >= 20)
  }
  @Test fun indoorPacketsAgreeWithForegroundTracker() {
    IndoorEnvironment.model = JSONObject(java.io.File("src/main/res/raw/indoor_model.json").readText())
    val scenarios = JSONArray(javaClass.classLoader!!.getResourceAsStream("indoor-parity.json")!!.bufferedReader().readText())
    for (i in 0 until scenarios.length()) {
      val scenario = scenarios.getJSONObject(i)
      var dog = AlertCodec.readDog(scenario.getJSONObject("initial"))!!
      val rows = scenario.getJSONArray("rows")
      for (j in 0 until rows.length()) {
        val step = rows.getJSONObject(j); val row = step.getJSONObject("row")
        val packetJson = JSONObject(row.toString()).put("slave_lat", row.getDouble("latitude")).put("slave_lon", row.getDouble("longitude"))
          .put("master_lat", row.getDouble("master_latitude")).put("master_lon", row.getDouble("master_longitude"))
        dog = Dogs.apply(dog, AlertCodec.readPacket(packetJson, row.getLong("time"))!!)
        // Process death between packets must preserve the exact same tracker.
        dog = AlertCodec.readDog(AlertCodec.writeDog(dog))!!
        val expected = step.getJSONObject("expect"); val label = scenario.getString("name") + ", step " + j
        assertEquals(label, expected.getBoolean("held"), dog.held)
        assertEquals(label, expected.getJSONObject("coordinate").getDouble("latitude"), dog.coordinate!!.latitude, 1e-9)
        assertEquals(label, expected.getJSONObject("coordinate").getDouble("longitude"), dog.coordinate!!.longitude, 1e-9)
        val why = JSONObject(dog.indoorState!!).optJSONObject("previousHold")?.optString("why")
        assertEquals(label, if (expected.isNull("why")) null else expected.getString("why"), why)
      }
    }
  }

}
