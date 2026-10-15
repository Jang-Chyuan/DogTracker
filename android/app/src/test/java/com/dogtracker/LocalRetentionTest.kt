package com.dogtracker

import org.junit.Assert.*
import org.junit.Test
import java.util.TimeZone

class LocalRetentionTest {
  private val taipei = TimeZone.getTimeZone("Asia/Taipei")
  private val day = 86_400_000L
  // 2026-10-15 12:00 in Taipei.
  private val now = 1_792_022_400_000L + 4 * 3_600_000L

  data class Row(val id: Long, val slave: Long, val time: Long)

  /** The constant statements answered from in-memory tables (jest runs the real SQL). */
  private class FakeSql(val route: MutableList<Row>? = mutableListOf(), val dogs: MutableList<Row>? = mutableListOf()) : LocalRetention.Sql {
    val statements = mutableListOf<String>()
    var pauses = 0
    override fun first(sql: String, vararg args: Any): Long? {
      statements += sql
      return when (sql) {
        LocalRetention.TABLE_SQL -> if ((if (args[0] == "dog_status") dogs else route) != null) 1L else null
        LocalRetention.ROUTE_NEWEST_ID_SQL -> route!!.maxOfOrNull { it.id }
        LocalRetention.NEXT_DOG_SQL -> dogs!!.filter { it.slave > (args[0] as Long) }.minOfOrNull { it.slave }
        LocalRetention.DOG_NTH_NEWEST_SQL -> dogs!!.filter { it.slave == args[0] as Long }.sortedByDescending { it.id }
          .getOrNull((args[1] as Long).toInt())?.id
        LocalRetention.DOG_COUNT_SQL -> dogs!!.size.toLong()
        LocalRetention.DOG_NEWEST_TIME_SQL -> dogs!!.filter { it.slave == args[0] as Long }.maxOfOrNull { it.time }
        LocalRetention.DOG_OLDEST_SQL -> dogs!!.filter { it.slave == args[0] as Long && it.id <= args[1] as Long && it.time < args[2] as Long }
          .minOfOrNull { it.id }
        else -> error("unexpected $sql")
      }
    }
    override fun change(sql: String, vararg args: Any): Int {
      statements += sql
      if (sql.startsWith(LocalRetention.DOG_CAP_HEAD)) {
        assertEquals(LocalRetention.dogCapSql((args.size - 2) / 3), sql)
        val from = args[0] as Long
        val terms = args.drop(1).dropLast(1).chunked(3)
        val gone = dogs!!.filter { r -> r.id >= from && terms.any { (slave, through, before) ->
          r.slave == slave as Long && r.id <= through as Long && r.time < before as Long } }
          .sortedBy { it.id }.take((args.last() as Long).toInt())
        dogs.removeAll(gone.toSet())
        return gone.size
      }
      val (table, match) = when (sql) {
        LocalRetention.ROUTE_DELETE_SQL -> route!! to { r: Row -> r.id <= args[0] as Long && r.time < args[1] as Long }
        LocalRetention.ROUTE_CAP_DELETE_SQL -> route!! to { r: Row -> r.id <= args[0] as Long }
        LocalRetention.DOG_DELETE_SQL -> dogs!! to { r: Row -> r.slave == args[0] as Long && r.id <= args[1] as Long && r.time < args[2] as Long }
        else -> error("unexpected $sql")
      }
      val gone = table.filter(match).sortedBy { it.id }.take((args.last() as Long).toInt())
      table.removeAll(gone.toSet())
      return gone.size
    }
    override fun pause() { pauses++ }
  }

  @Test fun theCutoffIsLocalMidnightOfTheFirstDayKept() {
    // 30 days kept, today included: from 9/16 00:00 in Taipei; a year from 2025/10/16.
    assertEquals(1_789_516_800_000L - 8 * 3_600_000L, LocalRetention.cutoff(now, 30, taipei))
    assertEquals(1_792_022_400_000L - 8 * 3_600_000L - 364 * day, LocalRetention.cutoff(now, 365, taipei))
    assertEquals(365, LocalRetention.ROUTE_DAYS)
    assertEquals(30, LocalRetention.DOG_DAYS)
    assertEquals(1_792_022_400_000L - 8 * 3_600_000L - 6 * day, LocalRetention.cutoff(now, 7, taipei))
    // Just after midnight the day just begun counts as one.
    val midnight = 1_792_022_400_000L - 8 * 3_600_000L
    assertEquals(midnight, LocalRetention.cutoff(midnight + 1, 1, taipei))
    assertEquals(midnight - day, LocalRetention.cutoff(midnight - 1, 1, taipei))
  }

  @Test fun routeRowsOlderThanAYearGoInBatchesAndNothingInsideTheWindow() {
    val cutoff = LocalRetention.cutoff(now, LocalRetention.ROUTE_DAYS, taipei)
    val sql = FakeSql(dogs = null)
    var id = 0L
    repeat(1_200) { sql.route!! += Row(++id, 0, cutoff - 1_200 + it) }
    repeat(10) { sql.route!! += Row(++id, 0, cutoff + it) }
    val swept = LocalRetention.sweep(sql, now, taipei)
    assertEquals(1_200L, swept.route)
    assertEquals((0 until 10).map { cutoff + it }, sql.route!!.map { it.time })
    // 500 + 500 + 200: a pause between full batches only.
    assertEquals(2, sql.pauses)
    assertEquals(0L, swept.dogs)
  }

  @Test fun theRouteCapKeepsTheNewestRowsAsWrittenWhateverTheirTime() {
    val sql = FakeSql(dogs = null)
    // One row dated ahead (a clock later set back), then the cap's worth.
    sql.route!! += Row(1, 0, now + day)
    for (i in 2..LocalRetention.ROUTE_CAP + 1) sql.route!! += Row(i, 0, now - 1_000)
    LocalRetention.sweep(sql, now, taipei)
    assertEquals(LocalRetention.ROUTE_CAP, sql.route!!.size.toLong())
    assertEquals(2L, sql.route!!.first().id)
  }

  @Test fun dogsKeepThirtyDaysAndAQuietDogKeepsItsNewestRows() {
    val cutoff = LocalRetention.cutoff(now, LocalRetention.DOG_DAYS, taipei)
    val sql = FakeSql(route = null)
    var id = 0L
    // Dog 3: heard every day, a few rows before the window. Dog 9: quiet for weeks.
    repeat(20) { sql.dogs!! += Row(++id, 3, cutoff - 20 + it) }
    repeat(5) { sql.dogs!! += Row(++id, 3, cutoff + it) }
    repeat(LocalRetention.DOG_FLOOR.toInt() + 30) { sql.dogs!! += Row(++id, 9, cutoff - 30 * day + it) }
    val swept = LocalRetention.sweep(sql, now, taipei)
    // Dog 3 has fewer than the floor: its old rows stay too.
    assertEquals(25, sql.dogs!!.count { it.slave == 3L })
    assertEquals(LocalRetention.DOG_FLOOR, sql.dogs!!.count { it.slave == 9L }.toLong())
    assertEquals(30L, swept.dogs)
    // Above the floor a busy dog loses only rows before the window.
    repeat(LocalRetention.DOG_FLOOR.toInt()) { sql.dogs!! += Row(++id, 3, cutoff + 100 + it) }
    LocalRetention.sweep(sql, now, taipei)
    assertTrue(sql.dogs!!.filter { it.slave == 3L }.all { it.time >= cutoff })
    assertEquals(LocalRetention.DOG_FLOOR + 5, sql.dogs!!.count { it.slave == 3L }.toLong())
  }

  @Test fun aboveTheTotalCapTheOldestOfAnyDogGoFirstButNeverAFloorOrANewestDay() {
    val sql = FakeSql(route = null)
    val today = LocalRetention.cutoff(now, 1, taipei)
    var id = 0L
    // Dog 8: quiet, exactly its floor, weeks old. Dog 10: oldest ids, all today.
    repeat(LocalRetention.DOG_FLOOR.toInt()) { sql.dogs!! += Row(++id, 8, today - 25 * day + it) }
    repeat(30_000) { sql.dogs!! += Row(++id, 10, today + it) }
    repeat(5_000) { sql.dogs!! += Row(++id, 9, today - 6 * day + it) }
    val dog7 = id + 1
    repeat(455_700) { sql.dogs!! += Row(++id, 7, today - 5 * day + it * 1_000L) }
    repeat(10_000) { sql.dogs!! += Row(++id, 9, today + 40_000 + it) }
    val swept = LocalRetention.sweep(sql, now, taipei)
    assertEquals(10_700L, swept.dogs)
    assertEquals(LocalRetention.DOG_TOTAL_CAP, sql.dogs!!.size.toLong())
    assertEquals(LocalRetention.DOG_FLOOR, sql.dogs!!.count { it.slave == 8L }.toLong())
    assertEquals(30_000, sql.dogs!!.count { it.slave == 10L })
    assertEquals(10_000, sql.dogs!!.count { it.slave == 9L })
    assertEquals(dog7 + 5_700, sql.dogs!!.filter { it.slave == 7L }.minOf { it.id })
    // One more packet: the next sweep takes dog 7's oldest row, not dog 10's.
    sql.dogs!! += Row(++id, 10, today + 1)
    assertEquals(1L, LocalRetention.sweep(sql, now, taipei).dogs)
    assertEquals(dog7 + 5_701, sql.dogs!!.filter { it.slave == 7L }.minOf { it.id })
    assertEquals(30_001, sql.dogs!!.count { it.slave == 10L })
  }

  @Test fun dogsHeardTogetherGoAWholeBatchAStatement() {
    val sql = FakeSql(route = null)
    val today = LocalRetention.cutoff(now, 1, taipei)
    var id = 0L
    // Two dogs heard at the same time for 25 days: their ids alternate.
    val each = (LocalRetention.DOG_TOTAL_CAP / 2 + 600).toInt()
    for (i in 0 until each) for (slave in listOf(12L, 13L)) sql.dogs!! += Row(++id, slave, today - 25 * day + i * 4_000L)
    val swept = LocalRetention.sweep(sql, now, taipei)
    assertEquals(1_200L, swept.dogs)
    // The 1,200 oldest ids of both dogs, three statements (500, 500, 200).
    assertEquals(1_201L, sql.dogs!!.minOf { it.id })
    assertEquals(3, sql.statements.count { it.startsWith(LocalRetention.DOG_CAP_HEAD) })
    assertEquals(each - 600, sql.dogs!!.count { it.slave == 12L })
  }

  @Test fun missingTablesAreSkipped() {
    val sql = FakeSql(route = null, dogs = null)
    assertEquals(LocalRetention.Swept(0, 0), LocalRetention.sweep(sql, now, taipei))
    assertEquals(listOf(LocalRetention.TABLE_SQL, LocalRetention.TABLE_SQL), sql.statements)
  }
}
