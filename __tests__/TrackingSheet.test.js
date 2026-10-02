import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import TrackingSheet, {
  formatTime,
  sheetSummary,
} from '../src/map/TrackingSheet';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';
const tracking = {
  point: trackingPoint,
  historyLoaded: true,
  initialSnapshotReady: true,
  mode: 'real',
  preferences: { ready: true, value: DEFAULT_TRACKING_PREFERENCES },
};

const NOW = Date.parse('2026-10-02T02:00:00Z');
const cloudDog = (slaveId, ageMs) => ({
  slaveId, masterId: 7, source: 'cloud', coordinate: { latitude: 25, longitude: 121 },
  receivedAt: NOW - ageMs, lastPositionAt: NOW - ageMs, lastPacketAt: NOW - ageMs,
  retained: false, speedKmh: 2, batteryPercentage: 80,
});

test('collapsed, the card is a row of avatar chips; the header opens the list', async () => {
  let renderer;
  const onHeight = jest.fn();
  const onPickDog = jest.fn();
  const prefs = { ready: true, value: { ...DEFAULT_TRACKING_PREFERENCES, hiddenSlaveIds: [6] } };
  await act(async () => {
    renderer = Renderer.create(
      <TrackingSheet tracking={{ ...tracking, preferences: prefs, saveTrackingPreferences: jest.fn() }}
        dogs={[cloudDog(4, 10000), cloudDog(6, 10000), cloudDog(8, 4 * 60000)]}
        now={NOW} bottomInset={90} onHeight={onHeight} onPickDog={onPickDog} />,
    );
  });
  const chips = renderer.root.findAll(node => node.props.testID?.startsWith?.('strip-dog-')
    && typeof node.props.onPress === 'function', { deep: false });
  // Hidden dog 6 is not in the strip; each chip says the dog and its state
  // (dog 8 has sent nothing for four minutes).
  expect(chips.map(chip => chip.props.accessibilityLabel)).toEqual(['狗 4，即時', '狗 8，未更新']);
  const handle = () => renderer.root.findAllByProps({ testID: 'tracking-sheet-handle' })[0];
  expect(handle().props.accessibilityLabel).toContain('3 隻狗');
  expect(handle().props.accessibilityValue.now).toBe(0);
  const collapsedHeight = onHeight.mock.calls.at(-1)[0];
  await act(async () => handle().props.onPress());
  expect(handle().props.accessibilityValue.now).toBe(1);
  expect(onHeight.mock.calls.at(-1)[0]).toBeGreaterThan(collapsedHeight);
  // A chip opens that dog's popover from where it was tapped.
  await act(async () => handle().props.onPress());
  await act(async () => chips[1].props.onPress({ nativeEvent: { pageY: 700, pageX: 160 } }));
  expect(onPickDog).toHaveBeenCalledWith(expect.objectContaining({ slaveId: 8 }), 700, 160);
  await act(async () => renderer.unmount());
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
