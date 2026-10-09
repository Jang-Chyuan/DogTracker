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
      {name === 'frame' && (
        // 框住全部: four corners around a centre dot.
        <>
          <Path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" {...stroke} />
          <Circle cx={12} cy={12} r={1.6} fill={color} />
        </>
      )}
      {name === 'locate' && (
        // 我的位置: the platform's crosshair.
        <>
          <Circle cx={12} cy={12} r={7} {...stroke} />
          <Circle cx={12} cy={12} r={2.4} fill={color} />
          <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" {...stroke} />
        </>
      )}
      {name === 'pencil' && (
        // 編輯: a pencil leaning right, as in the mockups.
        <>
          <Path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" {...stroke} />
          <Path d="M13.5 7l3 3M12 20h8" {...stroke} />
        </>
      )}
      {name === 'arrow' && (
        // The card's direction arrow, pointing up (north on screen); the card
        // turns it to the dog's bearing.
        <Path d="M12 20V4M5.5 10.5 12 4l6.5 6.5" {...stroke} />
      )}
      {name === 'chevron' && <Path d="M9 5l7 7-7 7" {...stroke} />}
      {name === 'back' && <Path d="M15 5l-7 7 7 7" {...stroke} />}
      {name === 'clock' && (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Path d="M12 7v5.5l3.5 2" {...stroke} />
        </>
      )}
    </Svg>
  );
}
