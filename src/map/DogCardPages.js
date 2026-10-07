// What the card's 活動量 row opens until A4 exists (PR 057): the old activity
// chart on a page of its own. It returns to the card: back key, ‹. (The
// pencil opens the dog's own page, src/dogs/DogProfile.js.)
import React, { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActivityHistoryChart from './ActivityHistoryChart';
import Glyph from './Glyph';
import { colors, layout, radius, touch, type } from '../theme/tokens';

// The back key closes the top-most of these first.
function useBack(onBack) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);
}

/** ‹ 小黑・活動量, with the existing 24-hour chart of that dog. */
export function ActivityPage({ name, slaveId, database, owner, active, dogAliases, onBack }) {
  const insets = useSafeAreaInsets();
  useBack(onBack);
  return (
    <View style={[StyleSheet.absoluteFill, styles.page, { paddingTop: insets.top }]} testID="activity-page">
      <View style={styles.pageHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Glyph name="back" color={colors.text} size={22} />
        </Pressable>
        <Text style={styles.pageTitle} accessibilityRole="header" numberOfLines={1}>{`${name}・活動量`}</Text>
      </View>
      <View style={styles.pageBody}>
        <ActivityHistoryChart database={database} owner={owner} active={active} dogAliases={dogAliases}
          slaveId={slaveId} key={slaveId} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { zIndex: 40, elevation: 12, backgroundColor: colors.bg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', minHeight: touch.subpageHeader,
    paddingHorizontal: 4 },
  back: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.full },
  pageTitle: { ...type.title, color: colors.text, flexShrink: 1 },
  pageBody: { paddingHorizontal: layout.screenEdge },
  pressed: { backgroundColor: colors.pressedOverlay },
});
