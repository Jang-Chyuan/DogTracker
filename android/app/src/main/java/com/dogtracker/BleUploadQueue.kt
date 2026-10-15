package com.dogtracker

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Called on the existing native DB owner's monitor, before display throttling. */
internal object BleUploadQueue {
  /** Waiting rows kept. Refused (blocked) rows do not count: UploadDatabase.prune expires them. */
  const val CAP = 20_000
  /**
   * At the cap the oldest waiting rows are thinned first: the oldest
   * [THIN_BATCH] rows that have an older row of the same account, Master and
   * dog in the same minute go, so every dog keeps one position per minute
   * over the whole outage. Only when nothing is left to thin do the oldest
   * [DROP_BATCH] rows go. The newest packets are always queued.
   */
  const val THIN_BATCH = 2_000
  const val DROP_BATCH = 500
  /** The cap is counted once every this many queued packets, not under every packet. */
  const val CHECK_EVERY = 50

  // The statements, as constants: the jest suites execute these exact strings.
  const val PENDING_COUNT_SQL = "SELECT COUNT(*) FROM ble_upload_queue WHERE status='pending'"
  const val THIN_SQL = "DELETE FROM ble_upload_queue WHERE id IN (SELECT o.id FROM ble_upload_queue o WHERE o.status='pending' AND EXISTS (SELECT 1 FROM ble_upload_queue k WHERE k.status='pending' AND k.owner_user_id=o.owner_user_id AND k.master_id=o.master_id AND k.slave_id=o.slave_id AND k.received_at>=o.received_at-(o.received_at%60000) AND k.received_at<=o.received_at AND (k.received_at<o.received_at OR (k.received_at=o.received_at AND k.id<o.id))) ORDER BY o.id LIMIT 2000)"
  const val DROP_SQL = "DELETE FROM ble_upload_queue WHERE id IN (SELECT id FROM ble_upload_queue WHERE status='pending' ORDER BY id LIMIT 500)"
  const val THINNED_SQL = "INSERT OR REPLACE INTO ble_upload_meta(key,value) VALUES('queue_thinned_at',?)"
  const val DUPLICATE_SQL = "SELECT id FROM ble_upload_queue WHERE owner_user_id=? AND master_id=? AND fingerprint=? LIMIT 1"
  const val REFUSED_SQL = "SELECT 1 FROM ble_upload_refusals WHERE owner_user_id=? AND master_id=?"
  /** The relay's next due time: refused Masters' rows wait for 重試 and do not keep it awake. */
  const val NEXT_RETRY_SQL = "SELECT MIN(next_retry_at) FROM ble_upload_queue WHERE owner_user_id=? AND status='pending' AND master_id NOT IN (SELECT master_id FROM ble_upload_refusals WHERE owner_user_id=?)"

  /** What [enqueue] needs from SQLite, so its decisions run in JVM unit tests. */
  interface Sql {
    /** First column of the first row, as text; null without a row or for NULL. */
    fun first(sql: String, vararg args: String): String?
    /** A DELETE/UPDATE; rows changed. */
    fun change(sql: String, vararg args: Any?): Int
    fun insert(values: Map<String, Any?>)
  }

  private class Android(private val db: SQLiteDatabase) : Sql {
    override fun first(sql: String, vararg args: String): String? = db.rawQuery(sql, args).use {
      if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null
    }
    override fun change(sql: String, vararg args: Any?): Int = db.compileStatement(sql).use { statement ->
      args.forEachIndexed { i, value ->
        when (value) {
          null -> statement.bindNull(i + 1)
          is Long, is Int -> statement.bindLong(i + 1, (value as Number).toLong())
          else -> statement.bindString(i + 1, value.toString())
        }
      }
      statement.executeUpdateDelete()
    }
    override fun insert(values: Map<String, Any?>) {
      db.insertOrThrow("ble_upload_queue", null, ContentValues().apply {
        for ((key, value) in values) when (value) {
          is Int -> put(key, value)
          is Long -> put(key, value)
          else -> put(key, value?.toString())
        }
      })
    }
  }

  fun initialize(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE IF NOT EXISTS ble_upload_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)")
    db.execSQL("CREATE TABLE IF NOT EXISTS ble_upload_settings (owner_user_id TEXT NOT NULL,master_id INTEGER NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('wifi','phone')),PRIMARY KEY(owner_user_id,master_id))")
    db.execSQL("CREATE TABLE IF NOT EXISTS ble_upload_queue (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,owner_user_id TEXT NOT NULL,master_id INTEGER NOT NULL,received_at INTEGER NOT NULL,payload_json TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_retry_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',sent_at INTEGER,slave_id INTEGER)")
    // A Master whose cloud route refused this phone (403): nothing more is
    // queued or sent for it until 重試, a route change or a successful send.
    db.execSQL("CREATE TABLE IF NOT EXISTS ble_upload_refusals (owner_user_id TEXT NOT NULL,master_id INTEGER NOT NULL,refused_at INTEGER NOT NULL,message TEXT NOT NULL DEFAULT '',PRIMARY KEY(owner_user_id,master_id))")
    val hasSlave = db.rawQuery("PRAGMA table_info(ble_upload_queue)", null).use { cursor ->
      var found = false
      while (cursor.moveToNext()) if (cursor.getString(1) == "slave_id") found = true
      found
    }
    if (!hasSlave) {
      db.beginTransaction()
      try {
        db.execSQL("ALTER TABLE ble_upload_queue ADD COLUMN slave_id INTEGER")
        db.rawQuery("SELECT id,payload_json FROM ble_upload_queue", null).use { cursor ->
          while (cursor.moveToNext()) {
            val slave = try { JSONObject(cursor.getString(1)).optInt("sid", 0) } catch (_: Exception) { 0 }
            db.execSQL("UPDATE ble_upload_queue SET slave_id=? WHERE id=?", arrayOf(slave, cursor.getLong(0)))
          }
        }
        db.setTransactionSuccessful()
      } finally { db.endTransaction() }
    }
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_ble_upload_latest ON ble_upload_queue(owner_user_id,status,master_id,slave_id,id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_ble_upload_pending ON ble_upload_queue(owner_user_id,status,next_retry_at,id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_ble_upload_fingerprint ON ble_upload_queue(owner_user_id,master_id,fingerprint,received_at)")
    // The cap count and the thinning's same-minute lookup.
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_ble_upload_thin ON ble_upload_queue(status,owner_user_id,master_id,slave_id,received_at)")
    db.execSQL("INSERT OR IGNORE INTO ble_upload_meta(key,value) VALUES('phone_id',?)", arrayOf(UUID.randomUUID().toString()))
  }

  fun enqueue(db: SQLiteDatabase, data: JSONObject, payload: String, receivedAt: Long): String? =
    enqueue(Android(db), data, payload, receivedAt)

  // Packets queued until the next cap count (0: count at the next one).
  private var untilCheck = 0

  /** Tests: count the cap at the next packet. */
  internal fun recount() { untilCheck = 0 }

  fun enqueue(sql: Sql, data: JSONObject, payload: String, receivedAt: Long,
    eventId: () -> String = { UUID.randomUUID().toString() }): String? {
    val master = (data.opt("mid") as? Number)?.toDouble() ?: return null
    if (!master.isFinite() || master < 1 || master > 65535 || master % 1.0 != 0.0) return null
    val owner = sql.first("SELECT value FROM ble_upload_meta WHERE key='owner'").orEmpty()
    if (owner.isEmpty()) return null
    val masterId = master.toInt().toString()
    if (sql.first("SELECT mode FROM ble_upload_settings WHERE owner_user_id=? AND master_id=?", owner, masterId) != "phone") return null
    if (sql.first(REFUSED_SQL, owner, masterId) != null) return null
    val fingerprint = MessageDigest.getInstance("SHA-256").digest(payload.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    // The same bytes again (the Master re-sending a quiet dog's last packet:
    // same seq and GPS time) are the same event however late they come. A
    // 60 s window let one copy a minute through, each with a new event_id
    // the server cannot tell apart. Rows kept: all waiting and refused ones,
    // the newest sent ones (UploadDatabase.prune).
    val duplicate = sql.first(DUPLICATE_SQL, owner, masterId, fingerprint) != null
    if (duplicate) return null
    if (untilCheck <= 0) {
      // At most CHECK_EVERY rows over the cap until the next count.
      untilCheck = CHECK_EVERY
      if ((sql.first(PENDING_COUNT_SQL)?.toLongOrNull() ?: 0L) >= CAP) {
        if (sql.change(THIN_SQL) == 0) sql.change(DROP_SQL)
        sql.change(THINNED_SQL, receivedAt.toString())
      }
    }
    untilCheck--
    sql.insert(linkedMapOf("event_id" to eventId(), "owner_user_id" to owner, "master_id" to master.toInt(),
      "received_at" to receivedAt, "payload_json" to payload, "fingerprint" to fingerprint,
      "slave_id" to data.optInt("sid", 0)))
    // The pre-thinning "queue full" notice, from older versions.
    sql.change("DELETE FROM ble_upload_meta WHERE key='queue_error'")
    return owner
  }
}
