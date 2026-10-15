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

  private val packet = "{\"type\":3,\"mid\":3,\"sid\":1,\"lat\":25.0,\"lon\":121.0,\"seq\":7}"

  // One notification cut short (longer than the link's MTU, or a lost
  // fragment) used to swallow every later packet until the 64 KB overflow.
  @Test fun truncatedNotificationDoesNotSwallowTheNextPackets() {
    val framer = BleJsonFramer()
    assertTrue(framer.accept("{\"type\":3,\"mid\":3,\"sid\":1,\"lat\":25.0".toByteArray(), 1_000).isEmpty())
    val delivered = (1..1200).flatMap { framer.accept(packet.toByteArray(), 1_000L + it * 1_000) }
    assertEquals(1200, delivered.size)
    assertEquals(packet, delivered.first())
    assertEquals(1, framer.resyncs)
  }

  @Test fun truncatedFragmentBeforeAFragmentedPacketResyncsOnTheGap() {
    val framer = BleJsonFramer()
    assertTrue(framer.accept("{\"type\":3,\"mid\":3".toByteArray(), 1_000).isEmpty())
    // The next packet in 20-byte notifications, a second later.
    val chunks = packet.toByteArray().toList().chunked(20).map { it.toByteArray() }
    val delivered = chunks.mapIndexed { i, chunk -> framer.accept(chunk, 2_000L + i * 10) }.flatten()
    assertEquals(listOf(packet), delivered)
    assertEquals(1, framer.resyncs)
  }

  @Test fun quickFragmentsOfOnePacketAreNotResynced() {
    val framer = BleJsonFramer()
    val chunks = packet.toByteArray().toList().chunked(5).map { it.toByteArray() }
    val delivered = chunks.mapIndexed { i, chunk -> framer.accept(chunk, 1_000L + i * 15) }.flatten()
    assertEquals(listOf(packet), delivered)
    assertEquals(0, framer.resyncs)
    assertEquals(packet.length, framer.largest)
  }

  @Test fun coalescedCompletePacketsInOneNotificationResyncOnce() {
    val framer = BleJsonFramer()
    framer.accept("{\"sid\":".toByteArray(), 1_000)
    assertEquals(listOf("{\"sid\":2}", "{\"sid\":3}"), framer.accept("\u0000{\"sid\":2}{\"sid\":3}".toByteArray(), 1_050))
    assertEquals(1, framer.resyncs)
  }
}
