import React, { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
export const mockCamera = {
  fitToCoordinates: jest.fn(),
  animateToRegion: jest.fn(),
};
const MapView = forwardRef((props, ref) => {
  useImperativeHandle(ref, () => mockCamera);
  return <View {...props} testID="google-map" />;
});
export default MapView;
export const PROVIDER_GOOGLE = 'google';
export const Marker = props => <View {...props} testID="map-marker" />;
export const Polyline = props => <View {...props} testID="map-polyline" />;
export const Circle = props => <View {...props} testID="map-circle" />;
