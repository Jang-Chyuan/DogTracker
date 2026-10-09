import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors, space, touch, type } from '../theme/tokens';
import ConfirmDialog from './ConfirmDialog';
import { signOutDialog, switchDialog } from './AccountModel';
import { GroupCard, GroupTitle, ListRow, settingsStyles } from './SettingsUI';

/**
 * S3 Supabase 帳號. Signed out (a choice, or 登入失效): 「未登入」 or 「需要
 * 重新登入」 and 「登入」 (`onSignIn` opens D1; done, 「稍後再說」 and back
 * return here); while the restore waits for Supabase 「暫時連不上，會自動
 * 重試」. Signed in:
 * the account with 登出 (confirmed, saying what stops), 下載 (last success,
 * or failing since when + 重試 ›), 上傳 (what still waits in this phone,
 * what needs handling + 重試 ›, the last success) and each receiver's upload
 * route, switched after a confirmation that sends what waits first.
 *
 * `page` is AccountModel.accountPage. `onSwitch(master, mode)` resolves when
 * the route changed or rejects with the reason (c256). `dialog` opens one
 * dialog from the start ({ kind: 'switch', master } | { kind: 'signout' }):
 * a screen fixture's open dialog.
 */
export default function AccountSettings({ page, onSignIn, onSignOut, onRetryDownload, onRetryUpload, onSwitch,
  dialog: initialDialog = null }) {
  const [dialog, setDialog] = useState(initialDialog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  // A fixture switching to another open dialog (or none).
  useEffect(() => { setDialog(initialDialog); setError(null); }, [initialDialog]);
  // Another account (or signed out): a dialog opened for the last one closes.
  const account = page.signedIn ? page.email : null;
  const shownFor = useRef(account);
  useEffect(() => {
    if (shownFor.current !== account) { setDialog(initialDialog); setError(null); }
    shownFor.current = account;
    // Only an account change; initialDialog has its own effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  if (!page.signedIn) {
    // Signed out: 「登入」 opens D1 (its 「稍後再說」 and back come back here).
    let row;
    if (page.restoring) {
      row = <ListRow testID="account-restoring" title="暫時連不上，會自動重試" label="暫時連不上，會自動重試" />;
    } else {
      const title = page.expired ? '需要重新登入' : '未登入';
      row = <ListRow testID="account-signed-out" title={title} titleTone={page.expired ? 'crit' : undefined}
        problem={page.expired} action="登入" actionTone="tonal" chevron onPress={onSignIn}
        label={`${title}，登入`} />;
    }
    return (
      <ScrollView testID="account-settings" style={settingsStyles.page}
        contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}>
        <GroupCard flat>{row}</GroupCard>
        <Text style={styles.explain}>登入後會把收到的位置上傳，也能看到隊友的狗。不登入也可以用，只顯示這支手機連到的接收器。</Text>
      </ScrollView>
    );
  }

  const close = () => { if (!busy) { setDialog(null); setError(null); } };
  async function run(work) {
    setBusy(true); setError(null);
    try {
      await work();
      if (mounted.current) setDialog(null);
    } catch (failure) {
      if (mounted.current) setError(failure?.message || '沒有完成，請重試');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const route = dialog?.kind === 'switch' ? page.routes.find(item => item.master === dialog.master) : null;
  const switching = route ? switchDialog(route, { offline: page.offline, error }) : null;
  const signingOut = dialog?.kind === 'signout' ? signOutDialog(page.pendingTotal) : null;
  const { download, upload } = page;

  return (
    <ScrollView testID="account-settings" style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}>
      <GroupCard flat>
        <ListRow testID="account-signed-in" title={page.email} detail="已登入" label={`${page.email}，已登入`}>
          <Pressable testID="account-sign-out" accessibilityRole="button" accessibilityLabel="登出"
            onPress={() => setDialog({ kind: 'signout' })} hitSlop={4}
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
            <Text style={styles.signOutText}>登出</Text>
          </Pressable>
        </ListRow>
      </GroupCard>

      <GroupTitle>下載</GroupTitle>
      <GroupCard flat>
        <StatusRow testID="account-download" row={download} onRetry={onRetryDownload} />
      </GroupCard>

      <GroupTitle>上傳</GroupTitle>
      <GroupCard flat>
        {upload.problem && <StatusRow testID="account-upload-problem" row={upload.problem} onRetry={onRetryUpload} />}
        <ListRow testID="account-upload-pending" title="還沒上傳" right={upload.pendingText}
          rightTone={['mutedBold']} label={`還沒上傳 ${upload.pendingText}`} />
        <ListRow testID="account-upload-last" title="最後上傳成功" right={upload.lastText}
          rightTone={['mutedBold']} label={`最後上傳成功 ${upload.lastText}`} />
        {page.routesLoading && <ListRow title="讀取上傳方式中…" titleTone="muted" />}
        {page.routes.map(item => (
          <ListRow key={item.master} testID={`account-route-${item.master}`} title={item.title} detail={item.detail}
            chevron={item.canSwitch} label={item.label}
            onPress={item.canSwitch ? () => { setError(null); setDialog({ kind: 'switch', master: item.master }); }
              : undefined} />
        ))}
      </GroupCard>

      <ConfirmDialog testID="upload-switch-dialog" visible={!!switching} title={switching?.title}
        body={switching?.body} problem={switching?.blockedBy} confirm={switching?.confirm ?? '切換'} busy={busy}
        onCancel={close}
        onConfirm={() => run(() => onSwitch(route.master, route.to))} />
      <ConfirmDialog testID="sign-out-dialog" visible={!!signingOut} title={signingOut?.title}
        body={signingOut?.body} problem={dialog?.kind === 'signout' ? error : null}
        confirm={signingOut?.confirm ?? '登出'} busy={busy} onCancel={close}
        onConfirm={() => run(onSignOut)} />
    </ScrollView>
  );
}

// A 下載／上傳 status row: the red 「!」 and 「重試 ›」 when it has a problem.
function StatusRow({ row, onRetry, testID }) {
  return (
    <ListRow testID={testID} title={row.title} detail={row.detail} problem={row.problem}
      right={row.right} rightTone={row.problem ? undefined : ['mutedBold']}
      action={row.retry ? '重試 ›' : null} actionTone="critAction"
      onPress={row.retry ? onRetry : undefined} label={row.label} />
  );
}

const styles = StyleSheet.create({
  signOut: { minWidth: touch.min, minHeight: touch.min, alignItems: 'flex-end', justifyContent: 'center',
    marginLeft: space.s },
  signOutText: { ...type.captionBold, color: colors.textMuted },
  explain: { ...type.caption, color: colors.textMuted, marginTop: space.m, marginHorizontal: space.xs },
  pressed: { opacity: 0.6 },
});
