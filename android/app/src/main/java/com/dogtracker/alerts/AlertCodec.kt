package com.dogtracker.alerts

import org.json.JSONArray
import org.json.JSONObject

/**
 * The alert state in the app's JavaScript format (AlertEngine
 * persistedAlertState / restoreAlertState, version 1), so the app in front and
 * the background check carry on from each other. A collar or receiver number
 * is written back as a JSON number, as the app wrote it. `pending` (the
 * problems waiting for the 2-minute gap) is an extra the app ignores.
 */
object AlertCodec {
  private fun JSONObject.long(name: String): Long? =
    if (!has(name) || isNull(name)) null else (opt(name) as? Number)?.toLong()
  private fun JSONObject.int(name: String): Int? =
    if (!has(name) || isNull(name)) null else (opt(name) as? Number)?.let { Math.round(it.toDouble()).toInt() }
  private fun JSONObject.double(name: String): Double? =
    if (!has(name) || isNull(name)) null else (opt(name) as? Number)?.toDouble()
  private fun JSONObject.text(name: String): String? =
    if (!has(name) || isNull(name)) null else opt(name)?.toString()
  private fun JSONObject.objects(name: String): Map<String, JSONObject> {
    val value = optJSONObject(name) ?: return emptyMap()
    return value.keys().asSequence().mapNotNull { key -> value.optJSONObject(key)?.let { key to it } }.toMap()
  }
  private fun subjectValue(subject: String): Any = subject.toLongOrNull() ?: subject
  private fun put(json: JSONObject, name: String, value: Any?) = json.put(name, value ?: JSONObject.NULL)

  fun readState(text: String?): AlertState {
    val saved = try { JSONObject(text ?: return AlertState()) } catch (_: Exception) { return AlertState() }
    if (saved.optInt("version") != 1) return AlertState()
    val active = saved.objects("active").mapNotNull { (key, value) ->
      val startedAt = value.long("startedAt") ?: return@mapNotNull null
      val (kind, subject) = Events.split(key)
      key to AlertEvent(key, kind, subject, startedAt, value.int("level") ?: 1)
    }.toMap()
    val batteries = saved.objects("batteries").mapNotNull { (key, value) ->
      val startedAt = value.long("startedAt") ?: return@mapNotNull null
      val level = value.int("level") ?: return@mapNotNull null
      val detail = value.optJSONObject("detail") ?: JSONObject()
      val (kind, subject) = Events.split(key)
      key to BatteryLatch(value.text("kind") ?: kind, value.text("subject") ?: subject, startedAt, level,
        value.int("percentage"), detail.text("name"), detail.int("number"))
    }.toMap()
    val seen = saved.objects("seen").mapNotNull { (key, value) ->
      val token = value.text("token") ?: return@mapNotNull null
      val at = value.long("at") ?: return@mapNotNull null
      key to Seen(token, at, value.optBoolean("reminded", false))
    }.toMap()
    val pending = saved.objects("pending").mapNotNull { (key, value) ->
      val token = value.text("token") ?: return@mapNotNull null
      key to Pending(token, value.optBoolean("reminder"), value.optBoolean("repeat"))
    }.toMap()
    val pause = saved.optJSONObject("pause")?.let { value ->
      val until = value.long("until") ?: return@let null
      val known = value.optJSONObject("known") ?: return@let null
      Pause(value.long("since"), until, known.keys().asSequence().mapNotNull { key ->
        (known.opt(key) as? String)?.let { key to it }
      }.toMap())
    }
    return AlertState(active, batteries, seen, pending, saved.long("lastAttentionAt"), pause)
  }

  fun writeState(state: AlertState): String {
    val active = JSONObject()
    for ((key, event) in state.active) {
      active.put(key, JSONObject().put("key", key).put("startedAt", event.startedAt).put("level", event.level))
    }
    val batteries = JSONObject()
    for ((key, latch) in state.batteries) {
      val detail = JSONObject().put("source", "ble")
      if (latch.name != null) detail.put("name", latch.name).put("receiverAffected", true)
      if (latch.number != null) detail.put("number", latch.number)
      val value = JSONObject().put("kind", latch.kind).put("subject", subjectValue(latch.subject))
        .put("startedAt", latch.startedAt).put("level", latch.level).put("detail", detail)
      put(value, "percentage", latch.percentage)
      batteries.put(key, value)
    }
    val seen = JSONObject()
    for ((key, value) in state.seen) {
      seen.put(key, JSONObject().put("token", value.token).put("at", value.at).put("reminded", value.reminded))
    }
    val pending = JSONObject()
    for ((key, value) in state.pending) {
      pending.put(key, JSONObject().put("token", value.token).put("reminder", value.reminder).put("repeat", value.repeat))
    }
    val json = JSONObject().put("version", 1).put("active", active).put("batteries", batteries).put("seen", seen)
      .put("pending", pending)
    put(json, "lastAttentionAt", state.lastAttentionAt)
    put(json, "pause", state.pause?.let { pause ->
      val known = JSONObject()
      for ((key, token) in pause.known) known.put(key, token)
      JSONObject().put("until", pause.until).put("known", known).also { put(it, "since", pause.since) }
    })
    return json.toString()
  }

  fun readPreferences(json: JSONObject?): AlertPreferences {
    val value = json ?: return AlertPreferences()
    val defaults = AlertPreferences()
    fun flag(name: String, default: Boolean) = (value.opt(name) as? Boolean) ?: default
    return AlertPreferences(
      dogStale = flag("dogStale", defaults.dogStale),
      dogOutOfRange = flag("dogOutOfRange", defaults.dogOutOfRange),
      dogBattery = flag("dogBattery", defaults.dogBattery),
      receiverBattery = flag("receiverBattery", defaults.receiverBattery),
      receiverDisconnectedStorage = flag("receiverDisconnectedStorage", defaults.receiverDisconnectedStorage),
      vibrate = flag("vibrate", defaults.vibrate),
      sound = flag("sound", defaults.sound),
    )
  }

  fun writePreferences(value: AlertPreferences): JSONObject = JSONObject()
    .put("dogStale", value.dogStale).put("dogOutOfRange", value.dogOutOfRange).put("dogBattery", value.dogBattery)
    .put("receiverBattery", value.receiverBattery).put("receiverDisconnectedStorage", value.receiverDisconnectedStorage)
    .put("vibrate", value.vibrate).put("sound", value.sound)

  private fun readLatLng(json: JSONObject?): LatLng? {
    val latitude = json?.double("latitude")
    val longitude = json?.double("longitude")
    return if (Geo.valid(latitude, longitude)) LatLng(latitude!!, longitude!!) else null
  }

  private fun writeLatLng(value: LatLng?): Any =
    value?.let { JSONObject().put("latitude", it.latitude).put("longitude", it.longitude) } ?: JSONObject.NULL

  fun readRange(json: JSONObject?): RangeState {
    val value = json ?: return RangeState()
    val clearing = value.optJSONArray("clearing")
    return RangeState(
      status = value.text("status")?.takeIf { it == Range.IN || it == Range.NEAR || it == Range.OUT },
      judgedAt = value.long("judgedAt"),
      outSince = value.long("outSince"),
      clearing = if (clearing == null) emptyList() else (0 until clearing.length()).mapNotNull {
        (clearing.opt(it) as? Number)?.toLong()
      },
      nearBack = value.int("nearBack") ?: 0,
      lastLocalAt = value.long("lastLocalAt"),
      lastTime = value.long("lastTime"),
      cloudOnly = value.optBoolean("cloudOnly", false),
      cloudSince = value.long("cloudSince"),
    )
  }

  fun writeRange(value: RangeState): JSONObject {
    val json = JSONObject()
    put(json, "status", value.status)
    put(json, "judgedAt", value.judgedAt)
    put(json, "outSince", value.outSince)
    json.put("clearing", JSONArray(value.clearing))
    json.put("nearBack", value.nearBack)
    put(json, "lastLocalAt", value.lastLocalAt)
    put(json, "lastTime", value.lastTime)
    json.put("cloudOnly", value.cloudOnly)
    put(json, "cloudSince", value.cloudSince)
    return json
  }

  fun readDog(json: JSONObject): AlertDog? {
    val slaveId = json.int("slaveId") ?: return null
    return AlertDog(
      slaveId = slaveId,
      name = json.text("name"),
      coordinate = readLatLng(json.optJSONObject("coordinate")),
      fixAt = json.long("fixAt"),
      packetAt = json.long("packetAt"),
      held = json.optBoolean("held", false),
      indoorState = json.optJSONObject("indoorState")?.toString(),
      farFixes = json.int("farFixes") ?: 0,
      batteryPercentage = json.int("batteryPercentage"),
      charging = json.optBoolean("charging", false),
      range = readRange(json.optJSONObject("range")),
    )
  }

  fun writeDog(dog: AlertDog): JSONObject {
    val json = JSONObject().put("slaveId", dog.slaveId).put("coordinate", writeLatLng(dog.coordinate))
      .put("held", dog.held).put("farFixes", dog.farFixes).put("charging", dog.charging)
      .put("range", writeRange(dog.range))
    put(json, "indoorState", dog.indoorState?.let(::JSONObject))
    put(json, "name", dog.name)
    put(json, "fixAt", dog.fixAt)
    put(json, "packetAt", dog.packetAt)
    put(json, "batteryPercentage", dog.batteryPercentage)
    return json
  }

  fun readDogs(array: JSONArray?): Map<Int, AlertDog> {
    if (array == null) return emptyMap()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::readDog) }.associateBy { it.slaveId }
  }

  fun writeDogs(dogs: Collection<AlertDog>) = JSONArray(dogs.map(::writeDog))

  /**
   * One stored BLE packet as the background check reads it (the same keys
   * DogStatusStore accepts, long or short).
   */
  fun readPacket(data: JSONObject, receivedAt: Long): Packet? {
    fun number(vararg names: String): Double? = names.firstNotNullOfOrNull { name ->
      if (data.has(name) && !data.isNull(name)) (data.opt(name) as? Number)?.toDouble()
        ?: data.optString(name).toDoubleOrNull() else null
    }
    val slave = number("slave_id", "sid") ?: return null
    if (slave <= 0 || slave % 1.0 != 0.0 || slave > Int.MAX_VALUE) return null
    val latitude = number("slave_lat", "slat", "lat")
    val longitude = number("slave_lon", "slon", "lon")
    val masterLatitude = number("master_lat", "mlat")
    val masterLongitude = number("master_lon", "mlon")
    val batteryValid = number("battery_valid", "bv")
    val battery = number("battery_pct", "bp")
    val satellites = number("satellites", "sat")
    val hdop = number("hdop", "hd")
    val usb = number("usbPresent", "usb_present") ?: (data.opt("usbPresent") as? Boolean)?.let { if (it) 1.0 else 0.0 }
      ?: (data.opt("usb_present") as? Boolean)?.let { if (it) 1.0 else 0.0 }
    return Packet(
      slaveId = slave.toInt(),
      time = receivedAt,
      dog = if (Geo.valid(latitude, longitude)) LatLng(latitude!!, longitude!!) else null,
      receiver = if (Geo.valid(masterLatitude, masterLongitude)) LatLng(masterLatitude!!, masterLongitude!!) else null,
      batteryPercentage = if (battery != null && batteryValid != 0.0) Math.round(battery).toInt() else null,
      usb = usb?.let { it == 1.0 },
      good = Dogs.good(satellites, hdop),
      masterId = number("master_id", "mid")?.toInt(),
      satellites = satellites, hdop = hdop,
      rssi = number("rssi"), snr = number("snr"),
      speedKmh = (if (data.has("raw_speed_kmh")) number("raw_speed_kmh") else number("speed_kmh"))?.takeIf { it >= 0 && it.isFinite() },
    )
  }

  /** The receiver's own battery from a packet, or null when it is not valid. */
  fun readReceiverBattery(data: JSONObject): Int? {
    val valid = data.opt("master_battery_valid") ?: data.opt("mbv")
    val value = (data.opt("master_battery_pct") ?: data.opt("mbp")) as? Number ?: return null
    if (valid == 0 || valid == false || (valid as? Number)?.toInt() == 0) return null
    return Math.round(value.toDouble()).toInt()
  }
}
