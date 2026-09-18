import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import TrackingAvatar from '../map/TrackingAvatar';
import { appColors as colors, floatingShadow } from '../theme/AppTheme';

export const NAV_HEIGHT = 68;
// The first tab is live positions, not "the map": both map tabs are maps, and
// what separates them is now vs. the past. History carries the dog face, since
// what it holds is where the dogs have been.
const TABS = [
  { name: 'map', label: '即時位置', symbol: '⌖' },
  { name: 'history', label: '歷史軌跡', dog: true },
  { name: 'settings', label: '設定', symbol: '⚙' },
];

export default function BottomNavigation({
  selected,
  onNavigate,
  floating,
  bottomInset,
}) {
  return (
    <View
      accessibilityRole="tablist"
      testID="bottom-navigation"
      style={[
        styles.bar,
        floating
          ? [styles.floating, { bottom: bottomInset + 8 }]
          : styles.docked,
      ]}
    >
      {TABS.map(tab => (
        <Pressable
          key={tab.name}
          accessibilityRole="tab"
          accessibilityLabel={tab.label}
          accessibilityState={{ selected: selected === tab.name }}
          onPress={() => onNavigate(tab.name)}
          style={({ pressed }) => [
            styles.tab,
            selected === tab.name && styles.selected,
            pressed && styles.pressed,
          ]}
        >
          {tab.dog ? (
            <View style={styles.dogIcon}>
              <TrackingAvatar role="slave" size={22} />
            </View>
          ) : (
            <Text
              accessible={false}
              style={[styles.icon, selected === tab.name && styles.active]}
            >
              {tab.symbol}
            </Text>
          )}
          <Text
            accessible={false}
            style={[styles.label, selected === tab.name && styles.active]}
          >
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  bar: {
    height: NAV_HEIGHT,
    zIndex: 40,
    flexDirection: 'row',
    padding: 6,
    backgroundColor: colors.surface,
    borderRadius: 22,
    ...floatingShadow,
  },
  floating: { position: 'absolute', left: 12, right: 12 },
  docked: { marginHorizontal: 12, marginBottom: 8, marginTop: 8 },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  selected: { backgroundColor: colors.softDanger },
  pressed: { opacity: 0.7 },
  icon: {
    fontSize: 23,
    lineHeight: 26,
    color: colors.muted,
    fontWeight: '600',
  },
  dogIcon: { height: 26, justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '700', color: colors.muted },
  active: { color: '#C94D4A' },
});
