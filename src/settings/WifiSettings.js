import { t } from '../i18n';
import { wifiCommand } from './WifiValidation';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { radius, size, space, touch, type, border } from '../theme/tokens';
import ConfirmDialog from './ConfirmDialog';
import {
  GroupCard,
  GroupTitle,
  ListRow,
  getSettingsStyles,
} from './SettingsUI';

/**
 * 設定 → 進階 → 接收器 Wi-Fi (design S7 「接收器 Wi-Fi（顯示／隱藏密碼、刪除
 * 要確認、失敗寫原因＋重試）」): the networks the receiver keeps, the one it
 * uses, and a form that sends one more (or a new password for one). Deleting
 * asks first. `wifi` is useReceiverWifi's answer; `receiver` is 「接收器 7」.
 * The receiver never sends a password back.
 */
export default function WifiSettings({ wifi, receiver = t('c075'), draft = null }) {
  const { colors } = useTheme();
  const settingsStyles = useStyles(getSettingsStyles);
  const styles = useStyles(getStyles);
  const [ssid, setSsid] = useState(draft?.current?.ssid ?? '');
  const [password, setPassword] = useState(draft?.current?.password ?? '');
  const [shown, setShown] = useState(draft?.current?.shown ?? false);
  useEffect(() => { if (draft) draft.current = { ...draft.current, ssid, password, shown }; }, [draft, ssid, password, shown]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState('');
  const [removeBusy, setRemoveBusy] = useState(false);
  const { connected } = wifi;
  // 「接收器 7 存的…」, 「接收器存的…」 when it has no number.
  const of = text =>
    /\d$/.test(receiver) ? `${receiver} ${text}` : `${receiver}${text}`;

  const send = async () => {
    const name = ssid.trim();
    try {
      wifiCommand('upsert', name, password);
    } catch (error) {
      setResult({ ok: false, text: error.message });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      await wifi.save(name, password);
      setPassword('');
      setResult({ ok: true, text: t("c1033", { receiver: receiver }) });
    } catch (error) {
      setResult({
        ok: false,
        text: t("c1034", { value: error?.message || t("c545") }),
        retry: true,
      });
    } finally {
      setSending(false);
    }
  };
  const remove = async () => {
    setRemoveBusy(true);
    setRemoveError('');
    try {
      await wifi.remove(removing);
      if (ssid === removing) {
        setSsid('');
        setPassword('');
      }
      setRemoving(null);
    } catch (error) {
      setRemoveError(t("c989", { value: error?.message || t("c545") }));
    } finally {
      setRemoveBusy(false);
    }
  };

  const ssids = wifi.ssids || [];
  return (
    <ScrollView
      testID="wifi-settings"
      contentOffset={{ x: 0, y: draft?.current?.scrollY ?? 0 }}
      onScroll={event => { if (draft) draft.current = { ...draft.current, scrollY: event.nativeEvent.contentOffset.y }; }}
      scrollEventThrottle={16}
      style={settingsStyles.page}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={settingsStyles.content}
    >
      {!connected && (
        <Text
          testID="wifi-offline"
          style={[styles.note, styles.firstNote]}
          accessibilityLiveRegion="polite"
        >
          {of(t("c1017"))}
        </Text>
      )}
      <GroupTitle>{of(t("c1030"))}</GroupTitle>
      <GroupCard flat>
        {wifi.error ? (
          <ListRow
            testID="wifi-load-error"
            problem
            title={t("c440")}
            detail={wifi.error}
            detailTone="crit"
            action={t('c049')}
            onPress={wifi.reload}
            label={t("c1024", { error: wifi.error })}
          />
        ) : null}
        {!wifi.error && wifi.loading && !wifi.ssids ? (
          <View style={styles.loading}>
            <ActivityIndicator
              color={colors.tonalText}
              accessibilityLabel={t("c835")}
            />
          </View>
        ) : null}
        {!wifi.error && wifi.ssids && ssids.length === 0 ? (
          <ListRow
            testID="wifi-empty"
            title={t("c1028")}
            titleTone="muted"
            label={t("c1028")}
          />
        ) : null}
        {ssids.map(network => (
          <ListRow
            key={network}
            testID={`wifi-${network}`}
            title={network}
            right={network === wifi.activeSsid ? t("c1027") : undefined}
            rightTone={['mutedBold']}
            onPress={() => setSsid(network)}
            label={((network === wifi.activeSsid) ? t("c1025", { network: network }) : t("c1026", { network: network }))}
          >
            <Pressable
              testID={`wifi-delete-${network}`}
              accessibilityRole="button"
              accessibilityLabel={t("c1018", { network: network })}
              disabled={!connected}
              onPress={() => {
                setRemoveError('');
                setRemoving(network);
              }}
              hitSlop={space.xs}
              style={({ pressed }) => [
                styles.delete,
                !connected && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.deleteText}>{t("c949")}</Text>
            </Pressable>
          </ListRow>
        ))}
      </GroupCard>

      <GroupTitle>{t("c1031")}</GroupTitle>
      <TextInput
        cursorColor={colors.accent}
        selectionColor={`${colors.accent}66`}
        selectionHandleColor={colors.accent}
        testID="wifi-ssid"
        accessibilityLabel={t("c1019")}
        placeholder={t("c1019")}
        placeholderTextColor={colors.textMuted}
        style={[styles.field, !connected && styles.disabled]}
        value={ssid}
        onChangeText={setSsid}
        autoCapitalize="none"
        autoCorrect={false}
        editable={connected}
      />
      <View
        style={[
          styles.field,
          styles.passwordRow,
          !connected && styles.disabled,
        ]}
      >
        <TextInput
          cursorColor={colors.accent}
          selectionColor={`${colors.accent}66`}
          selectionHandleColor={colors.accent}
          testID="wifi-password"
          accessibilityLabel={t("c1020")}
          placeholder={t('c004')}
          placeholderTextColor={colors.textMuted}
          style={styles.passwordInput}
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!shown}
          editable={connected}
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
      {result ? (
        <View style={styles.resultRow}>
          <Text
            testID="wifi-result"
            accessibilityLiveRegion="polite"
            style={[styles.result, result.ok ? styles.ok : styles.fail]}
          >
            {result.text}
          </Text>
          {result.retry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('c049')}
              onPress={send}
              hitSlop={space.s}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>{t('c049')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Pressable
        testID="wifi-send"
        accessibilityRole="button"
        accessibilityLabel={t("c1021")}
        accessibilityState={{ disabled: !connected || sending, busy: sending }}
        disabled={!connected || sending}
        onPress={send}
        style={({ pressed }) => [
          styles.primary,
          !connected && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {sending ? (
          <ActivityIndicator
            color={colors.tonalText}
            accessibilityLabel={t("c1022")}
          />
        ) : (
          <Text style={styles.primaryText}>{t("c1021")}</Text>
        )}
      </Pressable>
      <Text style={styles.note}>
        {of(t("c1032"))}
      </Text>

      <ConfirmDialog
        testID="wifi-delete-dialog"
        visible={removing != null}
        title={t("c1029")}
        body={of(t("c1023", { value: removing ?? '' }))}
        problem={removeError || null}
        confirm={t("c949")}
        destructive
        busy={removeBusy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
        problemBlocks={false}
      />
    </ScrollView>
  );
}

const getStyles = makeStyles(theme => {
  const { colors, opacity } = theme;
  return StyleSheet.create({
    note: { ...type.caption, color: colors.textMuted, marginTop: space.l },
    firstNote: { marginTop: space.l, color: colors.warn },
    loading: { minHeight: touch.row, justifyContent: 'center' },
    delete: {
      minWidth: touch.min,
      minHeight: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: space.s,
    },
    deleteText: { ...type.captionBold, color: colors.critAction },
    field: {
      minHeight: size.input.height,
      borderRadius: radius.input,
      borderWidth: border.regular,
      borderColor: colors.floatingOutline,
      // 深色模式「鍵盤」: inputs sit on surface (white in light, as before).
      backgroundColor: colors.surface,
      paddingHorizontal: space.l,
      marginBottom: space.m,
      ...type.body,
      color: colors.text,
    },
    passwordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: 0,
    },
    passwordInput: {
      flex: 1,
      ...type.body,
      color: colors.text,
      padding: 0,
      minHeight: size.login.passwordHeight,
    },
    show: {
      minWidth: touch.min,
      minHeight: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s,
    },
    showText: { ...type.caption, color: colors.textMuted },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: space.s,
    },
    result: { ...type.caption, flex: 1 },
    ok: { color: colors.ok },
    fail: { color: colors.crit },
    retry: {
      minHeight: touch.min,
      justifyContent: 'center',
      paddingHorizontal: space.s,
    },
    retryText: { ...type.captionBold, color: colors.critAction },
    primary: {
      minHeight: touch.primary,
      borderRadius: radius.button,
      backgroundColor: colors.tonal,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.s,
    },
    primaryText: { ...type.status, color: colors.tonalText },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: 0.75 },
  });
});
