import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse, Circle, Path } from 'react-native-svg';
import { GuideButton, GuidePage } from './GuideUI';
import DogAvatar from '../dogs/DogAvatar';
import { space, type } from '../theme/tokens';

// The sitting dog of the app icon (android ic_launcher_foreground, #47), in
// the text colour, above D4's headline.
const SITTING_DOG = [
  'M38 37c8-7 36-7 44 0',
  'M39 35C24 35 17 52 21 71c2 7 9 8 12 2 2-5 2-11 4-17',
  'M81 35c15 0 22 17 18 36-2 7-9 8-12 2-2-5-2-11-4-17',
  'M41 78c9 9 29 9 38 0',
  'M54 69q3 4 6 0 3 4 6 0',
  'M42 90v32c0 6 4 9 9 9s7-3 7-8v-21',
  'M62 104v19c0 5 3 8 8 8s9-3 9-9V92',
  'M88 82c10 12 13 30 8 42-2 5-6 7-12 7',
];

function SittingDog({ size = 80 }) {
  const { colors } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="12 24 104 112" accessible={false}>
      {SITTING_DOG.map(d => (
        <Path
          key={d}
          d={d}
          stroke={colors.text}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      <Circle cx={49} cy={58} r={3.4} fill={colors.text} />
      <Circle cx={71} cy={58} r={3.4} fill={colors.text} />
      <Ellipse cx={60} cy={64.5} rx={3.8} ry={2.8} fill={colors.text} />
    </Svg>
  );
}

/**
 * D4 已連上接收器 N (and D4b, nothing received yet): `page` is
 * Pairing.pairedPage — every source heard so far as 「訊號源 4」 after the
 * default avatar (32dp, 12dp gap; nothing on the right). 開始使用 ends the
 * guide on the map.
 */
export default function PairedScreen({ page, step = null, onStart, onLayout }) {
  const styles = useStyles(getStyles);
  return (
    <GuidePage
      testID="paired-page"
      step={step}
      onLayout={onLayout}
      icon={
        <View style={styles.icon}>
          <SittingDog />
        </View>
      }
      title={page.title}
      body={page.body}
      bottom={
        <GuideButton testID="paired-start" label="開始使用" onPress={onStart} />
      }
    >
      {page.sources.map(source => (
        <View
          key={source.slaveId}
          testID={`paired-source-${source.slaveId}`}
          style={styles.row}
          accessible
          accessibilityLabel={source.label}
        >
          <DogAvatar size={32} border={0} />
          <Text style={styles.label}>{source.label}</Text>
        </View>
      ))}
    </GuidePage>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    icon: { alignItems: 'center', marginTop: space.s, marginBottom: space.l },
    row: { minHeight: 56, flexDirection: 'row', alignItems: 'center' },
    label: { ...type.status, color: colors.text, marginLeft: space.m },
  });
});
