package com.dogtracker.location

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneMotionParityTest {
  @Test fun historyReplayAndNativeMotionAgree() {
    val cases = JSONArray(javaClass.classLoader!!.getResourceAsStream("phone-motion-parity.json")!!.bufferedReader().readText())
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val samples = case.getJSONArray("samples")
      val detector = MotionDetector()
      for (j in 0 until samples.length()) {
        val row = samples.getJSONObject(j)
        val t = Math.round(row.getDouble("t") * 1000)
        val speed = if (row.isNull("speed")) null else (row.getDouble("speed") / 3.6).toFloat()
        val spread = if (row.isNull("sacc")) null else row.getDouble("sacc").toFloat()
        // x metres north, optional y metres east (generate-phone-motion-parity.cjs).
        val east = if (row.has("y")) row.getDouble("y") else 0.0
        val point = LocationSample(25 + row.getDouble("x") / 111195, 121 + east / 100777, row.getDouble("accuracy").toFloat(),
          t * 1_000_000, t, speed, speedAccuracy = spread)
        assertEquals("${case.getString("name")} t=$t", row.getString("state"), detector.accept(point))
      }
    }
  }
}
