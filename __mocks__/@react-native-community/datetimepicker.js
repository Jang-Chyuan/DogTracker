import React from 'react';
import { View } from 'react-native';

// The tests drive the picker through its onChange, the way the platform does.
export default function DateTimePicker(props) {
  return <View {...props} testID={props.testID || 'datetime-picker'} />;
}
