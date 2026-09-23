package com.dogtracker

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Called on the existing native DB owner's monitor, before display throttling. */
internal object BleUploadQueue {
  fun initialize(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE IF NOT EXISTS ble_upload_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)")
    db.execSQL("CREATE TABLE IF NOT EXISTS ble_upload_settings (owner_user_id TEXT NOT NULL,master_id INTEGER NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('wifi','phone')),PRIMARY KEY(owner_user_id,master_id))")
    db.execSQL("CREATE TABLE IF NOT EXISTS ble_upload_queue (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,owner_user_id TEXT NOT NULL,master_id INTEGER NOT NULL,received_at INTEGER NOT NULL,payload_json TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_retry_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',sent_at INTEGER)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_ble_upload_pending ON ble_upload_queue(owner_user_id,status,next_retry_at,id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_ble_upload_fingerprint ON ble_upload_queue(owner_user_id,master_id,fingerprint,received_at)")
    db.execSQL("INSERT OR IGNORE INTO ble_upload_meta(key,value) VALUES('phone_id',?)", arrayOf(UUID.randomUUID().toString()))
  }

  fun enqueue(db: SQLiteDatabase, data: JSONObject, payload: String, receivedAt: Long) {
    val master = (data.opt("mid") as? Number)?.toDouble() ?: return
    if (!master.isFinite() || master < 1 || master > 65535 || master % 1.0 != 0.0) return
    val owner = db.rawQuery("SELECT value FROM ble_upload_meta WHERE key='owner'", null).use {
      if (it.moveToFirst()) it.getString(0) else ""
    }
    if (owner.isEmpty()) return
    val enabled = db.rawQuery("SELECT mode FROM ble_upload_settings WHERE owner_user_id=? AND master_id=?", arrayOf(owner, master.toInt().toString())).use {
      it.moveToFirst() && it.getString(0) == "phone"
    }
    if (!enabled) return
    val fingerprint = MessageDigest.getInstance("SHA-256").digest(payload.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    val duplicate = db.rawQuery("SELECT id FROM ble_upload_queue WHERE owner_user_id=? AND master_id=? AND fingerprint=? AND received_at>=? LIMIT 1",
      arrayOf(owner, master.toInt().toString(), fingerprint, (receivedAt - 60000).toString())).use { it.moveToFirst() }
    if (duplicate) return
    val full = db.rawQuery("SELECT COUNT(*) FROM ble_upload_queue WHERE status<>'sent'", null).use { it.moveToFirst(); it.getLong(0) >= 20000 }
    if (full) {
      db.execSQL("INSERT OR REPLACE INTO ble_upload_meta(key,value) VALUES('queue_error','待傳佇列已滿（20,000 筆），新轉送資料未入列；請恢復上傳。')")
      return
    }
    db.insertOrThrow("ble_upload_queue", null, ContentValues().apply {
      put("event_id", UUID.randomUUID().toString()); put("owner_user_id", owner)
      put("master_id", master.toInt()); put("received_at", receivedAt)
      put("payload_json", payload); put("fingerprint", fingerprint)
    })
    db.execSQL("DELETE FROM ble_upload_meta WHERE key='queue_error'")
  }
}
