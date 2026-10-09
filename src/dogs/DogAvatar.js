import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path } from 'react-native-svg';
import { colors } from '../theme/tokens';
import { DEFAULT_AVATAR, DOG_ARTS, DOG_COLORS } from './DogArt';

// The stale face's line colour on staleFace (4.6:1, design 判定表「未更新頭像
// 的顏色」).
export const STALE_LINE = '#5B645F';

/**
 * A dog's face, wherever a dog is drawn: its photo, its chosen illustration,
 * or the default one (coral 原本). `stale` greys only the face itself — the
 * illustration's background becomes staleFace with darker lines, a photo turns
 * greyscale — never the white border or the badges drawn over it (v3: no
 * transparency, no status ring). `border` is the white frame's width.
 * `onLoad` lets a map marker redraw once a photo is decoded.
 */
export default function DogAvatar({ avatar, size = 40, stale = false, border = 2, onLoad }) {
  const value = avatar || DEFAULT_AVATAR;
  const frame = [styles.frame, { width: size, height: size, borderRadius: size / 2, borderWidth: border }];
  const inner = size - 2 * border;
  if (value.kind === 'photo') {
    return (
      <View style={frame} testID="dog-avatar-photo">
        <Image source={{ uri: value.uri }} onLoad={onLoad}
          style={[{ width: inner, height: inner, borderRadius: inner / 2 },
            stale && styles.greyscale]} />
      </View>
    );
  }
  const art = DOG_ARTS[value.art] || DOG_ARTS.classic;
  const color = DOG_COLORS[value.color] || DOG_COLORS.coral;
  const background = stale ? colors.staleFace : color.bg;
  const line = stale ? STALE_LINE : color.line;
  // The mockups' line weight (3.4 on the 120 grid): light, hand-drawn.
  const stroke = 3.4;
  return (
    <View style={frame} testID={`dog-avatar-${value.art}${stale ? '-stale' : ''}`}>
      <Svg width={inner} height={inner} viewBox="14 16 92 92">
        <Defs>
          <ClipPath id="face"><Circle cx={60} cy={62} r={46} /></ClipPath>
        </Defs>
        <Circle cx={60} cy={62} r={46} fill={background} />
        <G clipPath="url(#face)" transform="translate(0 2)">
          <G fill="none" stroke={line} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
            {art.lines.map(d => <Path key={d} d={d} />)}
          </G>
          {art.dots.map(dot => <Circle key={`${dot.cx}`} {...dot} fill={line} />)}
          <Ellipse {...art.nose} fill={line} />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderColor: '#FFFFFF', backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center' },
  // React Native's CSS filter (Android, new architecture).
  greyscale: { filter: [{ grayscale: 1 }] },
});
