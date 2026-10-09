import { t } from '../i18n';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { radius, space, type, touch, border, size as sizes } from '../theme/tokens';
import { GuideProgress } from '../onboarding/GuideUI';

// What a failed sign-in says (D1): wrong account details under the fields
// (c274), no network (c275) with 「重試」; anything else is its own message.
export function signInErrorText(failure) {
  const message = String(failure?.message || '');
  if (/network|fetch|timed? ?out|connection/i.test(message))
    return t('c275');
  if (
    failure?.status === 400 ||
    /invalid (login )?credentials|invalid_grant|email not confirmed/i.test(
      message,
    )
  ) {
    return t('c274');
  }
  return message || t("c901");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
export default function LoginScreen({
  step = null,
  expired = false,
  onDone,
  onLater,
  onLayout,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
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
    const onShow = Keyboard.addListener('keyboardDidShow', event =>
      setKeyboard(event?.endCoordinates?.height || 0),
    );
    const onHide = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboard(0),
    );
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);
  const locked = useRef(false),
    mounted = useRef(false),
    left = useRef(false);
  const cancel = useRef(auth.cancelSignIn);
  cancel.current = auth.cancelSignIn;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Closed some other way (the back key) during a sign-in: it is
      // dropped like 「稍後再說」, and its late answer leads nowhere.
      if (locked.current && !left.current) {
        left.current = true;
        cancel.current?.();
      }
    };
  }, []);
  // Signed in some other way meanwhile (a slow restore finishing): nothing
  // left to do here.
  const user = auth.user?.id ?? null;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (user && !left.current) {
      left.current = true;
      done.current?.();
    }
  }, [user]);

  async function login() {
    if (locked.current || !auth.available) return;
    // Checked when 登入 is pressed (design D1), before anything is sent.
    if (email.trim() && password && !EMAIL.test(email.trim())) {
      setError({ text: t("c900"), offline: false });
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(email, password);
      if (mounted.current) setPassword('');
      if (mounted.current && !left.current) {
        left.current = true;
        done.current?.();
      }
    } catch (failure) {
      if (mounted.current && !failure?.cancelled) {
        const text = signInErrorText(failure);
        setError({ text, offline: text === t('c275') });
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
  const field = name => [
    styles.field,
    focused === name && styles.fieldFocused,
    fieldError && styles.fieldError,
    disabled && styles.disabled,
  ];

  return (
    <View
      testID="sign-in-page"
      style={[styles.page, keyboard > 0 && { paddingBottom: keyboard }]}
      onLayout={onLayout}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <GuideProgress step={step} />
        <Text accessibilityRole="header" style={styles.title}>{t('c001')}</Text>
        {expired ? (
          <Text accessibilityRole="alert" style={styles.expired}>{t('c276')}</Text>
        ) : null}
        <Text style={styles.body}>{t('c002')}</Text>
        <TextInput
          cursorColor={colors.accent}
          selectionColor={`${colors.accent}66`}
          selectionHandleColor={colors.accent}
          accessibilityLabel={t('c003')}
          placeholder={t('c003')}
          placeholderTextColor={colors.textMuted}
          style={[...field('email'), styles.input]}
          value={email}
          onChangeText={setEmail}
          onFocus={() => setFocused('email')}
          onBlur={() => setFocused(null)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          editable={!disabled}
          returnKeyType="next"
        />
        <View style={[...field('password'), styles.passwordRow]}>
          <TextInput
            cursorColor={colors.accent}
            selectionColor={`${colors.accent}66`}
            selectionHandleColor={colors.accent}
            accessibilityLabel={t('c004')}
            placeholder={t('c004')}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.passwordInput]}
            value={password}
            onChangeText={setPassword}
            onFocus={() => setFocused('password')}
            onBlur={() => setFocused(null)}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!shown}
            autoComplete="current-password"
            textContentType="password"
            editable={!disabled}
            returnKeyType="go"
            onSubmitEditing={login}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? t("c897") : t("c898")}
            onPress={() => setShown(value => !value)}
            style={({ pressed }) => [styles.show, pressed && styles.pressed]}
            hitSlop={space.xs}
          >
            <Text style={styles.showText}>{shown ? t("c896") : t('c005')}</Text>
          </Pressable>
        </View>
        {message ? (
          <View style={styles.errorRow}>
            <Text
              testID="sign-in-error"
              accessibilityLiveRegion="polite"
              style={styles.error}
            >
              {message}
            </Text>
            {error?.offline ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('c049')}
                onPress={login}
                disabled={busy}
                hitSlop={space.m}
                style={({ pressed }) => [
                  styles.retry,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.retryText}>{t('c049')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.bottom}>
        {/* D1: the fields are checked when 登入 is pressed, not by greying it out. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('c006')}
          accessibilityState={{ disabled, busy }}
          disabled={disabled}
          onPress={login}
          style={({ pressed }) => [
            styles.primary,
            disabled && !busy && styles.disabled,
            pressed && styles.pressedButton,
          ]}
        >
          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator
                color={colors.tonalText}
                accessibilityLabel={t("c899")}
              />
              <Text style={[styles.primaryText, styles.busyText]}>{t('c006')}</Text>
            </View>
          ) : (
            <Text style={styles.primaryText}>{t('c006')}</Text>
          )}
        </Pressable>
        {onLater ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('c007')}
            onPress={later}
            style={({ pressed }) => [styles.later, pressed && styles.pressed]}
          >
            <Text style={styles.laterText}>{t('c007')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors, opacity } = theme;
  return StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: theme.isDark ? colors.bg : colors.surface,
    },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: space.xl,
      paddingTop: space.l,
      paddingBottom: space.l,
    },
    title: { ...type.headline, color: colors.text, marginBottom: space.s },
    expired: { ...type.status, color: colors.crit, marginBottom: space.s },
    body: { ...type.body, color: colors.textMuted, marginBottom: space.xl },
    // DESIGN.md 文字輸入欄: 56dp, radius 12, 1.5dp line; focused 2dp accent;
    // an error 2dp critLine.
    field: {
      minHeight: sizes.input.height,
      borderRadius: radius.input,
      borderWidth: border.regular,
      borderColor: colors.floatingOutline,
      paddingHorizontal: space.l,
      marginBottom: space.m,
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    fieldFocused: { borderWidth: border.strong, borderColor: colors.accent },
    fieldError: { borderWidth: border.strong, borderColor: colors.critLine },
    input: { ...type.body, color: colors.text },
    passwordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: 0,
    },
    passwordInput: { flex: 1, padding: 0, minHeight: sizes.login.passwordHeight },
    show: {
      minWidth: touch.min,
      minHeight: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s,
    },
    showText: { ...type.caption, color: colors.textMuted },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: -space.xs,
    },
    error: { ...type.caption, color: colors.crit, flexShrink: 1 },
    retry: { marginLeft: space.m, minHeight: sizes.login.retryHeight, justifyContent: 'center' },
    retryText: { ...type.captionBold, color: colors.tonalText },
    // Pinned to the bottom: 登入 (56dp tonal pill) and 「稍後再說」 (48dp text).
    bottom: {
      paddingHorizontal: space.xl,
      paddingTop: space.s,
      paddingBottom: space.l,
    },
    primary: {
      minHeight: touch.primary,
      borderRadius: radius.button,
      backgroundColor: colors.tonal,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { ...type.status, color: colors.tonalText },
    busy: { flexDirection: 'row', alignItems: 'center' },
    busyText: { marginLeft: space.s },
    later: {
      minHeight: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.xs,
    },
    laterText: { ...type.status, color: colors.tonalText },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: 0.6 },
    pressedButton: { transform: [{ scale: 0.97 }] },
  });
});
