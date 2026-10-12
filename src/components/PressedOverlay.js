import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';

/**
 * The pressed state laid over a button (DESIGN.md §5.8): `pressedOverlay` in
 * the button's own shape. Round and pill buttons (D18: small elements are
 * round or capsules) get a round overlay, never a square grey box, and the
 * button keeps its own opaque background underneath (§2.5: nothing floating
 * over the map turns see-through while pressed).
 *
 * `corner` is the button's borderRadius; leave it out for a round or pill
 * button. Put it last inside the button so it covers the content.
 */
export default function PressedOverlay({ visible = true, corner = radius.full, testID = 'pressed-overlay' }) {
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: corner, backgroundColor: colors.pressedOverlay }]}
    />
  );
}
