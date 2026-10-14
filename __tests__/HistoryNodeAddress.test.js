import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text, StyleSheet } from 'react-native';
import { placeLines } from '../src/history/HistoryText';
import HistoryTimelineList from '../src/mapHistory/HistoryTimelineList';
import { exportPlaces, exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { layoutRow, defaultMeasure } from '../src/mapHistory/ExportPNG';
import { AddressLookupContext, createAddressLookup, useAddress } from '../src/placement/AddressLookup';
import { useHistoryExport } from '../src/mapHistory/useHistoryExport';
import { colors } from '../src/theme/tokens';

const point = { latitude: 24.9378, longitude: 121.2954 };
const address = '八德區介壽路一段 728 號附近';
const house = { ...point, type: 'indoor', start: 0, end: 2400000 };

test.each(['indoor', 'stop', 'departure', 'end', 'switch'])('%s uses identical screen and PNG address lines', type => {
  const node = { ...house, type, durationMs: 2400000, interruptionMs: 300000, label: '結束' };
  const missing = placeLines(node, { state: 'none' });
  expect(missing).toEqual({ title: '24.9378, 121.2954', titleMuted: false, coordinates: '', missing: '' });
  // 2026-10-14 (the user's decision): no address → the PNG row shows the
  // coordinates, as the list does, never a blank.
  const row = exportTimelineRows([node], () => null)[0];
  const layout = layoutRow(row, defaultMeasure);
  expect(layout.titleLines).toEqual(['24.9378, 121.2954']);
  expect(row.coordinates).toBe('');
  expect(layout.items.map(item => item.kind)).toEqual(type === 'switch' ? [] : type === 'stop' ? ['pill', 'note'] : ['pill']);
  if (type === 'stop') expect(layout.items[1].text).toBe(row.note);
  expect(layout.secondLines).toBe(type === 'switch' ? 0 : type === 'stop' ? 2 : 1);
  const found = placeLines(node, { state: 'found', text: address });
  expect(found).toMatchObject({ title: address, coordinates: missing.title });
  const foundRow = exportTimelineRows([node], () => address)[0];
  expect(foundRow).toMatchObject({ title: address, coordinates: '' });
  expect(layoutRow(foundRow, defaultMeasure).items.some(item => item.text === missing.title)).toBe(false);
});

test('a switch with no address has no empty second row on screen', async () => {
  const lookup = { lookup: () => null, subscribe: () => () => {} };
  let renderer;
  await act(async () => { renderer = Renderer.create(<AddressLookupContext.Provider value={lookup}>
    <HistoryTimelineList model={{ nodes: [{ ...house, type: 'switch', number: 1 }] }} color={colors.route1} />
  </AddressLookupContext.Provider>); });
  const title = renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'place-title')[0];
  expect(title.parent.children).toHaveLength(1);
  await act(async () => renderer.unmount());
});

test('indoor list and PNG export reuse the live card address cache', async () => {
  const native = { reverseGeocode: jest.fn(async () => JSON.stringify([
    { line: '334台灣桃園市八德區介壽路一段728號', ...point },
  ])) };
  const lookup = createAddressLookup({ native });
  let renderer, exporterState;
  const model = { nodes: [house], packets: [{ ...point, time: 0 }], points: [{ ...point, time: 0 }],
    edges: [], locations: [house], distanceM: 0 };
  const exporter = { listExports: async () => [], charWidths: async () => ({ regular: {}, bold: {} }),
    renderPng: jest.fn(async () => ['/cache/test.png']), share: jest.fn(async () => {}) };
  function Card() { return <Text>{useAddress(point)}</Text>; }
  function Export() {
    exporterState = useHistoryExport({ screen: { dayModel: { subjects: [{ id: 1, model }] },
      range: { start: 0, end: house.end }, subject: 'dog', look: { 1: { name: '小黑', color: colors.route1 } } }, exporter });
    return null;
  }
  await act(async () => { renderer = Renderer.create(<AddressLookupContext.Provider value={lookup}><Card /></AddressLookupContext.Provider>); });
  expect(JSON.stringify(renderer.toJSON())).toContain(address);
  const cardRequests = native.reverseGeocode.mock.calls.length;
  expect(cardRequests).toBe(1);
  await act(async () => renderer.update(<AddressLookupContext.Provider value={lookup}>
    <HistoryTimelineList model={model} color={colors.route1} /><Export />
  </AddressLookupContext.Provider>));
  expect(JSON.stringify(renderer.toJSON())).toContain(address);
  expect(exportPlaces(model)).toEqual([house]);
  await act(async () => exporterState.start('png'));
  expect(exporter.renderPng).toHaveBeenCalledTimes(1);
  const pages = JSON.stringify(exporter.renderPng.mock.calls[0][2]);
  const addressLines = exporter.renderPng.mock.calls[0][2].flatMap(page => page.ops)
    .filter(op => op.t === 'text' && op.bold && op.size === 40).map(op => op.text);
  expect(addressLines.slice(1).join(' ')).toBe(address);
  expect(pages).toContain('室內・40 分');
  expect(native.reverseGeocode).toHaveBeenCalledTimes(cardRequests);
  await act(async () => renderer.unmount());
});


test.each([1, 2])('a leading stay pill and marker are centered on the first wrapping address line at font scale %s', async scale => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 393, height: 851, fontScale: scale });
  const lookup = { lookup: () => '虛構桃園長地址第一行第二行第三行', subscribe: () => () => {} };
  let renderer;
  try {
  await act(async () => { renderer = Renderer.create(<AddressLookupContext.Provider value={lookup}>
    <HistoryTimelineList model={{ nodes: [{ ...house, type: 'stop', number: 1, durationMs: house.end }] }} color={colors.route1} />
  </AddressLookupContext.Provider>); });
  const title = renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'place-title')[0];
  let host = title.parent;
  while (host && StyleSheet.flatten(host.props.style)?.flexDirection !== 'row') host = host.parent;
  const heading = StyleSheet.flatten(host.props.style);
  expect(heading).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' });
  expect(host.children).toHaveLength(2);
  expect(title.props.children).toBe('虛構桃園長地址第一行第二行第三行'); // real lookup returns a string
  const pillBox = renderer.root.findAll(node => node.type === 'View' && node.props.testID === 'place-pill-first-line')[0];
  const markerBox = renderer.root.findAll(node => node.type === 'View' && node.props.testID === 'place-node-first-line')[0];
  expect(StyleSheet.flatten(pillBox.props.style)).toMatchObject({ height: 20 * scale, justifyContent: 'center' });
  expect(StyleSheet.flatten(markerBox.props.style)).toEqual(StyleSheet.flatten(pillBox.props.style));
  } finally {
    await act(async () => renderer?.unmount());
    dimensions.mockRestore();
  }
});


test('pending addresses shimmer however long they wait; a real failure shows the coordinates; a late answer replaces them', async () => {
  jest.useFakeTimers();
  let renderer, answer, publish;
  const lookup = { lookup: () => answer, subscribe: fn => { publish = fn; return () => {}; } };
  const view = <AddressLookupContext.Provider value={lookup}><HistoryTimelineList
    model={{ nodes: [{ ...house, type: 'stop', number: 1, durationMs: house.end }] }} color={colors.route1} />
  </AddressLookupContext.Provider>;
  const speech = () => renderer.root.findAll(node => node.props.testID === 'timeline-stop'
    && typeof node.props.accessibilityLabel === 'string')[0].props.accessibilityLabel;
  try {
    await act(async () => { renderer = Renderer.create(view); });
    expect(renderer.root.findAllByProps({ testID: 'place-address-pending' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ testID: 'place-title' })).toHaveLength(0);
    // Still queued or asked (undefined) a minute on: still the shimmer.
    await act(async () => { jest.advanceTimersByTime(60000); publish(); });
    expect(renderer.root.findAllByProps({ testID: 'place-address-pending' }).length).toBeGreaterThan(0);
    await act(async () => { answer = null; publish(); });
    expect(renderer.root.findAllByProps({ testID: 'place-address-pending' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('24.9378, 121.2954');
    expect(speech()).toContain('24.9378, 121.2954');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('地址暫時無法取得');
    await act(async () => { answer = address; publish(); });
    expect(JSON.stringify(renderer.toJSON())).toContain(address);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('24.9378, 121.2954');
    expect(speech()).toContain(address);
  } finally { await act(async () => renderer?.unmount()); jest.useRealTimers(); }
});

test.each(['departure', 'end', 'indoor'])('a %s row without an address shows its coordinates on screen and in the PNG', async type => {
  const node = { ...house, type, label: '結束', durationMs: house.end };
  const lookup = { lookup: () => null, subscribe: () => () => {} };
  let renderer;
  await act(async () => { renderer = Renderer.create(<AddressLookupContext.Provider value={lookup}>
    <HistoryTimelineList model={{ nodes: [node] }} color={colors.route1} />
  </AddressLookupContext.Provider>); });
  const title = renderer.root.findAll(item => typeof item.type === 'string' && item.props.testID === 'place-title')[0];
  expect([title.props.children].flat().join('')).toBe('24.9378, 121.2954');
  expect(exportTimelineRows([node], () => null)[0].title).toBe('24.9378, 121.2954');
  await act(async () => renderer.unmount());
});
