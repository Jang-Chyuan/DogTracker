import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, space, type } from '../theme/tokens';

// c273 with its suggestion: say which data cannot be opened.
export const START_FAILED_TITLE = '手機裡的資料打不開';

/**
 * D0 啟動失敗: the database on this phone could not be opened, so there is
 * nothing to draw the map with. 「重試」 opens it again; 「診斷」 shows the
 * reason (S8). Buttons at the bottom, as on D1.
 */
export default function StartFailedScreen({
  onRetry,
  onDiagnostics,
  onLayout,
}) {
  const styles = useStyles(getStyles);
  return (
    <View testID="start-failed" style={styles.page} onLayout={onLayout}>
      <View style={styles.middle}>
        <Text accessibilityRole="header" style={styles.title}>
          {START_FAILED_TITLE}
        </Text>
      </View>
      <View style={styles.bottom}>
        <Pressable
          testID="start-failed-retry"
          accessibilityRole="button"
          accessibilityLabel="重試"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.primary,
            pressed && styles.pressedButton,
          ]}
        >
          <Text style={styles.primaryText}>重試</Text>
        </Pressable>
        <Pressable
          testID="start-failed-diagnostics"
          accessibilityRole="button"
          accessibilityLabel="診斷"
          onPress={onDiagnostics}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>診斷</Text>
        </Pressable>
      </View>
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.surface },
    middle: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.xl,
    },
    title: { ...type.headline, color: colors.text, textAlign: 'center' },
    bottom: {
      paddingHorizontal: space.xl,
      paddingTop: space.s,
      paddingBottom: space.l,
    },
    primary: {
      minHeight: 56,
      borderRadius: radius.button,
      backgroundColor: colors.tonal,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { ...type.status, color: colors.tonalText },
    secondary: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.xs,
    },
    secondaryText: { ...type.status, color: colors.tonalText },
    pressed: { opacity: 0.6 },
    pressedButton: { transform: [{ scale: 0.97 }] },
  });
});
