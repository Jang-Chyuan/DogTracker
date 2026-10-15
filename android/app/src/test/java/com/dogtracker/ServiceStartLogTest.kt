package com.dogtracker

import org.junit.Assert.*
import org.junit.Test

// F6: a START_STICKY restart the system refuses is recorded, not a crash.
class ServiceStartLogTest {
  private class Memory : ServiceStartLog.Store {
    var value: String? = null
    override fun get() = value
    override fun put(value: String) { this.value = value }
  }
  // The JVM has no android.app classes: the same name and base class as Android 12's.
  private class ForegroundServiceStartNotAllowedException(message: String) : IllegalStateException(message)

  @Test fun aNullIntentIsTheSystemsRestart() {
    assertEquals(ServiceStartLog.Kind.RESTART, ServiceStartLog.kindOf(intentWasNull = true))
    assertEquals(ServiceStartLog.Kind.START, ServiceStartLog.kindOf(intentWasNull = false))
  }

  @Test fun aRefusedRestartIsCaughtRecordedAndKeptAcrossProcessEnds() {
    val memory = Memory()
    var ran = false
    val error = ServiceStartLog(memory).attempt(ServiceStartLog.Kind.RESTART, 5_000L) {
      ran = true
      throw ForegroundServiceStartNotAllowedException("startForegroundService() not allowed due to mAllowStartForeground false")
    }
    assertTrue(ran)
    assertTrue(error is ForegroundServiceStartNotAllowedException)
    // The next process reads it back.
    val next = ServiceStartLog(memory)
    assertEquals(1, next.restarts)
    assertEquals(1, next.failures)
    val lines = next.lines { "t$it" }
    assertTrue(lines[0], lines[0].startsWith("starts: restarts=1 refused=1"))
    assertTrue(lines[1], lines[1].startsWith("  t5000 restart refused ForegroundServiceStartNotAllowedException: startForegroundService()"))
  }

  @Test fun aSecurityExceptionIsCaughtToo() {
    val log = ServiceStartLog(Memory())
    val error = log.attempt(ServiceStartLog.Kind.RESTART, 1L) { throw SecurityException("FGS type location not allowed") }
    assertTrue(error is SecurityException)
    assertEquals(1, log.failures)
  }

  @Test fun startsAndRestartsThatRanAreCountedApart() {
    val log = ServiceStartLog(Memory())
    assertNull(log.attempt(ServiceStartLog.Kind.START, 1L) {})
    assertNull(log.attempt(ServiceStartLog.Kind.RESTART, 2L) {})
    log.note(3L, "restart got no fixes in 60 s")
    assertEquals(1, log.restarts)
    assertEquals(0, log.failures)
    assertEquals(listOf("starts: restarts=1 refused=0 (kept across process ends, oldest first)",
      "  t1 start started", "  t2 restart started", "  t3 restart got no fixes in 60 s"), log.lines { "t$it" })
  }

  @Test fun onlyTheNewestEntriesAreKeptButTheTotalsStay() {
    val log = ServiceStartLog(Memory(), max = 3)
    for (i in 1..5) log.started(ServiceStartLog.Kind.RESTART, i.toLong())
    val lines = log.lines { "t$it" }
    assertEquals(listOf("  t3 restart started", "  t4 restart started", "  t5 restart started"), lines.drop(1))
    assertEquals(5, log.restarts)
  }

  @Test fun anUnreadableStoreStartsOver() {
    val memory = Memory().apply { value = "{not json" }
    val log = ServiceStartLog(memory)
    assertEquals(0, log.restarts)
    log.started(ServiceStartLog.Kind.RESTART, 1L)
    assertEquals(1, ServiceStartLog(memory).restarts)
  }
}
