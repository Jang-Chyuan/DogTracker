import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { StyleSheet, Text, View } from 'react-native';
import SittingDogArt from '../dogs/SittingDogArt';
import { GuideButton, GuidePage } from './GuideUI';
import DogAvatar from '../dogs/DogAvatar';
import { space, type } from '../theme/tokens';

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
          <SittingDogArt />
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
