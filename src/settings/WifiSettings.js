import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useState } from 'react';
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
export default function WifiSettings({ wifi, receiver = '接收器' }) {
  const { colors } = useTheme();
  const settingsStyles = useStyles(getSettingsStyles);
  const styles = useStyles(getStyles);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
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
    if (!name) {
      setResult({ ok: false, text: '請輸入 Wi-Fi 名稱' });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      await wifi.save(name, password);
      setPassword('');
      setResult({ ok: true, text: `已傳送到${receiver}` });
    } catch (error) {
      setResult({
        ok: false,
        text: `傳送失敗：${error?.message || '請再試一次'}`,
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
      setRemoveError(`刪除失敗：${error?.message || '請再試一次'}`);
    } finally {
      setRemoveBusy(false);
    }
  };

  const ssids = wifi.ssids || [];
  return (
    <ScrollView
      testID="wifi-settings"
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
          {of('沒有連線，連上後才能讀取和設定 Wi-Fi。')}
        </Text>
      )}
      <GroupTitle>{of('存的 Wi-Fi')}</GroupTitle>
      <GroupCard flat>
        {wifi.error ? (
          <ListRow
            testID="wifi-load-error"
            problem
            title="讀取失敗"
            detail={wifi.error}
            detailTone="crit"
            action="重試"
            onPress={wifi.reload}
            label={`讀取失敗，${wifi.error}，重試`}
          />
        ) : null}
        {!wifi.error && wifi.loading && !wifi.ssids ? (
          <View style={styles.loading}>
            <ActivityIndicator
              color={colors.tonalText}
              accessibilityLabel="讀取中"
            />
          </View>
        ) : null}
        {!wifi.error && wifi.ssids && ssids.length === 0 ? (
          <ListRow
            testID="wifi-empty"
            title="還沒有存 Wi-Fi"
            titleTone="muted"
            label="還沒有存 Wi-Fi"
          />
        ) : null}
        {ssids.map(network => (
          <ListRow
            key={network}
            testID={`wifi-${network}`}
            title={network}
            right={network === wifi.activeSsid ? '使用中' : undefined}
            rightTone={['mutedBold']}
            onPress={() => setSsid(network)}
            label={`${network}${
              network === wifi.activeSsid ? '，使用中' : ''
            }，填入名稱`}
          >
            <Pressable
              testID={`wifi-delete-${network}`}
              accessibilityRole="button"
              accessibilityLabel={`刪除 ${network}`}
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
              <Text style={styles.deleteText}>刪除</Text>
            </Pressable>
          </ListRow>
        ))}
      </GroupCard>

      <GroupTitle>新增或更新 Wi-Fi</GroupTitle>
      <TextInput
        cursorColor={colors.accent}
        selectionColor={`${colors.accent}66`}
        selectionHandleColor={colors.accent}
        testID="wifi-ssid"
        accessibilityLabel="Wi-Fi 名稱"
        placeholder="Wi-Fi 名稱"
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
          accessibilityLabel="Wi-Fi 密碼"
          placeholder="密碼"
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
          accessibilityLabel={shown ? '隱藏密碼' : '顯示密碼'}
          onPress={() => setShown(value => !value)}
          style={({ pressed }) => [styles.show, pressed && styles.pressed]}
          hitSlop={space.xs}
        >
          <Text style={styles.showText}>{shown ? '隱藏' : '顯示'}</Text>
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
              accessibilityLabel="重試"
              onPress={send}
              hitSlop={space.s}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>重試</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Pressable
        testID="wifi-send"
        accessibilityRole="button"
        accessibilityLabel="傳送到接收器"
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
            accessibilityLabel="傳送中"
          />
        ) : (
          <Text style={styles.primaryText}>傳送到接收器</Text>
        )}
      </Pressable>
      <Text style={styles.note}>
        {of('只回傳 Wi-Fi 名稱，不會回傳存著的密碼。')}
      </Text>

      <ConfirmDialog
        testID="wifi-delete-dialog"
        visible={removing != null}
        title="刪除 Wi-Fi？"
        body={of(`不會再連「${removing ?? ''}」。`)}
        problem={removeError || null}
        confirm="刪除"
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
