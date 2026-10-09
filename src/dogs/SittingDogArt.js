import { size as sizes } from '../theme/tokens';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

// Same paths and stroke geometry as Android’s icon and native splash.
export const SITTING_DOG_PATHS = [
  'M38 37c8-7 36-7 44 0',
  'M39 35C24 35 17 52 21 71c2 7 9 8 12 2 2-5 2-11 4-17',
  'M81 35c15 0 22 17 18 36-2 7-9 8-12 2-2-5-2-11-4-17',
  'M41 78c9 9 29 9 38 0',
  'M54 69q3 4 6 0 3 4 6 0',
  'M42 90v32c0 6 4 9 9 9s7-3 7-8v-21',
  'M62 104v19c0 5 3 8 8 8s9-3 9-9V92',
  'M88 82c10 12 13 30 8 42-2 5-6 7-12 7',
  'M98 124h9M100 129h12',
  'M45.6,58a3.4,3.4 0 1,0 6.8,0a3.4,3.4 0 1,0 -6.8,0',
  'M67.6,58a3.4,3.4 0 1,0 6.8,0a3.4,3.4 0 1,0 -6.8,0',
  'M56.158,64.5a3.8419999999999996,2.8219999999999996 0 1,0 7.683999999999999,0a3.8419999999999996,2.8219999999999996 0 1,0 -7.683999999999999,0',
];

// Includes rounded stroke caps on the tail marks, with breathing room.
export const SITTING_DOG_VIEW_BOX = '12 24 106 112';

export default function SittingDogArt({ size = sizes.sittingDog.canvas }) {
  const { colors } = useTheme();
  return (
    <Svg width={size} height={size} viewBox={SITTING_DOG_VIEW_BOX} accessible={false}>
      {SITTING_DOG_PATHS.map((d, index) => (
        <Path key={d} d={d} fill={index < 9 ? 'none' : colors.text}
          stroke={index < 9 ? colors.text : 'none'} strokeWidth={5}
          strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}
