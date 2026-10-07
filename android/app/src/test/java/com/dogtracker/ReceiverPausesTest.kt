package com.dogtracker

import org.junit.Assert.assertEquals
import org.junit.Test

class ReceiverPausesTest {
  @Test
  fun recordsPausesAndResumes() {
    var text = ReceiverPauses.paused(null, 1000)
    assertEquals("1000:0", text)
    // Stopping again while off keeps the first time.
    text = ReceiverPauses.paused(text, 2000)
    assertEquals("1000:0", text)
    text = ReceiverPauses.resumed(text, 3000)
    assertEquals("1000:3000", text)
    // A later reconnect (link dropped and came back) does not move it.
    assertEquals("1000:3000", ReceiverPauses.resumed(text, 4000))
    text = ReceiverPauses.paused(text, 5000)
    assertEquals(listOf(ReceiverPauses.Pause(1000, 3000), ReceiverPauses.Pause(5000, 0)), ReceiverPauses.parse(text))
  }

  @Test
  fun keepsTheLastEntriesAndIgnoresDamage() {
    var text = ""
    for (index in 1..12) text = ReceiverPauses.resumed(ReceiverPauses.paused(text, index * 10L), index * 10L + 5)
    val pauses = ReceiverPauses.parse(text)
    assertEquals(ReceiverPauses.MAX, pauses.size)
    assertEquals(50L, pauses.first().pausedAt)
    assertEquals(listOf(ReceiverPauses.Pause(7, 0)), ReceiverPauses.parse("x,7:0,8:y,:,-1:0"))
    assertEquals("", ReceiverPauses.resumed(null, 1))
  }
}
