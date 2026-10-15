package com.dogtracker

import java.util.Calendar
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean

/**
 * How long this phone keeps its own data (#198): my route 30 days, the dogs'
 * packets this phone received 7 days, both counted in whole local days (the
 * history's calendar never offers a day that is only half there). A safety
 * cap of rows stays under each: a route recorded at one fix a second all day,
 * a dog heard around the clock.
 *
 * A dog not heard for longer keeps its newest [DOG_FLOOR] rows whatever their
 * age (as before #198, when every dog kept exactly that many): its last
 * position, battery and card stay on the map.
 *
 * Pruning runs on its own thread ([schedule]: 30 s after the store opens, then
 * at most once an hour while BLE or the route write), [BATCH] rows a
 * statement, each statement its own short hold of the write monitor
 * (DogStatusStore.locked, 稽核 A F3), with a pause between, so the BLE and
 * route writers never wait for a whole day's rows. The first sweep after an
 * update is the migration: it removes what the new rule removes, never a row
 * inside the window.
 *
 * The statements, as constants: the jest suites run these exact strings
 * (src/database/LocalRetention.js holds the same ones for the JS fallback).
 */
object LocalRetention {
  const val ROUTE_DAYS = 30
  const val ROUTE_CAP = 700_000L
  const val DOG_DAYS = 7
  const val DOG_FLOOR = 10_000L
  const val DOG_CAP = 200_000L
  const val BATCH = 500L
  const val SWEEP_EVERY_MS = 60 * 60_000L
  const val FIRST_SWEEP_DELAY_MS = 30_000L
  const val PAUSE_MS = 25L

  const val TABLE_SQL = "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  const val NEXT_DOG_SQL = "SELECT MIN(slave_id) FROM dog_status WHERE slave_id > ?"
  /** The dog's (OFFSET+1)th newest row: it and every older row are beyond the newest OFFSET. */
  const val DOG_NTH_NEWEST_SQL = "SELECT id FROM dog_status WHERE slave_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?"
  const val DOG_DELETE_SQL = "DELETE FROM dog_status WHERE id IN (SELECT id FROM dog_status WHERE slave_id = ? AND id <= ? AND received_at < ? LIMIT ?)"
  const val ROUTE_NEWEST_ID_SQL = "SELECT MAX(id) FROM myLocationTracker"
  // The cap counts rows as written (id, #194): a row dated ahead by a clock
  // later set back cannot outlive the newer ones.
  const val ROUTE_DELETE_SQL = "DELETE FROM myLocationTracker WHERE id IN (SELECT id FROM myLocationTracker WHERE id <= ? AND recorded_at < ? LIMIT ?)"

  /** What [sweep] needs from SQLite, so its decisions run in JVM unit tests. */
  interface Sql {
    /** First column of the first row as a number; null without a row or for NULL. */
    fun first(sql: String, vararg args: Any): Long?
    /** A DELETE, holding the write monitor for this one statement; rows changed. */
    fun change(sql: String, vararg args: Any): Int
    /** Between two batches: lets the BLE and route writers in. */
    fun pause()
  }

  /** The first instant kept: local midnight [days] − 1 days before [now]'s day. */
  fun cutoff(now: Long, days: Int, zone: TimeZone = TimeZone.getDefault()): Long =
    Calendar.getInstance(zone).run {
      timeInMillis = now
      set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
      add(Calendar.DAY_OF_MONTH, -(days - 1))
      timeInMillis
    }

  data class Swept(val route: Long, val dogs: Long)

  /** One pass over both tables (either may not exist yet). */
  fun sweep(sql: Sql, now: Long, zone: TimeZone = TimeZone.getDefault()): Swept {
    var route = 0L
    var dogs = 0L
    if (sql.first(TABLE_SQL, "myLocationTracker") != null) {
      sql.first(ROUTE_NEWEST_ID_SQL)?.let { newest ->
        if (newest > ROUTE_CAP) route += drain(sql, ROUTE_DELETE_SQL, newest - ROUTE_CAP, Long.MAX_VALUE)
        route += drain(sql, ROUTE_DELETE_SQL, Long.MAX_VALUE, cutoff(now, ROUTE_DAYS, zone))
      }
    }
    if (sql.first(TABLE_SQL, "dog_status") != null) {
      val cut = cutoff(now, DOG_DAYS, zone)
      var after = 0L
      while (true) {
        val slave = sql.first(NEXT_DOG_SQL, after) ?: break
        if (slave <= after) break
        after = slave
        sql.first(DOG_NTH_NEWEST_SQL, slave, DOG_CAP)?.let { dogs += drain(sql, DOG_DELETE_SQL, slave, it, Long.MAX_VALUE) }
        sql.first(DOG_NTH_NEWEST_SQL, slave, DOG_FLOOR)?.let { dogs += drain(sql, DOG_DELETE_SQL, slave, it, cut) }
      }
    }
    return Swept(route, dogs)
  }

  private fun drain(sql: Sql, statement: String, vararg args: Any): Long {
    var total = 0L
    while (true) {
      val removed = sql.change(statement, *args, BATCH)
      total += removed
      if (removed < BATCH) return total
      sql.pause()
    }
  }

  private val sweeping = AtomicBoolean(false)
  @Volatile private var nextSweepAt: Long? = null
  @Volatile private var last: String = "retention: no sweep yet"

  /** For dumpsys: the last sweep's counts and duration, no data. */
  fun diagnostics(): String = last

  /**
   * Starts a sweep on its own thread unless one ran within the hour or is
   * running. Cheap enough for every BLE and route write.
   */
  fun schedule(sql: Sql, delayMs: Long = 0, clock: () -> Long = System::currentTimeMillis) {
    val tick = System.nanoTime()
    nextSweepAt?.let { if (tick - it < 0) return }
    if (!sweeping.compareAndSet(false, true)) return
    nextSweepAt = tick + SWEEP_EVERY_MS * 1_000_000
    Thread({
      try {
        if (delayMs > 0) Thread.sleep(delayMs)
        val started = System.nanoTime()
        val swept = sweep(sql, clock())
        last = "retention: last sweep removed route=${swept.route} dogs=${swept.dogs} in ${(System.nanoTime() - started) / 1_000_000} ms"
      } catch (e: Exception) {
        last = "retention: last sweep failed (${e.javaClass.simpleName})"
        // Try again in five minutes, not in an hour.
        nextSweepAt = System.nanoTime() + 5 * 60_000L * 1_000_000
      } finally { sweeping.set(false) }
    }, "DogTracker-Retention").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }.start()
  }
}
