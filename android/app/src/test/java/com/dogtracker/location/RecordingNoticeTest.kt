package com.dogtracker.location

import org.junit.Assert.assertEquals
import org.junit.Test

class RecordingNoticeTest {
  @Test fun everyStateIsOnePlainSentence() {
    assertEquals("正在記錄我的路線", RecordingNotice.RECORDING.text())
    assertEquals("請允許精確位置", RecordingNotice.NEEDS_PRECISE_LOCATION.text())
    assertEquals("請開啟手機定位", RecordingNotice.LOCATION_OFF.text())
    assertEquals("定位訊號不好，稍後自動繼續", RecordingNotice.POOR_SIGNAL.text())
    assertEquals("無法開始記錄，請打開 App", RecordingNotice.CANNOT_START.text())
  }
  @Test fun theFirstSecondsAndRecentFixesAreRecording() {
    assertEquals(RecordingNotice.RECORDING, RecordingNotice.during(true, null, 5.0))
    assertEquals(RecordingNotice.RECORDING, RecordingNotice.during(true, 12.0, 600.0))
    assertEquals(RecordingNotice.RECORDING, RecordingNotice.during(true, 30.0, 600.0))
  }
  @Test fun noFixForAWhileIsAPoorSignalWhateverTheRejectionWas() {
    assertEquals(RecordingNotice.POOR_SIGNAL, RecordingNotice.during(true, null, 31.0))
    assertEquals(RecordingNotice.POOR_SIGNAL, RecordingNotice.during(true, 45.0, 600.0))
  }
  @Test fun phoneLocationOffComesFirst() {
    assertEquals(RecordingNotice.LOCATION_OFF, RecordingNotice.during(false, 2.0, 600.0))
    assertEquals(RecordingNotice.LOCATION_OFF, RecordingNotice.during(false, null, 1.0))
  }
}
