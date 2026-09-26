import React from 'react';
import { View } from 'react-native';

// The tests only care that an icon is rendered with the right colour and
// state; the native SVG surface is not part of that.
const shape = name => props => <View {...props} testID={`svg-${name}`} />;
export const Svg = props => <View {...props} testID="svg" />;
export default Svg;
export const Polyline = props => <View {...props} testID="svg-polyline" />;
export const Path = shape('path');
export const Circle = shape('circle');
export const Line = shape('line');
export const Rect = shape('rect');
export const G = shape('g');
export const Text = shape('text');
