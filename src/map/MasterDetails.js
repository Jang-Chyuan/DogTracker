import React, { useEffect } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { floatingShadow, mapColors as colors } from './MapTheme';
import { Position } from './TrackingSheet';

export default function MasterDetails({
  tracking,
  master,
  topInset,
  bottomInset,
  onClose,
}) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onClose]);
  const { point } = tracking;
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.root]}
      testID="master-details"
    >
      <Pressable
        testID="master-details-backdrop"
        accessibilityRole="button"
        accessibilityLabel="關閉領犬員資訊"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      />
      <View style={[styles.panel, { top: topInset, bottom: bottomInset }]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heading}>
            <Text style={styles.title}>領犬員資訊</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="關閉領犬員資訊面板"
              onPress={onClose}
              style={styles.close}
            >
              <Text style={styles.title}>×</Text>
            </Pressable>
          </View>
          <Position role="master" position={master} />
          <Text style={styles.hint}>Master ID: {point.masterId ?? '—'}</Text>
          <Text style={styles.hint}>
            領犬員裝置電量：
            {point.masterBatteryValid
              ? (point.masterBatteryPercentage ?? '—') + '%'
              : '尚無有效資料'}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: {
    zIndex: 30,
    // Raise the whole modal root above the tracking sheet for Android touches.
    elevation: floatingShadow.elevation + 1,
  },
  backdrop: { backgroundColor: '#00000020' },
  panel: {
    position: 'absolute',
    right: 14,
    left: 14,
    maxHeight: 330,
    borderRadius: 22,
    backgroundColor: colors.surface,
    ...floatingShadow,
  },
  content: { padding: 18 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, color: colors.ink, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 19, color: colors.muted, marginTop: 8 },
});
