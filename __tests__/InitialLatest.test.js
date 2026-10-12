import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useInitialLatest, INITIAL_LATEST_WAIT_MS } from '../src/app/useInitialLatest';
import { launchScreen } from '../src/app/Launch';
import { resetSplashGate, getSplashState, reportMapFramed, launchInto,
  awaitInitialLink, initialLinkRead, giveUpWaiting, finishSplash } from '../src/app/hideSplash';
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

test('10s automatically releases only latest gate, retaining map/link/local requirements and a map failure until accepted', async () => {
  await update();
  await act(async () => launchInto('map'));
  await act(async () => jest.advanceTimersByTime(INITIAL_LATEST_WAIT_MS - 1));
  expect(value.ready).toBe(false);
  await act(async () => jest.advanceTimersByTime(1));
  expect(value.ready).toBe(true); expect(value.phase).toBe('fallback');
  expect(value.mapFailure).toBe(true);
  expect(props.sync.getMapPublication().mapSuccessRevision).toBe(0);
  await act(async () => { awaitInitialLink(); reportMapFramed([]); });
  expect(getSplashState().phase).toBe('waiting');
  await act(async () => initialLinkRead());
  expect(getSplashState().phase).toBe('handover');
  await act(async () => finishSplash());
  expect(value.mapFailure).toBe(true);
  // A network publication is insufficient: the same atomic map read must accept.
  const publication = { ...props.sync.getMapPublication(), mapSuccessRevision: 1 };
  await update({ sync: { getMapPublication: () => publication }, dogs: { cloudCommit: 1 } });
  expect(value.mapFailure).toBe(true);
  await update({ dogs: accepted(publication) });
  expect(value.mapFailure).toBe(false);
  expect(getSplashState().phase).toBe('done');
});

test('actual failure automatically permits framing but cannot bypass undecided local launch or carry into another account', async () => {
  await update({ sync: { ...props.sync, error: 'opaque' } });
  expect(value.phase).toBe('fallback'); expect(value.ready).toBe(true); expect(value.mapFailure).toBe(true);
  await act(async () => reportMapFramed([]));
  expect(getSplashState().phase).toBe('waiting'); // launchInto still absent
  await act(async () => launchInto('map'));
  expect(getSplashState().phase).toBe('handover');
  await act(async () => finishSplash());
  const next = { owner: 'b', scope: {}, generation: 1, mapSuccessRevision: 0 };
  await update({ owner: 'b', sync: { getMapPublication: () => next } });
  expect(value.mapFailure).toBe(false);
  expect(getSplashState().phase).toBe('done'); // no second cold gate on resume
});

test.each(['scope', 'generation'])('timeout failure is reset on publisher %s replacement and stale acceptance cannot clear its new failure', async field => {
  await update();
  await act(async () => jest.advanceTimersByTime(INITIAL_LATEST_WAIT_MS));
  const old = props.sync.getMapPublication();
  const next = { ...old, [field]: field === 'scope' ? {} : 2 };
  await update({ sync: { getMapPublication: () => next }, dogs: accepted(old) });
  expect(value.ready).toBe(false); expect(value.mapFailure).toBe(false);
  await update({ sync: { getMapPublication: () => next, error: 'opaque' } });
  expect(value.ready).toBe(true); expect(value.mapFailure).toBe(true);
  await update({ sync: { getMapPublication: () => ({ ...next, mapSuccessRevision: 1 }) }, dogs: accepted(old) });
  expect(value.mapFailure).toBe(true);
  await update({ dogs: accepted(next) }); expect(value.mapFailure).toBe(false);
});

test.each([{ owner: null }, { expired: true }, { pageLaunch: true }])('initial failure notice clears when launch becomes ineligible %j', async changes => {
  await update({ sync: { ...props.sync, error: 'opaque' } });
  expect(value.mapFailure).toBe(true);
  await update(changes); expect(value.mapFailure).toBe(false);
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

test('hang safety net still fades a signed-in launch whose map never frames, after latest settles', async () => {
  // Latest fell back (its own 10 s budget); the map never reports framing.
  await update();
  await act(async () => launchInto('map'));
  await act(async () => jest.advanceTimersByTime(INITIAL_LATEST_WAIT_MS));
  expect(value.phase).toBe('fallback');
  expect(getSplashState().phase).toBe('waiting');
  await act(async () => giveUpWaiting());
  expect(getSplashState().phase).toBe('handover');
});

test('hang safety net firing before latest settles waits for latest, then fades without map framing', async () => {
  await update();
  await act(async () => launchInto('map'));
  await act(async () => giveUpWaiting());
  // The added latest condition is not skipped by the original escape.
  expect(getSplashState().phase).toBe('waiting');
  await act(async () => jest.advanceTimersByTime(INITIAL_LATEST_WAIT_MS - 1));
  expect(getSplashState().phase).toBe('waiting');
  // Settling to 'fallback' fades at once (the hook then reports a bypass).
  await act(async () => jest.advanceTimersByTime(1));
  expect(getSplashState().phase).toBe('handover');
  expect(getSplashState().mode).toBe('fade');
});
