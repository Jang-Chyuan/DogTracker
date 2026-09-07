import React from 'react';
import { Text, View } from 'react-native';
import { ui } from './ScreenUI';

export default function TrackingStatusCard({ point, mode }) {
  const updatedAt =
    point.receivedAt === null
      ? '尚無資料'
      : new Date(point.receivedAt).toLocaleString('zh-TW', { hour12: false });
  return (
    <View style={ui.card}>
      <Text style={ui.heading}>SQLite 最新資料</Text>
      <Text style={ui.badge}>
        {mode === 'demo' ? 'DEMO · 模擬資料' : '正式 · 硬體資料'}
      </Text>
      <Text style={ui.hint}>
        資料表：{mode === 'demo' ? 'demo_dog_status' : 'dog_status'}
      </Text>
      <Text style={ui.text}>資料庫最後更新：{updatedAt}</Text>
      {point.id === null ? (
        <Text style={ui.hint}>
          {mode === 'demo'
            ? '尚無 Demo 資料。'
            : '等待硬體寫入資料；不會自動使用假資料。'}
        </Text>
      ) : (
        <>
          <Text style={ui.text}>
            Master ID: {point.masterId ?? '-'} | Slave ID:{' '}
            {point.slaveId ?? '-'}
          </Text>
          <Text style={ui.text}>
            Slave GPS: {point.slaveLat ?? '-'}, {point.slaveLon ?? '-'}
          </Text>
          <Text style={ui.text}>
            Master GPS: {point.masterLat ?? '-'}, {point.masterLon ?? '-'}
          </Text>
          <Text style={ui.text}>
            距離: {point.distanceMeters ?? '-'} m | 速度:{' '}
            {point.speedKmh ?? '-'} km/h
          </Text>
          <Text style={ui.text}>
            衛星: {point.satellites ?? '-'} | HDOP: {point.hdop ?? '-'}
          </Text>
          <Text style={ui.text}>
            活動: {point.activity ?? '-'} | 有效:{' '}
            {point.activityValid ? '是' : '否'}
          </Text>
          <Text style={ui.text}>
            GPS 時間: {point.gpsTime ?? '-'} | 活動時間:{' '}
            {point.activityTime ?? '-'}
          </Text>
          <Text style={ui.text}>
            電池: {point.batteryMillivolts ?? '-'} mV |{' '}
            {point.batteryPercentage ?? '-'}% (
            {point.batteryValid ? '有效' : '無效'})
          </Text>
          <Text style={ui.text}>
            Master 電池: {point.masterBatteryMillivolts ?? '-'} mV |{' '}
            {point.masterBatteryPercentage ?? '-'}% (
            {point.masterBatteryValid ? '有效' : '無效'})
          </Text>
          <Text style={ui.text}>
            RSSI: {point.rssi ?? '-'} | SNR: {point.snr ?? '-'}
          </Text>
          <Text style={ui.text}>
            封包: type {point.type ?? '-'} | seq {point.sequence ?? '-'} | len{' '}
            {point.length ?? '-'}
          </Text>
          <Text style={ui.hint}>DB row ID: {point.id}</Text>
        </>
      )}
    </View>
  );
}
