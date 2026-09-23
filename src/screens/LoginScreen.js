import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { ActionButton, ui } from '../components/ScreenUI';

// Render inside AuthProvider. The parent chooses navigation after sign-in.
export default function LoginScreen({ onSignedIn }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function login() {
    if (locked.current || auth.loading || !auth.available) return;
    locked.current = true;
    setBusy(true); setError('');
    try {
      const data = await auth.signIn(email, password);
      if (mounted.current) { setPassword(''); onSignedIn?.(data.session); }
    } catch (failure) {
      if (mounted.current) setError(failure.message || '登入失敗，請稍後重試');
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const disabled = busy || auth.loading || !auth.available;
  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={ui.title}>登入 DogTracker</Text>
      <Text style={ui.hint}>使用已獲 Master 授權的帳號登入雲端服務。</Text>
      {auth.loading ? <Text style={ui.hint}>正在恢復登入狀態…</Text> : null}
      {auth.user ? <Text style={ui.text}>已登入：{auth.user.email}</Text> : <>
        <Text style={ui.text}>Email</Text>
        <TextInput accessibilityLabel="Email" style={styles.input} value={email} onChangeText={setEmail}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={!disabled} />
        <Text style={ui.text}>密碼</Text>
        <TextInput accessibilityLabel="密碼" style={styles.input} value={password} onChangeText={setPassword}
          autoCapitalize="none" autoCorrect={false} secureTextEntry autoComplete="current-password"
          editable={!disabled} returnKeyType="go" onSubmitEditing={login} />
        <ActionButton title={busy ? '登入中…' : '登入'} disabled={disabled || !email.trim() || !password} onPress={login} />
      </>}
      {error || auth.error ? <Text accessibilityLiveRegion="polite" style={ui.error}>{error || auth.error}</Text> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  input: { color: '#f8fafc', backgroundColor: '#111827', borderColor: '#374151',
    borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16, minHeight: 48 },
});
