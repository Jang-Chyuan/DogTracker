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
    assertEquals("連不上接收器，2 分鐘後再試著連線", ReceiverNotificationText.of(false, false, 120000))
  }
  private val utc = java.util.TimeZone.getTimeZone("UTC")
  // 2026-10-17 06:05:09 UTC
  private val at = 1_792_217_109_000L
  @Test fun everyReceiverStateHasOneSentenceAndNeverARawError() {
    val text = { connected: Boolean, disconnected: Boolean, delay: Long, problem: ReceiverProblem, data: Long ->
      ReceiverNotificationText.of(connected, disconnected, delay, problem, data, utc) }
    assertEquals("正在接收狗的位置・06:05 收到資料", text(true, false, 0, ReceiverProblem.NONE, at))
    assertEquals("正在接收狗的位置", text(true, false, 0, ReceiverProblem.NONE, 0))
    assertEquals("正在連線接收器", text(false, false, 2000, ReceiverProblem.NONE, 0))
    assertEquals("斷線了，正在自動重連", text(false, true, 8000, ReceiverProblem.NONE, at))
    assertEquals("斷線了，2 分鐘後再試著連線", text(false, true, 120000, ReceiverProblem.NONE, at))
    assertEquals("連不上接收器，5 分鐘後再試著連線", text(false, false, 300000, ReceiverProblem.NONE, 0))
    assertEquals("藍牙關著，打開藍牙才能接收", text(false, false, 30000, ReceiverProblem.BLUETOOTH_OFF, 0))
    assertEquals("藍牙關著，打開藍牙才能接收", text(false, true, 30000, ReceiverProblem.BLUETOOTH_OFF, at))
    assertEquals("需要藍牙權限，請打開 App 允許", text(false, false, 30000, ReceiverProblem.NEEDS_PERMISSION, 0))
    assertEquals("接收器設定有問題，請打開 App 檢查", text(false, false, 0, ReceiverProblem.BAD_CONFIG, 0))
    assertEquals("收不到資料，正在重新連線", text(false, true, 2000, ReceiverProblem.NO_DATA, at))
    assertEquals("收不到資料，正在重新連線", text(false, false, 4000, ReceiverProblem.NO_DATA, 0))
    // A long outage says the wait in minutes, not the reason.
    assertEquals("斷線了，2 分鐘後再試著連線", text(false, true, 120000, ReceiverProblem.NO_DATA, at))
  }
}
