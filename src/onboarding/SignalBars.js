import Svg, { Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

export default function SignalBars({ bars }) {
  const { colors } = useTheme();
  if (!bars) return null;
  return (
    <Svg width={16} height={12} viewBox="0 0 16 12" accessible={false} testID="pair-signal-bars">
      {[3, 6, 9, 12].map((height, index) => (
        <Rect key={height} x={index * 4} y={12 - height} width={3} height={height}
          rx={1} fill={index < bars ? colors.text : colors.line} />
      ))}
    </Svg>
  );
}
