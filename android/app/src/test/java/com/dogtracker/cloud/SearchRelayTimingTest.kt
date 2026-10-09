package com.dogtracker.cloud

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SearchRelayTimingTest {
  @Test fun reactStartupRetryIsPositiveAndCapped() {
    assertEquals(1000L, SearchRelayTiming.reactWaitMs(0))
    assertEquals(2000L, SearchRelayTiming.reactWaitMs(1))
    assertEquals(16000L, SearchRelayTiming.reactWaitMs(4))
    assertEquals(16000L, SearchRelayTiming.reactWaitMs(Int.MAX_VALUE))
    assertEquals(1000L, SearchRelayTiming.reactWaitMs(-1))
  }
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
