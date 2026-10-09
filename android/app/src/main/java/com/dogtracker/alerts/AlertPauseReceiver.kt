package com.dogtracker.alerts

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 「暫停提醒 30 分」 on the merged notification: the notification goes away
 * and the problems known now are silenced for 30 minutes, without opening the
 * app (判定表「S6 的開關管什麼」). The pause is saved with the alert state, so
 * it survives the app being closed (「重開 App 仍記得暫停」).
 */
class AlertPauseReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      AlertPoster.ACTION_PAUSE -> BackgroundAlerts.pause(context, System.currentTimeMillis())
      AlertPoster.ACTION_DISMISSED -> AlertPoster.dismissed(context)
    }
  }
}
