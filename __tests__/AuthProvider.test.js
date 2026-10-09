import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import LoginScreen from '../src/screens/LoginScreen';
import { TextInput } from 'react-native';

function fixture() {
  let notify;
  const unsubscribe = jest.fn();
  const auth = {
    onAuthStateChange: callback => { notify = callback; return { data: { subscription: { unsubscribe } } }; },
    getSession: jest.fn(async () => ({ data: { session: null } })),
    signInWithPassword: jest.fn(async () => ({ data: { session: { user: { id: 'a' } } } })),
    signOut: jest.fn(async () => ({ error: null })),
  };
  return { auth, factory: () => ({ auth }), notify: session => notify('SIGNED_OUT', session), unsubscribe };
}

test('a delayed stored session cannot override logout and subscription is cleaned up', async () => {
  const f = fixture(); let restore, value;
  f.auth.getSession.mockReturnValue(new Promise(resolve => { restore = resolve; }));
  function Probe() { value = useAuth(); return null; }
  let renderer;
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}><Probe /></AuthProvider>); });
  expect(value.loading).toBe(true);
  // Supabase removed the saved session while restoring (refused): 登入失效
  // found at the start (D1 「需要重新登入」).
  await act(async () => f.notify(null));
  await act(async () => restore({ data: { session: { user: { id: 'old' } } } }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(value.user).toBeNull(); expect(value.loading).toBe(false);
  expect(value.expiredAtStart).toBe(true);
  await value.signOut();
  expect(f.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  await act(async () => renderer.unmount());
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});

test('login submits trimmed email and unchanged password, clears password on success', async () => {
  const f = fixture(), done = jest.fn(); let renderer;
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}><LoginScreen onDone={done} /></AuthProvider>); });
  const inputs = renderer.root.findAllByType(TextInput);
  await act(async () => {
    inputs[0].props.onChangeText(' user@example.com ');
    inputs[1].props.onChangeText(' password ');
  });
  await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === '登入'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(f.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'user@example.com', password: ' password ' });
  expect(done).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByType(TextInput)[1].props.value).toBe('');
  await act(async () => renderer.unmount());
});

// ---- the start (052): restore timeout, no network, 登入失效 at the start ----
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
function AuthProbe({ onValue }) { onValue(useAuth()); return null; }

test('the restore past 10 s lets the app open; it keeps waiting and a later session is taken', async () => {
  jest.useFakeTimers();
  const f = fixture(); let value, restore, renderer;
  f.auth.getSession.mockReturnValue(new Promise(resolve => { restore = resolve; }));
  try {
    await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}>
      <AuthProbe onValue={next => { value = next; }} /></AuthProvider>); });
    await act(async () => jest.advanceTimersByTime(9900));
    expect(value.loading).toBe(true);
    await act(async () => jest.advanceTimersByTime(100));
    // Opened signed out for now; S3 「暫時連不上，會自動重試」.
    expect(value.loading).toBe(false);
    expect(value.timedOut).toBe(true);
    expect(value.restoring).toBe(true);
    expect(value.expiredAtStart).toBe(false);
    // The saved sign-in comes back (Supabase reached later).
    await act(async () => restore({ data: { session: { user: { id: 'a' } } } }));
    await act(async () => jest.advanceTimersByTime(1));
    expect(value.user).toEqual({ id: 'a' });
    expect(value.restoring).toBe(false);
  } finally {
    await act(async () => renderer.unmount());
    jest.useRealTimers();
  }
});

test('no network at the restore: the saved sign-in waits (restoring); a refusal later is 登入失效 in use', async () => {
  let notify;
  const f = fixture();
  f.auth.onAuthStateChange = callback => { notify = callback; return { data: { subscription: { unsubscribe: jest.fn() } } }; };
  f.auth.getSession.mockResolvedValue({ data: { session: null },
    error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 } });
  let value, renderer;
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}>
    <AuthProbe onValue={next => { value = next; }} /></AuthProvider>); });
  await act(async () => notify('INITIAL_SESSION', null));
  await settle();
  expect(value.loading).toBe(false);
  expect(value.restoring).toBe(true);
  expect(value.expired).toBe(false);
  // Reached later and refused: in use now (S3, the gear), not D1.
  await act(async () => notify('SIGNED_OUT', null));
  expect(value.restoring).toBe(false);
  expect(value.expired).toBe(true);
  expect(value.expiredAtStart).toBe(false);
  await act(async () => renderer.unmount());
});

test('nothing saved: the restore ends signed out, neither restoring nor expired', async () => {
  const f = fixture(); let value, renderer;
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}>
    <AuthProbe onValue={next => { value = next; }} /></AuthProvider>); });
  await settle();
  expect(value).toMatchObject({ loading: false, user: null, restoring: false, expired: false, expiredAtStart: false });
  await act(async () => renderer.unmount());
});

test('「稍後再說」 during a sign-in cancels it: the late session is not taken and is signed out', async () => {
  let notify, finish;
  const f = fixture();
  f.auth.onAuthStateChange = callback => { notify = callback; return { data: { subscription: { unsubscribe: jest.fn() } } }; };
  f.auth.signInWithPassword.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  f.auth.signOut.mockImplementation(async () => { notify('SIGNED_OUT', null); return { error: null }; });
  const later = jest.fn(), done = jest.fn();
  let value, renderer;
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}>
    <AuthProbe onValue={next => { value = next; }} />
    <LoginScreen onDone={done} onLater={later} />
  </AuthProvider>); });
  await settle();
  const inputs = renderer.root.findAllByType(TextInput);
  await act(async () => {
    inputs[0].props.onChangeText('user@example.com');
    inputs[1].props.onChangeText('test-only-password');
  });
  const button = label => renderer.root.findAll(node => node.props.accessibilityLabel === label
    && node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0];
  await act(async () => { button('登入').props.onPress(); });
  expect(JSON.stringify(renderer.toJSON())).toContain('登入中');
  // 「稍後再說」 can always be pressed.
  await act(async () => button('稍後再說').props.onPress());
  expect(later).toHaveBeenCalledTimes(1);
  // Supabase signs in anyway: its event and its answer are not taken.
  const session = { user: { id: 'late' } };
  await act(async () => {
    expect(value.isDiscarded(session)).toBe(true);
    notify('SIGNED_IN', session);
    finish({ data: { session }, error: null });
  });
  await settle();
  expect(value.user).toBeNull();
  expect(done).not.toHaveBeenCalled();
  expect(f.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  // Signing that one out is not 登入失效.
  expect(value.expired).toBe(false);
  expect(value.isDiscarded(session)).toBe(false);
  await act(async () => renderer.unmount());
});

test('a second sign-in waiting for a cancelled one can be cancelled too and never reaches Supabase', async () => {
  let finish;
  const f = fixture();
  f.auth.signInWithPassword.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let value, renderer;
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}>
    <AuthProbe onValue={next => { value = next; }} /></AuthProvider>); });
  await settle();
  const first = value.signIn('a@example.com', 'x').catch(failure => failure);
  await act(async () => value.cancelSignIn());
  const second = value.signIn('a@example.com', 'x').catch(failure => failure);
  await act(async () => value.cancelSignIn());
  await act(async () => finish({ data: { session: null }, error: { status: 400, message: 'Invalid login credentials' } }));
  expect((await first).cancelled).toBe(true);
  expect((await second).cancelled).toBe(true);
  expect(f.auth.signInWithPassword).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

test('D1 closed by the back key during a sign-in drops it; its late answer leads nowhere', async () => {
  let finish;
  const f = fixture();
  f.auth.signInWithPassword.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const done = jest.fn();
  let value, renderer;
  function Page({ open }) {
    return <>
      <AuthProbe onValue={next => { value = next; }} />
      {open ? <LoginScreen onDone={done} onLater={() => {}} /> : null}
    </>;
  }
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}><Page open /></AuthProvider>); });
  await settle();
  const inputs = renderer.root.findAllByType(TextInput);
  await act(async () => {
    inputs[0].props.onChangeText('user@example.com');
    inputs[1].props.onChangeText('test-only-password');
  });
  await act(async () => { renderer.root.findAll(node => node.props.accessibilityLabel === '登入'
    && typeof node.props.onPress === 'function')[0].props.onPress(); });
  await act(async () => renderer.update(<AuthProvider clientFactory={f.factory}><Page open={false} /></AuthProvider>));
  await act(async () => finish({ data: { session: { user: { id: 'late' } } }, error: null }));
  await settle();
  expect(done).not.toHaveBeenCalled();
  expect(value.user).toBeNull();
  expect(f.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  await act(async () => renderer.unmount());
});

test('登入 checks the e-mail format before anything is sent', async () => {
  const f = fixture(); let renderer;
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}><LoginScreen /></AuthProvider>); });
  const inputs = renderer.root.findAllByType(TextInput);
  await act(async () => { inputs[0].props.onChangeText('abc'); inputs[1].props.onChangeText('x'); });
  await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === '登入'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('電子郵件格式不對');
  expect(f.auth.signInWithPassword).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});
