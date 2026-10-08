import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GuideButton, GuidePage } from './GuideUI';
import DogAvatar from '../dogs/DogAvatar';
import { colors, space, type } from '../theme/tokens';

// The line dog above the headline: the default illustration drawn in the
// text colour on the page, no circle.
const LINE_DOG = Object.freeze({ bg: colors.surface, line: colors.text });

/**
 * D4 已連上接收器 N (and D4b, nothing received yet): `page` is
 * Pairing.pairedPage — every source heard so far as 「訊號源 4」 after the
 * default avatar (32dp, 12dp gap; nothing on the right). 開始使用 ends the
 * guide on the map.
 */
export default function PairedScreen({ page, step = null, onStart, onLayout }) {
  return (
    <GuidePage testID="paired-page" step={step} onLayout={onLayout}
      icon={<View style={styles.icon}><DogAvatar size={72} border={0} tint={LINE_DOG} /></View>}
      title={page.title} body={page.body}
      bottom={<GuideButton testID="paired-start" label="開始使用" onPress={onStart} />}>
      {page.sources.map(source => (
        <View key={source.slaveId} testID={`paired-source-${source.slaveId}`} style={styles.row} accessible
          accessibilityLabel={source.label}>
          <DogAvatar size={32} border={0} />
          <Text style={styles.label}>{source.label}</Text>
        </View>
      ))}
    </GuidePage>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', marginTop: space.s, marginBottom: space.l },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center' },
  label: { ...type.status, color: colors.text, marginLeft: space.m },
});
