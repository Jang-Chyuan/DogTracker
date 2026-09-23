import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useDefaultLocationRecording } from '../src/locationTracker/useDefaultLocationRecording';
import { locationTrackerNative } from '../src/locationTracker/LocationTrackerService';

jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: { resumeIfEnabled: jest.fn() },
}));

function Harness({ foreground = true, permission = 'precise', services = true, busy = false }) {
  useDefaultLocationRecording(foreground, { permission, services, busy });
  return null;
}

test('only attempts native resume after foreground precise permission and GPS readiness', async () => {
  locationTrackerNative.resumeIfEnabled.mockReset().mockResolvedValue(true);
  let renderer;
  await act(async () => { renderer = Renderer.create(<Harness permission="checking" />); });
  await act(async () => renderer.update(<Harness permission="approximate" />));
  await act(async () => renderer.update(<Harness services={false} />));
  await act(async () => renderer.update(<Harness busy />));
  await act(async () => renderer.update(<Harness foreground={false} />));
  expect(locationTrackerNative.resumeIfEnabled).not.toHaveBeenCalled();
  await act(async () => renderer.update(<Harness />));
  expect(locationTrackerNative.resumeIfEnabled).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(<Harness />));
  expect(locationTrackerNative.resumeIfEnabled).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

test('native opt-out is respected and resume failure does not create a retry loop', async () => {
  locationTrackerNative.resumeIfEnabled.mockReset().mockResolvedValue(false);
  let renderer;
  await act(async () => { renderer = Renderer.create(<Harness />); });
  await act(async () => renderer.update(<Harness foreground={false} />));
  locationTrackerNative.resumeIfEnabled.mockRejectedValueOnce(new Error('not resumed'));
  await act(async () => renderer.update(<Harness />));
  await act(async () => renderer.update(<Harness />));
  expect(locationTrackerNative.resumeIfEnabled).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
});
