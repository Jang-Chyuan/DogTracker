package com.dogtracker

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.*
import android.content.Intent
import android.content.pm.PackageManager
import android.os.*
import android.util.Base64
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.dogtracker.alerts.BackgroundAlerts
import com.dogtracker.alerts.Events
import com.dogtracker.alerts.ReceiverInput
import com.dogtracker.alerts.ReceiverPause
import org.json.JSONObject
import java.util.UUID

class BleForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = NotificationChannels.TRACKING
    const val NOTIFICATION_ID = 3103
    const val EVENT_STATUS = "BleBackgroundStatus"
    const val EVENT_DATA = "BleBackgroundData"
    const val ACTION_CONNECT = "com.dogtracker.ble.CONNECT"
    const val ACTION_STOP = "com.dogtracker.ble.STOP"
    // The persistent notification's 「中斷連線」: the user's own disconnect.
    const val ACTION_USER_STOP = "com.dogtracker.ble.USER_STOP"
    // How often the background alert check runs (BackgroundAlerts).
    const val ALERT_CHECK_MS = 10_000L
    const val ACTION_RESUME = "com.dogtracker.ble.RESUME"
    const val EXTRA_DEVICE_ID = "deviceId"
    const val EXTRA_DEVICE_NAME = "deviceName"
    const val EXTRA_SERVICE_UUID = "serviceUuid"
    const val EXTRA_DATA_UUID = "dataUuid"
    const val WIFI_UUID = "7f510003-6d9e-4e2f-a671-8f3f2d49a001"
    @Volatile var isRunning = false
    @Volatile var isConnected = false
    @Volatile var lastDataElapsed = 0L
    // When an established link (subscribed, this service run) was lost and
    // has not come back since (wall clock ms; 0 = connected, or never
    // connected yet). The map's 「接收器 7 斷線了」 card counts from it; a
    // receiver that has not connected since the service started is
    // "connecting", not disconnected.
    @Volatile var disconnectedAt = 0L
    @Volatile var instance: BleForegroundService? = null
    @Volatile var eventSink: ((String, String) -> Unit)? = null
  }

  private val worker = HandlerThread("DogTracker-BLE")
  private lateinit var handler: Handler
  private val prefs by lazy { getSharedPreferences("ble_session", MODE_PRIVATE) }
  private var gatt: BluetoothGatt? = null
  private val reconnectBackoff = BleReconnectBackoff()
  private var manualStop = false
  private var connecting = false
  private var deviceId = ""
  private var deviceName = "DogGPS Master"
  private var serviceUuid = ""
  private var dataUuid = ""
  private var expectedMasterId = 0
  private var lastReceivedElapsed = 0L
  private var subscribedElapsed = 0L
  private var stale = false
  private val framer = BleJsonFramer()
  private var wifiResult: ((String?, String?) -> Unit)? = null
  private var wifiRead = false
  private val reconnectRunnable = Runnable { connectGatt() }
  private val connectTimeout = Runnable { fail("BLE 連線或訂閱逾時") }
  private val wifiTimeout = Runnable {
    finishWifi(null, "Wi-Fi 指令逾時")
    fail("BLE 指令逾時，重新連線")
  }
  // The alerts while the app is off screen (BackgroundAlerts skips its turn
  // while the app is on screen and runs them itself).
  private val alertCheck = object : Runnable {
    override fun run() {
      if (manualStop) return
      try {
        BackgroundAlerts.evaluate(this@BleForegroundService, alertInput(), System.currentTimeMillis())
      } catch (error: Exception) {
        com.dogtracker.AppLog.w("DogTrackerAlerts", "background alert check failed", error)
      }
      handler.postDelayed(this, ALERT_CHECK_MS)
    }
  }

  private fun alertInput(): ReceiverInput {
    val number = if (expectedMasterId > 0) expectedMasterId
      else Regex("(\\d+)\\s*$").find(deviceName)?.groupValues?.get(1)?.toIntOrNull()
    return ReceiverInput(
      enabled = prefs.getBoolean("enabled", false), running = isRunning, connected = isConnected,
      disconnectedAt = disconnectedAt, number = number,
      batteryPercentage = BackgroundAlerts.receiverBattery(this),
      storageError = prefs.getString("storageError", null),
      pauses = ReceiverPauses.parse(prefs.getString(ReceiverPauses.KEY, "")).map {
        ReceiverPause(it.pausedAt, if (it.resumedAt > 0) it.resumedAt else null)
      },
    )
  }

  // A link that just dropped is checked again after the 30 seconds that make
  // it 「斷線」, even with the screen off.
  private val wakeLock by lazy {
    getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DogTracker:ble-disconnect")
      .apply { setReferenceCounted(false) }
  }

  private val freshnessCheck = object : Runnable {
    override fun run() {
      if (manualStop) return
      if (isConnected) {
        val age = SystemClock.elapsedRealtime() - if (lastReceivedElapsed > 0) lastReceivedElapsed else subscribedElapsed
        if (age >= 30_000 && !stale) {
          stale = true
          publishStatus("BLE 已連線，但超過 30 秒未收到資料")
        }
        if (age >= 90_000) fail("BLE 超過 90 秒無資料，重新連線")
      }
      handler.postDelayed(this, 5_000)
    }
  }

  override fun onCreate() {
    super.onCreate()
    worker.start()
    handler = Handler(worker.looper)
    instance = this
    NotificationChannels.create(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Repeated Activity resumes must not reset an active GATT session.
    if (intent?.action == ACTION_RESUME && isRunning) return START_STICKY
    if (intent?.action == ACTION_STOP) {
      handler.post { stopSession() }
      return START_NOT_STICKY
    }
    if (intent?.action == ACTION_USER_STOP) {
      // The same as S2's 中斷連線 (BleBackgroundModule.stop): remembered as
      // the user's own, so its dogs do not turn 「沒有新位置」 and no
      // disconnection is alerted.
      if (prefs.getBoolean("enabled", false)) {
        prefs.edit().putString(ReceiverPauses.KEY,
          ReceiverPauses.paused(prefs.getString(ReceiverPauses.KEY, ""), System.currentTimeMillis())).commit()
      }
      handler.post {
        stopSession("已中斷連線")
        // A disconnection alert already showing goes (the user's own
        // disconnect is not one); the other problems stay as they are.
        runCatching { BackgroundAlerts.evaluate(this, alertInput(), System.currentTimeMillis()) }
      }
      return START_NOT_STICKY
    }
    startForeground(NOTIFICATION_ID, notification("正在準備 BLE 連線"))
    isRunning = true
    prefs.edit().remove("resumeError").apply()
    handler.post {
      if (intent?.action == ACTION_CONNECT) {
        closeGatt()
        // A newly chosen receiver starts as "connecting".
        disconnectedAt = 0
        prefs.edit().remove("receiverLink").commit()
        handler.removeCallbacks(reconnectRunnable)
        deviceId = intent.getStringExtra(EXTRA_DEVICE_ID).orEmpty()
        deviceName = intent.getStringExtra(EXTRA_DEVICE_NAME)?.ifBlank { "DogGPS Master" } ?: "DogGPS Master"
        serviceUuid = intent.getStringExtra(EXTRA_SERVICE_UUID).orEmpty()
        dataUuid = intent.getStringExtra(EXTRA_DATA_UUID).orEmpty()
        expectedMasterId = intent.getIntExtra("expectedMasterId", 0)
        prefs.edit().putBoolean("enabled", true).putString("deviceId", deviceId)
          .putString("deviceName", deviceName).putString("serviceUuid", serviceUuid)
          .putString("dataUuid", dataUuid).putInt("expectedMasterId", expectedMasterId)
          .putString("sessionId", intent.getStringExtra("sessionId"))
          .remove("lastPayload").remove("lastReceivedAt").remove("storageError").commit()
        reconnectBackoff.reset()
        BackgroundAlerts.forgetReceiver(this)
      } else {
        val restored = com.dogtracker.alerts.ReceiverLinkState.restore(prefs.getString("receiverLink", null), System.currentTimeMillis())
        disconnectedAt = restored.disconnectedAt
        prefs.edit().putString("receiverLink", restored.write()).commit()
        deviceId = prefs.getString("deviceId", "").orEmpty()
        deviceName = prefs.getString("deviceName", "DogGPS Master").orEmpty()
        serviceUuid = prefs.getString("serviceUuid", "").orEmpty()
        dataUuid = prefs.getString("dataUuid", "").orEmpty()
        expectedMasterId = prefs.getInt("expectedMasterId", 0)
      }
      manualStop = false
      if (!prefs.getBoolean("enabled", false) || deviceId.isBlank()) {
        stopSession()
      } else {
        handler.removeCallbacks(freshnessCheck)
        handler.post(freshnessCheck)
        handler.removeCallbacks(alertCheck)
        val remaining = com.dogtracker.alerts.ReceiverLinkState(false, disconnectedAt)
          .remainingGrace(System.currentTimeMillis(), Events.DISCONNECT_GRACE_MS)
        if (remaining != null) {
          runCatching { wakeLock.acquire(remaining + 2 * ALERT_CHECK_MS) }
          handler.postDelayed(alertCheck, remaining)
        } else handler.postDelayed(alertCheck, ALERT_CHECK_MS)
        connectGatt()
      }
    }
    return START_STICKY
  }

  private fun hasPermission() = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
    ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

  private fun connectGatt() {
    handler.removeCallbacks(reconnectRunnable)
    if (manualStop || connecting || isConnected) return
    if (!hasPermission()) {
      scheduleReconnect(30_000, "缺少藍牙連線權限，等待重新授權")
      return
    }
    try {
      val adapter = getSystemService(BluetoothManager::class.java)?.adapter
      if (adapter == null || !adapter.isEnabled) {
        scheduleReconnect(30_000, "藍牙未開啟")
        return
      }
      closeGatt()
      connecting = true
      publishStatus("正在連線 $deviceName")
      gatt = adapter.getRemoteDevice(deviceId).connectGatt(this, false, callback, BluetoothDevice.TRANSPORT_LE)
      if (gatt == null) return fail("無法建立 BLE 連線")
      handler.postDelayed(connectTimeout, 30_000)
    } catch (error: Exception) { fail("BLE 連線失敗：${error.message}") }
  }

  // Serialize callbacks, persistence and commands; ignore callbacks from closed GATTs.
  private fun dispatch(client: BluetoothGatt, action: () -> Unit) {
    handler.post {
      if (manualStop || client !== gatt) return@post
      try { action() } catch (error: Exception) { fail("BLE 操作失敗：${error.message}") }
    }
  }

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(client: BluetoothGatt, status: Int, state: Int) {
      dispatch(client) {
        if (status != BluetoothGatt.GATT_SUCCESS || state == BluetoothProfile.STATE_DISCONNECTED) {
          fail("BLE 已斷線（$status），等待自動重連")
        } else if (state == BluetoothProfile.STATE_CONNECTED) {
          publishStatus("BLE 已連線，正在探索服務")
          if (!client.discoverServices()) fail("無法探索 BLE 服務")
        }
      }
    }

    override fun onServicesDiscovered(client: BluetoothGatt, status: Int) {
      dispatch(client) {
        if (status != BluetoothGatt.GATT_SUCCESS) fail("BLE 服務探索失敗：$status")
        else if (!client.requestMtu(320)) subscribe(client)
      }
    }

    override fun onMtuChanged(client: BluetoothGatt, mtu: Int, status: Int) {
      dispatch(client) { subscribe(client) }
    }

    override fun onDescriptorWrite(client: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      dispatch(client) {
        if (descriptor.characteristic.uuid != UUID.fromString(dataUuid)) return@dispatch
        if (status != BluetoothGatt.GATT_SUCCESS) return@dispatch fail("BLE 通知訂閱失敗：$status")
        handler.removeCallbacks(connectTimeout)
        connecting = false
        isConnected = true
        disconnectedAt = 0
        prefs.edit().putString("receiverLink", com.dogtracker.alerts.ReceiverLinkState(true).write()).commit()
        reconnectBackoff.reset()
        // Receiving again after the user switched it off: closes that pause.
        prefs.edit().putString(ReceiverPauses.KEY,
          ReceiverPauses.resumed(prefs.getString(ReceiverPauses.KEY, ""), System.currentTimeMillis())).apply()
        subscribedElapsed = SystemClock.elapsedRealtime()
        lastReceivedElapsed = 0
        stale = false
        publishStatus("BLE 已訂閱，等待資料")
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicChanged(client: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      val bytes = characteristic.value?.clone() ?: return
      dispatch(client) { if (characteristic.uuid == UUID.fromString(dataUuid)) receive(bytes) }
    }

    override fun onCharacteristicChanged(client: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      val bytes = value.clone()
      dispatch(client) { if (characteristic.uuid == UUID.fromString(dataUuid)) receive(bytes) }
    }

    override fun onCharacteristicWrite(client: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      dispatch(client) {
        if (characteristic.uuid != UUID.fromString(WIFI_UUID) || wifiResult == null) return@dispatch
        if (status != BluetoothGatt.GATT_SUCCESS) finishWifi(null, "Wi-Fi 寫入失敗：$status")
        else if (!wifiRead) finishWifi("{}", null)
        else if (!client.readCharacteristic(characteristic)) finishWifi(null, "Wi-Fi 讀取啟動失敗")
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicRead(client: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      val bytes = characteristic.value?.clone() ?: byteArrayOf()
      dispatch(client) { readWifi(characteristic, bytes, status) }
    }

    override fun onCharacteristicRead(client: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
      val bytes = value.clone()
      dispatch(client) { readWifi(characteristic, bytes, status) }
    }
  }

  private fun subscribe(client: BluetoothGatt) {
    val characteristic = client.getService(UUID.fromString(serviceUuid))?.getCharacteristic(UUID.fromString(dataUuid))
      ?: return fail("找不到 BLE 資料 Characteristic")
    if (!client.setCharacteristicNotification(characteristic, true)) return fail("無法啟用 BLE 通知")
    val descriptor = characteristic.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
      ?: return fail("BLE 資料不支援通知")
    val started = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      client.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
      @Suppress("DEPRECATION")
      client.writeDescriptor(descriptor)
    }
    if (!started) fail("無法寫入 BLE 通知設定")
  }

  // Assemble UTF-8 bytes before decoding, including fragmented or coalesced JSON.
  private fun receive(bytes: ByteArray) {
    val payloads = try { framer.accept(bytes) } catch (error: IllegalArgumentException) {
      publishStatus(error.message ?: "BLE 資料封包錯誤")
      return
    }
    for (payload in payloads) {
        val data = try { JSONObject(payload) } catch (_: Exception) {
          publishStatus("BLE 資料格式錯誤")
          continue
        }
        val masterId = if (!data.isNull("master_id")) data.optInt("master_id") else data.optInt("mid")
        if (expectedMasterId > 0 && masterId != expectedMasterId) {
          stopSession("Master ID 不符合：QR=$expectedMasterId，BLE=$masterId")
          return
        }
        val now = System.currentTimeMillis()
        try {
          DogStatusStore.get(this).save(data, payload, now)
          prefs.edit().remove("storageError").apply()
        } catch (error: Exception) {
          prefs.edit().putString("storageError", "資料存檔失敗：${error.message}").apply()
        }
        runCatching { BackgroundAlerts.onPacket(this, data, now) }
        lastReceivedElapsed = SystemClock.elapsedRealtime()
        lastDataElapsed = lastReceivedElapsed
        stale = false
        val value = Base64.encodeToString(payload.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        prefs.edit().putString("lastPayload", value).putLong("lastReceivedAt", now).apply()
        publishStatus("BLE 接收中；最後資料 ${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.TAIWAN).format(java.util.Date(now))}")
        emit(EVENT_DATA, JSONObject().put("value", value).put("receivedAt", now)
          .put("sessionId", prefs.getString("sessionId", "")).toString())
    }
  }

  fun wifiCommand(json: String, read: Boolean, result: (String?, String?) -> Unit) {
    handler.post {
      if (!isConnected || manualStop || !hasPermission()) return@post result(null, "BLE 尚未連線")
      if (wifiResult != null) return@post result(null, "另一個 Wi-Fi 指令仍在執行")
      try {
        val client = gatt ?: return@post result(null, "BLE 尚未連線")
        val characteristic = client.getService(UUID.fromString(serviceUuid))?.getCharacteristic(UUID.fromString(WIFI_UUID))
          ?: return@post result(null, "裝置不支援 Wi-Fi 設定")
        wifiResult = result
        wifiRead = read
        val bytes = json.toByteArray(Charsets.UTF_8)
        val started = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          client.writeCharacteristic(characteristic, bytes, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
        } else {
          @Suppress("DEPRECATION")
          characteristic.value = bytes
          characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
          @Suppress("DEPRECATION")
          client.writeCharacteristic(characteristic)
        }
        if (started) handler.postDelayed(wifiTimeout, 10_000)
        else finishWifi(null, "Wi-Fi 指令啟動失敗")
      } catch (error: Exception) {
        if (wifiResult != null) finishWifi(null, error.message ?: "Wi-Fi 指令失敗")
        else result(null, error.message ?: "Wi-Fi 指令失敗")
      }
    }
  }

  private fun readWifi(characteristic: BluetoothGattCharacteristic, bytes: ByteArray, status: Int) {
    if (characteristic.uuid != UUID.fromString(WIFI_UUID) || wifiResult == null) return
    if (status == BluetoothGatt.GATT_SUCCESS) finishWifi(bytes.toString(Charsets.UTF_8), null)
    else finishWifi(null, "Wi-Fi 讀取失敗：$status")
  }

  private fun finishWifi(value: String?, error: String?) {
    handler.removeCallbacks(wifiTimeout)
    val result = wifiResult
    wifiResult = null
    result?.invoke(value, error)
  }

  private fun fail(message: String) {
    // Only the loss of an established link starts a disconnection; failed
    // reconnect attempts keep its first moment.
    if (isConnected) {
      disconnectedAt = System.currentTimeMillis()
      prefs.edit().putString("receiverLink", com.dogtracker.alerts.ReceiverLinkState(false, disconnectedAt).write()).commit()
      runCatching { wakeLock.acquire(Events.DISCONNECT_GRACE_MS + 2 * ALERT_CHECK_MS) }
    }
    closeGatt()
    scheduleReconnect(reason = message)
  }

  private fun scheduleReconnect(delayOverride: Long? = null, reason: String = "等待自動重連") {
    if (manualStop) return
    val delay = reconnectBackoff.next(SystemClock.elapsedRealtime(), delayOverride)
    publishStatus("$reason；${delay / 1000} 秒後重試")
    handler.removeCallbacks(reconnectRunnable)
    handler.postDelayed(reconnectRunnable, delay)
  }

  private fun emit(event: String, value: String) {
    // A missing or shutting-down React runtime must never interrupt collection.
    runCatching { eventSink?.invoke(event, value) }
  }

  private fun publishStatus(status: String) {
    prefs.edit().putString("lastStatus", status).apply()
    if (isRunning) getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(status))
    emit(EVENT_STATUS, status)
  }

  private fun closeGatt() {
    handler.removeCallbacks(connectTimeout)
    connecting = false
    isConnected = false
    lastDataElapsed = 0
    val previous = gatt
    gatt = null
    runCatching { previous?.close() }
    finishWifi(null, "BLE 連線已關閉")
    framer.reset()
  }

  private fun stopSession(status: String = "背景接收已停止") {
    manualStop = true
    isRunning = false
    com.dogtracker.cloud.SearchRelayService.receiverStopped(this)
    disconnectedAt = 0
    handler.removeCallbacksAndMessages(null)
    closeGatt()
    prefs.edit().putBoolean("enabled", false).remove("receiverLink").commit()
    publishStatus(status)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  // The 「常駐」 notification in field words (design 「常駐通知（三種）」):
  // which receiver, and whether the dogs' positions are coming in. A tap opens
  // 設定 → 接收器 (S2); 「中斷連線」 is S2's 中斷連線.
  private fun notification(status: String) = NotificationCompat.Builder(this, CHANNEL_ID)
    .setContentTitle(receiverTitle()).setContentText(when {
      isConnected -> "正在接收狗的位置"
      disconnectedAt > 0 -> "斷線了；$status"
      else -> status
    }).setColor(NotificationChannels.accent(this)).setSmallIcon(R.drawable.ic_stat_dog)
    .setContentIntent(NotificationChannels.launch(this, "receiver-settings"))
    .addAction(0, "中斷連線", PendingIntent.getService(this, NOTIFICATION_ID,
      Intent(this, BleForegroundService::class.java).setAction(ACTION_USER_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    .setOngoing(true).setOnlyAlertOnce(true).setPriority(NotificationCompat.PRIORITY_LOW).build()

  private fun receiverTitle(): String {
    val number = alertInput().number
    return if (number != null) "DogTracker・接收器 $number" else "DogTracker・接收器"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    if (isConnected) {
      prefs.edit().putString("receiverLink", com.dogtracker.alerts.ReceiverLinkState(false, System.currentTimeMillis()).write()).commit()
    }
    instance = null
    isRunning = false
    com.dogtracker.cloud.SearchRelayService.receiverStopped(this)
    isConnected = false
    disconnectedAt = 0
    handler.post {
      manualStop = true
      handler.removeCallbacksAndMessages(null)
      closeGatt()
      runCatching { if (wakeLock.isHeld) wakeLock.release() }
      worker.quitSafely()
    }
    super.onDestroy()
  }
}
