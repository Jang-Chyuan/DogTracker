import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { BOTTOM_DROP_MS, StableInsets } from '../src/app/StableInsets';

const edges = bottom => ({ top: 49, right: 0, bottom, left: 0 });

function setup(initial) {
  const seen = [];
  function Probe() {
    seen.push(useSafeAreaInsets());
    return null;
  }
  const tree = insets => (
    <SafeAreaInsetsContext.Provider value={insets}>
      <StableInsets>
        <Probe />
      </StableInsets>
    </SafeAreaInsetsContext.Provider>
  );
  let renderer;
  act(() => {
    renderer = ReactTestRenderer.create(tree(initial));
  });
  return {
    update: insets => act(() => renderer.update(tree(insets))),
    last: () => seen[seen.length - 1],
    seen,
  };
}

describe('StableInsets (E04)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('a bottom inset that drops to 0 and comes back is never passed on', () => {
    const view = setup(edges(24));
    view.update(edges(0));
    act(() => jest.advanceTimersByTime(300));
    view.update(edges(24));
    act(() => jest.advanceTimersByTime(BOTTOM_DROP_MS * 2));
    expect(view.seen.every(insets => insets.bottom === 24)).toBe(true);
  });

  test('a lasting smaller bottom inset is taken after the delay', () => {
    const view = setup(edges(48));
    view.update(edges(24));
    expect(view.last().bottom).toBe(48);
    act(() => jest.advanceTimersByTime(BOTTOM_DROP_MS));
    expect(view.last().bottom).toBe(24);
  });

  test('a larger bottom inset and the other edges are taken at once', () => {
    const view = setup(edges(24));
    view.update({ ...edges(48), top: 60 });
    expect(view.last()).toEqual({ ...edges(48), top: 60 });
  });
});
