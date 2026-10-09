// The round 「!」 (DESIGN.md §15 角標, 卡片問題列, 設定的紅色「!」): a filled
// circle with the mark drawn as a vector, so it stays centred whatever the
// system font size (a text 「!」 grew with the font and slid off-centre).
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * @param size the circle's diameter (dp)
 * @param background the circle's colour
 * @param color the mark's colour
 */
export default function BangGlyph({ size, background, color, testID }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={false}
      testID={testID}
    >
      <Circle cx={12} cy={12} r={12} fill={background} />
      {/* The marker badge's mark (DogMarkerView), in a 24 box with a 6.5 margin. */}
      <Path
        d="M12 6.5v7"
        stroke={color}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={17.6} r={1.8} fill={color} />
    </Svg>
  );
}
