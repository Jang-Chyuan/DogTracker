package com.dogtracker.alerts

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

/** Packet-driven port of IndoorHold.createHoldTracker, with a JSON checkpoint for handover/restarts. */
class IndoorHold(saved: String? = null) {
  private val s = runCatching { JSONObject(saved ?: "{}") }.getOrDefault(JSONObject())
  private fun array(name: String) = s.optJSONArray(name) ?: JSONArray().also { s.put(name, it) }
  private fun list(a: JSONArray?) = if (a == null) mutableListOf<JSONObject>() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }.toMutableList()
  private fun points(name: String) = list(array(name))
  private fun set(name: String, values: List<JSONObject>) { s.put(name, JSONArray(values)) }
  private fun num(o: JSONObject, name: String): Long? = (o.opt(name) as? Number)?.toLong()
  private fun time(p: JSONObject) = p.getLong("time")
  private fun coord(p: JSONObject) = LatLng(p.getDouble("latitude"), p.getDouble("longitude"))
  private fun point(p: Packet) = p.dog?.let { JSONObject().put("time", p.time).put("latitude", it.latitude).put("longitude", it.longitude) }
  private fun median(values: List<Double>): Double { val a = values.sorted(); return if (a.size % 2 == 1) a[a.size / 2] else (a[a.size / 2 - 1] + a[a.size / 2]) / 2 }
  private fun medianPoint(values: List<JSONObject>) = JSONObject().put("latitude", median(values.map { it.getDouble("latitude") })).put("longitude", median(values.map { it.getDouble("longitude") }))
  private fun distance(a: JSONObject, b: JSONObject): Double {
    val latitude = Math.toRadians((a.getDouble("latitude") + b.getDouble("latitude")) / 2)
    val x = Math.toRadians(b.getDouble("longitude") - a.getDouble("longitude")) * cos(latitude)
    val y = Math.toRadians(b.getDouble("latitude") - a.getDouble("latitude"))
    return hypot(x, y) * 6371000
  }
  private fun near(p: JSONObject, values: List<JSONObject>, radius: Double) = values.filter { distance(p, it) <= radius }
  private var held: JSONObject?
    get() = s.optJSONObject("held")
    set(value) { s.put("held", value ?: JSONObject.NULL) }
  private fun evidence(t: Long): String? {
    if (s.optBoolean("usb")) return "charging"
    val e = s.optJSONObject("environment") ?: return null
    val age = t - e.optLong("observedAt")
    return e.optString("environment").takeIf { age in 0..240000 && it in listOf("indoor", "window") }
  }
  private fun gap(values: List<JSONObject>): Double {
    val gaps = values.zipWithNext { a, b -> (time(b) - time(a)).toDouble() }.sorted()
    return if (gaps.isEmpty()) 0.0 else gaps[gaps.size / 2]
  }
  private fun typicalGap() = gap((points("goods").takeLast(10) + points("weak").takeLast(10)).sortedBy(::time).takeLast(10))
  private fun travel(t: Long): Pair<JSONObject, Boolean>? {
    val slice = max(30000.0, typicalGap() * 2.2)
    val fixes = (points("goods") + points("weak")).filter { t - time(it) < 4 * slice }
    val slices = (3 downTo 0).map { i -> fixes.filter { t - time(it) >= i * slice && t - time(it) < (i + 1) * slice } }
    if (slices.any { it.size < 2 }) return null
    val centres = slices.map(::medianPoint)
    val steps = centres.zipWithNext { a, b ->
      Pair((b.getDouble("latitude") - a.getDouble("latitude")) * 111320,
        (b.getDouble("longitude") - a.getDouble("longitude")) * 111320 * cos(Math.toRadians(a.getDouble("latitude"))))
    }
    val north = steps.sumOf { it.first }; val east = steps.sumOf { it.second }
    val length = hypot(north, east).takeIf { it != 0.0 } ?: 1.0
    return centres.last() to (steps.all { (it.first * north + it.second * east) / length >= 12 } && distance(centres.first(), centres.last()) >= 60)
  }
  private fun settled(t: Long, strict: Boolean): Boolean {
    val previousHold = s.optJSONObject("previousHold")
    if (strict && previousHold != null && t - time(previousHold) <= 120000) {
      val afterRelease = (points("goods") + points("weak")).filter { time(it) > time(previousHold) }
      val first = afterRelease.minOfOrNull(::time)
      if (afterRelease.size < 3 || first == null || t - first < 60000) return false
    }
    val recent = points("goods").filter { t - time(it) <= 90000 }
    if (recent.size >= 2 && distance(recent.first(), recent.last()) > 120) return false
    return travel(t)?.let { !it.second } ?: !strict
  }
  private fun anchorGroup(): List<JSONObject> {
    val all = points("goods"); if (all.isEmpty()) return emptyList()
    val recent = all.filter { time(all.last()) - time(it) <= 600000 }
    var best = emptyList<JSONObject>()
    for (i in recent.indices.reversed()) { val group = near(recent[i], recent, 30.0); if (group.size > best.size) best = group }
    val trailing = near(recent.last(), recent, 30.0)
    val stayed = best.size >= 5 && time(best.last()) - time(best.first()) >= 60000 && time(recent.last()) - time(best.last()) <= 120000 && distance(best.first(), best.last()) <= 15
    return (if (stayed && best.size >= trailing.size * 2) best else trailing).takeLast(8)
  }
  private fun start(t: Long, reason: String): Boolean {
    val group = anchorGroup(); val lastGood = num(s, "lastGoodAt")
    val pool = points("weak").filter { lastGood == null || time(it) > lastGood }
    val lately = if (reason == com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c882)) pool.takeLast(5) else pool.filter { t - time(it) <= 60000 }
    if (group.isNotEmpty() && lately.size >= 3 && distance(medianPoint(lately), medianPoint(group)) > 100) return false
    if (reason == com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c882) && group.isNotEmpty() && pool.isNotEmpty() && time(pool.last()) - time(group.last()) > max(60000.0, typicalGap() * 3)) return false
    var anchor = if (group.isNotEmpty()) medianPoint(group) else if (pool.size >= 3) medianPoint(pool) else return false
    var source = if (group.isNotEmpty()) "good" else "weak"
    var refine = group
    val old = s.optJSONObject("previousHold")
    if (old != null && t - time(old) <= 600000 && distance(anchor, old.getJSONObject("anchor")) <= 30) {
      anchor = old.getJSONObject("anchor"); source = old.getString("source"); refine = list(old.optJSONArray("refine"))
    }
    held = JSONObject().put("anchor", anchor).put("source", source).put("reason", reason).put("refine", JSONArray(refine))
      .put("weak", JSONArray(pool.takeLast(300))).put("farGood", JSONArray()).put("lately", JSONArray()).put("nearby", JSONArray())
      .put("since", lastGood ?: pool.firstOrNull()?.let(::time) ?: t)
      .put("anchorAt", if (source == "good" && group.isNotEmpty()) time(group.last()) else t).put("startedAt", t)
    return true
  }
  private fun release(t: Long, why: String): Boolean {
    val h = held ?: return false
    s.put("previousHold", JSONObject().put("time", t).put("why", why).put("anchor", h.getJSONObject("anchor")).put("source", h.getString("source")).put("refine", h.getJSONArray("refine")))
    held = null; return true
  }
  private fun shareWindow(h: JSONObject) = max(60000.0, gap(list(h.optJSONArray("lately"))) * 4)
  private fun whileHeld(p: JSONObject?, quality: String, t: Long): Boolean {
    val h = held ?: return false
    var lately = list(h.optJSONArray("lately")); lately.add(JSONObject().put("time", t).put("quality", quality))
    h.put("lately", JSONArray(lately)); lately = lately.filter { t - time(it) <= shareWindow(h) }.toMutableList(); h.put("lately", JSONArray(lately))
    if (p != null && distance(p, h.getJSONObject("anchor")) <= 80) h.put("farGood", JSONArray())
    if (p != null && distance(p, h.getJSONObject("anchor")) <= 60) h.put("nearby", JSONArray())
    if (quality == "good" && p != null) {
      val anchor = h.getJSONObject("anchor"); val away = distance(p, anchor)
      val why = evidence(t)
      val nearby = list(h.optJSONArray("nearby")).filter { time(p) - time(it) <= 120000 }.toMutableList()
      if (away > 60) nearby.add(p)
      h.put("nearby", JSONArray(nearby))
      if (nearby.size >= 6 && time(p) - time(nearby.first()) >= 60000 && lately.count { it.optString("quality") == "good" } >= lately.size * 0.7 && distance(medianPoint(nearby), anchor) > 60
        && (why == null || near(medianPoint(nearby), nearby, 30.0).size == nearby.size)) return release(t, "good-fixes-nearby")
      if (away <= 20) {
        val refine = (list(h.optJSONArray("refine")) + p).takeLast(200); h.put("refine", JSONArray(refine))
        val refined = medianPoint(refine); if (distance(refined, anchor) >= 15) h.put("anchor", refined)
        h.put("source", "good").put("farGood", JSONArray()); return false
      }
      val far = list(h.optJSONArray("farGood")).filter { t - time(it) <= max(180000.0, shareWindow(h) * 2) }.toMutableList()
      h.put("farGood", JSONArray(far)); if (away <= 80) return false
      p.put("away", away); far.add(p); h.put("farGood", JSONArray(far))
      val needed = if (why != null) 3 else 2
      val latest = far.takeLast(needed)
      val agree = latest.size == needed && near(medianPoint(latest), latest, 30.0).size == needed
      val recent = lately.filter { t - time(it) <= shareWindow(h) }
      val outside = recent.size >= 3 && recent.count { it.optString("quality") == "good" } >= recent.size * 0.5
      val beyond = far.takeLast(2)
      val agreeingRun = if (agree) far.asReversed().takeWhile { distance(it, medianPoint(latest)) <= 30 } else emptyList()
      val sustained = agree && agreeingRun.isNotEmpty() && t - time(agreeingRun.last()) >= 30000
      val farRun = far.drop(far.indexOfLast { it.getDouble("away") <= 100 } + 1)
      val goodTravel = if (farRun.size >= 3) {
        val first = farRun.first(); val last = farRun.last()
        val direct = distance(first, last)
        val path = farRun.zipWithNext { a, b -> distance(a, b) }.sum()
        time(last) - time(first) >= 10000 && direct >= 60 && direct >= path * 0.8 && last.getDouble("away") - first.getDouble("away") >= 12
          && farRun.zipWithNext { a, b -> b.getDouble("away") >= a.getDouble("away") - 15 }.all { it }
      } else false
      val travelling = if (why != null) travel(t) else null
      val leaves = if (why != null) sustained || goodTravel || (travelling?.second == true && distance(travelling.first, anchor) > 80)
        else (outside && beyond.size == 2) || agree || (beyond.size == 2 && beyond.all { it.getDouble("away") > 100 })
      if (leaves) return release(t, "good-fixes-away")
    } else if (quality == "weak" && p != null) {
      val weak = (list(h.optJSONArray("weak")) + p).takeLast(300); h.put("weak", JSONArray(weak))
      if (h.optString("source") == "weak") { val anchor = medianPoint(weak); if (distance(anchor, h.getJSONObject("anchor")) >= 10) h.put("anchor", anchor) }
      if (s.optBoolean("usb")) return false
      val travelling = travel(t)
      if (travelling?.second == true && distance(travelling.first, h.getJSONObject("anchor")) > 80) return release(t, "travelling")
      val span = max(90000.0, gap(weak.takeLast(10)) * 10) * 1.5
      val last = weak.filter { t - time(it) <= span }
      if (last.size >= 10 && time(last.last()) - time(last.first()) >= 90000 && last.count { distance(it, h.getJSONObject("anchor")) > 150 } >= ceil(last.size * 0.75)) return release(t, "weak-fixes-away")
    }
    return false
  }
  private fun environment(packet: Packet) {
    val bucket = packet.time / 120000 * 120000
    val buckets = s.optJSONObject("buckets") ?: JSONObject().also { s.put("buckets", it) }
    if (num(s, "bucketStart") != null && num(s, "bucketStart") != bucket) {
      var best: JSONObject? = null; var bestRssi = Double.NEGATIVE_INFINITY
      for (key in buckets.keys()) {
        val rows = list(buckets.optJSONArray(key)); if (rows.isEmpty()) continue
        val signals = rows.mapNotNull { (it.opt("rssi") as? Number)?.toDouble() }
        val rssi = if (signals.isEmpty()) Double.NEGATIVE_INFINITY else signals.average()
        val e = JSONObject().put("environment", IndoorEnvironment.classify(rows)).put("observedAt", rows.maxOf { it.getLong("track_at") })
        if (best == null || rssi > bestRssi) { best = e; bestRssi = rssi }
      }
      if (best != null && (s.optJSONObject("environment") == null || best.getLong("observedAt") >= s.getJSONObject("environment").getLong("observedAt"))) s.put("environment", best)
      s.put("buckets", JSONObject())
    }
    s.put("bucketStart", bucket)
    val current = s.getJSONObject("buckets"); val key = packet.masterId?.toString() ?: ""
    val rows = list(current.optJSONArray(key))
    val row = JSONObject().put("master_id", packet.masterId).put("slave_id", packet.slaveId).put("track_at", packet.time)
      .put("slave_lat", packet.dog?.latitude ?: 0).put("slave_lon", packet.dog?.longitude ?: 0)
      .put("satellites", packet.satellites ?: JSONObject.NULL).put("hdop", packet.hdop ?: JSONObject.NULL)
      .put("rssi", packet.rssi ?: JSONObject.NULL).put("snr", packet.snr ?: JSONObject.NULL).put("usb_present", packet.usb?.let { if (it) 1 else 0 } ?: JSONObject.NULL)
    val last = rows.lastOrNull()
    if (last == null || last.getLong("track_at") != packet.time || last.getDouble("slave_lat") != row.getDouble("slave_lat") || last.getDouble("slave_lon") != row.getDouble("slave_lon")) rows.add(row)
    current.put(key, JSONArray(rows))
  }
  fun push(packet: Packet) {
    val t = packet.time
    val lastTime = num(s, "lastTime") ?: Long.MIN_VALUE
    if (t < lastTime) return
    packet.usb?.let { s.put("usb", it) }; environment(packet)
    val p = point(packet); val previous = s.optJSONObject("previous")
    val seen = points("recentFixes")
    val master = packet.masterId?.toString() ?: ""
    val same = t == lastTime && previous != null && (p != null) == (previous.optJSONObject("point") != null) &&
      (p == null || distance(p, previous.getJSONObject("point")) == 0.0)
    val copy = p != null && seen.any { t - time(it) in 0..60000 && (it.optString("master") != master || time(it) == t) && distance(p, it) == 0.0 }
    s.put("lastTime", t)
    if (same || copy) return
    if (p != null) { seen.add(JSONObject(p.toString()).put("master", master)); set("recentFixes", seen.filter { t - time(it) <= 60000 }) }
    val measured = if (p == null) "none" else if (packet.good) "good" else "weak"
    val backed = previous?.optString("quality") == "good" && t - previous.getLong("time") <= 90000
    val quality = if (measured == "good" && !backed) "weak" else measured
    var ended = false
    if (measured == "good" && backed && previous != null && !previous.optBoolean("trusted")) {
      val promoted = previous.optJSONObject("point")
      if (promoted != null) {
        set("goods", points("goods") + promoted); set("weak", points("weak").filter { time(it) != time(promoted) })
        if (held != null) ended = whileHeld(promoted, "good", time(promoted))
      }
    }
    s.put("previous", JSONObject().put("time", t).put("quality", measured).put("point", p ?: JSONObject.NULL).put("trusted", quality == "good"))
    set("goods", points("goods").takeLast(64))
    if (held != null) ended = whileHeld(p, quality, t)
    if (quality == "good" && p != null) { set("goods", points("goods") + p); s.put("lastGoodAt", t) }
    else if (quality == "weak" && p != null) set("weak", (points("weak") + p).takeLast(300))
    if (held != null || ended || quality == "good") return
    val quiet = num(s, "lastGoodAt")?.let { t - it }?.toDouble() ?: Double.POSITIVE_INFINITY
    val why = evidence(t)
    val weakSince = points("weak").any { (num(s, "lastGoodAt") == null || time(it) > num(s, "lastGoodAt")!!) && t - time(it) < max(60000.0, typicalGap() * 3) }
    val wait = if (why == null || why == "window") 45000 else 20000
    val oldHold = s.optJSONObject("previousHold")
    val recentlyReleased = oldHold != null && t - time(oldHold) <= 120000
    val cautious = why == null || why == "window" || recentlyReleased
    val recentGood = points("goods").filter { t - time(it) <= 120000 && (oldHold == null || time(it) > time(oldHold)) }
    val parked = why != null && quality == "weak" && recentGood.size >= 4 && time(recentGood.last()) - time(recentGood.first()) >= 60000 && near(medianPoint(recentGood), recentGood, 15.0).size == recentGood.size
    if ((parked && (!recentlyReleased || settled(t, true))) || (why != null || weakSince) && quiet >= wait && settled(t, cautious)) start(t, when (why) { "charging" -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c731); "indoor" -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c114); "window" -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c853); else -> com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c883) })
    else if (!weakSince && quiet >= 60000 && travel(t)?.second != true && (!recentlyReleased || settled(t, true))) start(t, com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c882))
  }
  fun coordinate() = held?.getJSONObject("anchor")?.let(::coord)
  fun write() = s.toString()
  companion object {
    /** Older foreground snapshots only contained the held anchor. Preserve it until release evidence arrives. */
    fun fromDog(dog: AlertDog): IndoorHold {
      if (dog.indoorState != null) return IndoorHold(dog.indoorState)
      val tracker = IndoorHold()
      val anchor = dog.coordinate?.let { JSONObject().put("latitude", it.latitude).put("longitude", it.longitude).put("time", dog.fixAt ?: dog.packetAt ?: 0) }
      if (anchor != null) {
        tracker.set("goods", listOf(anchor)); tracker.s.put("lastGoodAt", dog.fixAt ?: dog.packetAt ?: 0)
        if (dog.held) tracker.start(dog.packetAt ?: dog.fixAt ?: 0, com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c114))
      }
      return tracker
    }
  }
}
