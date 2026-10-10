import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import DogMarkerView, { markerFrame } from '../src/map/DogMarkerView';
import { houseBadgePosition, problemBadgePosition } from '../src/map/BadgeGeometry';
import { size as sizes } from '../src/theme/tokens';

test.each([48, 56])('a separated %ddp face bitmap excludes unused tag canvas and contains badges/shadow', async faceSize => {
  const marker = { size: faceSize, problem: true, stale: true, selected: faceSize === 56, indoor: true };
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<DogMarkerView marker={marker} compact />); });
    const root = renderer.root.findAllByType(View)[0];
    const bitmap = StyleSheet.flatten(root.props.style);
    const frame = markerFrame(marker.size, true);
    expect(bitmap.width).toBe(frame.width);
    expect(bitmap.height).toBe(frame.height);
    // Separated centers can be 60dp diagonally apart. The old wide/tag
    // bitmap includes (60, 32) from this face, despite drawing nothing there.
    const tap = { x: 60, y: 32 };
    const bounds = { left: -bitmap.width * frame.anchor.x, right: bitmap.width * (1 - frame.anchor.x),
      top: -bitmap.height * frame.anchor.y, bottom: bitmap.height * (1 - frame.anchor.y) };
    expect(tap.x >= bounds.left && tap.x <= bounds.right && tap.y >= bounds.top && tap.y <= bounds.bottom).toBe(false);
    expect(bitmap.width).toBeLessThanOrEqual(faceSize + 16);
    expect(bitmap.height).toBeLessThanOrEqual(faceSize + 16);
    const left = (frame.width - faceSize) / 2;
    const top = sizes.marker.headroom;
    const problem = problemBadgePosition(faceSize);
    const house = houseBadgePosition(faceSize);
    expect(top + problem.top).toBeGreaterThanOrEqual(0);
    expect(left + faceSize - problem.right).toBeLessThanOrEqual(frame.width);
    expect(left + house.left).toBeGreaterThanOrEqual(0);
    expect(top + house.top + sizes.badge.size).toBeLessThanOrEqual(frame.height);
    const shadow = marker.selected ? sizes.marker.selectedShadowDrop : sizes.marker.shadowDrop;
    expect(left - shadow).toBeGreaterThanOrEqual(0);
    expect(top + faceSize + 2 * shadow).toBeLessThanOrEqual(frame.height);
    // Existing in-marker name/group tags keep their canvas.
    expect(markerFrame(marker.size).width).toBeGreaterThan(100);
  } finally { await act(async () => renderer?.unmount()); }
});
