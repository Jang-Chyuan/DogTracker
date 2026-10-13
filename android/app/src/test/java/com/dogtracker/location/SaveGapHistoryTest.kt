package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test

// PR 116: the night's save-gap counts survive a process end (counts/times only).
class SaveGapHistoryTest {
  private class Memory : SaveGapHistory.Store {
    var value: String? = null
    override fun get() = value
    override fun put(value: String, now: Boolean) { this.value = value }
  }
  private fun counters(received: Int) = SaveGapHistory.Counters(received, received - 2,
    mapOf("stale" to 2, "accuracy" to 0), received / 5, 0)
  private fun stretch(start: Long, end: Long?, motionOnly: Int = 0) = SaveGapLog.Stretch(start, end, 300, 4, 0,
    mapOf("stale" to 3, "accuracy" to 1), 0, 4.4, 35f, motionOnly)

  @Test fun aRecordingEndedWithItsProcessIsClosedAtItsLastCheckpointOnTheNextStart() {
    val memory = Memory()
    SaveGapHistory(memory).apply {
      begin(1_000L)
      stretchDone(stretch(2_000L, 302_000L, motionOnly = 1))
      checkpoint(400_000L, counters(100), stretch(320_000L, null))
    } // the process ends here: no end()
    val next = SaveGapHistory(memory)
    next.begin(900_000L)
    val lines = next.lines { "t$it" }
    assertTrue(lines[0], lines[0].startsWith("  run t1000 -> t400000 process ended"))
    assertTrue(lines[0].contains("\"received\":100"))
    assertTrue(lines[1], lines[1].startsWith("  run (this one) t900000"))
    assertTrue(lines[2], lines[2].contains("t2000 -> t302000 300s received=4 accepted=0"))
    assertTrue(lines[2].contains("maxStale=4.4s") && lines[2].contains("bestRejectedAccuracy=35.0m"))
    // Accuracy rejections that still reached the motion detector; shown only when there were any.
    assertTrue(lines[2], lines[2].endsWith("motionOnly=1"))
    assertFalse(lines[3], lines[3].contains("motionOnly"))
    // The stretch still going when the process ended is kept, marked as cut.
    assertTrue(lines[3], lines[3].contains("t320000 -> t400000+") && lines[3].endsWith("(process ended)"))
    assertEquals(4, lines.size)
    // Counts and times only.
    assertFalse(memory.value!!.contains("latitude") || memory.value!!.contains("longitude"))
  }

  @Test fun aStoppedRecordingEndsCleanlyAndTheHistoryStaysBounded() {
    val memory = Memory()
    val history = SaveGapHistory(memory, maxRuns = 3, maxStretches = 5)
    for (i in 0 until 6) {
      history.begin(i * 10_000L)
      history.stretchDone(stretch(i * 10_000L + 1, i * 10_000L + 2))
      history.stretchDone(stretch(i * 10_000L + 3, i * 10_000L + 4))
      history.end(i * 10_000L + 9_000, counters(10 + i))
    }
    val lines = SaveGapHistory(memory).lines { "t$it" }
    assertEquals(3, lines.count { it.startsWith("  run ") })
    assertEquals(5, lines.count { it.startsWith("  stretch ") })
    assertTrue(lines.first().startsWith("  run t30000 -> t39000 stopped"))
    assertFalse(lines.any { it.contains("(this one)") })
  }

  @Test fun unreadableStoredHistoryStartsOver() {
    val memory = Memory().apply { value = "not json" }
    val history = SaveGapHistory(memory)
    history.begin(5L)
    assertEquals(listOf("  run (this one) t5 -> t5 running {}"), history.lines { "t$it" })
  }
}
