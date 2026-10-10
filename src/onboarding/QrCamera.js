import React from 'react';
import { requireNativeComponent } from 'react-native';

// The camera inside D3a's scan frame (android QrCameraViewManager): reports
// each QR code it reads as onScan(value); nothing while `paused`.
let NativeQrCamera = null;

export default function QrCamera({ paused = false, onScan, style, testID = 'qr-camera' }) {
  if (!NativeQrCamera) NativeQrCamera = requireNativeComponent('QrCameraView');
  return <NativeQrCamera testID={testID} style={style} paused={paused}
    onScan={event => onScan?.(event?.nativeEvent?.value)} />;
}
