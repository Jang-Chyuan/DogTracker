package com.dogtracker.alerts

import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject

/**
 * The alerts while the app is not on screen (design v3 N 「限制」: 「新增的只有
 * 原生服務裡的提醒判斷（只看本機收到的狗、接收器、手機）」).
 *
 * One alert state, kept here (SharedPreferences "alert_notifications") in the
 * app's format, with two writers taking turns:
 * - the app in front runs the alerts itself (useAlertEngine) and saves the
 *   state here; it also hands over what only it knows about this phone's dogs
 *   (names, indoor holds, range judgements) and the 提醒 settings;
 * - once the app is off screen, the receiver's background service checks every
 *   few seconds: the dogs as handed over, moved on by every packet it stores,
 *   the receiver link and storage; it posts the merged notification, vibrates
 *   and saves the state with a new revision;
 * - 「暫停提醒 30 分」 on the notification pauses here, with a new revision.
 * The app reads the state again when its revision moved on, so nothing is
 * alerted twice and nothing is lost between the two.
 *
 * Cloud dogs are not checked here (their data arrives about every 15 minutes
 * in the background): their problems keep their state until the app is back.
 */
object BackgroundAlerts {
  private const val PREFS = "alert_notifications"
  private const val STATE = "state"
  private const val REVISION = "revision"
  private const val DOGS = "dogs"
  private const val PREFERENCES = "preferences"
  private const val RECEIVER_BATTERY = "receiverBattery"
  // After the app leaves the screen, its last step may still be under way.
  const val HANDOVER_MS = 3000L

  private val lock = Any()
  private var dogs: MutableMap<Int, AlertDog>? = null
  private var receiverBattery: Int? = null

  // ---- whose turn: MainActivity reports the screen ----------------------------
  @Volatile private var visible = false
  @Volatile private var visibleChangedAt = 0L

  fun setAppVisible(value: Boolean, context: Context? = null) {
    synchronized(lock) {
      visible = value
      visibleChangedAt = SystemClock.elapsedRealtime()
      // On screen there is no system notification (the app shows it all).
      if (value && context != null) runCatching { AlertPoster.cancel(context) }
    }
  }

  fun appVisible() = visible || SystemClock.elapsedRealtime() - visibleChangedAt < HANDOVER_MS

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun loadDogs(context: Context): MutableMap<Int, AlertDog> {
    if (IndoorEnvironment.model == null) IndoorEnvironment.model = JSONObject(
      context.resources.openRawResource(com.dogtracker.R.raw.indoor_model).bufferedReader().use { it.readText() })
    dogs?.let { return it }
    val prefs = prefs(context)
    val loaded = try {
      AlertCodec.readDogs(org.json.JSONArray(prefs.getString(DOGS, "[]")))
    } catch (_: Exception) { emptyMap() }
    receiverBattery = if (prefs.contains(RECEIVER_BATTERY)) prefs.getInt(RECEIVER_BATTERY, 0) else null
    return loaded.toMutableMap().also { dogs = it }
  }

  // ---- the state, for the app ------------------------------------------------------

  /** { revision, state } as JSON (state: the persisted alert state or null). */
  fun load(context: Context): String = synchronized(lock) {
    val prefs = prefs(context)
    val state = prefs.getString(STATE, null)
    JSONObject().put("revision", prefs.getLong(REVISION, 0))
      .put("state", state?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject.NULL).toString()
  }

  /**
   * The app's save, refused when the state moved on since the app read it
   * (`basedOn` is the revision it read): it reads the newer one instead.
   */
  fun save(context: Context, state: String, basedOn: Long): Boolean = synchronized(lock) {
    val prefs = prefs(context)
    if (prefs.getLong(REVISION, 0) != basedOn) return false
    // The app saves the whole state, its queue (pending) included.
    prefs.edit().putString(STATE, state).commit()
  }

  private fun write(context: Context, state: AlertState) {
    val prefs = prefs(context)
    prefs.edit().putString(STATE, AlertCodec.writeState(state)).putLong(REVISION, prefs.getLong(REVISION, 0) + 1).commit()
  }

  /**
   * The app's view of this phone's dogs and its 提醒 settings (while in
   * front, each time they change). The names, holds and range judgements are
   * the app's; times and batteries keep whichever is newer.
   */
  fun handOver(context: Context, json: String) = synchronized(lock) {
    val value = JSONObject(json)
    val known = loadDogs(context)
    val incoming = AlertCodec.readDogs(value.optJSONArray("dogs"))
    for ((id, dog) in incoming) {
      val mine = known[id]
      // Whichever saw this phone's newest packet of the dog keeps what came
      // from the packets (times, position, hold, range, battery); the name
      // is always the app's.
      val mineNewer = mine != null && (mine.range.lastLocalAt ?: mine.packetAt ?: 0) >
        (dog.range.lastLocalAt ?: dog.packetAt ?: 0)
      known[id] = if (mine != null && mineNewer) mine.copy(name = dog.name) else dog
    }
    // A dog the app no longer counts as this phone's (only heard through the
    // cloud now, or forgotten after 24 hours) is not checked here either.
    known.keys.retainAll(incoming.keys)
    val edit = prefs(context).edit().putString(DOGS, AlertCodec.writeDogs(known.values).toString())
    value.optJSONObject("preferences")?.let { edit.putString(PREFERENCES, it.toString()) }
    edit.apply()
  }

  fun preferences(context: Context): AlertPreferences = AlertCodec.readPreferences(
    runCatching { JSONObject(prefs(context).getString(PREFERENCES, "{}")!!) }.getOrNull())

  /** Every packet the service stored: the dog (and the receiver's battery) moves on. */
  fun onPacket(context: Context, data: JSONObject, receivedAt: Long) = synchronized(lock) {
    val packet = AlertCodec.readPacket(data, receivedAt) ?: return@synchronized
    val known = loadDogs(context)
    known[packet.slaveId] = Dogs.apply(known[packet.slaveId], packet)
    prefs(context).edit().putString(DOGS, AlertCodec.writeDogs(known.values).toString()).commit()
    AlertCodec.readReceiverBattery(data)?.let { receiverBattery = it }
  }

  /** A newly chosen receiver: the old one's battery is not this one's. */
  fun forgetReceiver(context: Context) = synchronized(lock) {
    receiverBattery = null
    prefs(context).edit().remove(RECEIVER_BATTERY).apply()
  }

  fun receiverBattery(context: Context): Int? = synchronized(lock) { loadDogs(context); receiverBattery }

  // ---- the background check ------------------------------------------------------

  /**
   * One step while the app is off screen. Returns the effects carried out, or
   * null when it was the app's turn.
   */
  fun evaluate(context: Context, receiver: ReceiverInput, now: Long, force: Boolean = false): Effects? {
    // One lock for the step and its effects: a pause, or the app coming on
    // screen, never meets a step half carried out.
    synchronized(lock) {
      if (!force && appVisible()) return null
      val prefs = prefs(context)
      val previous = AlertCodec.readState(prefs.getString(STATE, null))
      val known = loadDogs(context)
      val events = Events.update(previous, known.values, receiver, now)
      val (state, effects) = Scheduler.schedule(events, now, preferences(context), AlertPoster.alertsEnabled(context))
      val changed = AlertCodec.writeState(state) != AlertCodec.writeState(previous)
      if (changed) write(context, state)
      val edit = prefs.edit().putString(DOGS, AlertCodec.writeDogs(known.values).toString())
      receiverBattery?.let { edit.putInt(RECEIVER_BATTERY, it) }
      edit.apply()
      if (effects.delivered.isNotEmpty() || changed) {
        com.dogtracker.AppLog.i(AlertPoster.TAG, "background step: ${effects.notification}, delivered ${effects.delivered}")
      }
      AlertPoster.carryOut(context, effects)
      return effects
    }
  }

  /** Forgets everything (debug builds' DebugAlertFeed). */
  fun reset(context: Context) = synchronized(lock) {
    prefs(context).edit().clear().commit()
    dogs = null
    receiverBattery = null
  }

  /** 「暫停提醒 30 分」 (the notification's button; the app may not be running). */
  fun pause(context: Context, now: Long) = synchronized(lock) {
    val prefs = prefs(context)
    val state = Scheduler.pause(AlertCodec.readState(prefs.getString(STATE, null)), now)
    write(context, state)
    AlertPoster.cancel(context)
    com.dogtracker.AppLog.i(AlertPoster.TAG, "paused until ${state.pause?.until}")
  }
}
