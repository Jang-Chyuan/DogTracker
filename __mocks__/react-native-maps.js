import React, { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
export const mockCamera = {
  fitToCoordinates: jest.fn(),
  animateToRegion: jest.fn(),
  animateCamera: jest.fn(),
  getCamera: jest.fn().mockResolvedValue(null),
};
const MapView = forwardRef((props, ref) => {
  useImperativeHandle(ref, () => mockCamera);
  return <View {...props} testID="google-map" />;
});
export default MapView;
export const PROVIDER_GOOGLE = 'google';
// A marker's bitmap redraw, called with the marker's identifier.
export const mockMarkerRedraw = jest.fn();
export const Marker = forwardRef((props, ref) => {
  useImperativeHandle(ref, () => ({ redraw: () => mockMarkerRedraw(props.identifier) }), [props.identifier]);
  return <View {...props} testID="map-marker" />;
});
export const Polyline = props => <View {...props} testID="map-polyline" />;
export const Circle = props => <View {...props} testID="map-circle" />;
export const Polygon = props => <View {...props} testID="map-polygon" />;
