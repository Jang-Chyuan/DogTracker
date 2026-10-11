import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { border, radius, space, tabularNumbers, type } from '../theme/tokens';

// Keep the complete clock inside the control's visible width. The tip has no
// touch/a11y target: the adjustable handle already speaks this same time.
export const dragTimeTipHeight = (fontScale = 1) => Math.ceil(type.value.lineHeight * fontScale + space.s * 2);

export function dragTimeTipBox(x, width, top, minTop, fontScale = 1) {
  const available = Math.max(0, width - space.s * 2);
  const tipWidth = Math.min(available, Math.ceil(type.value.fontSize * 5 * 0.75 * fontScale + space.m * 2));
  const tipHeight = dragTimeTipHeight(fontScale);
  return { left: Math.max(space.s, Math.min(width - space.s - tipWidth, x - tipWidth / 2)),
    top: Math.max(minTop, top - tipHeight - space.s), width: tipWidth, minHeight: tipHeight };
}

export default function HistoryDragTimeTip({ text, x, width, top = 0, minTop = -Infinity, testID }) {
  const styles = useStyles(getStyles);
  const { fontScale = 1 } = useWindowDimensions();
  if (!(width > space.s * 2)) return null;
  return <View testID={testID} pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.tip, dragTimeTipBox(x, width, top, minTop, fontScale)]}>
    <Text style={styles.time} numberOfLines={1}>{text}</Text>
  </View>;
}
const getStyles = makeStyles(({ colors }) => StyleSheet.create({
  tip: { position: 'absolute', zIndex: 40, borderRadius: radius.cursorLabel,
    borderWidth: border.hairline, borderColor: colors.line, backgroundColor: colors.elevated,
    paddingHorizontal: space.m, paddingVertical: space.s, alignItems: 'center', justifyContent: 'center' },
  time: { ...type.value, ...tabularNumbers, color: colors.text },
}));
