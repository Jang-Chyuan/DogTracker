package com.dogtracker

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.*
import android.content.Intent
import android.content.pm.PackageManager
import android.os.*
import android.util.Base64
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import java.util.UUID

class BleForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "dogtracker_ble"
    const val NOTIFICATION_ID = 3103
    const val EVENT_STATUS = "BleBackgroundStatus"
    const val EVENT_DATA = "BleBackgroundData"
    const val ACTION_CONNECT = "com.dogtracker.ble.CONNECT"
    const val ACTION_STOP = "com.dogtracker.ble.STOP"
    const val EXTRA_DEVICE_ID = "deviceId"
    const val EXTRA_DEVICE_NAME = "deviceName"
    const val EXTRA_SERVICE_UUID = "serviceUuid"
    const val EXTRA_DATA_UUID = "dataUuid"

    @Volatile var isRunning = false
    @Volatile var isConnected = false
    @Volatile var eventSink: ((String, String) -> Unit)? = null
  }

  private val handler = Handler(Looper.getMainLooper())
  private val prefs by lazy { getSharedPreferences("ble_session", MODE_PRIVATE) }
  private var gatt: BluetoothGatt? = null
  private var reconnectAttempt = 0
  private var manualStop = false
  private var connecting = false
  private var deviceId = ""
  private var deviceName = "DogGPS Master"
  private var serviceUuid = ""
  private var dataUuid = ""
  private val reconnectRunnable = Runnable { connectGatt() }

  override fun onCreate() {
    super.onCreate()
    isRunning = true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "DogTracker BLE", NotificationManager.IMPORTANCE_LOW)
      channel.description = "保持 DogTracker BLE 連線"
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSession()
      return START_NOT_STICKY
    }
    startForeground(NOTIFICATION_ID, notification("正在準備 BLE 連線"))
    if (intent?.action == ACTION_CONNECT) {
      saveConfig(intent)
      manualStop = false
      isConnected = true
      publishStatus("已連線 $deviceName，背景接收資料中")
      return START_STICKY
    }
    loadConfig()
    manualStop = false
    if (prefs.getBoolean("enabled", false) && deviceId.isNotBlank()) connectGatt()
    return START_STICKY
  }

  private fun saveConfig(intent: Intent) {
    deviceId = intent.getStringExtra(EXTRA_DEVICE_ID).orEmpty()
    deviceName = intent.getStringExtra(EXTRA_DEVICE_NAME)?.ifBlank { "DogGPS Master" } ?: "DogGPS Master"
    serviceUuid = intent.getStringExtra(EXTRA_SERVICE_UUID).orEmpty().lowercase()
    dataUuid = intent.getStringExtra(EXTRA_DATA_UUID).orEmpty().lowercase()
    prefs.edit().putBoolean("enabled", true).putString("deviceId", deviceId)
      .putString("deviceName", deviceName).putString("serviceUuid", serviceUuid)
      .putString("dataUuid", dataUuid).apply()
  }

  private fun loadConfig() {
    deviceId = prefs.getString("deviceId", "").orEmpty()
    deviceName = prefs.getString("deviceName", "DogGPS Master").orEmpty()
    serviceUuid = prefs.getString("serviceUuid", "").orEmpty()
    dataUuid = prefs.getString("dataUuid", "").orEmpty()
  }

  private fun hasPermission() = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
    ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

  private fun connectGatt() {
    handler.removeCallbacks(reconnectRunnable)
    if (manualStop || connecting || isConnected || !hasPermission()) return
    val adapter = getSystemService(BluetoothManager::class.java)?.adapter
    if (adapter == null || !adapter.isEnabled) {
      publishStatus("藍牙未開啟，30 秒後重試")
      scheduleReconnect(30_000)
      return
    }
    try {
      connecting = true
      publishStatus("正在連線 $deviceName")
      closeGatt()
      val remote = adapter.getRemoteDevice(deviceId)
      gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        remote.connectGatt(this, false, callback, BluetoothDevice.TRANSPORT_LE)
      } else {
        @Suppress("DEPRECATION") remote.connectGatt(this, false, callback)
      }
    } catch (error: Exception) {
      connecting = false
      publishStatus("BLE 連線失敗：${error.message}")
      scheduleReconnect()
    }
  }

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(client: BluetoothGatt, status: Int, state: Int) {
      if (state == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        connecting = false
        publishStatus("已連線 $deviceName，正在訂閱資料")
        if (!hasPermission() || !client.discoverServices()) fail("無法探索 BLE 服務")
      } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
        connecting = false
        isConnected = false
        closeGatt(client)
        if (!manualStop) {
          publishStatus("BLE 已斷線，等待自動重連")
          scheduleReconnect()
        }
      }
    }

    override fun onServicesDiscovered(client: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS || !hasPermission()) return fail("BLE 服務探索失敗：$status")
      val characteristic = runCatching {
        client.getService(UUID.fromString(serviceUuid))?.getCharacteristic(UUID.fromString(dataUuid))
      }.getOrNull() ?: return fail("找不到 BLE 資料 Characteristic")
      if (!client.setCharacteristicNotification(characteristic, true)) return fail("無法啟用 BLE 資料通知")
      val descriptor = characteristic.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
        ?: return fail("BLE 資料 Characteristic 不支援通知")
      val started = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        client.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        run {
          descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          client.writeDescriptor(descriptor)
        }
      }
      if (!started) fail("無法寫入 BLE 通知設定")
    }

    override fun onDescriptorWrite(client: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS) {
        isConnected = true
        reconnectAttempt = 0
        publishStatus("已連線並訂閱：$deviceName")
      } else fail("BLE 通知訂閱失敗：$status")
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicChanged(client: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      characteristic.value?.let(::publishData)
    }

    override fun onCharacteristicChanged(client: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      publishData(value)
    }
  }

  private fun fail(message: String) {
    connecting = false
    isConnected = false
    publishStatus(message)
    closeGatt()
    scheduleReconnect()
  }

  private fun scheduleReconnect(override: Long? = null) {
    if (manualStop) return
    val delay = override ?: minOf(2_000L * (1L shl minOf(reconnectAttempt, 4)), 30_000L)
    reconnectAttempt++
    handler.removeCallbacks(reconnectRunnable)
    handler.postDelayed(reconnectRunnable, delay)
    updateNotification("BLE 已斷線，${delay / 1000} 秒後重連")
  }

  private fun publishStatus(status: String) {
    prefs.edit().putString("lastStatus", status).apply()
    updateNotification(status)
    eventSink?.invoke(EVENT_STATUS, status)
  }

  private fun publishData(bytes: ByteArray) {
    val value = Base64.encodeToString(bytes, Base64.NO_WRAP)
    prefs.edit().putString("lastPayload", value).apply()
    eventSink?.invoke(EVENT_DATA, value)
  }

  private fun closeGatt(target: BluetoothGatt? = gatt) {
    target ?: return
    if (hasPermission()) runCatching { target.close() }
    if (target === gatt) gatt = null
  }

  private fun stopSession() {
    manualStop = true
    connecting = false
    isConnected = false
    handler.removeCallbacksAndMessages(null)
    closeGatt()
    prefs.edit().putBoolean("enabled", false).apply()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun notification(status: String) = NotificationCompat.Builder(this, CHANNEL_ID)
    .setContentTitle("DogTracker").setContentText(status).setSmallIcon(R.mipmap.ic_launcher)
    .setOngoing(true).setOnlyAlertOnce(true).setPriority(NotificationCompat.PRIORITY_LOW).build()

  private fun updateNotification(status: String) {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(status))
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    isRunning = false
    isConnected = false
    handler.removeCallbacksAndMessages(null)
    closeGatt()
    super.onDestroy()
  }
}
