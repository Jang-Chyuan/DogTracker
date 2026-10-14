package com.dogtracker

import android.content.Intent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchLinkTest {
  @Test fun aFirstStartKeepsItsLink() {
    // A notification tap or a link while the app was not running.
    assertFalse(LaunchLink.isReplayed(Intent.FLAG_ACTIVITY_NEW_TASK, restored = false))
    assertFalse(LaunchLink.isReplayed(0, restored = false))
  }

  @Test fun recentsAfterTheSystemClosedTheAppDoesNotReplayIt() {
    // Recents hands back the intent that first opened the app.
    assertTrue(LaunchLink.isReplayed(
      Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY, restored = false))
  }

  @Test fun comingBackToARestoredActivityDoesNotReplayIt() {
    // Back from another app after a low-memory kill: a saved state, no flag.
    assertTrue(LaunchLink.isReplayed(Intent.FLAG_ACTIVITY_NEW_TASK, restored = true))
  }
}
