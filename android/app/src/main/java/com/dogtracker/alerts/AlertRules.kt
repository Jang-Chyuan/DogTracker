package com.dogtracker.alerts

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * The alert rules while the app is not in front (design v3 N 「限制」: only the
 * dogs this phone's receiver hears, the receiver and the phone are checked in
 * the background; cloud dogs wait until the app is open). A line-by-line port
 * of the JavaScript the app runs in front, so both judge the same way:
 *
 *   ReceiverRange.advanceRange   -> Range.advance
 *   DogFreshness.dogFreshness    -> Freshness.of (this phone's dogs only)
 *   AlertEvents.updateAlertEvents-> Events.update
 *   AlertScheduler.scheduleAlerts-> Scheduler.schedule
 *   AlertContent                 -> Content
 *
 * Pure: no Android, no clock, no storage. AlertCodec reads and writes the
 * state in the JavaScript format (AlertEngine.persistedAlertState), so either
 * side can carry on from where the other stopped.
 */

data class LatLng(val latitude: Double, val longitude: Double)

object Geo {
  private const val EARTH_RADIUS_M = 6371000.0
  private fun radians(degrees: Double) = degrees * Math.PI / 180

  fun valid(latitude: Double?, longitude: Double?) = latitude != null && longitude != null &&
    latitude.isFinite() && longitude.isFinite() && kotlin.math.abs(latitude) <= 90 &&
    kotlin.math.abs(longitude) <= 180 && !(latitude == 0.0 && longitude == 0.0)

  fun distance(a: LatLng, b: LatLng): Double {
    val dLat = radians(b.latitude - a.latitude)
    val dLon = radians(b.longitude - a.longitude)
    val h = sin(dLat / 2) * sin(dLat / 2) +
      cos(radians(a.latitude)) * cos(radians(b.latitude)) * sin(dLon / 2) * sin(dLon / 2)
    return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(h)))
  }
}

// ---- ReceiverRange -----------------------------------------------------------

data class RangeState(
  val status: String? = null,
  val judgedAt: Long? = null,
  val outSince: Long? = null,
  val clearing: List<Long> = emptyList(),
  val nearBack: Int = 0,
  val lastLocalAt: Long? = null,
  val lastTime: Long? = null,
  val cloudOnly: Boolean = false,
  val cloudSince: Long? = null,
)

/** One BLE row of a dog (cloud rows never reach the background check). */
data class RangeRow(
  val time: Long,
  val dog: LatLng?,
  val receiver: LatLng?,
  val held: Boolean,
)

object Range {
  const val RADIUS_M = 1000.0
  const val NEAR_M = 800.0
  const val CLEAR_M = 900.0
  const val CLEAR_FIXES = 2
  const val CLEAR_SPAN_MS = 2 * 60000L
  const val NEAR_CLEAR_FIXES = 2
  const val IN = "in"
  const val NEAR = "near"
  const val OUT = "out"

  private fun judge(distance: Double) = when {
    distance > RADIUS_M -> OUT
    distance > NEAR_M -> NEAR
    else -> IN
  }

  fun advance(state: RangeState, row: RangeRow): RangeState {
    val time = row.time
    if (state.lastLocalAt != null && time <= state.lastLocalAt) return state
    if (state.cloudSince != null && time < state.cloudSince) return state
    var next = state.copy(lastTime = max(time, state.lastTime ?: Long.MIN_VALUE), lastLocalAt = time,
      cloudOnly = false, cloudSince = null)
    if (row.held) return next.copy(clearing = emptyList(), nearBack = 0)
    val dog = row.dog ?: return next
    val receiver = row.receiver ?: return next
    val distance = Geo.distance(dog, receiver)
    next = next.copy(judgedAt = time)
    val fresh = judge(distance)
    return when (state.status) {
      OUT -> {
        if (distance > CLEAR_M) return next.copy(clearing = emptyList())
        val clearing = state.clearing + time
        if (clearing.size >= CLEAR_FIXES && time - clearing[0] >= CLEAR_SPAN_MS) {
          next.copy(status = if (distance > NEAR_M) NEAR else IN, outSince = null, clearing = emptyList(), nearBack = 0)
        } else next.copy(clearing = clearing)
      }
      NEAR -> when (fresh) {
        OUT -> next.copy(status = OUT, outSince = time, nearBack = 0)
        IN -> {
          val back = state.nearBack + 1
          if (back >= NEAR_CLEAR_FIXES) next.copy(status = IN, nearBack = 0) else next.copy(nearBack = back)
        }
        else -> next.copy(nearBack = 0)
      }
      else -> next.copy(status = fresh, outSince = if (fresh == OUT) time else null, nearBack = 0, clearing = emptyList())
    }
  }
}

// ---- The dogs this phone hears ------------------------------------------------

/**
 * A dog as the background check knows it: handed over by the app (name, hold,
 * range judgement, times) and moved on by every packet the service stores.
 */
data class AlertDog(
  val slaveId: Int,
  val name: String? = null,
  val coordinate: LatLng? = null,
  val fixAt: Long? = null,
  val packetAt: Long? = null,
  // Held indoors when the app handed it over (IndoorHold runs in the app):
  // timed by its packets, its positions do not judge the range.
  val held: Boolean = false,
  val farFixes: Int = 0,
  val batteryPercentage: Int? = null,
  val charging: Boolean = false,
  val range: RangeState = RangeState(),
)

data class Packet(
  val slaveId: Int,
  val time: Long,
  val dog: LatLng?,
  val receiver: LatLng?,
  val batteryPercentage: Int?,
  val usb: Boolean?,
)

object Dogs {
  // A hold the app handed over lets go after two valid positions this far
  // from where the dog is held (IndoorHold's releaseFarM, the plain case).
  const val RELEASE_FAR_M = 100.0
  const val RELEASE_FIXES = 2

  fun apply(previous: AlertDog?, packet: Packet): AlertDog {
    val dog = previous ?: AlertDog(packet.slaveId)
    if (dog.packetAt != null && packet.time <= dog.packetAt) return dog
    var held = dog.held
    var far = dog.farFixes
    if (held && packet.dog != null && dog.coordinate != null) {
      if (Geo.distance(packet.dog, dog.coordinate) > RELEASE_FAR_M) far += 1 else far = 0
      if (far >= RELEASE_FIXES) { held = false; far = 0 }
    }
    val range = Range.advance(dog.range, RangeRow(packet.time, packet.dog, packet.receiver, held))
    return dog.copy(
      packetAt = packet.time,
      fixAt = if (packet.dog != null) packet.time else dog.fixAt,
      coordinate = if (packet.dog != null && !held) packet.dog else dog.coordinate,
      held = held, farFixes = far,
      batteryPercentage = packet.batteryPercentage ?: dog.batteryPercentage,
      charging = packet.usb ?: dog.charging,
      range = range,
    )
  }
}

// ---- DogFreshness (this phone's dogs) ---------------------------------------------

data class ReceiverPause(val pausedAt: Long, val resumedAt: Long?)

data class Freshness(val drawn: Boolean, val stale: Boolean, val basis: String, val lastAt: Long?, val ageMs: Long?)

object FreshnessRule {
  const val STALE_AFTER_MS = 10 * 60000L

  fun of(dog: AlertDog, now: Long, pauses: List<ReceiverPause>): Freshness {
    val basis = if (dog.held) "packet" else "position"
    val lastAt = if (dog.held) dog.packetAt ?: dog.fixAt else dog.fixAt
    if (dog.coordinate == null || lastAt == null) return Freshness(dog.coordinate != null, false, basis, null, null)
    val age = max(0L, now - lastAt)
    var from: Long = lastAt
    for (pause in pauses.sortedBy { it.pausedAt }) {
      if (pause.pausedAt <= from) continue
      if (pause.pausedAt - from > STALE_AFTER_MS) break
      val resumed = pause.resumedAt ?: return Freshness(true, false, basis, lastAt, age)
      from = max(from, resumed)
    }
    return Freshness(true, now - from > STALE_AFTER_MS, basis, lastAt, age)
  }
}

// ---- AlertEvents -----------------------------------------------------------------

data class AlertEvent(
  val key: String,
  val kind: String,
  val subject: String,
  val startedAt: Long,
  val level: Int = 1,
  val present: Boolean = true,
  val name: String? = null,
  val basis: String? = null,
  val ageMs: Long? = null,
  val percentage: Int? = null,
  val number: Int? = null,
  val dogCount: Int = 0,
  val storageFull: Boolean = false,
  val receiverAffected: Boolean = false,
) {
  val severity get() = Events.SEVERITY[kind] ?: 0
  val token get() = "$startedAt:$level"
}

/** A latched battery episode (AlertEvents' `batteries`), kept as the app wrote it. */
data class BatteryLatch(
  val kind: String,
  val subject: String,
  val startedAt: Long,
  val level: Int,
  val percentage: Int?,
  val name: String? = null,
  val number: Int? = null,
)

/** The persisted state (AlertEngine.persistedAlertState) plus the queue. */
data class AlertState(
  val active: Map<String, AlertEvent> = emptyMap(),
  val batteries: Map<String, BatteryLatch> = emptyMap(),
  val seen: Map<String, Seen> = emptyMap(),
  val pending: Map<String, Pending> = emptyMap(),
  val lastAttentionAt: Long? = null,
  val pause: Pause? = null,
)

data class Seen(val token: String, val at: Long, val reminded: Boolean = false)
data class Pending(val token: String, val reminder: Boolean, val repeat: Boolean)
data class Pause(val since: Long?, val until: Long, val known: Map<String, String>)

data class ReceiverInput(
  val enabled: Boolean,
  val running: Boolean,
  val connected: Boolean,
  val disconnectedAt: Long,
  val number: Int?,
  // The receiver's own battery, from its last packet (null: not known).
  val batteryPercentage: Int?,
  val storageError: String?,
  val pauses: List<ReceiverPause>,
)

object Events {
  val SEVERITY = mapOf(
    "receiver-disconnected" to 6, "dog-out-of-range" to 5, "storage" to 4,
    "dog-stale" to 3, "dog-battery" to 2, "receiver-battery" to 1,
  )
  const val LOW_BATTERY_PERCENT = 20
  const val RECEIVER_BATTERY_LOW = 20
  const val BATTERY_CLEAR_PERCENT = 30
  const val BATTERY_AGAIN_PERCENT = 10
  const val DISCONNECT_GRACE_MS = 30 * 1000L
  private val FULL = Regex("SQLITE_FULL|disk is full|no space left|ENOSPC|空間不足", RegexOption.IGNORE_CASE)

  fun key(kind: String, subject: String) = "$kind:$subject"
  /** "dog-stale:4" -> ("dog-stale", "4"). */
  fun split(key: String): Pair<String, String> = key.indexOf(':').let {
    if (it < 0) key to "" else key.substring(0, it) to key.substring(it + 1)
  }

  val bySeverity = Comparator<AlertEvent> { left, right ->
    val bySeverity = right.severity - left.severity
    if (bySeverity != 0) bySeverity else left.key.compareTo(right.key)
  }

  fun isFull(error: String) = FULL.containsMatchIn(error)

  /**
   * AlertEvents.updateAlertEvents for the dogs this phone hears. A dog the app
   * judged that is not one of them (a cloud dog) keeps its entry untouched and
   * not present: it is judged again once the app is in front.
   */
  fun update(previous: AlertState, dogs: Collection<AlertDog>, receiver: ReceiverInput, now: Long): AlertState {
    val active = linkedMapOf<String, AlertEvent>()
    val batteries = previous.batteries.toMutableMap()
    fun add(kind: String, subject: String, startedAt: Long?, detail: (AlertEvent) -> AlertEvent) {
      val key = key(kind, subject)
      val start = startedAt ?: previous.active[key]?.startedAt ?: now
      active[key] = detail(AlertEvent(key, kind, subject, start))
    }
    fun battery(kind: String, subject: String, percentage: Int?, charging: Boolean, name: String?, number: Int?) {
      val latch = key(kind, subject)
      if (percentage != null && percentage > BATTERY_CLEAR_PERCENT) batteries.remove(latch)
      val threshold = if (kind == "receiver-battery") RECEIVER_BATTERY_LOW else LOW_BATTERY_PERCENT
      val low = percentage != null && percentage <= threshold && !charging
      if (low) {
        val level = if (kind == "dog-battery" && percentage!! <= BATTERY_AGAIN_PERCENT) 2 else 1
        val old = batteries[latch]
        batteries[latch] = BatteryLatch(kind, subject, old?.startedAt ?: now, max(old?.level ?: 0, level), percentage,
          name ?: old?.name, number ?: old?.number)
      }
      val value = batteries[latch] ?: return
      add(kind, subject, value.startedAt) {
        it.copy(level = value.level, present = low, percentage = percentage ?: value.percentage,
          name = name ?: value.name, number = number ?: value.number, receiverAffected = kind == "dog-battery")
      }
    }

    var localDogs = 0
    val heard = mutableSetOf<String>()
    for (dog in dogs) {
      val subject = dog.slaveId.toString()
      heard.add(subject)
      val freshness = FreshnessRule.of(dog, now, receiver.pauses)
      if (!freshness.drawn) continue
      localDogs += 1
      val name = dog.name?.takeIf { it.isNotBlank() } ?: "狗 ${dog.slaveId}"
      if (freshness.stale) add("dog-stale", subject, null) {
        it.copy(name = name, basis = freshness.basis, ageMs = freshness.ageMs, receiverAffected = true)
      }
      if (dog.range.status == Range.OUT) add("dog-out-of-range", subject, null) {
        it.copy(name = name, receiverAffected = true)
      }
      battery("dog-battery", subject, dog.batteryPercentage, dog.charging, name, null)
    }
    if (receiver.enabled && receiver.running && !receiver.connected && receiver.disconnectedAt > 0 &&
      now - receiver.disconnectedAt >= DISCONNECT_GRACE_MS) {
      add("receiver-disconnected", "receiver", receiver.disconnectedAt) {
        it.copy(number = receiver.number, dogCount = localDogs)
      }
    }
    val error = receiver.storageError?.trim().orEmpty()
    if (error.isNotEmpty()) add("storage", "phone", null) { it.copy(storageFull = isFull(error)) }
    if (receiver.enabled && receiver.number != null) {
      val number = receiver.number.toString()
      batteries.entries.removeAll { it.value.kind == "receiver-battery" && it.value.subject != number }
      battery("receiver-battery", number, receiver.batteryPercentage, false, null, receiver.number)
    }
    for ((latch, value) in batteries) {
      if (active.containsKey(latch)) continue
      add(value.kind, value.subject, value.startedAt) {
        it.copy(level = value.level, percentage = value.percentage, name = value.name, number = value.number,
          present = false)
      }
    }
    // The app's judgement of a dog not heard here (a cloud dog): kept as it
    // was, not present, so it is neither forgotten nor alerted.
    for ((key, old) in previous.active) {
      if (active.containsKey(key)) continue
      val (kind, subject) = split(key)
      if (kind.startsWith("dog-") && subject !in heard) active[key] = old.copy(present = false)
    }
    return previous.copy(active = active, batteries = batteries)
  }
}

// ---- AlertPreferences --------------------------------------------------------------

data class AlertPreferences(
  val dogStale: Boolean = true,
  val dogOutOfRange: Boolean = true,
  val dogBattery: Boolean = true,
  val receiverBattery: Boolean = true,
  val receiverDisconnectedStorage: Boolean = true,
  val vibrate: Boolean = true,
  val sound: Boolean = false,
) {
  fun enabled(kind: String) = when (kind) {
    "dog-stale" -> dogStale
    "dog-out-of-range" -> dogOutOfRange
    "dog-battery" -> dogBattery
    "receiver-battery" -> receiverBattery
    "receiver-disconnected", "storage" -> receiverDisconnectedStorage
    else -> true
  }
}

// ---- AlertContent ------------------------------------------------------------------

data class Target(val screen: String, val dogId: String? = null)

data class NotificationContent(val title: String, val lines: List<String>, val target: Target) {
  val count get() = lines.size
}

object Content {
  const val PAUSE_MINUTES = 30

  fun target(event: AlertEvent): Target = when {
    event.kind.startsWith("dog-") -> Target("map", event.subject)
    event.kind == "storage" -> Target(if (event.storageFull) "system-storage" else "diagnostics")
    else -> Target("receiver-settings")
  }

  fun duration(ms: Long?): String {
    val minutes = max(10L, floor((ms ?: 0L) / 60000.0).toLong())
    return when {
      minutes < 60 -> "$minutes 分鐘"
      minutes < 24 * 60 -> "${minutes / 60} 小時"
      else -> "${minutes / (24 * 60)} 天"
    }
  }

  private fun receiverName(number: Int?) = if (number != null) "接收器 $number" else "接收器"

  fun line(event: AlertEvent): String = when (event.kind) {
    "dog-out-of-range" -> "${event.name} 不在接收範圍"
    "dog-stale" -> "${event.name} ${duration(event.ageMs)}沒有新${if (event.basis == "packet") "資料" else "位置"}"
    "dog-battery" -> "${event.name} 電量低 ${event.percentage}%"
    "receiver-battery" -> "${receiverName(event.number)} 電量低 ${event.percentage}%"
    "storage" -> if (event.storageFull) "手機空間不足，位置存不進手機" else "位置存不進手機"
    "receiver-disconnected" ->
      "${receiverName(event.number)} 斷線了${if (event.dogCount > 0) "（${event.dogCount} 隻狗收不到）" else ""}"
    else -> ""
  }

  fun of(problems: Collection<AlertEvent>): NotificationContent? {
    val list = problems.filter { it.present }.sortedWith(Events.bySeverity)
    if (list.isEmpty()) return null
    val outage = list.any { it.kind == "receiver-disconnected" }
    val shown = list.filter { !(outage && it.kind == "dog-stale" && it.receiverAffected) }
    val dogs = shown.filter { it.kind.startsWith("dog-") }.map { it.subject }.toSet()
    val devices = shown.filter { !it.kind.startsWith("dog-") }
    val title = when {
      devices.isEmpty() -> "DogTracker・${dogs.size} 隻狗要注意"
      dogs.isEmpty() -> "DogTracker・接收器與手機要注意"
      else -> "DogTracker・${shown.size} 件事要注意"
    }
    return NotificationContent(title, shown.map(::line), target(shown[0]))
  }
}

// ---- AlertScheduler ----------------------------------------------------------------

data class Effects(
  val notification: String,
  val content: NotificationContent?,
  val delivered: List<String>,
  val vibration: LongArray?,
  val critical: Boolean,
  val sound: Boolean,
)

object Scheduler {
  const val REMINDER_MS = 30 * 60000L
  const val ATTENTION_GAP_MS = 2 * 60000L
  const val PAUSE_MS = Content.PAUSE_MINUTES * 60000L
  val CRITICAL_KINDS = setOf("dog-out-of-range", "receiver-disconnected")
  val NORMAL = longArrayOf(0, 250)
  val CRITICAL = longArrayOf(0, 500, 150, 200, 150, 500)

  private fun on(pause: Pause?, now: Long) = pause != null && pause.until > now

  /** 「暫停提醒 30 分」: the problems known now are silenced until then. */
  fun pause(state: AlertState, now: Long, until: Long = now + PAUSE_MS): AlertState {
    val known = state.active.values.associate { it.key to it.token }
    return state.copy(pending = state.pending - known.keys, pause = Pause(now, until, known))
  }

  /**
   * One step. In the background the app is not in front: the notification is
   * posted (or updated silently) unless the system does not allow it.
   */
  fun schedule(previous: AlertState, now: Long, preferences: AlertPreferences, notificationsAllowed: Boolean,
    foreground: Boolean = false): Pair<AlertState, Effects> {
    val active = previous.active
    val seen = previous.seen.toMutableMap()
    val pending = previous.pending.toMutableMap()
    var pause = previous.pause
    val present = active.values.filter { it.present }.sortedWith(Events.bySeverity)
    val enabled = { event: AlertEvent -> preferences.enabled(event.kind) }
    val outageAlerts = present.any { it.kind == "receiver-disconnected" && enabled(it) }
    val covered = { event: AlertEvent -> outageAlerts && event.kind == "dog-stale" && event.receiverAffected }

    seen.keys.retainAll(active.keys)
    pending.keys.retainAll(present.map { it.key }.toSet())

    val paused = on(pause, now)
    val ended = pause != null && !paused
    for (event in present) {
      val token = event.token
      val before = seen[event.key]
      if (!enabled(event) || covered(event)) {
        seen[event.key] = Seen(token, if (before?.token == token) before.at else now, true)
        pending.remove(event.key)
        continue
      }
      val fresh = before == null || before.token != token
      val reminder = !fresh && event.kind == "dog-stale" && !before!!.reminded && now - before.at >= REMINDER_MS
      val known = pause != null && pause.known[event.key] == token
      if (paused && known) {
        pending.remove(event.key)
        continue
      }
      if (fresh || reminder || (ended && known)) pending[event.key] = Pending(token, !fresh && reminder, !fresh)
    }
    if (ended) pause = null

    val queued = present.filter { pending.containsKey(it.key) }
    val critical = queued.any { it.kind in CRITICAL_KINDS && !pending[it.key]!!.repeat }
    val deliver = queued.isNotEmpty() && (critical || previous.lastAttentionAt == null ||
      now - previous.lastAttentionAt >= ATTENTION_GAP_MS)
    var lastAttentionAt = previous.lastAttentionAt
    if (deliver) {
      for (event in queued) {
        val before = seen[event.key]
        val wait = pending.getValue(event.key)
        val fresh = before == null || before.token != wait.token
        seen[event.key] = Seen(wait.token, if (fresh) now else before!!.at,
          if (fresh) false else before!!.reminded || wait.reminder)
        pending.remove(event.key)
      }
      lastAttentionAt = now
    }

    val listed = present.filter(enabled)
    val content = Content.of(listed)
    val silenced = on(pause, now) && listed.all { pause!!.known[it.key] == it.token }
    val effects = Effects(
      notification = if (foreground || !notificationsAllowed || content == null || silenced) "cancel"
        else if (deliver) "notify" else "update",
      content = content,
      delivered = if (deliver) queued.map { it.key } else emptyList(),
      vibration = if (deliver && preferences.vibrate) (if (critical) CRITICAL else NORMAL).copyOf() else null,
      critical = deliver && critical,
      sound = deliver && preferences.sound,
    )
    return previous.copy(seen = seen, pending = pending, lastAttentionAt = lastAttentionAt, pause = pause) to effects
  }
}
