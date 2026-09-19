import React from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

// The outline every icon set draws for "visible": a lens through the middle of
// the box with a round pupil, and the same lens struck through for "hidden".
// Drawing it from views only ever produced a capsule, a diamond or an ellipse,
// so this is the real path, scaled from a 24×24 grid.
const LENS = 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z';

export default function EyeIcon({ color, open = true, size = 26 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={LENS}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3} fill={color} />
      {!open && (
        <Line
          x1={3}
          y1={21}
          x2={21}
          y2={3}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}
