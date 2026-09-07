import React from 'react';
import { StyleSheet, View } from 'react-native';
import { mapColors as colors } from './MapTheme';

// antgo's basic person/dog visual, independent of profiles and photo storage.
export default function TrackingAvatar({ role, size = 40 }) {
  const person = role === 'master';
  return (
    <View
      testID={`avatar-${role}`}
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: person ? colors.master : colors.dog,
        },
      ]}
    >
      {person ? (
        <>
          <View
            style={[
              styles.part,
              styles.person,
              {
                width: size * 0.25,
                height: size * 0.25,
                borderRadius: size,
                left: size * 0.32,
                top: size * 0.12,
              },
            ]}
          />
          <View
            style={[
              styles.part,
              styles.person,
              {
                width: size * 0.52,
                height: size * 0.3,
                borderTopLeftRadius: size,
                borderTopRightRadius: size,
                left: size * 0.19,
                bottom: size * 0.15,
              },
            ]}
          />
        </>
      ) : (
        <>
          <View
            style={[
              styles.part,
              styles.ear,
              {
                width: size * 0.24,
                height: size * 0.3,
                left: size * 0.08,
                top: size * 0.16,
                borderRadius: size * 0.08,
                transform: [{ rotate: '-25deg' }],
              },
            ]}
          />
          <View
            style={[
              styles.part,
              styles.ear,
              {
                width: size * 0.24,
                height: size * 0.3,
                right: size * 0.08,
                top: size * 0.16,
                borderRadius: size * 0.08,
                transform: [{ rotate: '25deg' }],
              },
            ]}
          />
          <View
            style={[
              styles.part,
              styles.coat,
              {
                width: size * 0.6,
                height: size * 0.56,
                top: size * 0.23,
                left: size * 0.15,
                borderRadius: size * 0.24,
              },
            ]}
          >
            <View
              style={[
                styles.part,
                styles.feature,
                {
                  width: size * 0.065,
                  height: size * 0.065,
                  borderRadius: size,
                  left: size * 0.12,
                  top: size * 0.16,
                },
              ]}
            />
            <View
              style={[
                styles.part,
                styles.feature,
                {
                  width: size * 0.065,
                  height: size * 0.065,
                  borderRadius: size,
                  right: size * 0.12,
                  top: size * 0.16,
                },
              ]}
            />
            <View
              style={[
                styles.part,
                styles.feature,
                {
                  width: size * 0.11,
                  height: size * 0.075,
                  borderRadius: size,
                  left: size * 0.245,
                  bottom: size * 0.1,
                },
              ]}
            />
          </View>
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { borderWidth: 2, borderColor: 'white', overflow: 'hidden' },
  part: { position: 'absolute' },
  person: { backgroundColor: 'white' },
  coat: { backgroundColor: '#FFF5EC' },
  ear: { backgroundColor: '#7D513B' },
  feature: { backgroundColor: '#4B3428' },
});
