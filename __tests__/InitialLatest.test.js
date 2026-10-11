import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useInitialLatest, INITIAL_LATEST_WAIT_MS } from '../src/app/useInitialLatest';
import { launchScreen } from '../src/app/Launch';
import { resetSplashGate, getSplashState, reportMapFramed, launchInto,
  awaitInitialLink, initialLinkRead, giveUpWaiting, proceedInitialLatest, finishSplash } from '../src/app/hideSplash';
let renderer, value, props;
function Probe(input) { value = useInitialLatest(input); return null; }
const accepted = publication => ({ loaded: true, rows: [], cloudCommit: 1,
  cloudPublication: { owner: publication.owner, scope: publication.scope, generation: publication.generation, revision: 1 } });
async function update(changes = {}) {
  props = { ...props, ...changes };
  await act(async () => { if (renderer) renderer.update(<Probe {...props} />); else renderer = Renderer.create(<Probe {...props} />); });
}
beforeEach(() => {
  jest.useFakeTimers(); resetSplashGate();
  const publication = { owner: 'a', scope: {}, generation: 1, mapSuccessRevision: 0, pending: true };
  props = { screen: 'map', owner: 'a', sync: { getMapPublication: () => publication }, dogs: { cloudCommit: null } };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = null; resetSplashGate(); jest.useRealTimers(); });

test('framed Google map cannot reveal an unpublished initial snapshot; fresh empty acceptance still needs map framing', async () => {
  await update();
  await act(async () => { launchInto('map'); reportMapFramed([]); });
  expect(getSplashState().phase).toBe('waiting');
  const publication = { ...props.sync.getMapPublication(), mapSuccessRevision: 1, pending: false };
  // Native DB publish occurred, but atomic rows/holds reader has not accepted.
  await update({ sync: { getMapPublication: () => publication } });
  expect(value.ready).toBe(false);
  expect(getSplashState().phase).toBe('waiting');
  await update({ dogs: accepted(publication) });
  expect(getSplashState().phase).toBe('handover');
  resetSplashGate(); await update();
  await act(async () => launchInto('map'));
  expect(value.ready).toBe(true);
  expect(getSplashState().phase).toBe('waiting');
  await act(async () => reportMapFramed([]));
  expect(getSplashState().phase).toBe('handover');
});

test('fresh snapshot does not skip pending initial link or local launch requirements and does not wait for archive', async () => {
  expect(launchScreen({ databaseReady: false, preferencesSettled: true, authSettled: true })).toBe('splash');
  const publication = { ...props.sync.getMapPublication(), mapSuccessRevision: 1 };
  await act(async () => awaitInitialLink());
  await update({ sync: { getMapPublication: () => publication, archivePending: true, contextPending: true }, dogs: accepted(publication) });
  await act(async () => { launchInto('map'); reportMapFramed([]); });
  expect(getSplashState().phase).toBe('waiting');
  await act(async () => initialLinkRead());
  expect(getSplashState().phase).toBe('handover');
});

test('accepted first publication stays satisfied during the next busy tick before framing', async () => {
  const publication = { ...props.sync.getMapPublication(), mapSuccessRevision: 1 };
  await update({ sync: { getMapPublication: () => publication }, dogs: accepted(publication) });
  await update({ sync: { getMapPublication: () => ({ ...publication, pending: true, attempt: 2 }), snapshotPending: true }, dogs: { cloudCommit: null } });
  expect(value.ready).toBe(true);
  await act(async () => { launchInto('map'); reportMapFramed([]); });
  expect(getSplashState().phase).toBe('handover');
});

test.each(['owner', 'scope', 'generation'])('old acceptance with reused revision cannot release changed %s', async field => {
  const old = { ...props.sync.getMapPublication(), mapSuccessRevision: 1 };
  await update({ sync: { getMapPublication: () => old }, dogs: accepted(old) });
  const next = { ...old, [field]: field === 'owner' ? 'b' : field === 'scope' ? {} : 2 };
  await update({ owner: next.owner, sync: { getMapPublication: () => next } });
  expect(value.ready).toBe(false);
  await act(async () => { launchInto('map'); reportMapFramed([]); });
  expect(getSplashState().phase).toBe('waiting');
});

test('10s and 30s expose explicit fallback without claiming success; action retains the map-frame requirement', async () => {
  await update();
  await act(async () => launchInto('map'));
  await act(async () => jest.advanceTimersByTime(INITIAL_LATEST_WAIT_MS));
  expect(value.phase).toBe('fallback'); expect(value.ready).toBe(false);
  await act(async () => { jest.advanceTimersByTime(20000); giveUpWaiting(); });
  expect(getSplashState().phase).toBe('waiting');
  await act(async () => proceedInitialLatest(value.frameScope));
  expect(value.ready).toBe(true); expect(getSplashState().phase).toBe('waiting');
  expect(props.sync.getMapPublication().mapSuccessRevision).toBe(0);
  await act(async () => reportMapFramed([]));
  expect(getSplashState().phase).toBe('handover');
});

test('failure makes a safe action available, but old-account and unmounted actions cannot release a new launch', async () => {
  await update({ sync: { ...props.sync, error: 'opaque' } });
  const oldScope = value.frameScope;
  expect(value.phase).toBe('fallback');
  const next = { owner: 'b', scope: {}, generation: 1, mapSuccessRevision: 0 };
  await update({ owner: 'b', sync: { getMapPublication: () => next } });
  await act(async () => proceedInitialLatest(oldScope));
  expect(value.ready).toBe(false);
  await update({ sync: { getMapPublication: () => next, error: 'opaque' } });
  const scope = value.frameScope;
  await act(async () => renderer.unmount()); renderer = null;
  await act(async () => proceedInitialLatest(scope));
  expect(getSplashState().latest.phase).toBe('fallback');
});

test.each([{ owner: null }, { expired: true }, { fixture: true }, { pageLaunch: true }, { enabled: false }, { supported: false },
  { screen: 'onboarding' }, { screen: 'failed' }, { sync: { enabled: false } }, { sync: { supported: false } }])('local or disabled launch bypasses cloud %j', async changes => {
  await update(changes);
  expect(value.ready).toBe(true);
  expect(getSplashState().latest).toBeUndefined();
  await act(async () => giveUpWaiting());
  expect(getSplashState().phase).toBe('handover');
});

test('engine stop invalidates a not-yet-framed success; completed launch never resplashes on resume', async () => {
  const publication = { ...props.sync.getMapPublication(), mapSuccessRevision: 1 };
  await update({ sync: { getMapPublication: () => publication }, dogs: accepted(publication) });
  await update({ sync: { getMapPublication: () => null } });
  expect(value.ready).toBe(false);
  await act(async () => { launchInto('page'); finishSplash(); });
  await update({ owner: 'b', sync: { getMapPublication: () => null } });
  expect(value.ready).toBe(true); expect(getSplashState().phase).toBe('done');
});
