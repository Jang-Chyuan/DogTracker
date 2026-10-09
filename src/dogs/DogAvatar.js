import { size as sizes, border as borders } from '../theme/tokens';
import { lightTheme } from '../theme/ThemeProvider';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { Image, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  FeColorMatrix,
  Filter,
  G,
  Image as SvgImage,
  Path,
} from 'react-native-svg';

import { DEFAULT_AVATAR, DOG_ARTS, DOG_COLORS } from './DogArt';

// The stale face's line colour on staleFace (4.6:1, design 判定表「未更新頭像
// 的顏色」).
export const getSTALE_LINE = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return themeLiteral.staleAvatarLine;
});

/**
 * A dog's face, wherever a dog is drawn: its photo, its chosen illustration,
 * or the default one (coral 原本). `stale` greys only the face itself — the
 * illustration's background becomes staleFace with darker lines, a photo turns
 * greyscale — never the white border or the badges drawn over it (v3: no
 * transparency, no status ring). `border` is the white frame's width.
 * `onLoad` lets a map marker redraw once a photo is decoded. `tint`
 * ({ bg, line }) draws an illustration in other colours (A5c's unselected
 * 樣子 choices are neutral). `snapshot` is for map markers, which are drawn
 * into a bitmap off screen: there a photo is drawn by the SVG surface (it
 * loads while being drawn), because an Image view never loads unattached.
 */
export default function DogAvatar({
  avatar,
  size = sizes.marker.normal,
  stale = false,
  border = borders.strong,
  onLoad,
  tint = null,
  snapshot = false,
  frameColor = null,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const STALE_LINE = useStyles(getSTALE_LINE);
  const value = avatar || DEFAULT_AVATAR;
  const frame = [
    styles.frame,
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: border,
      borderColor:
        frameColor ?? (snapshot ? colors.avatarFrameMap : colors.surface),
      backgroundColor:
        frameColor ?? (snapshot ? colors.avatarFrameMap : colors.surface),
    },
  ];
  const inner = size - 2 * border;
  if (value.kind === 'photo' && snapshot) {
    return (
      <View style={frame} testID="dog-avatar-photo">
        <Svg width={inner} height={inner} viewBox="0 0 100 100">
          <Defs>
            <ClipPath id="photo">
              <Circle cx={50} cy={50} r={50} />
            </ClipPath>
            {stale && (
              <Filter id="grey">
                <FeColorMatrix type="saturate" values="0" />
              </Filter>
            )}
          </Defs>
          <SvgImage
            href={{ uri: value.uri }}
            x={0}
            y={0}
            width={sizes.avatar.artGrid}
            height={sizes.avatar.artGrid}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#photo)"
            onLoad={onLoad}
            filter={stale ? 'url(#grey)' : undefined}
            testID={stale ? 'dog-photo-grey' : 'dog-photo'}
          />
        </Svg>
      </View>
    );
  }
  if (value.kind === 'photo') {
    return (
      <View style={frame} testID="dog-avatar-photo">
        <Image
          source={{ uri: value.uri }}
          onLoad={onLoad}
          style={[
            { width: inner, height: inner, borderRadius: inner / 2 },
            stale && styles.greyscale,
          ]}
        />
      </View>
    );
  }
  const art = DOG_ARTS[value.art] || DOG_ARTS.classic;
  const color = DOG_COLORS[value.color] || DOG_COLORS.coral;
  const background = stale ? colors.staleFace : tint?.bg ?? color.bg;
  const line = stale ? STALE_LINE : tint?.line ?? color.line;
  // The mockups' line weight (3.4 on the 120 grid): light, hand-drawn.
  const stroke = 3.4;
  return (
    <View
      style={frame}
      testID={`dog-avatar-${value.art}${stale ? '-stale' : ''}`}
    >
      <Svg width={inner} height={inner} viewBox="14 16 92 92">
        <Defs>
          <ClipPath id="face">
            <Circle cx={60} cy={62} r={46} />
          </ClipPath>
        </Defs>
        <Circle cx={60} cy={62} r={46} fill={background} />
        <G clipPath="url(#face)" transform="translate(0 2)">
          <G
            fill="none"
            stroke={line}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {art.lines.map(d => (
              <Path key={d} d={d} />
            ))}
          </G>
          {art.dots.map(dot => (
            <Circle key={`${dot.cx}`} {...dot} fill={line} />
          ))}
          <Ellipse {...art.nose} fill={line} />
        </G>
      </Svg>
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return StyleSheet.create({
    frame: {
      overflow: 'hidden',
      borderColor: themeLiteral.avatarFrameMap,
      backgroundColor: themeLiteral.avatarFrameMap,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // React Native's CSS filter (Android, new architecture).
    greyscale: { filter: [{ grayscale: 1 }] },
  });
});

// Compatibility for non-hook consumers; views resolve their current theme.
export const STALE_LINE = getSTALE_LINE(lightTheme);
