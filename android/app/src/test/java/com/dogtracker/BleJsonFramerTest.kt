package com.dogtracker

import org.junit.Assert.*
import org.junit.Test

class BleJsonFramerTest {
  @Test fun fragmentedUtf8AndNestedObjects() {
    val framer = BleJsonFramer()
    val payload = """{"mid":3,"label":"中文 {犬}","extra":{"quoted":"a\\\"b"}}"""
    val result = mutableListOf<String>()
    for (byte in payload.toByteArray(Charsets.UTF_8)) result.addAll(framer.accept(byteArrayOf(byte)))
    assertEquals(listOf(payload), result)
  }

  @Test fun multiplePacketsAndTrailingFragment() {
    val framer = BleJsonFramer()
    assertEquals(listOf("{\"sid\":1}", "{\"sid\":2}"),
      framer.accept("noise\u0000{\"sid\":1}{\"sid\":2}{\"sid\":".toByteArray()))
    assertEquals(listOf("{\"sid\":3}"), framer.accept("3}".toByteArray()))
  }

  @Test fun reconnectDiscardsPreviousPartialPacket() {
    val framer = BleJsonFramer()
    assertTrue(framer.accept("{\"sid\":".toByteArray()).isEmpty())
    framer.reset()
    assertEquals(listOf("{\"sid\":2}"), framer.accept("{\"sid\":2}".toByteArray()))
  }

  @Test fun oversizePacketIsBoundedAndCanRecover() {
    val framer = BleJsonFramer()
    assertThrows(IllegalArgumentException::class.java) {
      framer.accept(("{\"x\":\"" + "a".repeat(65536)).toByteArray())
    }
    assertEquals(listOf("{\"sid\":2}"), framer.accept("{\"sid\":2}".toByteArray()))
  }
}
