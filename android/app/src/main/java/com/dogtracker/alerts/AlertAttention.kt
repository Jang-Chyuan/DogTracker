package com.dogtracker.alerts

/**
 * Whether the app gives an alert's vibration / sound itself. System
 * permissions and the 「提醒」 channel's settings win over S6:
 * - channelAlerts: the channel may make noise at all (importance DEFAULT or
 *   higher; 「靜音」 and 「最低」 are lower). A blocked channel never gets here.
 * - channelVibrates / channelSounds: the user gave the channel its own
 *   vibration / sound in system settings; Android then plays it with the
 *   notification, so the app does not add its own on top (no double alert).
 */
object AlertAttention {
  fun vibration(allowed: Boolean, silent: Boolean, channelAlerts: Boolean, channelVibrates: Boolean) =
    allowed && !silent && channelAlerts && !channelVibrates
  fun sound(allowed: Boolean, normalRinger: Boolean, channelAlerts: Boolean, channelSounds: Boolean) =
    allowed && normalRinger && channelAlerts && !channelSounds
}
