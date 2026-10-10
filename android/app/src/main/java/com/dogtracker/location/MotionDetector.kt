package com.dogtracker.location

import kotlin.math.*

/** Raw phone evidence; PhoneMotion.js replays the same decisions for old rows. */
internal class MotionDetector {
  private val tail = mutableListOf<LocationSample>()
  private val entry = mutableListOf<LocationSample>()
  private var state = "moving"
  private var lowAt = 0L
  private var highAt: Long? = null
  private var lastTime = 0L
  private var strictReentry = false
  private var lastGeometryAt = 0L
  private var origin: Long? = null

  private fun pushSample(list: MutableList<LocationSample>, point: LocationSample) {
    val start = origin ?: point.elapsedNanos.also { origin = it }
    fun bucket(sample: LocationSample) = (sample.elapsedNanos - start) / 1_000_000_000L
    if (list.isNotEmpty() && bucket(list.last()) == bucket(point)) list[list.lastIndex] = point
    else list.add(point)
  }
  fun accept(point: LocationSample): String {
    val time = point.elapsedNanos
    if (lastTime > 0 && (time <= lastTime || time - lastTime > 30_000_000_000L)) reset()
    lastTime = time
    pushSample(tail, point)
    tail.removeAll { time - it.elapsedNanos > 600_000_000_000L }
    while (tail.size > 720) tail.removeAt(0)
    val speed = point.rawSpeed
    val spread = point.speedAccuracy
    val valid = point.accuracy.isFinite() && point.accuracy >= 0 && point.accuracy < 50 &&
      speed != null && speed.isFinite() && speed >= 0
    val spreadValid = spread != null && spread.isFinite() && spread >= 0
    val low = valid && point.accuracy <= 30 && speed!! <= 1f &&
      (if (spreadValid) spread!! <= 1.5f && speed - spread <= 0.500001f else point.accuracy <= 10 && speed <= 0.3f)
    val high = valid && (if (spreadValid) speed!! - spread!! > 0.500001f else speed!! > 1f)
    val geometryNeeded = !valid || speed!! < 0.3f || (spreadValid && spread!! > 1.5f && !high) ||
      (!spreadValid && point.accuracy > 10 && speed <= 1f)
    if (low) lowAt = time
    if (state == "stationary") {
      if (high) {
        val start = highAt ?: time.also { highAt = it }
        if (time - start >= 3_000_000_000L) { reset(); strictReentry = true; return "moving" }
        return state
      } else highAt = null
      val checkGeometry = time - lastGeometryAt >= 5_000_000_000L
      if (checkGeometry) lastGeometryAt = time
      if (checkGeometry && departure(point)) { reset(); strictReentry = true; return "moving" }
      if (!low && time - lowAt > 180_000_000_000L) { reset(); return "unknown" }
      return state
    }
    if (!low) {
      entry.clear()
      if (strictReentry && geometryNeeded && progress(point, tail.filter { time - it.elapsedNanos <= 60_000_000_000L }, true)) {
        state = "moving"; return state
      }
      val checkGeometry = time - lastGeometryAt >= 5_000_000_000L
      if (checkGeometry) lastGeometryAt = time
      if (!high && checkGeometry && departure(point)) {
        if (!strictReentry) { reset(); strictReentry = true }
        state = "moving"; return state
      }
      state = if (high) "moving" else "unknown"
      return if (high) "moving" else "unknown"
    }
    pushSample(entry, point)
    while (entry.size > 1 && time - entry[1].elapsedNanos >= 20_000_000_000L) entry.removeAt(0)
    val first = entry.first()
    val path = entry.zipWithNext().sumOf { (a, b) -> distance(a, b) }
    val net = distance(first, point)
    val fine = entry.all { it.accuracy <= 10 }
    val threshold = if (fine) 3.0 else max(5.0, entry.maxOf { it.accuracy }.toDouble() * if (strictReentry) 2 else 1)
    val reentryProgress = strictReentry && progress(point, entry)
    if (reentryProgress && time - lastGeometryAt >= 5_000_000_000L) {
      lastGeometryAt = time
      if (departure(point)) { entry.clear(); state = "moving"; return state }
    }
    if (entry.any { distance(first, it) > threshold } || (fine && net > 3 && net / path > 0.75) ||
      reentryProgress) {
      entry.clear(); if (!strictReentry) tail.clear(); state = "moving"; return state
    }
    state = when {
      time - first.elapsedNanos >= 20_000_000_000L -> "stationary"
      time - first.elapsedNanos >= 15_000_000_000L -> "suspected_stationary"
      else -> "moving"
    }
    if (state == "stationary") { strictReentry = false; tail.clear(); tail.addAll(entry) }
    else if (!strictReentry) { tail.clear(); tail.addAll(entry) }
    return state
  }

  private fun progress(point: LocationSample, points: List<LocationSample>, qualityAware: Boolean = false): Boolean {
    if (points.size < 3 || point.elapsedNanos - points.first().elapsedNanos < 15_000_000_000L ||
      points.any { !it.accuracy.isFinite() || it.accuracy < 0 || it.accuracy >= 50 ||
        !it.rawLatitude.isFinite() || !it.rawLongitude.isFinite() || abs(it.rawLatitude) > 90 || abs(it.rawLongitude) > 180 }) return false
    val net = distance(points.first(), point)
    val steps = points.zipWithNext().map { (a, b) -> distance(a, b) }
    val threshold = if (qualityAware) max(3.0, points.maxOf { it.accuracy }.toDouble() * 2) else 3.0
    return net > threshold + 1e-8 && net / steps.sum() > (if (qualityAware) 0.85 else 0.75) && steps.max() < net * 0.5
  }

  // Reliable speed exits in 3 seconds. Geometry alone, with contradictory low
  // speed, must progress through independent time slices beyond the location
  // uncertainty. A relocation to another compact cluster is not progress.
  private fun departure(point: LocationSample): Boolean {
    val fine = tail.filter { point.elapsedNanos - it.elapsedNanos <= 20_000_000_000L }.all { it.accuracy <= 10 }
    val windows = if (fine) listOf(20_000L) else listOf(120_000L, 180_000L, 240_000L, 300_000L, 600_000L)
    for (width in windows) {
      val points = tail.filter { point.elapsedNanos - it.elapsedNanos <= width * 1_000_000L }
      if (points.size < 3 || point.elapsedNanos - points.first().elapsedNanos <
        (width - if (fine) 1000 else 20000) * 1_000_000L) continue
      val first = points.first()
      val net = distance(first, point)
      val threshold = max(if (fine) 3.0 else 12.0, (if (fine) 2 else 4) * points.maxOf { it.accuracy }.toDouble())
      if (net <= threshold) continue
      if (points.any { !it.accuracy.isFinite() || it.accuracy < 0 || it.accuracy >= 50 ||
        !it.rawLatitude.isFinite() || !it.rawLongitude.isFinite() || abs(it.rawLatitude) > 90 ||
        abs(it.rawLongitude) > 180 || (it.rawLatitude == 0.0 && it.rawLongitude == 0.0) }) continue
      val steps = points.zipWithNext().map { (a, b) -> distance(a, b) }
      if (net / steps.sum() < 0.85 || steps.max() >= net * 0.5) continue
      if (fine) return true
      var progress = true
      for (slice in 0 until (width / 30000).toInt()) {
        val part = points.filter { it.elapsedNanos >= first.elapsedNanos + slice * 30_000_000_000L &&
          it.elapsedNanos <= first.elapsedNanos + (slice + 1) * 30_000_000_000L }
        if (part.size < 3) { progress = false; break }
        val a = part.first(); val b = part.last()
        val length = distance(a, b)
        val path = part.zipWithNext().sumOf { (u, v) -> distance(u, v) }
        val lon = cos(Math.toRadians(first.rawLatitude))
        val dx = (point.rawLongitude - first.rawLongitude) * lon; val dy = point.rawLatitude - first.rawLatitude
        val px = (b.rawLongitude - a.rawLongitude) * lon; val py = b.rawLatitude - a.rawLatitude
        if (length < 3 || length / path < 0.8 || (dx * px + dy * py) / hypot(dx, dy) / hypot(px, py) < 0.8) {
          progress = false; break
        }
      }
      if (progress) return true
    }
    return false
  }

  private fun reset() {
    tail.clear(); entry.clear(); state = "moving"; highAt = null; lowAt = 0; strictReentry = false
    origin = null; lastGeometryAt = 0
  }
  private fun distance(a: LocationSample, b: LocationSample): Double {
    val lat = Math.toRadians(b.rawLatitude - a.rawLatitude)
    val lon = Math.toRadians(b.rawLongitude - a.rawLongitude)
    val h = sin(lat / 2).pow(2) + cos(Math.toRadians(a.rawLatitude)) * cos(Math.toRadians(b.rawLatitude)) * sin(lon / 2).pow(2)
    return 12742000 * asin(sqrt(h.coerceIn(0.0, 1.0)))
  }
}
