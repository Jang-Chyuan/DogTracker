import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import * as models from '../src/history/screen/HistoryMultiModel';

const MINUTE = 60000;
let tree;
let opening = 0;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(FIXTURE_NOW); });
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function open(name = 'history-my-route', options = {}) {
  const fixture = buildFixture(name);
  const state = { screen: null };
  const memoryScope = `idle:${name}:${++opening}:`;
  const target = historyTargetOf(fixture.history.preferences);
  function Probe() {
    state.screen = useHistoryScreen({ target, read: fixture.history.readDay,
      readDays: fixture.history.readDays, owner: fixture.cloudSync.ownerId,
      memoryScope, ...options });
    return null;
  }
  await act(async () => { tree = Renderer.create(<Probe />); });
  return state;
}

test.each(['past', 'fixed'])('%s history keeps its day model across unchanged minute ticks', async mode => {
  const build = jest.spyOn(models, 'multiDayModel');
  const s = await open('history-calendar');
  if (mode === 'past') {
    await act(async () => s.screen.goTo('2026-09-29'));
    expect(s.screen.today).toBe(false);
  } else {
    const points = s.screen.dayPoints;
    await act(async () => s.screen.commitRange({ start: points[0].time,
      end: points.at(-1).time, following: false }));
    expect(s.screen.manual).toBe(true);
  }
  const model = s.screen.dayModel;
  const map = s.screen.map;
  const calls = build.mock.calls.length;
  const now = s.screen.now;
  for (let i = 0; i < 2; i += 1)
    await act(async () => jest.advanceTimersByTimeAsync(MINUTE));
  expect(s.screen.now).toBe(now + 2 * MINUTE);
  expect(build.mock.calls.length - calls).toBe(0);
  expect(s.screen.dayModel).toBe(model);
  expect(s.screen.map).toBe(map);
});

test('following today still ages end labels and expands the range track every minute', async () => {
  const build = jest.spyOn(models, 'multiDayModel');
  const s = await open();
  const before = s.screen.dayModel;
  const end = s.screen.track.end;
  expect(s.screen.following).toBe(true);
  build.mockClear();
  await act(async () => jest.advanceTimersByTimeAsync(MINUTE));
  expect(build).toHaveBeenCalled();
  expect(s.screen.dayModel).not.toBe(before);
  expect(s.screen.track.end).toBeGreaterThan(end);
});

test('a fixed range still rebuilds when a poll adds a row outside it', async () => {
  const fixture = buildFixture('history-my-route');
  let extra = [];
  const read = async request => {
    const answer = await fixture.history.readDay(request);
    const rows = [...answer.rows, ...extra];
    extra = [];
    return { ...answer, rows };
  };
  const s = await open('history-my-route', { read });
  const points = s.screen.dayPoints;
  await act(async () => s.screen.commitRange({ start: points[0].time,
    end: points.at(-2).time, following: false }));
  const before = s.screen.dayModel;
  const range = s.screen.range;
  const last = before.main.packets.at(-1);
  extra = [{ ...last, id: 999999, time: FIXTURE_NOW, packetTime: FIXTURE_NOW,
    locationTime: FIXTURE_NOW, latitude: last.latitude + 0.001 }];
  await act(async () => jest.advanceTimersByTimeAsync(15000));
  expect(s.screen.dayModel).not.toBe(before);
  expect(s.screen.dayPoints.at(-1).time).toBe(FIXTURE_NOW);
  expect(s.screen.range).toEqual(range);
});

test('a stopped automatic phone range still ages departure confirmation', async () => {
  const build = jest.spyOn(models, 'multiDayModel');
  const s = await open('history-my-route', { recording: false,
    recordingStoppedAt: FIXTURE_NOW - MINUTE });
  expect(s.screen.following).toBe(false);
  expect(s.screen.manual).toBe(false);
  build.mockClear();
  await act(async () => jest.advanceTimersByTimeAsync(MINUTE));
  expect(build).toHaveBeenCalled();
  expect(s.screen.model.nodes.at(-1).closedAt).toBe(FIXTURE_NOW - MINUTE);
});

test('midnight retains the viewed day, updates today identity, then stops aging that past model', async () => {
  const build = jest.spyOn(models, 'multiDayModel');
  const s = await open();
  const day = s.screen.day;
  jest.setSystemTime(s.screen.dayEnd - 30000);
  await act(async () => jest.advanceTimersByTimeAsync(MINUTE));
  expect(s.screen.day).toBe(day);
  expect(s.screen.today).toBe(false);
  expect(s.screen.todayKey).not.toBe(s.screen.dayKey);
  const model = s.screen.dayModel;
  build.mockClear();
  await act(async () => jest.advanceTimersByTimeAsync(MINUTE));
  expect(build).not.toHaveBeenCalled();
  expect(s.screen.dayModel).toBe(model);
});
