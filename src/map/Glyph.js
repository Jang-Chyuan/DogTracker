import { useTheme } from '../theme/ThemeProvider';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

// The gear outline of the design's mockups (24×24).
const GEAR =
  'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z';

/**
 * The small icons the card uses instead of repeating words: where a row came
 * from, and what its numbers are. Drawn as paths on a 24×24 grid, the way icon
 * sets do, because the app ships no icon font.
 */
export default function Glyph({ name, color, size = 16, level = null }) {
  const { literalColors: themeLiteral } = useTheme();
  const stroke = {
    stroke: color,
    strokeWidth: 2,
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {name === 'ble' && (
        // The Bluetooth rune: the same shape the platform uses.
        <Path d="M7 7.5 17 16.5 12 21V3l5 4.5L7 16.5" {...stroke} />
      )}
      {name === 'cloud' && (
        <Path
          d="M7 18.5a4 4 0 0 1 .4-8A5.5 5.5 0 0 1 17.7 11a3.8 3.8 0 0 1-.7 7.5z"
          {...stroke}
        />
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
            <Rect
              x={4}
              y={9}
              width={Math.max(1.5, 13 * Math.min(1, level / 100))}
              height={6}
              rx={1}
              fill={color}
            />
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
      {name === 'camera' && (
        // 改頭像 (A5): the mockups' camera.
        <>
          <Path d="M4 8h3l2-3h6l2 3h3v11H4z" {...stroke} />
          <Circle cx={12} cy={13} r={3.5} {...stroke} />
        </>
      )}
      {name === 'arrow' && (
        // The card's direction arrow, pointing up (north on screen); the card
        // turns it to the dog's bearing.
        <Path d="M12 20V4M5.5 10.5 12 4l6.5 6.5" {...stroke} />
      )}
      {name === 'gear' && (
        // 設定 (A1 top right): the mockups' gear.
        <>
          <Path d={GEAR} {...stroke} />
          <Circle cx={12} cy={12} r={3} {...stroke} />
        </>
      )}
      {(name === 'walk' || name === 'walk-off') && (
        // 「今天 x km」: a walking person; with a slash when the phone has
        // no location (A2).
        <>
          <Circle cx={13} cy={4.5} r={1.8} {...stroke} />
          <Path
            d="M10 21l2-6 3 3v3M8 12l2-4 4 1 2 4 2 1M12 15l-1-4"
            {...stroke}
          />
          {name === 'walk-off' && <Path d="M3 3l18 18" {...stroke} />}
        </>
      )}
      {name === 'paw' && (
        // History list: a dog's movement row (H1 狗的歷史).
        <>
          <Circle cx={6.5} cy={10} r={2} {...stroke} />
          <Circle cx={10} cy={5.5} r={2} {...stroke} />
          <Circle cx={14} cy={5.5} r={2} {...stroke} />
          <Circle cx={17.5} cy={10} r={2} {...stroke} />
          <Path
            d="M12 12c-3 0-5.5 3.2-5.5 5.4 0 1.6 1.3 2.6 2.8 2.6 1 0 1.7-.5 2.7-.5s1.7.5 2.7.5c1.5 0 2.8-1 2.8-2.6C17.5 15.2 15 12 12 12z"
            {...stroke}
          />
        </>
      )}
      {name === 'car' && (
        // History list: 開車 (my route) and 坐車 (a dog), seen from the side.
        <>
          <Path
            d="M3 16v-3.5l2-1 2.5-4h7l3.5 4 3 .8V16h-1.5M7.5 16h7"
            {...stroke}
          />
          <Circle cx={6} cy={16.5} r={1.8} {...stroke} />
          <Circle cx={16.5} cy={16.5} r={1.8} {...stroke} />
        </>
      )}
      {name === 'dots' && (
        // History list: 沒有資料.
        <>
          <Circle cx={5} cy={12} r={1.6} fill={color} stroke="none" />
          <Circle cx={12} cy={12} r={1.6} fill={color} stroke="none" />
          <Circle cx={19} cy={12} r={1.6} fill={color} stroke="none" />
        </>
      )}
      {name === 'house' && (
        // History list: a dog held indoors (停在原處), white on receiver blue.
        <Path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5" {...stroke} />
      )}
      {name === 'chevron' && <Path d="M9 5l7 7-7 7" {...stroke} />}
      {name === 'back' && <Path d="M15 5l-7 7 7 7" {...stroke} />}
      {name === 'clock' && (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Path d="M12 7v5.5l3.5 2" {...stroke} />
        </>
      )}
      {name === 'receiver-off' && (
        // 接收器斷線 (A2): the mockup's receiver box with its antenna.
        <>
          <Rect x={6} y={10} width={12} height={10} rx={2} {...stroke} />
          <Path d="M12 10V5M8.5 4.5a5 5 0 0 1 7 0" {...stroke} />
        </>
      )}
      {name === 'map-off' && (
        // 地圖載入失敗／地圖打不開 (A2c): a folded map, struck through.
        <Path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM3 3l18 18" {...stroke} />
      )}
      {name === 'storage' && (
        // 位置存不進手機: a phone with a cross where the data would go.
        <>
          <Rect x={6} y={2.5} width={12} height={19} rx={2.5} {...stroke} />
          <Path d="M10 10l4 4M14 10l-4 4M11 18.5h2" {...stroke} />
        </>
      )}
      {name === 'close' && <Path d="M6 6l12 12M18 6 6 18" {...stroke} />}
      {name === 'share' && (
        // 匯出 (history top right): an arrow up out of a tray.
        <Path
          d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"
          {...stroke}
        />
      )}
      {name === 'sliders' && (
        // 調整範圍: two sliders with their knobs.
        <>
          <Path d="M4 8h4M12 8h8M4 16h10M18 16h2" {...stroke} />
          <Circle cx={10} cy={8} r={2} {...stroke} />
          <Circle cx={16} cy={16} r={2} {...stroke} />
        </>
      )}
      {name === 'compass' && (
        // The compass (shown once the map is turned): north half in red.
        <>
          <Path
            d="M12 3l3.2 9H8.8z"
            fill={themeLiteral.critLine}
            stroke="none"
          />
          <Path d="M12 21l-3.2-9h6.4z" fill={color} stroke="none" />
        </>
      )}
    </Svg>
  );
}
