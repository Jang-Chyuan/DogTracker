import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
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
  const row = exportTimelineRows([node], () => null)[0];
  const layout = layoutRow(row, defaultMeasure);
  expect(layout.titleLines).toEqual(['24.9378, 121.2954']);
  expect(layout.items.map(item => item.kind)).toEqual(type === 'switch' ? [] : ['pill']);
  expect(layout.secondLines).toBe(type === 'switch' ? 0 : 1);
  const found = placeLines(node, { state: 'found', text: address });
  expect(found).toMatchObject({ title: address, coordinates: missing.title });
  const foundRow = exportTimelineRows([node], () => address)[0];
  expect(foundRow).toMatchObject({ title: address, coordinates: missing.title });
  expect(layoutRow(foundRow, defaultMeasure).items.some(item => item.text === missing.title)).toBe(true);
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
  expect(pages).toContain(address);
  expect(pages).toContain('室內・40 分');
  expect(native.reverseGeocode).toHaveBeenCalledTimes(cardRequests);
  await act(async () => renderer.unmount());
});
