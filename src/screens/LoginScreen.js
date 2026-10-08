import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { colors, opacity, radius, space, type } from '../theme/tokens';

// What a failed sign-in says (D1): wrong account details under the fields,
// no network as its own line; anything else is a plain retry.
export function signInErrorText(failure) {
  const message = String(failure?.message || '');
  if (/network|fetch|timed? ?out|connection/i.test(message)) return '連不上網路';
  if (failure?.status === 400 || /invalid (login )?credentials|invalid_grant|email not confirmed/i.test(message)) {
    return '電子郵件或密碼不對';
  }
  return message || '登入失敗，請稍後重試';
}

/**
 * The sign-in form (D1 登入 Supabase 帳號). Signing in is optional: the app
 * works without it, so the form lives on 設定 → Supabase 帳號 (S3) rather than in
 * front of the map. Render inside AuthProvider; `onLater` is 「稍後再說」;
 * `expired` (登入失效, default AuthProvider's) adds 「需要重新登入」.
 */
export default function LoginScreen({ onSignedIn, onLater, expired: expiredProp }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
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
      if (mounted.current) setError(signInErrorText(failure));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const disabled = busy || auth.loading || !auth.available;
  const message = error || auth.error;
  return <View style={styles.panel}>
    <Text style={styles.title}>登入 Supabase 帳號</Text>
    {(expiredProp ?? auth.expired) ? <Text accessibilityRole="alert" style={styles.expired}>需要重新登入</Text> : null}
    <Text style={styles.body}>登入後會把收到的位置上傳，也能看到隊友的狗。不登入也可以用，只顯示這支手機連到的接收器。</Text>
    <TextInput accessibilityLabel="電子郵件" placeholder="電子郵件" placeholderTextColor={colors.textMuted}
      style={[styles.field, !!error && styles.fieldError, disabled && styles.disabled]}
      value={email} onChangeText={setEmail}
      autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={!disabled} />
    <View style={[styles.field, styles.passwordRow, !!error && styles.fieldError, disabled && styles.disabled]}>
      <TextInput accessibilityLabel="密碼" placeholder="密碼" placeholderTextColor={colors.textMuted}
        style={styles.passwordInput} value={password} onChangeText={setPassword}
        autoCapitalize="none" autoCorrect={false} secureTextEntry={!shown} autoComplete="current-password"
        editable={!disabled} returnKeyType="go" onSubmitEditing={login} />
      <Pressable accessibilityRole="button" accessibilityLabel={shown ? '隱藏密碼' : '顯示密碼'}
        onPress={() => setShown(value => !value)} style={styles.show} hitSlop={4}>
        <Text style={styles.showText}>{shown ? '隱藏' : '顯示'}</Text>
      </Pressable>
    </View>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
    {/* D1: the fields are checked when 登入 is pressed, not by greying it out. */}
    <Pressable accessibilityRole="button" accessibilityLabel="登入" accessibilityState={{ disabled, busy }}
      disabled={disabled} onPress={login}
      style={({ pressed }) => [styles.primary, disabled && !busy && styles.disabled, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={colors.tonalText} accessibilityLabel="登入中" />
        : <Text style={styles.primaryText}>登入</Text>}
    </Pressable>
    {onLater ? <Pressable accessibilityRole="button" accessibilityLabel="稍後再說" onPress={onLater}
      style={({ pressed }) => [styles.later, pressed && styles.pressed]}>
      <Text style={styles.laterText}>稍後再說</Text>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius.card, padding: space.xl, marginBottom: space.l },
  title: { ...type.headline, color: colors.text, marginBottom: space.s },
  expired: { ...type.status, color: colors.crit, marginBottom: space.s },
  body: { ...type.body, color: colors.textMuted, marginBottom: space.xl },
  field: { minHeight: 56, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line,
    paddingHorizontal: space.l, marginBottom: space.l, ...type.body, color: colors.text },
  fieldError: { borderWidth: 2, borderColor: colors.critLine },
  passwordRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 0 },
  passwordInput: { flex: 1, ...type.body, color: colors.text, padding: 0, minHeight: 52 },
  show: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.s },
  showText: { ...type.caption, color: colors.textMuted },
  error: { ...type.caption, color: colors.crit, marginTop: -space.s, marginBottom: space.l },
  primary: { minHeight: 56, borderRadius: radius.button, backgroundColor: colors.tonal,
    alignItems: 'center', justifyContent: 'center', marginTop: space.s },
  primaryText: { ...type.status, color: colors.tonalText },
  later: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: space.s },
  laterText: { ...type.status, color: colors.tonalText },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: 0.75 },
});
