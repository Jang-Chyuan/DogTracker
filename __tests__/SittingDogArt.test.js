import React from 'react';
import fs from 'fs';
import path from 'path';
import Renderer, { act } from 'react-test-renderer';
import Svg, { Path } from 'react-native-svg';
import SittingDogArt, { SITTING_DOG_PATHS, SITTING_DOG_VIEW_BOX } from '../src/dogs/SittingDogArt';

test('D4 artwork exactly matches all native icon/splash paths and stroke geometry', () => {
  const xml = fs.readFileSync(path.join(__dirname,
    '../android/app/src/main/res/drawable/ic_launcher_foreground.xml'), 'utf8');
  const paths = [...xml.matchAll(/<path\b[^>]*>/g)].map(match => match[0]);
  expect(SITTING_DOG_PATHS).toEqual(paths.map(tag => tag.match(/android:pathData="([^"]+)"/)[1]));
  let screen;
  act(() => { screen = Renderer.create(<SittingDogArt />); });
  const drawn = screen.root.findAllByType(Path);
  expect(drawn.map(node => node.props.d)).toEqual(SITTING_DOG_PATHS);
  paths.forEach((tag, index) => {
    if (tag.includes('android:strokeWidth')) {
      expect(drawn[index].props).toMatchObject({ strokeWidth: 5, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' });
    } else expect(drawn[index].props.stroke).toBe('none');
  });
  expect(screen.root.findByType(Svg).props.viewBox).toBe(SITTING_DOG_VIEW_BOX);
  const [x, , width] = SITTING_DOG_VIEW_BOX.split(' ').map(Number);
  // Tail marks end at x=112, plus the native 2.5-unit rounded cap.
  expect(x + width).toBeGreaterThan(112 + 2.5);
  act(() => screen.unmount());
});
