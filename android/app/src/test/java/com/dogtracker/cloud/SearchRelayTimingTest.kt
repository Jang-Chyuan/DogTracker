package com.dogtracker.cloud

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SearchRelayTimingTest {
  @Test fun noQueueStopsAndFutureRetryWaitsWithoutAnActivePass() {
    assertNull(SearchRelayTiming.waitMs(null,1000))
    assertEquals(0L,SearchRelayTiming.waitMs(0,1000))
    assertEquals(300000L,SearchRelayTiming.waitMs(301000,1000))
  }
  @Test fun cooldownPreventsBusyLaunchesFromSpinningButNeverKeepsAnIdleService() {
    assertEquals(10000L,SearchRelayTiming.waitMs(0,1000,10000))
    assertEquals(300000L,SearchRelayTiming.waitMs(301000,1000,10000))
    assertNull(SearchRelayTiming.waitMs(null,1000,10000))
    assertEquals(0L,SearchRelayTiming.waitMs(0,1000,-1000))
  }
}
