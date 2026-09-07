import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { PanResponder } from 'react-native';
import TrackingSheet, {
  formatTime,
  sheetSummary,
} from '../src/map/TrackingSheet';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { SHEET_COLLAPSED_HEIGHT } from '../src/map/SheetMotion';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';
const tracking = {
  point: trackingPoint,
  historyLoaded: true,
  initialSnapshotReady: true,
  mode: 'real',
  preferences: { ready: true, value: DEFAULT_TRACKING_PREFERENCES },
};

test('actual pan callbacks follow finger, recover cancellation, and keep handle usable when content is scrolled', async () => {
  jest.useFakeTimers();
  const configurations = [];
  const original = PanResponder.create;
  const spy = jest.spyOn(PanResponder, 'create').mockImplementation(config => {
    configurations.push(config);
    return original(config);
  });
  let renderer;
  const onHeight = jest.fn();
  try {
    await act(async () => {
      renderer = Renderer.create(
        <TrackingSheet
          tracking={tracking}
          master={null}
          slave={null}
          bottomInset={90}
          onHeight={onHeight}
        />,
      );
      jest.advanceTimersByTime(1000);
    });
    const [content, handle] = configurations;
    const control = () =>
      renderer.root.findAllByProps({ testID: 'tracking-sheet-handle' })[0];
    const initialHeight = onHeight.mock.calls.at(-1)[0];
    expect(initialHeight).toBeGreaterThanOrEqual(SHEET_COLLAPSED_HEIGHT);
    expect(control().props.accessibilityValue.now).toBe(0);
    expect(control().props.accessibilityLabel).toContain('最新詳細資訊');
    expect(
      renderer.root.findAllByProps({ testID: 'tracking-sheet-summary' })[0]
        .props.children,
    ).toBe('最新詳細資訊');
    expect(
      renderer.root.findAllByProps({ testID: 'tracking-sheet-content' })[0]
        .props.accessibilityElementsHidden,
    ).toBe(true);
    await act(async () => {
      handle.onPanResponderGrant();
      handle.onPanResponderMove(null, { dy: 10000 });
      handle.onPanResponderRelease(null, { vy: 0.8 });
    });
    await act(async () => jest.advanceTimersByTime(1000));
    expect(onHeight).toHaveBeenLastCalledWith(initialHeight);
    expect(control().props.accessibilityValue.now).toBe(0);
    expect(
      handle.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: -30 }),
    ).toBe(true);
    await act(async () => {
      handle.onPanResponderGrant();
      handle.onPanResponderMove(null, { dy: -10000 });
      handle.onPanResponderRelease(null, { vy: -0.8 });
    });
    await act(async () => jest.advanceTimersByTime(1000));
    expect(control().props.accessibilityValue.now).toBe(2);
    expect(onHeight.mock.calls.at(-1)[0]).toBeGreaterThan(initialHeight);
    await act(async () =>
      renderer.root
        .findAllByProps({ testID: 'tracking-sheet-content' })[0]
        .props.onScroll({ nativeEvent: { contentOffset: { y: 100 } } }),
    );
    expect(
      content.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: 40 }),
    ).toBe(false);
    expect(
      handle.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: 40 }),
    ).toBe(true);
    await act(async () => {
      handle.onPanResponderGrant();
      handle.onPanResponderMove(null, { dy: 40 });
      handle.onPanResponderTerminate();
    });
    expect(control().props.accessibilityValue.now).toBe(2);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    spy.mockRestore();
    jest.useRealTimers();
  }
});

test('summary distinguishes pending preferences, empty sources and read errors without waiting for route history', () => {
  expect(sheetSummary({ ...tracking, preferences: { ready: false } })).toBe(
    '正在讀取設定…',
  );
  expect(
    sheetSummary({
      ...tracking,
      initialSnapshotReady: false,
      point: { id: null },
    }),
  ).toBe('正在讀取追蹤資料…');
  const empty = { ...tracking, point: { ...trackingPoint, id: null } };
  expect(sheetSummary(empty)).toBe('等待硬體資料');
  expect(sheetSummary({ ...empty, mode: 'demo' })).toBe('尚無 Demo 資料');
  expect(sheetSummary({ ...tracking, errors: { real: 'locked' } })).toBe(
    '資料讀取失敗 · 上滑查看',
  );
  expect(sheetSummary({ ...tracking, historyLoaded: false })).toBe(
    '最後更新 ' + formatTime(tracking.point.receivedAt),
  );
});
test.each([null, undefined, NaN, Infinity])(
  'invalid timestamps do not become invented dates: %s',
  receivedAt => {
    expect(
      sheetSummary({
        ...tracking,
        point: { ...trackingPoint, receivedAt },
      }),
    ).toBe('最後更新 尚無資料');
  },
);
test('summary uses DB update time, not distance or a stale threshold', () => {
  for (const receivedAt of [0, 1000]) {
    expect(
      sheetSummary({
        ...tracking,
        point: { ...trackingPoint, receivedAt },
      }),
    ).toBe('最後更新 ' + formatTime(receivedAt));
  }
});

test('DB updates refresh the visible summary without changing the chosen sheet level', async () => {
  jest.useFakeTimers();
  let renderer;
  const onHeight = jest.fn();
  const props = { tracking, bottomInset: 90, onHeight };
  try {
    await act(async () => {
      renderer = Renderer.create(<TrackingSheet {...props} />);
    });
    const handle = () =>
      renderer.root.findAllByProps({ testID: 'tracking-sheet-handle' })[0];
    onHeight.mockClear();
    const updated = {
      ...tracking,
      point: {
        ...trackingPoint,
        id: 43,
        receivedAt: trackingPoint.receivedAt + 1000,
      },
    };
    await act(async () =>
      renderer.update(<TrackingSheet {...props} tracking={updated} />),
    );
    expect(handle().props.accessibilityLabel).toContain(
      formatTime(updated.point.receivedAt),
    );
    expect(handle().props.accessibilityValue.now).toBe(0);
    expect(onHeight).not.toHaveBeenCalled();
    await act(async () =>
      handle().props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      }),
    );
    onHeight.mockClear();
    await act(async () =>
      renderer.update(
        <TrackingSheet
          {...props}
          tracking={{ ...updated, historyLoaded: false }}
        />,
      ),
    );
    expect(handle().props.accessibilityLabel).toContain(
      formatTime(updated.point.receivedAt),
    );
    expect(handle().props.accessibilityValue.now).toBe(1);
    expect(onHeight).not.toHaveBeenCalled();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    jest.useRealTimers();
  }
});
