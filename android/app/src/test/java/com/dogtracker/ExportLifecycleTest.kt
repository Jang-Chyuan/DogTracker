package com.dogtracker

import org.junit.Assert.*
import org.junit.Test

class ExportLifecycleTest {
  @Test fun aCancelBeforeTheJobStartsIsSeenAndFinishForgetsIt() {
    val jobs = ExportJobs()
    jobs.cancel("a") // 取消 while the font widths are measured
    assertTrue(jobs.begin("a"))
    assertTrue(jobs.isCancelled("a"))
    jobs.finish("a")
    assertFalse(jobs.isCancelled("a"))
    assertEquals(0, jobs.cancelledCount())
    assertEquals(0, jobs.runningCount())
  }

  @Test fun cancelsOfJobsThatNeverStartAreBounded() {
    val jobs = ExportJobs(remember = 4)
    assertTrue(jobs.begin("running"))
    jobs.cancel("running")
    repeat(50) { jobs.cancel("gpx-$it") }
    assertEquals(4, jobs.cancelledCount())
    assertTrue(jobs.isCancelled("running")) // a running job's cancel is never forgotten
    assertTrue(jobs.isCancelled("gpx-49"))
    assertFalse(jobs.isCancelled("gpx-0"))
  }

  @Test fun disposeCancelsEveryJobNowAndLater() {
    val jobs = ExportJobs()
    assertTrue(jobs.begin("a"))
    jobs.dispose()
    assertTrue(jobs.isCancelled("a"))
    assertTrue(jobs.isCancelled("never-seen"))
    assertFalse(jobs.begin("b"))
    jobs.cancel("c")
    assertEquals(0, jobs.cancelledCount())
  }

  @Test fun theSharePromiseIsSettledExactlyOnce() {
    val slot = SettleOnce<String>()
    assertTrue(slot.claim("first"))
    assertFalse(slot.claim("second")) // 分享進行中: the open one is kept
    assertEquals("first", slot.take()) // chooser broadcast
    assertNull(slot.take()) // activity result, then invalidate(): nothing left
    assertTrue(slot.claim("third"))
  }

  @Test fun releasingRunsOnSuccessFailureAndCancel() {
    val released = mutableListOf<String>()
    assertEquals(3, "ok".releasing({ released.add(it) }) { it.length + 1 })
    assertThrows(IllegalStateException::class.java) {
      "fail".releasing({ released.add(it) }) { error("compress failed") }
    }
    assertThrows(InterruptedException::class.java) {
      "cancel".releasing({ released.add(it) }) { throw InterruptedException("cancelled") }
    }
    assertEquals(listOf("ok", "fail", "cancel"), released)
  }
}
