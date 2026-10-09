import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { size, type } from '../theme/tokens';

// Use the measured line count: large fonts alone do not imply a wrapped tag.
export default function MapNameTag({
  text,
  maxWidth,
  color,
  testID = 'dog-name-tag',
  onLayout,
}) {
  const { colors } = useTheme();
  const [wrapped, setWrapped] = useState(false);
  const label = size.mapLabel;
  return (
    <View
      testID={testID}
      onLayout={onLayout}
      style={{
        maxWidth,
        paddingHorizontal: label.paddingH,
        paddingVertical: label.paddingV,
        borderRadius: wrapped ? label.radiusWrapped : label.radius,
        borderWidth: label.border,
        borderColor: colors.floatingOutline,
        backgroundColor: colors.surface,
      }}
    >
      <Text
        style={[type.mapLabel, { color: color || colors.text, ...styles.text }]}
        numberOfLines={label.maxLines}
        onTextLayout={event => setWrapped(event.nativeEvent.lines.length > 1)}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ text: { textAlign: 'center' } });
