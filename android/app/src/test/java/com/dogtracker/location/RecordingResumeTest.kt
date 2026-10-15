package com.dogtracker.location

import com.dogtracker.location.RecordingResume.Action
import com.dogtracker.location.RecordingResume.Trigger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RecordingResumeTest {
  private fun decide(enabled: Boolean = true, running: Boolean = false, precise: Boolean = true,
    locationOn: Boolean = true, sdk: Int = 36) = RecordingResume.decide(enabled, running, precise, locationOn, sdk).action

  @Test fun recordingTheUserSwitchedOffIsNeverStartedNorAskedFor() {
    for (sdk in listOf(24, 29, 30, 34, 36)) {
      assertEquals(Action.SKIP, decide(enabled = false, sdk = sdk))
      assertEquals(Action.SKIP, decide(enabled = false, locationOn = false, sdk = sdk))
    }
  }

  @Test fun android10AndOlderStartsByItself() {
    for (sdk in 24..29) assertEquals(Action.START, decide(sdk = sdk))
  }

  @Test fun android11AndNewerAsksWithANotification() {
    // A location service started from these broadcasts gets no location
    // without ACCESS_BACKGROUND_LOCATION (Android 14+: SecurityException).
    for (sdk in 30..36) assertEquals(Action.NOTIFY, decide(sdk = sdk))
  }

  @Test fun alreadyRunningOrNoPermissionDoesNothing() {
    assertEquals(Action.SKIP, decide(running = true))
    assertEquals(Action.SKIP, decide(running = true, sdk = 28))
    assertEquals(Action.SKIP, decide(precise = false))
    assertEquals(Action.SKIP, decide(precise = false, sdk = 28))
  }

  @Test fun locationOffAsksInsteadOfStartingAServiceThatGetsNoFixes() {
    assertEquals(Action.NOTIFY, decide(locationOn = false, sdk = 28))
    assertEquals(Action.NOTIFY, decide(locationOn = false, sdk = 36))
  }

  @Test fun onlyUpdateAndBootAreTriggers() {
    assertEquals(Trigger.UPDATE, RecordingResume.triggerOf("android.intent.action.MY_PACKAGE_REPLACED"))
    assertEquals(Trigger.REBOOT, RecordingResume.triggerOf("android.intent.action.BOOT_COMPLETED"))
    assertNull(RecordingResume.triggerOf("android.intent.action.LOCKED_BOOT_COMPLETED"))
    assertNull(RecordingResume.triggerOf(null))
  }

  @Test fun notesSayWhatHappenedAndWhy() {
    assertEquals("after update: asked with a notification (phone location off), notifications blocked",
      RecordingResume.note(Trigger.UPDATE, Action.NOTIFY, "phone location off", "notifications blocked"))
    assertEquals("after reboot: not restarted (recording switched off)",
      RecordingResume.note(Trigger.REBOOT, Action.SKIP, "recording switched off"))
    assertEquals("after reboot: restarted (Android 10 or older)",
      RecordingResume.note(Trigger.REBOOT, Action.START, "Android 10 or older"))
  }
}
