package com.dogtracker.location

/**
 * What to do with 我的路線's recording when the app was updated
 * (ACTION_MY_PACKAGE_REPLACED: `adb install -r`, a Google Play update) or
 * the phone restarted (ACTION_BOOT_COMPLETED). Either ends the recording
 * service, and the system does not restart a START_STICKY service then.
 *
 * Android's rules (developer.android.com, "Restrictions on starting a
 * foreground service from the background" and the Android 15 behaviour
 * changes), for this app that has only while-in-use (fine) location and
 * deliberately no ACCESS_BACKGROUND_LOCATION:
 * - Both broadcasts exempt the app from the Android 12+ background start
 *   ban, and Android 15's BOOT_COMPLETED ban does not list the location
 *   type. But neither is an exemption that grants while-in-use access: from
 *   Android 11 (API 30) a location service started in the background gets
 *   no location (Android 14+: startForeground throws a SecurityException).
 *   So from Android 11 the user is asked with a notification instead; a
 *   tap opens the app, which resumes the recording (resumeIfEnabled).
 * - Android 10 and older have no such limit: the recording starts again
 *   by itself.
 */
internal object RecordingResume {
  enum class Trigger(val label: String) { UPDATE("after update"), REBOOT("after reboot") }
  enum class Action { START, NOTIFY, SKIP }
  data class Decision(val action: Action, val reason: String)

  /** Android 11: a location service started in the background gets no location. */
  const val WHILE_IN_USE_LIMIT_SDK = 30

  fun decide(enabled: Boolean, running: Boolean, precise: Boolean, locationOn: Boolean, sdk: Int): Decision = when {
    // The user's own switch (on unless they switched it off): never start
    // what they stopped.
    !enabled -> Decision(Action.SKIP, "recording switched off")
    running -> Decision(Action.SKIP, "already running")
    // Without precise permission the app cannot record either; opening it asks.
    !precise -> Decision(Action.SKIP, "no precise location permission")
    // The recording could not get fixes now; the app shows why when opened.
    !locationOn -> Decision(Action.NOTIFY, "phone location off")
    sdk >= WHILE_IN_USE_LIMIT_SDK -> Decision(Action.NOTIFY, "Android 11+: no location for a service started in the background")
    else -> Decision(Action.START, "Android 10 or older")
  }

  /** The trigger a broadcast action stands for, or null for any other. */
  fun triggerOf(action: String?): Trigger? = when (action) {
    "android.intent.action.MY_PACKAGE_REPLACED" -> Trigger.UPDATE
    "android.intent.action.BOOT_COMPLETED" -> Trigger.REBOOT
    else -> null
  }

  /** The dumpsys note for one decision (no position, no address). */
  fun note(trigger: Trigger, action: Action, reason: String, extra: String? = null): String {
    val outcome = when (action) { Action.START -> "restarted"; Action.NOTIFY -> "asked with a notification"; Action.SKIP -> "not restarted" }
    return "${trigger.label}: $outcome ($reason)" + (extra?.let { ", $it" } ?: "")
  }
}
