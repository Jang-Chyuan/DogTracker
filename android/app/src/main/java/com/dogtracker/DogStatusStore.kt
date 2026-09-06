package com.dogtracker

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** One native owner for both background writes and the history screen. */
class DogStatusStore private constructor(context: Context) {
  companion object {
    @Volatile private var instance: DogStatusStore? = null
    fun get(context: Context): DogStatusStore = instance ?: synchronized(this) {
      instance ?: DogStatusStore(context.applicationContext).also { instance = it }
    }
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
    "battery_valid" to listOf("battery_valid", "bv"), "master_battery_mv" to listOf("master_battery_mv", "mbmv"),
    "master_battery_percentage" to listOf("master_battery_pct", "mbp"), "master_battery_valid" to listOf("master_battery_valid", "mbv"),
    "rssi" to listOf("rssi"), "snr" to listOf("snr"), "gps_time" to listOf("gps_time", "gt"),
    "activity_time" to listOf("activity_time", "at"), "packet_type" to listOf("type"),
    "sequence" to listOf("seq"), "packet_length" to listOf("len")
  )

  init {
    val file = File(context.filesDir, "databases/dogtracker.sqlite")
    file.parentFile?.mkdirs()
    db = SQLiteDatabase.openOrCreateDatabase(file, null)
    db.rawQuery("PRAGMA busy_timeout=5000", null).use { it.moveToFirst() }
    val textFields = setOf("activity", "gps_time", "activity_time", "packet_type")
    val realFields = setOf("slave_lat", "slave_lon", "master_lat", "master_lon", "distance_meters", "speed_kmh", "hdop", "rssi", "snr")
    val definitions = fields.keys.joinToString(",") { name ->
      "$name ${if (name in textFields) "TEXT" else if (name in realFields) "REAL" else "INTEGER"}${if (name.endsWith("_valid")) " NOT NULL DEFAULT 0" else ""}"
    }
    db.execSQL("CREATE TABLE IF NOT EXISTS dog_status (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, $definitions, raw_payload TEXT)")
    val columns = mutableSetOf<String>()
    db.rawQuery("PRAGMA table_info(dog_status)", null).use { cursor ->
      while (cursor.moveToNext()) columns.add(cursor.getString(cursor.getColumnIndexOrThrow("name")))
    }
    for (name in listOf("master_id", "slave_id")) {
      if (name !in columns) db.execSQL("ALTER TABLE dog_status ADD COLUMN $name INTEGER")
    }
    db.execSQL("DROP TRIGGER IF EXISTS trim_dog_status_after_insert")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_dog_status_received_at ON dog_status(received_at DESC)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_dog_status_slave_received ON dog_status(slave_id, received_at DESC)")
  }

  @Synchronized fun save(data: JSONObject, payload: String, receivedAt: Long) {
    val slave = (value(data, listOf("slave_id", "sid")) as? Number)?.toDouble() ?: return
    if (slave <= 0 || slave > Int.MAX_VALUE || slave % 1.0 != 0.0) return
    val slaveId = slave.toInt()
    val previous = lastSaved[slaveId]
    if (previous != null && receivedAt >= previous && receivedAt - previous < 1000) return
    val row = ContentValues().apply {
      put("received_at", receivedAt)
      put("raw_payload", payload)
      for ((column, aliases) in fields) {
        val v = value(data, aliases)
        when {
          column.endsWith("_valid") -> put(column, if (v == null || v == false || v == "" || (v is Number && v.toDouble() == 0.0)) 0 else 1)
          v == null -> putNull(column)
          v is Number -> put(column, v.toDouble())
          else -> put(column, v.toString())
        }
      }
    }
    db.beginTransaction()
    try {
      db.insertOrThrow("dog_status", null, row)
      db.execSQL("DELETE FROM dog_status WHERE slave_id = ? AND id NOT IN (SELECT id FROM dog_status WHERE slave_id = ? ORDER BY id DESC LIMIT 10000)", arrayOf(slaveId, slaveId))
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
    lastSaved[slaveId] = receivedAt
  }

  private fun value(data: JSONObject, aliases: List<String>): Any? =
    aliases.firstOrNull { data.has(it) && !data.isNull(it) }?.let { data.get(it) }

  @Synchronized fun history(limit: Int): String {
    val result = JSONArray()
    db.rawQuery("SELECT * FROM dog_status ORDER BY received_at DESC, id DESC LIMIT ?", arrayOf(limit.coerceIn(1, 1000).toString())).use { cursor ->
      while (cursor.moveToNext()) {
        val row = JSONObject()
        for (i in 0 until cursor.columnCount) {
          row.put(cursor.getColumnName(i), when (cursor.getType(i)) {
            android.database.Cursor.FIELD_TYPE_NULL -> JSONObject.NULL
            android.database.Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(i)
            android.database.Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(i)
            else -> cursor.getString(i)
          })
        }
        result.put(row)
      }
    }
    return result.toString()
  }

  @Synchronized fun clear() {
    db.delete("dog_status", null, null)
    lastSaved.clear()
  }
}
