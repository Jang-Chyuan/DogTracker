import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import fs from 'fs';
import path from 'path';
import TrackingMap, {
  createMapProviderDefinition,
} from '../src/map/TrackingMap';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import {
  createTrackingMapPresentation,
  MASTER_RANGE_METERS,
} from '../src/map/TrackingMapPresentation';
import { createLiveRouteWindow } from '../src/tracking/LiveRouteWindow';
import { toRouteSample } from '../src/tracking/RouteSamples';

const source = file =>
  fs.readFileSync(path.join(__dirname, '..', 'src', 'map', file), 'utf8');

const point = (id, changes = {}) => ({
  id,
  receivedAt: id * 1000,
  masterId: 3,
  slaveId: 7,
  masterLat: 25,
  masterLon: 121,
  slaveLat: 25.001 + id / 10000,
  slaveLon: 121.001,
  ...changes,
});

test('composition injects a validated provider and only Google imports its SDK', async () => {
  expect(GOOGLE_MAP_PROVIDER.id).toBe('google');
  expect(source('TrackingMap.js')).not.toContain('react-native-maps');
  expect(source('TrackingMapPresentation.js')).not.toMatch(
    /react-native|MapView|PROVIDER_GOOGLE/,
  );
  expect(source('GoogleTrackingMap.js')).toContain("from 'react-native-maps'");
  expect(source('GoogleTrackingMap.js')).not.toContain(
    'NativeTrackingPlatform',
  );

  const received = jest.fn();
  const FakeRenderer = props => {
    received(props);
    return <Text>fake map</Text>;
  };
  const provider = createMapProviderDefinition({
    id: 'fake',
    Renderer: FakeRenderer,
    isSupported: () => true,
    isConfigured: () => false,
  });
  let rendered;
  await act(async () => {
    rendered = Renderer.create(
      <TrackingMap provider={provider} presentation={{ route: [] }} />,
    );
  });
  expect(rendered.root.findByType(Text).props.children).toBe('fake map');
  expect(received).toHaveBeenLastCalledWith(
    expect.objectContaining({
      presentation: { route: [] },
      supported: true,
      configured: false,
    }),
  );
  await act(async () => rendered.unmount());
});

test('invalid or missing provider definitions fail at the adapter boundary', () => {
  expect(() => createMapProviderDefinition({ id: '', Renderer() {} })).toThrow(
    'id',
  );
  expect(() => createMapProviderDefinition({ id: 'bad' })).toThrow('Renderer');
  expect(() => TrackingMap({})).toThrow('map provider is required');
  expect(() =>
    TrackingMap({ provider: { Renderer() {}, isSupported: () => true } }),
  ).toThrow('invalid map provider definition');
});

test('shared presentation applies fallback and route rules before rendering', () => {
  const oldValid = point(1);
  const routeRows = [point(2), point(3, { masterLat: null, slaveLat: null })];
  const route = createLiveRouteWindow();
  route.append(routeRows);
  const presentation = createTrackingMapPresentation(
    routeRows[1],
    route.snapshot(),
    [toRouteSample(oldValid)],
  );

  expect(presentation.master).toMatchObject({ retained: true });
  expect(presentation.slave).toMatchObject({ retained: true });
  expect(presentation.masterSegments).toEqual([]);
  expect(presentation.slaveSegments).toEqual([]);
  expect(presentation.masterRangeMeters).toBe(MASTER_RANGE_METERS);
});
