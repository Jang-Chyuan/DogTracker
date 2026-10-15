package com.dogtracker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DatabaseWaitsTest {
  @Test fun summarisesEachWriterApart() {
    val waits = DatabaseWaits()
    for (ms in 1L..100L) waits.waited("ble", ms)
    waits.waited("location", 16_000)
    val ble = waits.wait("ble")!!
    assertEquals(100, ble.count)
    assertEquals(50, ble.p50)
    assertEquals(95, ble.p95)
    assertEquals(100, ble.max)
    assertEquals(0, ble.over1s)
    val location = waits.wait("location")!!
    assertEquals(1, location.over1s)
    assertEquals(1, location.over5s)
    assertEquals(1, location.over15s)
    assertNull(waits.wait("other"))
  }

  @Test fun percentilesCoverTheRecentWindowAndMaxTheWholeProcess() {
    val waits = DatabaseWaits(window = 10)
    waits.waited("ble", 9_000)
    repeat(10) { waits.waited("ble", 2) }
    val ble = waits.wait("ble")!!
    assertEquals(11, ble.count)
    assertEquals(2, ble.p95)
    assertEquals(9_000, ble.max)
    assertEquals(1, ble.over5s)
  }

  @Test fun negativeTimesCountAsZero() {
    val waits = DatabaseWaits()
    waits.held("batch", -5)
    assertEquals(0, waits.hold("batch")!!.max)
  }

  @Test fun linesCarryOnlyNamesAndNumbers() {
    val waits = DatabaseWaits()
    assertTrue(waits.lines().contains("  none yet"))
    waits.waited("ble", 1_200)
    waits.held("batch", 4_000)
    waits.oversizedRead()
    val text = waits.lines().joinToString("\n")
    assertTrue(text, text.contains("ble n=1 p50=1200ms p95=1200ms max=1200ms >=1s=1 >=5s=0 >=15s=0"))
    assertTrue(text, text.contains("batch n=1 p50=4000ms"))
    assertTrue(text, text.contains("too large for one cursor window): 1"))
  }
}
