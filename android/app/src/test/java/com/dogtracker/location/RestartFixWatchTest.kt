package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test

// F6: a restarted recording without background location may get no fixes until the app is opened.
class RestartFixWatchTest {
  private val s = 1_000_000_000L
  private val start = 100 * s

  @Test fun anOrdinaryStartIsNotWatched() {
    val watch = RestartFixWatch(restart = false, backgroundLocation = false, sdk = 34, startedNanos = start)
    assertEquals(RestartFixWatch.State.NOT_RESTART, watch.state(start + 600 * s))
    assertNull(watch.noFixesNote(start + 600 * s))
    assertFalse(watch.whileInUseOnly)
  }

  @Test fun aRestartWithoutFixesIsNotedOnceWithItsLikelyReason() {
    val watch = RestartFixWatch(restart = true, backgroundLocation = false, sdk = 34, startedNanos = start)
    assertTrue(watch.whileInUseOnly)
    assertEquals(RestartFixWatch.State.WAITING, watch.state(start + 59 * s))
    assertNull(watch.noFixesNote(start + 59 * s))
    assertEquals(RestartFixWatch.State.NO_FIXES, watch.state(start + 60 * s))
    assertEquals("restart got no fixes in 60 s (no background location: none until the app is opened)",
      watch.noFixesNote(start + 60 * s))
    assertNull(watch.noFixesNote(start + 61 * s))
    assertTrue(watch.describe(start + 90 * s), watch.describe(start + 90 * s).endsWith("(none until the app is opened)"))
    // The app is opened: fixes come.
    assertNull(watch.firstFixNote())
    watch.received(start + 300 * s)
    assertEquals(RestartFixWatch.State.RECEIVING, watch.state(start + 301 * s))
    assertEquals("restart got its first fix after 300 s", watch.firstFixNote())
    assertNull(watch.firstFixNote())
    assertTrue(watch.describe(start + 301 * s).contains("firstFixAfter=300s"))
  }

  @Test fun aRestartThatGetsFixesSoonNotesNothing() {
    val watch = RestartFixWatch(restart = true, backgroundLocation = false, sdk = 34, startedNanos = start)
    watch.received(start + 3 * s)
    assertEquals(RestartFixWatch.State.RECEIVING, watch.state(start + 120 * s))
    assertNull(watch.noFixesNote(start + 120 * s))
    assertNull(watch.firstFixNote())
  }

  @Test fun beforeAndroid11OrWithBackgroundLocationNoReasonIsGiven() {
    for (watch in listOf(RestartFixWatch(true, backgroundLocation = false, sdk = 29, startedNanos = start),
      RestartFixWatch(true, backgroundLocation = true, sdk = 34, startedNanos = start))) {
      assertFalse(watch.whileInUseOnly)
      assertEquals("restart got no fixes in 60 s", watch.noFixesNote(start + 60 * s))
    }
  }
}
