import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import LoginScreen from '../src/screens/LoginScreen';
import { ActionButton } from '../src/components/ScreenUI';
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
  await act(async () => f.notify(null));
  await act(async () => restore({ data: { session: { user: { id: 'old' } } } }));
  expect(value.user).toBeNull(); expect(value.loading).toBe(false);
  await value.signOut();
  expect(f.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  await act(async () => renderer.unmount());
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});

test('login submits trimmed email and unchanged password, clears password on success', async () => {
  const f = fixture(), done = jest.fn(); let renderer;
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}><LoginScreen onSignedIn={done} /></AuthProvider>); });
  const inputs = renderer.root.findAllByType(TextInput);
  await act(async () => {
    inputs[0].props.onChangeText(' user@example.com ');
    inputs[1].props.onChangeText(' password ');
  });
  await act(async () => renderer.root.findByType(ActionButton).props.onPress());
  expect(f.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'user@example.com', password: ' password ' });
  expect(done).toHaveBeenCalledWith({ user: { id: 'a' } });
  expect(renderer.root.findAllByType(TextInput)[1].props.value).toBe('');
  await act(async () => renderer.unmount());
});
