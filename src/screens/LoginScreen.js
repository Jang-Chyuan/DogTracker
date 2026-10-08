import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { colors, opacity, radius, space, type } from '../theme/tokens';

// What a failed sign-in says (D1): wrong account details under the fields
// (c274), no network (c275) with 「重試」; anything else is its own message.
export function signInErrorText(failure) {
  const message = String(failure?.message || '');
  if (/network|fetch|timed? ?out|connection/i.test(message)) return '連不上網路';
  if (failure?.status === 400 || /invalid (login )?credentials|invalid_grant|email not confirmed/i.test(message)) {
    return '電子郵件或密碼不對';
  }
  return message || '登入失敗，請稍後重試';
}

// The first-launch guide's steps: D1 登入, D2 權限, D3 接收器, D4 完成.
const GUIDE_STEPS = 4;

/**
 * D1 登入 Supabase 帳號, a page of its own. Signing in is optional: 「稍後
 * 再說」 can always be pressed, and pressed during a sign-in it cancels that
 * sign-in (its late result is not taken). Render inside AuthProvider.
 *
 * `step` (1–4) draws the first-launch guide's progress bar (only on the
 * first launch); `expired` adds 「需要重新登入」 (登入失效, c276); `onDone`
 * runs once signed in, `onLater` for 「稍後再說」. The buttons stay at the
 * bottom (above the keyboard when it is open).
 */
export default function LoginScreen({ step = null, expired = false, onDone, onLater, onLayout }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [focused, setFocused] = useState(null);
  // The keyboard's height: the buttons ride on top of it (the window is
  // drawn edge to edge, so it does not shrink for the keyboard).
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const onShow = Keyboard.addListener('keyboardDidShow', event => setKeyboard(event?.endCoordinates?.height || 0));
    const onHide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);
  const locked = useRef(false), mounted = useRef(false), left = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Signed in some other way meanwhile (a slow restore finishing): nothing
  // left to do here.
  const user = auth.user?.id ?? null;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (user && !left.current) { left.current = true; done.current?.(); }
  }, [user]);

  async function login() {
    if (locked.current || !auth.available) return;
    locked.current = true;
    setBusy(true); setError(null);
    try {
      await auth.signIn(email, password);
      if (mounted.current) setPassword('');
      if (!left.current) { left.current = true; done.current?.(); }
    } catch (failure) {
      if (mounted.current && !failure?.cancelled) {
        const text = signInErrorText(failure);
        setError({ text, offline: text === '連不上網路' });
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function later() {
    if (left.current) return;
    left.current = true;
    // A sign-in on its way is dropped (design D1).
    if (busy) auth.cancelSignIn?.();
    onLater?.();
  }
  const disabled = busy || !auth.available;
  const message = error?.text || (!auth.available ? auth.error : '');
  const fieldError = !!error && !error.offline;
  const field = name => [styles.field, focused === name && styles.fieldFocused, fieldError && styles.fieldError,
    disabled && styles.disabled];

  return (
    <View testID="sign-in-page" style={[styles.page, keyboard > 0 && { paddingBottom: keyboard }]}
      onLayout={onLayout}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {step ? (
          <View testID="guide-progress" style={styles.progress} accessible
            accessibilityLabel={`第 ${step} 步，共 ${GUIDE_STEPS} 步`}>
            {Array.from({ length: GUIDE_STEPS }, (_, index) => (
              <View key={index} style={[styles.segment, index < step && styles.segmentOn]} />
            ))}
          </View>
        ) : <View style={styles.noProgress} />}
        <Text accessibilityRole="header" style={styles.title}>登入 Supabase 帳號</Text>
        {expired ? <Text accessibilityRole="alert" style={styles.expired}>需要重新登入</Text> : null}
        <Text style={styles.body}>登入後會把收到的位置上傳，也能看到隊友的狗。不登入也可以用，只顯示這支手機連到的接收器。</Text>
        <TextInput accessibilityLabel="電子郵件" placeholder="電子郵件" placeholderTextColor={colors.textMuted}
          style={[...field('email'), styles.input]} value={email} onChangeText={setEmail}
          onFocus={() => setFocused('email')} onBlur={() => setFocused(null)}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email"
          textContentType="emailAddress" editable={!disabled} returnKeyType="next" />
        <View style={[...field('password'), styles.passwordRow]}>
          <TextInput accessibilityLabel="密碼" placeholder="密碼" placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.passwordInput]} value={password} onChangeText={setPassword}
            onFocus={() => setFocused('password')} onBlur={() => setFocused(null)}
            autoCapitalize="none" autoCorrect={false} secureTextEntry={!shown} autoComplete="current-password"
            textContentType="password" editable={!disabled} returnKeyType="go" onSubmitEditing={login} />
          <Pressable accessibilityRole="button" accessibilityLabel={shown ? '隱藏密碼' : '顯示密碼'}
            onPress={() => setShown(value => !value)} style={styles.show} hitSlop={4}>
            <Text style={styles.showText}>{shown ? '隱藏' : '顯示'}</Text>
          </Pressable>
        </View>
        {message ? (
          <View style={styles.errorRow}>
            <Text testID="sign-in-error" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>
            {error?.offline ? (
              <Pressable accessibilityRole="button" accessibilityLabel="重試" onPress={login} disabled={busy}
                hitSlop={12} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
                <Text style={styles.retryText}>重試</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.bottom}>
        {/* D1: the fields are checked when 登入 is pressed, not by greying it out. */}
        <Pressable accessibilityRole="button" accessibilityLabel="登入" accessibilityState={{ disabled, busy }}
          disabled={disabled} onPress={login}
          style={({ pressed }) => [styles.primary, disabled && !busy && styles.disabled, pressed && styles.pressedButton]}>
          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={colors.tonalText} accessibilityLabel="登入中" />
              <Text style={[styles.primaryText, styles.busyText]}>登入</Text>
            </View>
          ) : <Text style={styles.primaryText}>登入</Text>}
        </Pressable>
        {onLater ? (
          <Pressable accessibilityRole="button" accessibilityLabel="稍後再說" onPress={later}
            style={({ pressed }) => [styles.later, pressed && styles.pressed]}>
            <Text style={styles.laterText}>稍後再說</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.l, paddingBottom: space.l },
  // The guide's progress: four 4dp bars, the steps done in accent.
  progress: { flexDirection: 'row', gap: space.xs, marginBottom: space.xl },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  segmentOn: { backgroundColor: colors.accent },
  noProgress: { height: space.s },
  title: { ...type.headline, color: colors.text, marginBottom: space.s },
  expired: { ...type.status, color: colors.crit, marginBottom: space.s },
  body: { ...type.body, color: colors.textMuted, marginBottom: space.xl },
  // DESIGN.md 文字輸入欄: 56dp, radius 12, 1.5dp line; focused 2dp accent;
  // an error 2dp critLine.
  field: { minHeight: 56, borderRadius: radius.input, borderWidth: 1.5, borderColor: colors.line,
    paddingHorizontal: space.l, marginBottom: space.m, justifyContent: 'center', backgroundColor: colors.surface },
  fieldFocused: { borderWidth: 2, borderColor: colors.accent },
  fieldError: { borderWidth: 2, borderColor: colors.critLine },
  input: { ...type.body, color: colors.text },
  passwordRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 0 },
  passwordInput: { flex: 1, padding: 0, minHeight: 52 },
  show: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.s },
  showText: { ...type.caption, color: colors.textMuted },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: -space.xs },
  error: { ...type.caption, color: colors.crit, flexShrink: 1 },
  retry: { marginLeft: space.m, minHeight: 32, justifyContent: 'center' },
  retryText: { ...type.captionBold, color: colors.tonalText },
  // Pinned to the bottom: 登入 (56dp tonal pill) and 「稍後再說」 (48dp text).
  bottom: { paddingHorizontal: space.xl, paddingTop: space.s, paddingBottom: space.l },
  primary: { minHeight: 56, borderRadius: radius.button, backgroundColor: colors.tonal,
    alignItems: 'center', justifyContent: 'center' },
  primaryText: { ...type.status, color: colors.tonalText },
  busy: { flexDirection: 'row', alignItems: 'center' },
  busyText: { marginLeft: space.s },
  later: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: space.xs },
  laterText: { ...type.status, color: colors.tonalText },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: 0.6 },
  pressedButton: { transform: [{ scale: 0.97 }] },
});
