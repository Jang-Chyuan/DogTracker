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

  @Test fun aShareIsSettledExactlyOnceAndOnlyOneIsOpen() {
    val shares = ShareSessions<String>()
    val code = shares.open("first")!!
    assertNull(shares.open("second")) // 分享進行中: the open one is kept
    assertEquals("first", shares.chosen(code))
    assertNull(shares.chosen(code))
    assertNull(shares.closed(code)) // its activity result after "shared": nothing to settle
    assertNull(shares.dispose())
  }

  @Test fun anEarlierChoosersResultNeverSettlesTheNextShare() {
    val shares = ShareSessions<String>()
    val first = shares.open("first")!!
    assertEquals("first", shares.chosen(first))
    val second = shares.open("second")!! // shared, its result not back yet: a new share may start
    assertNotEquals(first, second)
    assertNull(shares.closed(first)) // the first chooser's late result
    assertNull(shares.chosen(first))
    assertEquals("second", shares.closed(second)) // nothing chosen: "cancelled"
  }

  @Test fun aFailedLaunchOrDisposeSettlesOnceAndDisposeStopsNewShares() {
    val shares = ShareSessions<String>()
    val code = shares.open("first")!!
    assertEquals("first", shares.failed(code))
    assertNull(shares.failed(code))
    val open = shares.open("second")!!
    assertEquals("second", shares.dispose())
    assertNull(shares.failed(open)) // a launch failing after invalidate(): already rejected
    assertNull(shares.open("third")) // a share queued before invalidate() runs after it
  }

  @Test fun requestCodesStayInTheirRange() {
    val shares = ShareSessions<String>(firstCode = 7401, codes = 3)
    val codes = (1..7).map { shares.open("s$it")!!.also { c -> shares.closed(c) } }
    assertTrue(codes.all { shares.owns(it) })
    assertFalse(shares.owns(7400)); assertFalse(shares.owns(7404))
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
