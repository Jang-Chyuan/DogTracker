import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../theme/tokens';

/**
 * The receiver, everywhere it is drawn (design A1, 2026-10-02): round like
 * the dogs' avatars and as light — a white face in a slate-blue ring, a
 * slate-blue line receiver inside (a box, its antenna and two signal arcs) —
 * and its number in a small slate-blue tag at the lower right. Everything stays inside `size`, because a map marker is captured as
 * a bitmap of exactly its own bounds.
 */
//
// In a list row (`ring`) the circle is exactly the dogs' avatar ring, centred
// on the same line, and the tag may hang over its edge; on the map the whole
// drawing must fit `size`.
export default function ReceiverIcon({ number, size = 48, ring }) {
  const circle = ring ?? Math.round(size * 0.82);
  const box = ring ?? size;
  const glyph = Math.round(circle * 0.62);
  const tag = ring ? 18 : Math.max(18, Math.round(size * 0.42));
  const hang = ring ? -6 : 0;
  return (
    // Whatever it sits in names it; the number alone is never read out.
    <View style={{ width: box, height: box }} accessible={false}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.circle, { width: circle, height: circle, borderRadius: circle / 2 }]}>
        <Svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke={colors.receiver}
          strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Rect x={6} y={11} width={12} height={9} rx={2} />
          <Path d="M12 11V6" />
          <Path d="M8.5 6.5a5 5 0 0 1 7 0" />
          <Path d="M6 4a8.5 8.5 0 0 1 12 0" />
          <Circle cx={12} cy={15.5} r={1.3} fill={colors.receiver} stroke="none" />
        </Svg>
      </View>
      {number != null && (
        <View style={[styles.tag, { minWidth: tag, height: tag, borderRadius: tag / 2, right: hang, bottom: hang }]}>
          <Text style={[styles.tagText, { fontSize: Math.round(tag * 0.6) }]} allowFontScaling={false}>
            {number}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    position: 'absolute', left: 0, top: 0, backgroundColor: '#FFFFFF',
    borderWidth: 3, borderColor: colors.receiverRing, alignItems: 'center', justifyContent: 'center',
  },
  tag: {
    position: 'absolute', paddingHorizontal: 3, backgroundColor: colors.receiverRing,
    borderWidth: 1.5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  tagText: { color: '#FFFFFF', fontWeight: '800' },
});
