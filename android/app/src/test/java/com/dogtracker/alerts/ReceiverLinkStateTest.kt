package com.dogtracker.alerts

import org.junit.Assert.*
import org.junit.Test

class ReceiverLinkStateTest {
  @Test fun restoredOutageKeepsOnlyRemainingThirtySecondGrace() {
    val outage = ReceiverLinkState(false, 1000)
    assertEquals(20000L, outage.remainingGrace(11000, 30000))
    assertEquals(0L, outage.remainingGrace(31000, 30000))
    assertEquals(0L, outage.remainingGrace(60000, 30000))
    assertNull(ReceiverLinkState().remainingGrace(11000, 30000))
  }
  @Test fun outageStartSurvivesRepeatedRestartsAndFailedReconnects() {
    val lost = ReceiverLinkState(true).lost(1000)
    val restored = ReceiverLinkState.restore(lost.write(), 9000)
    assertEquals(1000L, restored.disconnectedAt)
    assertEquals(1000L, restored.lost(20000).disconnectedAt)
    assertFalse(restored.connected)
    assertEquals(0L, ReceiverLinkState.restore(null, 9000).disconnectedAt)
    assertEquals(9000L, ReceiverLinkState.restore(ReceiverLinkState(true).write(), 9000).disconnectedAt)
  }
}
