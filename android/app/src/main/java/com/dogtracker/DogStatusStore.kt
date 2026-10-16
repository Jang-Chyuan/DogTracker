package com.dogtracker

import android.content.ContentValues
import android.content.Context
import android.database.AbstractWindowedCursor
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteDoneException
import android.database.sqlite.SQLiteStatement
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * One native owner for both background writes and the history screen.
 *
 * Writes (BLE packets, the phone route, every App write and batch) take this
 * object's monitor, one at a time. Reads do not: the file is in WAL mode, so
 * a SELECT runs on one of the framework's reader connections and sees the
 * last committed state while a writer works (稽核 A F3; before, a 20,000-row
 * read or a cloud download held up the BLE and location writers).
 */
class DogStatusStore private constructor(private val context: Context) {
  companion object {
    @Volatile private var instance: DogStatusStore? = null
    fun get(context: Context): DogStatusStore = instance ?: synchronized(this) {
      instance ?: DogStatusStore(context.applicationContext).also { instance = it }
    }
    /** The writers whose waits are kept apart in [waits]. */
    const val BLE = "ble"
    const val LOCATION = "location"
    /** A route row from the location looper's hand-over to its commit (LocationTrackerStore). */
    const val LOCATION_DELAY = "location-row-delay"
    /** Lock waits and holds of this process (dumpsys of the BLE and location services). */
    val waits = DatabaseWaits()
    /** For dumpsys: never opens the database or waits for its lock. */
    fun diagnostics(): String = buildString {
      appendLine("database: wal=${instance?.wal ?: "not open"}")
      appendLine(LocalRetention.diagnostics())
      waits.lines().forEach { appendLine(it) }
    }.trimEnd()
  }

  // Preserve the existing Nitro SQLite location (filesDir + location + name).
  private val db: SQLiteDatabase
  private val lastSaved = mutableMapOf<Int, Long>()
  private val fields = linkedMapOf(
    "master_id" to listOf("master_id", "mid"), "slave_id" to listOf("slave_id", "sid"),
    "slave_lat" to listOf("slave_lat", "slat", "lat"), "slave_lon" to listOf("slave_lon", "slon", "lon"),
    "master_lat" to listOf("master_lat", "mlat"), "master_lon" to listOf("master_lon", "mlon"),
    "distance_meters" to listOf("distance_m", "dst"), "speed_kmh" to listOf("speed_kmh", "spd"),
    "satellites" to listOf("sat"), "hdop" to listOf("hdop", "hd"),
    "activity" to listOf("activity", "act"), "activity_valid" to listOf("activity_valid", "av"),
    "battery_mv" to listOf("battery_mv", "bmv"), "battery_percentage" to listOf("battery_pct", "bp"),
    "usb_present" to listOf("usbPresent", "usb_present"),
    "battery_valid" to listOf("battery_valid", "bv"), "master_battery_mv" to listOf("master_battery_mv", "mbmv"),
    "master_battery_percentage" to listOf("master_battery_pct", "mbp"), "master_battery_valid" to listOf("master_battery_valid", "mbv"),
    "rssi" to listOf("rssi"), "snr" to listOf("snr"), "gps_time" to listOf("gps_time", "gt"),
    "activity_time" to listOf("activity_time", "at"), "packet_type" to listOf("type"),
    "sequence" to listOf("seq"), "packet_length" to listOf("len")
  )

  /**
   * LocalRetention's statements on this store: reads on a reader connection,
   * each DELETE its own short hold of the write monitor ("retention").
   */
  private val retentionSql by lazy {
    object : LocalRetention.Sql {
      override fun first(sql: String, vararg args: Any): Long? = db.compileStatement(sql).use { statement ->
        bind(statement, args)
        try { statement.simpleQueryForString()?.toLongOrNull() } catch (e: SQLiteDoneException) { null }
      }
      override fun change(sql: String, vararg args: Any): Int = retentionDelete(sql, args)
      override fun pause() = Thread.sleep(LocalRetention.PAUSE_MS)
    }
  }

  private fun retentionDelete(sql: String, args: Array<out Any>): Int = atWriterPriority {
    locked("retention") {
      db.compileStatement(sql).use { statement -> bind(statement, args); statement.executeUpdateDelete() }
    }
  }

  /**
   * The prune thread runs at the lowest priority (LocalRetention.schedule) so
   * it never competes with the screen; but while one of its statements holds
   * the write monitor, the BLE and route writers wait for it. On a busy CPU
   * the lowest priority was descheduled in the middle of a 500-row DELETE (a
   * statement with nothing to delete held the lock 0.5–6.8 s on a loaded
   * emulator): for the statement, and the wait for the monitor, it runs at
   * the default priority as the writers do, and drops back between batches.
   */
  private inline fun <T> atWriterPriority(block: () -> T): T {
    val before = try { android.os.Process.getThreadPriority(android.os.Process.myTid()) } catch (e: Exception) { null }
    val raise = before != null && before > android.os.Process.THREAD_PRIORITY_DEFAULT
    if (raise) try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_DEFAULT) } catch (e: Exception) {}
    try { return block() } finally {
      if (raise && before != null) try { android.os.Process.setThreadPriority(before) } catch (e: Exception) {}
    }
  }

  private fun bind(statement: SQLiteStatement, args: Array<out Any>) = args.forEachIndexed { i, value ->
    if (value is Number) statement.bindLong(i + 1, value.toLong()) else statement.bindString(i + 1, value.toString())
  }

  /** Prunes by LocalRetention's rule, at most once an hour (BLE and route writes call it). */
  fun scheduleRetention() = LocalRetention.schedule(retentionSql)

  init {
    val file = File(context.filesDir, "databases/dogtracker.sqlite")
    file.parentFile?.mkdirs()
    // WAL (稽核 A F3): readers get their own connections and never wait for
    // a writer, nor a writer for them. Only this framework SQLite opens the
    // file on Android (TrackingDatabaseConnection); an older App that opens
    // it without the flag puts it back to its own journal mode on open.
    db = SQLiteDatabase.openDatabase(file.path, null,
      SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING)
    db.rawQuery("PRAGMA busy_timeout=5000", null).use { it.moveToFirst() }
    val textFields = setOf("activity", "gps_time", "activity_time", "packet_type")
    val realFields = setOf("slave_lat", "slave_lon", "master_lat", "master_lon", "distance_meters", "speed_kmh", "hdop", "rssi", "snr")
    val definitions = fields.keys.joinToString(",") { name ->
      "$name ${if (name in textFields) "TEXT" else if (name in realFields) "REAL" else "INTEGER"}${if (name.endsWith("_valid")) " NOT NULL DEFAULT 0" else ""}"
    }
    db.execSQL("CREATE TABLE IF NOT EXISTS dog_status (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, $definitions, raw_payload TEXT)")
    // Keep downloaded cloud history separate from BLE writes and retention.
    db.execSQL("CREATE TABLE IF NOT EXISTS supabase_dog_status (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, $definitions, raw_payload TEXT)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_supabase_dog_status_received_at_id ON supabase_dog_status(received_at, id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_supabase_dog_status_slave_received ON supabase_dog_status(slave_id, received_at DESC)")
    val columns = mutableSetOf<String>()
    db.rawQuery("PRAGMA table_info(dog_status)", null).use { cursor ->
      while (cursor.moveToNext()) columns.add(cursor.getString(cursor.getColumnIndexOrThrow("name")))
    }
    for (name in listOf("master_id", "slave_id")) {
      if (name !in columns) db.execSQL("ALTER TABLE dog_status ADD COLUMN $name INTEGER")
    }
    for (table in listOf("dog_status", "supabase_dog_status")) {
      val hasUsb = db.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
        var found = false
        while (cursor.moveToNext()) {
          if (cursor.getString(cursor.getColumnIndexOrThrow("name")) == "usb_present") found = true
        }
        found
      }
      if (!hasUsb) db.execSQL("ALTER TABLE $table ADD COLUMN usb_present INTEGER")
    }
    db.execSQL("DROP TRIGGER IF EXISTS trim_dog_status_after_insert")
    // The JS reader retires the received_at-only index. Create its existing
    // composite replacement directly so each cold open does not rebuild and
    // immediately drop an index over all local rows.
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_dog_status_received_at_id ON dog_status(received_at, id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_dog_status_slave_received ON dog_status(slave_id, received_at DESC)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_dog_status_slave_id ON dog_status(slave_id, id DESC)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_dog_status_slave_master ON dog_status(slave_id, master_id)")
    BleUploadQueue.initialize(db)
    // The first sweep after an update is the migration to the time rule; it
    // waits out the cold start's reads and writes.
    LocalRetention.schedule(retentionSql, LocalRetention.FIRST_SWEEP_DELAY_MS)
  }

  private val wal = db.isWriteAheadLoggingEnabled

  /**
   * Runs [block] holding the write monitor: [work] names it in the hold
   * times, [writer] (BLE, location) also records how long it waited.
   * Nested calls (a batch's statements) are part of the outer one.
   */
  private inline fun <T> locked(work: String, writer: String? = null, block: () -> T): T {
    if (Thread.holdsLock(this)) return block()
    val asked = System.nanoTime()
    synchronized(this) {
      val got = System.nanoTime()
      if (writer != null) waits.waited(writer, (got - asked) / 1_000_000)
      try { return block() } finally { waits.held(work, (System.nanoTime() - got) / 1_000_000) }
    }
  }

  // Lock-free, on a reader connection (SearchRelayService calls it off the main thread).
  fun nextSearchRetry(owner: String): Long? =
    db.rawQuery(BleUploadQueue.NEXT_RETRY_SQL, arrayOf(owner, owner)).use {
      if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null
    }

  fun save(data: JSONObject, payload: String, receivedAt: Long) { locked(BLE, BLE) {
    // Upload retention and identity are independent of the one-second map feed throttle.
    BleUploadQueue.enqueue(db, data, payload, receivedAt)?.let { owner ->
      com.dogtracker.cloud.SearchRelayService.queued(context, owner)
    }
    // The service hands packets over with it as a whole number
    // (ReceiverMasterId.normalized); read the same way regardless.
    val slaveId = ReceiverMasterId.slaveOf(data) ?: return
    val previous = lastSaved[slaveId]
    if (previous != null && receivedAt >= previous && receivedAt - previous < 1000) return
    val row = ContentValues().apply {
      put("received_at", receivedAt)
      put("raw_payload", payload)
      for ((column, aliases) in fields) {
        val v = value(data, aliases)
        when {
          column == "usb_present" -> {
            when {
              v == true || (v is Number && v.toDouble() == 1.0) -> put(column, 1)
              v == false || (v is Number && v.toDouble() == 0.0) -> put(column, 0)
              else -> putNull(column)
            }
          }
          column.endsWith("_valid") -> put(column, if (v == null || v == false || v == "" || (v is Number && v.toDouble() == 0.0)) 0 else 1)
          v == null -> putNull(column)
          v is Number -> put(column, v.toDouble())
          else -> put(column, v.toString())
        }
      }
    }
    db.insertOrThrow("dog_status", null, row)
    lastSaved[slaveId] = receivedAt
    // By time now (LocalRetention), on its own thread, not under every packet.
    scheduleRetention()
  } }

  private fun value(data: JSONObject, aliases: List<String>): Any? =
    aliases.firstOrNull { data.has(it) && !data.isNull(it) }?.let { data.get(it) }

  /**
   * A whole result read on a reader connection, or null when it did not fit
   * one cursor window: a cursor fills each further window by running the
   * query again, and a commit in between could shift the rows. Such a read
   * runs again holding the monitor instead, where no commit comes between.
   */
  private fun readUnlocked(sql: String, arguments: Array<String?>): JSONArray? =
    db.rawQuery(sql, arguments).use { cursor ->
      val count = cursor.count
      val window = (cursor as? AbstractWindowedCursor)?.window
      if (count > 0 && (window == null || window.startPosition != 0 || window.numRows < count)) {
        waits.oversizedRead()
        null
      } else rows(cursor)
    }

  private fun rows(cursor: Cursor): JSONArray {
    val rows = JSONArray()
    while (cursor.moveToNext()) {
      val row = JSONObject()
      for (i in 0 until cursor.columnCount) row.put(cursor.getColumnName(i),
        when (cursor.getType(i)) {
          Cursor.FIELD_TYPE_NULL -> JSONObject.NULL
          Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(i)
          Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(i)
          else -> cursor.getString(i)
        })
      rows.put(row)
    }
    return rows
  }

  fun history(limit: Int): String {
    val sql = "SELECT * FROM dog_status ORDER BY received_at DESC, id DESC LIMIT ?"
    val arguments = arrayOf<String?>(limit.coerceIn(1, 1000).toString())
    return (readUnlocked(sql, arguments) ?: locked("read") { db.rawQuery(sql, arguments).use(::rows) }).toString()
  }

  fun clear() = locked("write") {
    db.delete("dog_status", null, null)
    lastSaved.clear()
  }

  /**
   * One engine for the App's readers, transactions and BLE writer. A SELECT
   * (or WITH) outside a transaction reads without the monitor; everything
   * else holds it, as before.
   */
  fun executeSql(sql: String, params: JSONArray): JSONObject {
    val query = sql.trimStart()
    val verb = query.takeWhile { !it.isWhitespace() }.uppercase(java.util.Locale.ROOT)
    if (verb in setOf("SELECT", "PRAGMA", "WITH", "EXPLAIN")) {
      val arguments = Array<String?>(params.length()) { i ->
        if (params.isNull(i)) null else when (val value = params.get(i)) {
          is Boolean -> if (value) "1" else "0"
          else -> value.toString()
        }
      }
      val unlocked = if (verb != "PRAGMA" && !db.inTransaction()) readUnlocked(sql, arguments) else null
      val rows = unlocked ?: locked(if (verb == "PRAGMA") "pragma" else "read") {
        // A PRAGMA's setting stays with the connection that ran it (analysis_limit
        // before optimize): a transaction keeps it on the one writer connection.
        if (verb != "PRAGMA" || db.inTransaction()) db.rawQuery(sql, arguments).use(::rows)
        else {
          db.beginTransactionNonExclusive()
          try { db.rawQuery(sql, arguments).use(::rows).also { db.setTransactionSuccessful() } }
          finally { db.endTransaction() }
        }
      }
      return JSONObject().put("results", rows).put("rowsAffected", 0)
    }
    return locked("sql") {
      val result = JSONObject().put("results", JSONArray()).put("rowsAffected", 0)
      db.compileStatement(sql).use { statement ->
        for (i in 0 until params.length()) {
          val value = params.opt(i)
          when (value) {
            null, JSONObject.NULL -> statement.bindNull(i + 1)
            is Boolean -> statement.bindLong(i + 1, if (value) 1 else 0)
            is Float, is Double -> statement.bindDouble(i + 1, (value as Number).toDouble())
            is Number -> statement.bindLong(i + 1, value.toLong())
            is String -> statement.bindString(i + 1, value)
            else -> throw IllegalArgumentException("Unsupported SQL parameter at $i")
          }
        }
        if (verb == "INSERT" || verb == "REPLACE") {
          val id = statement.executeInsert()
          result.put("insertId", id).put("rowsAffected", if (id < 0) 0 else 1)
        } else result.put("rowsAffected", statement.executeUpdateDelete())
      }
      result
    }
  }

  /** One transaction. [writer] (BLE, location) records its wait apart from the App's batches. */
  fun executeBatch(commands: JSONArray, writer: String? = null) = locked(writer ?: "batch", writer) {
    db.beginTransaction()
    try {
      for (i in 0 until commands.length()) {
        val command = commands.getJSONObject(i)
        executeSql(command.getString("query"), command.optJSONArray("params") ?: JSONArray())
      }
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
}
