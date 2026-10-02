import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path } from 'react-native-svg';
import { DEFAULT_AVATAR, DOG_ARTS, DOG_COLORS } from './DogArt';

/**
 * A dog's face, wherever a dog is drawn: its photo, its chosen illustration,
 * or the default one. `tint` and `outline` are the aged-fix colours of a map
 * marker (amber, grey); a photo keeps its picture and lets the marker's ring
 * carry the age. `onLoad` lets a map marker redraw once a photo is decoded.
 */
// A photo cannot be tinted, so an aged one shows its age in its border.
const isPhoto = avatar => avatar?.kind === 'photo';

export default function DogAvatar({ avatar, size = 40, tint, outline, onLoad }) {
  const value = avatar || DEFAULT_AVATAR;
  const frame = [styles.frame, { width: size, height: size, borderRadius: size / 2 },
    outline || (isPhoto(avatar) && tint) ? { borderColor: outline || tint, borderWidth: 3 } : null];
  if (value.kind === 'photo') {
    return (
      <View style={frame} testID="dog-avatar-photo">
        <Image source={{ uri: value.uri }} style={{ width: size, height: size, borderRadius: size / 2 }}
          onLoad={onLoad} />
      </View>
    );
  }
  const art = DOG_ARTS[value.art] || DOG_ARTS.classic;
  const color = DOG_COLORS[value.color] || DOG_COLORS.coral;
  const background = tint ?? color.bg;
  const line = tint ? '#FFFFFF' : outline ? '#6B7470' : color.line;
  // Thin lines vanish on a 30 dp marker; small faces get heavier strokes.
  const stroke = size < 48 ? 4.6 : 3.4;
  return (
    <View style={frame} testID={`dog-avatar-${value.art}`}>
      <Svg width={size} height={size} viewBox="14 16 92 92">
        <Defs>
          <ClipPath id="face"><Circle cx={60} cy={62} r={46} /></ClipPath>
        </Defs>
        <Circle cx={60} cy={62} r={46} fill={outline && !tint ? '#FFFFFF' : background} />
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
  frame: { overflow: 'hidden', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
});
