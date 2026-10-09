import { t } from '../i18n';
import { LoadingContent } from '../components/Skeleton';
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { space, touch, type } from '../theme/tokens';
import ConfirmDialog from './ConfirmDialog';
import { signOutDialog, switchDialog } from './AccountModel';
import {
  GroupCard,
  GroupTitle,
  ListRow,
  getSettingsStyles,
} from './SettingsUI';

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
export default function AccountSettings({
  page,
  onSignIn,
  onSignOut,
  onRetryDownload,
  onRetryUpload,
  onSwitch,
  dialog: initialDialog = null,
}) {
  const settingsStyles = useStyles(getSettingsStyles);
  const styles = useStyles(getStyles);
  const [dialog, setDialog] = useState(initialDialog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const operation = useRef(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      operation.current?.abort();
    },
    [],
  );
  // A fixture switching to another open dialog (or none).
  useEffect(() => {
    setDialog(initialDialog);
    setError(null);
  }, [initialDialog]);
  // Another account (or signed out): a dialog opened for the last one closes.
  const account = page.signedIn ? page.email : null;
  const shownFor = useRef(account);
  useEffect(() => {
    if (shownFor.current !== account) {
      setDialog(initialDialog);
      setError(null);
    }
    shownFor.current = account;
    // Only an account change; initialDialog has its own effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  if (!page.signedIn) {
    // Signed out: 「登入」 opens D1 (its 「稍後再說」 and back come back here).
    let row;
    if (page.restoring) {
      row = (
        <ListRow
          testID="account-restoring"
          title={t('c257')}
          label={t('c257')}
        />
      );
    } else {
      const title = page.expired ? t('c276') : t('c302');
      row = (
        <ListRow
          testID="account-signed-out"
          title={title}
          titleTone={page.expired ? 'crit' : undefined}
          problem={page.expired}
          action={t('c006')}
          actionTone="tonal"
          chevron
          onPress={onSignIn}
          label={t("c933", { title: title })}
        />
      );
    }
    return (
      <ScrollView
        testID="account-settings"
        style={settingsStyles.page}
        contentContainerStyle={[
          settingsStyles.content,
          settingsStyles.firstCard,
        ]}
      >
        <GroupCard flat>{row}</GroupCard>
        <Text style={styles.explain}>{t('c002')}</Text>
      </ScrollView>
    );
  }

  const close = () => {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setDialog(null);
    setError(null);
  };
  async function run(work) {
    const controller = new AbortController();
    operation.current = controller;
    const current = () => mounted.current && operation.current === controller && !controller.signal.aborted;
    setBusy(true);
    setError(null);
    try {
      await work(controller.signal);
      if (current()) setDialog(null);
    } catch (failure) {
      if (current()) setError(failure?.message || t("c937"));
    } finally {
      if (current()) { operation.current = null; setBusy(false); }
    }
  }

  const route =
    dialog?.kind === 'switch'
      ? page.routes.find(item => item.master === dialog.master)
      : null;
  const switching = route
    ? switchDialog(route, { offline: page.offline, error })
    : null;
  const signingOut =
    dialog?.kind === 'signout' ? signOutDialog(page.pendingTotal) : null;
  const { download, upload } = page;

  return (
    <ScrollView
      testID="account-settings"
      style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}
    >
      <GroupCard flat>
        <ListRow
          testID="account-signed-in"
          title={page.email}
          detail={t('c208')}
          label={t("c934", { email: page.email })}
        >
          <Pressable
            testID="account-sign-out"
            accessibilityRole="button"
            accessibilityLabel={t('c209')}
            onPress={() => setDialog({ kind: 'signout' })}
            hitSlop={space.xs}
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          >
            <Text style={styles.signOutText}>{t('c209')}</Text>
          </Pressable>
        </ListRow>
      </GroupCard>

      <GroupTitle>{t('c210')}</GroupTitle>
      <GroupCard flat>
        <StatusRow
          testID="account-download"
          row={download}
          onRetry={onRetryDownload}
        />
      </GroupCard>

      <GroupTitle>{t('c214')}</GroupTitle>
      <GroupCard flat>
        {upload.visible && upload.problem && (
          <StatusRow
            testID="account-upload-problem"
            row={upload.problem}
            onRetry={onRetryUpload}
          />
        )}
        {upload.visible && (
          <>
            <ListRow
              testID="account-upload-pending"
              title={upload.pending > 0 ? t('c215') : t('c417')}
              right={upload.pending > 0 ? upload.pendingText : null}
              rightTone={['mutedBold']}
              label={upload.pending > 0 ? t("c935", { pendingText: upload.pendingText }) : t('c417')}
            />
            <ListRow
              testID="account-upload-last"
              title={t("c938")}
              right={upload.lastText}
              rightTone={['mutedBold']}
              label={t("c936", { lastText: upload.lastText })}
            />
          </>
        )}
        <LoadingContent loading={page.routesLoading} skeletonTestID="account-loading">
        {page.routes.map(item => (
          <ListRow
            key={item.master}
            testID={`account-route-${item.master}`}
            title={item.title}
            detail={item.detail}
            chevron={item.canSwitch}
            label={item.label}
            onPress={
              item.canSwitch
                ? () => {
                    setError(null);
                    setDialog({ kind: 'switch', master: item.master });
                  }
                : undefined
            }
          />
        ))}
        </LoadingContent>
      </GroupCard>

      <ConfirmDialog
        testID="upload-switch-dialog"
        visible={!!switching}
        title={switching?.title}
        body={switching?.body}
        problem={switching?.blockedBy}
        confirm={switching?.confirm ?? t("c928")}
        busy={busy}
        onCancel={close}
        onConfirm={() => run(signal => onSwitch(route.master, route.to, signal))}
      />
      <ConfirmDialog
        testID="sign-out-dialog"
        visible={!!signingOut}
        title={signingOut?.title}
        body={signingOut?.body}
        problem={dialog?.kind === 'signout' ? error : null}
        confirm={signingOut?.confirm ?? t('c209')}
        busy={busy}
        onCancel={close}
        onConfirm={() => run(onSignOut)}
      />
    </ScrollView>
  );
}

// A 下載／上傳 status row: the red 「!」 and 「重試 ›」 when it has a problem.
function StatusRow({ row, onRetry, testID }) {
  return (
    <ListRow
      testID={testID}
      title={row.title}
      detail={row.detail}
      problem={row.problem}
      right={row.right}
      rightTone={row.problem ? undefined : ['mutedBold']}
      action={row.retry ? t('c213') : null}
      actionTone="critAction"
      onPress={row.retry ? onRetry : undefined}
      label={row.label}
    />
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    signOut: {
      minWidth: touch.min,
      minHeight: touch.min,
      alignItems: 'flex-end',
      justifyContent: 'center',
      marginLeft: space.s,
    },
    signOutText: { ...type.captionBold, color: colors.textMuted },
    explain: {
      ...type.caption,
      color: colors.textMuted,
      marginTop: space.m,
      marginHorizontal: space.xs,
    },
    pressed: { opacity: 0.6 },
  });
});
