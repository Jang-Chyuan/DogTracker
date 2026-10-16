import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Glyph from '../map/Glyph';
import { makeStyles, useStyles, useTheme } from '../theme/ThemeProvider';
import { size, space, touch, type } from '../theme/tokens';

/**
 * The 「‹ 標題」 header row of every full page (settings pages, 活動, ...):
 * one 48dp target holding the back icon and the title, an 8dp gap apart.
 *
 * The icon is centred on the title. Android adds font padding above and below
 * a Text's glyphs, which put the title lower than the icon; the title drops it
 * (`includeFontPadding: false`, `textAlignVertical: 'center'`). When a large
 * system font wraps the title to two lines, the icon stays on the FIRST line
 * (the row aligns to the top and the icon sits in a box one line tall), not
 * in the middle of the whole block.
 */
// `rowId` is the Pressable's testID (named apart so tests find the Pressable).
export default function BackRow({ title, label, onPress, rowId, titleLines, style }) {
  const styles = useStyles(getStyles);
  const { colors } = useTheme();
  const [firstLine, setFirstLine] = useState(null);
  // `firstLine` is only set once the title has wrapped.
  const onTextLayout = event => {
    const lines = event.nativeEvent.lines;
    setFirstLine(lines.length > 1 ? lines[0].height : null);
  };
  return (
    <Pressable
      testID={rowId}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={space.s}
      style={({ pressed }) => [
        styles.row,
        firstLine != null && styles.rowWrapped,
        style,
        pressed && styles.pressed,
      ]}
    >
      <View
        testID={`${rowId}-icon`}
        style={[styles.icon, firstLine != null && { height: firstLine }]}
      >
        <Glyph name="back" color={colors.text} size={size.icon.navigation} />
      </View>
      <Text
        style={styles.title}
        accessibilityRole="header"
        numberOfLines={titleLines}
        onTextLayout={onTextLayout}
      >{title}</Text>
    </Pressable>
  );
}

export const getStyles = makeStyles(theme => StyleSheet.create({
  row: {
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingLeft: space.s,
    paddingRight: space.m,
    flexShrink: 1,
    alignSelf: 'flex-start',
  },
  // A wrapped title: the icon follows the first line, not the block.
  rowWrapped: { alignItems: 'flex-start', paddingVertical: space.s },
  icon: { height: type.title.lineHeight, justifyContent: 'center' },
  title: {
    ...type.title,
    color: theme.colors.text,
    flexShrink: 1,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  pressed: { opacity: 0.7 },
}));
