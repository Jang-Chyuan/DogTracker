import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

/**
 * The small icons the card uses instead of repeating words: where a row came
 * from, and what its numbers are. Drawn as paths on a 24×24 grid, the way icon
 * sets do, because the app ships no icon font.
 */
export default function Glyph({ name, color, size = 16, level = null }) {
  const stroke = {
    stroke: color, strokeWidth: 2, fill: 'none',
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {name === 'ble' && (
        // The Bluetooth rune: the same shape the platform uses.
        <Path d="M7 7.5 17 16.5 12 21V3l5 4.5L7 16.5" {...stroke} />
      )}
      {name === 'cloud' && (
        <Path d="M7 18.5a4 4 0 0 1 .4-8A5.5 5.5 0 0 1 17.7 11a3.8 3.8 0 0 1-.7 7.5z"
          {...stroke} />
      )}
      {name === 'speed' && (
        // A gauge with a needle and a pivot: the bare arc alone read as a
        // scribble at 15 px.
        <>
          <Path d="M3.5 18a8.5 8.5 0 1 1 17 0" {...stroke} />
          <Line x1={12} y1={18} x2={15.5} y2={12} {...stroke} />
          <Circle cx={12} cy={18} r={1.6} fill={color} />
        </>
      )}
      {name === 'battery' && (
        <>
          <Rect x={2} y={7} width={17} height={10} rx={2.5} {...stroke} />
          <Line x1={21.5} y1={10.5} x2={21.5} y2={13.5} {...stroke} />
          {Number.isFinite(level) && level > 0 && (
            <Rect x={4} y={9} width={Math.max(1.5, 13 * Math.min(1, level / 100))}
              height={6} rx={1} fill={color} />
          )}
        </>
      )}
      {name === 'distance' && (
        <>
          <Line x1={3} y1={12} x2={21} y2={12} {...stroke} />
          <Path d="M7 8 3 12l4 4" {...stroke} />
          <Path d="M17 8l4 4-4 4" {...stroke} />
        </>
      )}
      {name === 'clock' && (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Path d="M12 7v5.5l3.5 2" {...stroke} />
        </>
      )}
    </Svg>
  );
}
