package com.dogtracker

import android.content.Intent

/**
 * The link that opened the app (a notification's destination, or a debug
 * screen-state link), read once by JavaScript (Linking.getInitialURL).
 *
 * After the system has closed the app in the background (low memory, `am
 * kill`), Android makes the activity again with the intent that first opened
 * it: from Recents (FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY), or when the user
 * comes back to it from another app (a saved state). That link was handled
 * long ago; reading it again opened its page once more — a notification's
 * page, or the debug first-launch screen state (D1) although the guide was
 * passed. Such a start opens like a tap on the app icon instead.
 */
object LaunchLink {
  /** Whether this start hands back an intent that already opened the app. */
  fun isReplayed(flags: Int, restored: Boolean): Boolean =
    restored || (flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0

  /** The same start without its link and its notification mark. */
  fun withoutLink(intent: Intent): Intent = Intent(intent).apply {
    data = null
    removeExtra(SplashState.EXTRA_FROM_NOTIFICATION)
  }
}
