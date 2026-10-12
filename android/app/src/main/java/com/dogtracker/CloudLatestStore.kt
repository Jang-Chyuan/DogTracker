package com.dogtracker

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Latest map snapshots cannot queue behind the archive store's transaction. */
class CloudLatestStore private constructor(context: Context) {
  companion object {
    @Volatile private var instance: CloudLatestStore? = null
    fun get(context: Context): CloudLatestStore = instance ?: synchronized(this) {
      instance ?: CloudLatestStore(context.applicationContext).also { instance = it }
    }
  }

  // A different file AND monitor. A second connection to dogtracker.sqlite
  // would still wait for its writer, and a shared worker would still queue.
  private val db = SQLiteDatabase.openOrCreateDatabase(
    File(context.filesDir, "databases/dogtracker-latest.sqlite").also { it.parentFile?.mkdirs() }, null)

  @Synchronized fun executeSql(sql: String, params: JSONArray): JSONObject {
    val verb = sql.trimStart().takeWhile { !it.isWhitespace() }.uppercase(java.util.Locale.ROOT)
    val result = JSONObject().put("results", JSONArray()).put("rowsAffected", 0)
    if (verb in setOf("SELECT", "PRAGMA", "WITH", "EXPLAIN")) {
      val arguments = Array<String?>(params.length()) { i ->
        if (params.isNull(i)) null else when (val value = params.get(i)) {
          is Boolean -> if (value) "1" else "0"
          else -> value.toString()
        }
      }
      db.rawQuery(sql, arguments).use { cursor ->
        val rows = JSONArray()
        while (cursor.moveToNext()) {
          val row = JSONObject()
          for (i in 0 until cursor.columnCount) row.put(cursor.getColumnName(i), when (cursor.getType(i)) {
            android.database.Cursor.FIELD_TYPE_NULL -> JSONObject.NULL
            android.database.Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(i)
            android.database.Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(i)
            else -> cursor.getString(i)
          })
          rows.put(row)
        }
        result.put("results", rows)
      }
    } else {
      db.compileStatement(sql).use { statement ->
        for (i in 0 until params.length()) when (val value = params.opt(i)) {
          null, JSONObject.NULL -> statement.bindNull(i + 1)
          is Boolean -> statement.bindLong(i + 1, if (value) 1 else 0)
          is Float, is Double -> statement.bindDouble(i + 1, (value as Number).toDouble())
          is Number -> statement.bindLong(i + 1, value.toLong())
          is String -> statement.bindString(i + 1, value)
          else -> throw IllegalArgumentException("Unsupported SQL parameter at $i")
        }
        if (verb == "INSERT" || verb == "REPLACE") {
          val id = statement.executeInsert()
          result.put("insertId", id).put("rowsAffected", if (id < 0) 0 else 1)
        } else result.put("rowsAffected", statement.executeUpdateDelete())
      }
    }
    return result
  }

  @Synchronized fun executeBatch(commands: JSONArray) {
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
