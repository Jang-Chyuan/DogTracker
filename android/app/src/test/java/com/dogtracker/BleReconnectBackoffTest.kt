package com.dogtracker

import org.junit.Assert.assertEquals
import org.junit.Test

class BleReconnectBackoffTest {
  @Test fun shortFailuresKeepTheDesignBackoff() {
    val policy = BleReconnectBackoff()
    for (delay in listOf(2000L,4000L,8000L,16000L,30000L,30000L))
      assertEquals(delay, policy.next(1000))
  }
  @Test fun longFailuresBackOffAndSubscriptionResets() {
    val policy = BleReconnectBackoff()
    policy.next(1000)
    assertEquals(30000L,policy.next(600999,30000))
    assertEquals(120000L,policy.next(601000,30000))
    assertEquals(300000L,policy.next(1201000,30000))
    policy.reset()
    assertEquals(2000L,policy.next(1300000))
  }
  @Test fun durationIncludesFailuresBeforeTheFirstSuccessfulSubscription() {
    val policy = BleReconnectBackoff()
    assertEquals(30000L,policy.next(0,30000))
    assertEquals(120000L,policy.next(600000,30000))
  }
  @Test fun notificationUsesFieldWordsAndSaysOnlyAWidenedWait() {
    assertEquals("正在接收狗的位置", ReceiverNotificationText.of(true, false, 0))
    assertEquals("正在連線接收器", ReceiverNotificationText.of(false, false, 30000))
    assertEquals("斷線了，正在自動重連", ReceiverNotificationText.of(false, true, 30000))
    assertEquals("斷線了，2 分鐘後再試著連線", ReceiverNotificationText.of(false, true, 120000))
    assertEquals("斷線了，5 分鐘後再試著連線", ReceiverNotificationText.of(false, true, 300000))
  }
}
