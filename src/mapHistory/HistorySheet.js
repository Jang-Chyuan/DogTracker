import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '../components/ScreenUI';
import BottomSheet from '../map/BottomSheet';
import TrackingAvatar from '../map/TrackingAvatar';
import VisibilityButton from '../map/VisibilityButton';
import { mapColors as colors } from '../map/MapTheme';
import DateTimePicker from '@react-native-community/datetimepicker';
import HistoryExportButton from './HistoryExportButton';
import { coverageNotice } from './HistoryCoverage';
import { historyWindow, startOfDay } from './HistoryTime';

const HOUR_PRESETS = [1, 3, 6, 12, 24];
// A season of outings would be a wall of chips; the rest stay reachable through
// the date picker, whose range covers every day that has rows.
const DAY_CHIPS = 6;
const stamp = value => (Number.isFinite(value)
  ? new Date(value).toLocaleString('zh-TW', { hour12: false, year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '未選');
const dayLabel = value => new Date(value).toLocaleDateString('zh-TW',
  { month: 'numeric', day: 'numeric' });
const list = value => (Array.isArray(value) ? value : []);
const toggle = (values, id) => (values.includes(id)
  ? values.filter(item => item !== id)
  : [...values, id].sort((a, b) => a - b));

function Chip({ label, selected, disabled, onPress, icon }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabled]}
    >
      {icon}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A section that shows one line until it is opened.
 *
 * The card carries every parameter of a query, which made it a long scroll; a
 * closed section states its current answer, so the card stays about a screen
 * high and only what is being changed is unfolded.
 */
function Section({ title, value, open, onToggle, children }) {
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.sectionHeader}
      >
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionValue}>
          <Text style={styles.sectionAnswer} numberOfLines={1}>{value}</Text>
          <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
        </View>
      </Pressable>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

export function historySummary(history) {
  if (history.error) return history.error;
  if (!history.data) return '正在讀取歷史軌跡…';
  const { since, until, phone, clients } = history.data;
  const dogs = list(clients).map(track => `狗 ${track.slaveId} ${track.count} 筆`).join('、');
  return `${new Date(since).toLocaleString()} ～ ${new Date(until).toLocaleString()}`
    + ` · 手機 ${phone.count} 筆${dogs ? ' · ' + dogs : ''}`;
}

/** Short enough for the pill over the map. */
export function shortRangeLabel(preferences) {
  if (preferences.timeMode !== 'fixed') return `過去 ${preferences.hours} 小時`;
  const clock = value => new Date(value).toLocaleString('zh-TW',
    { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return Number.isFinite(preferences.startAt) && Number.isFinite(preferences.endAt)
    ? `${clock(preferences.startAt)}–${clock(preferences.endAt)}`
    : '指定區間';
}

export function rangeLabel(draft) {
  if (draft.timeMode === 'fixed') return `${stamp(draft.startAt)} ～ ${stamp(draft.endAt)}`;
  return `過去 ${draft.hours} 小時`;
}

/**
 * The history tab's card.
 *
 * Every parameter of a history query lives here, grouped the way the question
 * is asked: which dogs, from which source, over what time. Device numbers are
 * picked from what this phone actually holds — both ids can take several
 * values, and a typed number that exists nowhere looks exactly like "no data".
 * Changes stay a draft until 套用, so a half-made choice never restarts the
 * query.
 */
export default function HistorySheet({
  history, snapshot, bottomInset, topInset, onHeight, extras,
}) {
  const [draft, setDraft] = useState(history.preferences);
  const [open, setOpen] = useState('');
  const [picker, setPicker] = useState(null);
  useEffect(() => setDraft(history.preferences), [history.preferences]);
  // Switching source changes which devices exist: a dog only the cloud has
  // would stay selected and quietly return nothing. Only a source the user just
  // changed is pruned, so simply opening the card never claims a change.
  useEffect(() => {
    const pairs = history.devices || [];
    if (!pairs.length || draft.source === history.preferences.source) return;
    setDraft(current => {
      const slaves = list(current.slaves).filter(id => pairs.some(pair => pair.slave === id));
      const next = slaves.length ? slaves : [pairs[0].slave];
      const heard = pairs.filter(pair => next.includes(pair.slave)).map(pair => pair.master);
      const masters = list(current.masters).filter(id => heard.includes(id));
      const nextMasters = masters.length ? masters : [...new Set(heard)].sort((a, b) => a - b);
      return JSON.stringify([next, nextMasters]) === JSON.stringify([current.slaves, current.masters])
        ? current : { ...current, slaves: next, masters: nextMasters };
    });
  }, [history.devices, draft.source, history.preferences.source]);
  const patch = value => setDraft(current => ({ ...current, ...value }));
  // Which devices and days there are to offer follows what is being edited, not
  // what was applied: after picking the cloud and two of its dogs, a day list
  // answered for the BLE pair is worse than no list at all.
  useEffect(() => {
    history.preview?.({ source: draft.source, masters: list(draft.masters),
      slaves: list(draft.slaves) });
  }, [history, draft.source, draft.masters, draft.slaves]);
  const section = name => setOpen(current => (current === name ? '' : name));
  // Asking the cloud which days it holds costs a request per day, so it waits
  // until the section that shows them is actually open.
  const wantsDays = open === 'time' && draft.timeMode === 'fixed';
  useEffect(() => {
    history.wantDays?.(wantsDays);
  }, [history, wantsDays]);
  const devices = history.devices || [];
  const days = history.days || [];
  const slaves = list(draft.slaves);
  const masters = list(draft.masters);
  const dogOptions = [...new Set(devices.map(pair => pair.slave))].sort((a, b) => a - b);
  const masterOptions = [...new Set(devices
    .filter(pair => !slaves.length || slaves.includes(pair.slave))
    .map(pair => pair.master))].sort((a, b) => a - b);
  let preview = '';
  try {
    const window = historyWindow(draft);
    preview = `${new Date(window.since).toLocaleString()} ～ ${new Date(window.until).toLocaleString()}`;
  } catch (error) {
    preview = '';
  }
  const notice = history.data ? coverageNotice(history.data) : '';
  const changed = JSON.stringify(draft) !== JSON.stringify(history.preferences);
  const limited = history.data?.phone.limited
    || list(history.data?.clients).some(track => track.limited);
  return (
    <BottomSheet
      name="history"
      title="歷史軌跡"
      summary={historySummary(history)}
      bottomInset={bottomInset}
      topInset={topInset}
      onHeight={onHeight}
    >
      {history.error ? <Text style={styles.error}>{history.error}</Text> : null}
      {!!notice && <Text style={styles.warning}>{notice}</Text>}
      {!!history.data?.message && <Text style={styles.warning}>{history.data.message}</Text>}

      <Section
        title="資料來源"
        value={draft.source === 'ble' ? '這支手機收到的' : '雲端下載的'}
        open={open === 'source'}
        onToggle={() => section('source')}
      >
        <View style={styles.row}>
          {[['ble', '這支手機收到的（BLE）'], ['cloud', '雲端下載的（Supabase）']]
            .map(([value, label]) => (
              <Chip key={value} label={label} selected={draft.source === value}
                disabled={history.busy}
                onPress={() => patch({ source: value })} />
            ))}
        </View>
      </Section>

      {/* Source first: which dogs and Masters exist at all depends on it. */}
      <Section
        title="狗與 Master"
        value={`${slaves.map(id => `狗 ${id}`).join('、') || '未選'} · ${
          masters.map(id => `M${id}`).join('、') || '未選'}`}
        open={open === 'devices'}
        onToggle={() => section('devices')}
      >
        <Text style={styles.label}>看哪幾隻狗（可複選）</Text>
        <View style={styles.row}>
          {dogOptions.map(slave => (
            <Chip key={slave} label={`狗 ${slave}`} selected={slaves.includes(slave)}
              disabled={history.busy}
              icon={<TrackingAvatar role="slave" size={22} />}
              onPress={() => {
                const next = toggle(slaves, slave);
                // Keep at least the Masters that heard the remaining dogs, so a
                // new pick never leaves an empty query.
                const heard = devices
                  .filter(pair => next.includes(pair.slave))
                  .map(pair => pair.master);
                const keep = masters.filter(id => heard.includes(id));
                patch({
                  slaves: next,
                  masters: keep.length ? keep : [...new Set(heard)].sort((a, b) => a - b),
                });
              }} />
          ))}
          {!dogOptions.length && (
            <Text style={styles.hint}>
              這支手機還沒有這個來源的資料；先在「設定 → 雲端資料」下載，或連上 Master 收資料。
            </Text>
          )}
        </View>
        {masterOptions.length > 0 && (
          <>
            <Text style={styles.label}>哪幾台 Master 收到的（可複選）</Text>
            <View style={styles.row}>
              {masterOptions.map(master => (
                <Chip key={master} label={`Master ${master}`}
                  selected={masters.includes(master)} disabled={history.busy}
                  onPress={() => {
                    const next = toggle(masters, master);
                    patch({ masters: next.length ? next : masterOptions });
                  }} />
              ))}
            </View>
          </>
        )}
      </Section>

      <Section
        title="時間"
        value={rangeLabel(draft)}
        open={open === 'time'}
        onToggle={() => section('time')}
      >
        <View style={styles.row}>
          <Chip label="往前算一段時間" selected={draft.timeMode === 'recent'}
            disabled={history.busy} onPress={() => patch({ timeMode: 'recent' })} />
          <Chip label="指定起訖" selected={draft.timeMode === 'fixed'} disabled={history.busy}
            onPress={() => patch({
              timeMode: 'fixed',
              startAt: draft.startAt ?? (days[0] ? days[0].from : Date.now() - 3600000),
              endAt: draft.endAt ?? (days[0] ? days[0].to : Date.now()),
            })} />
        </View>
        {draft.timeMode === 'recent' ? (
          <View style={styles.row}>
            {HOUR_PRESETS.map(value => (
              <Chip key={value} label={`過去 ${value} 小時`} selected={draft.hours === value}
                disabled={history.busy} onPress={() => patch({ hours: value })} />
            ))}
          </View>
        ) : (
          <View>
            {/* Which days hold rows, from the database: a platform picker cannot
                mark them, and querying a day to find out it is empty is worse. */}
            <View style={styles.dayHeader}>
              <Text style={styles.label}>最近有資料的日子</Text>
              {history.daysLoading && (
                <View style={styles.loading}>
                  <ActivityIndicator size="small" color={colors.master} />
                  <Text style={styles.hint}>正在問雲端還有哪幾天…</Text>
                </View>
              )}
            </View>
            <View style={styles.row}>
              {days.slice(0, DAY_CHIPS).map(day => (
                <Chip key={day.day}
                  label={day.rows
                    ? `${dayLabel(day.day)}（${day.rows} 筆）`
                    : `${dayLabel(day.day)}（雲端有・未下載）`}
                  selected={draft.startAt != null && startOfDay(draft.startAt) === day.day}
                  disabled={history.busy}
                  onPress={() => patch({
                    // `day` is already local midnight; clamp to the rows that
                    // exist so a whole-day pick does not start hours before the
                    // first one or end after the last.
                    startAt: Math.max(day.day, day.from),
                    endAt: Math.min(day.day + 24 * 3600000, day.to + 1000),
                  })} />
              ))}
              {/* Nothing selected means nothing was asked — neither the phone
                  nor the cloud. Saying "no data" for a query that never ran is
                  how an empty pick looked like an empty account. */}
              {!slaves.length || !masters.length ? (
                <Text style={styles.hint}>請先在上面選至少一隻狗與一台 Master。</Text>
              ) : !days.length && !history.daysLoading && (
                <Text style={styles.hint}>這個來源與裝置在本機沒有任何資料。</Text>
              )}
              {/* A walk that gave up halfway must not look like "nothing before
                  this": the days it never got to are unknown, not empty. */}
              {!!history.daysIncomplete && (
                <Text style={styles.hint}>
                  更早的日子沒問完（{history.daysIncomplete}），收合再打開可以重試。
                </Text>
              )}
              {days.length > DAY_CHIPS && (
                <Text style={styles.hint}>
                  更早還有 {days.length - DAY_CHIPS} 天，用下面的開始／結束時間挑。
                </Text>
              )}
              {days.slice(0, DAY_CHIPS).some(day => !day.rows) && (
                <Text style={styles.hint}>
                  標「未下載」的日子雲端有、這支手機還沒有；選了會是空的，請先到
                  「設定 → 雲端資料」下載該日期。
                </Text>
              )}
            </View>
            <View style={styles.row}>
              {[['start', '開始', draft.startAt], ['end', '結束', draft.endAt]].map(
                ([key, label, value]) => (
                  <Pressable key={key} accessibilityRole="button"
                    accessibilityLabel={`選擇${label}時間`}
                    disabled={history.busy}
                    onPress={() => setPicker({ key, mode: 'date' })}
                    style={[styles.stampButton, history.busy && styles.disabled]}
                  >
                    <Text style={styles.stampLabel}>{label}</Text>
                    <Text style={styles.stampValue}>{stamp(value)}</Text>
                  </Pressable>
                ))}
            </View>
            {!!picker && (
              <DateTimePicker
                testID="history-datetime-picker"
                value={new Date((picker.key === 'start' ? draft.startAt : draft.endAt)
                  || Date.now())}
                mode={picker.mode}
                is24Hour
                minimumDate={days.length ? new Date(days[days.length - 1].from) : undefined}
                maximumDate={days.length ? new Date(days[0].to) : undefined}
                onChange={(event, picked) => {
                  if (event?.type === 'dismissed' || !picked) {
                    setPicker(null);
                    return;
                  }
                  // Date first, then time, which is how both platforms present it.
                  if (picker.mode === 'date') {
                    const kept = new Date((picker.key === 'start' ? draft.startAt : draft.endAt)
                      || picked.getTime());
                    const merged = new Date(picked);
                    merged.setHours(kept.getHours(), kept.getMinutes(), 0, 0);
                    patch({ [picker.key === 'start' ? 'startAt' : 'endAt']: merged.getTime() });
                    setPicker({ ...picker, mode: 'time' });
                    return;
                  }
                  patch({ [picker.key === 'start' ? 'startAt' : 'endAt']: picked.getTime() });
                  setPicker(null);
                }}
              />
            )}
          </View>
        )}
        {!!preview && <Text style={styles.hint}>會查：{preview}</Text>}
        <Text style={styles.hint}>
          依手機本地時區。{draft.timeMode === 'fixed'
            ? '指定的區間不會隨時間移動。' : '區間會跟著現在時間往前走。'}
        </Text>
      </Section>

      {/* Whether something is drawn is always an eye, here as on the live map. */}
      <View style={styles.visibility}>
        <Text style={styles.label}>地圖上畫</Text>
        <View style={styles.eyeRow}>
          <Text style={styles.eyeLabel}>狗的軌跡</Text>
          <VisibilityButton role="slave" size="small" subject="狗軌跡的"
            visible={draft.client} disabled={history.busy}
            onPress={() => patch({ client: !draft.client })} />
        </View>
        {history.phoneRecorded === false ? (
          <Text style={styles.hint}>
            這支手機沒有自己的定位記錄，所以只畫狗的軌跡。要記錄請到
            「設定 → 手機位置記錄」開啟。
          </Text>
        ) : (
          <View style={styles.eyeRow}>
            <Text style={styles.eyeLabel}>這支手機的軌跡</Text>
            <VisibilityButton role="master" size="small" subject="手機軌跡的"
              visible={draft.phone} disabled={history.busy}
              onPress={() => patch({ phone: !draft.phone })} />
          </View>
        )}
      </View>

      <ActionButton
        title={history.busy ? '查詢中…' : changed ? '套用（有未套用的變更）' : '重新查詢'}
        disabled={history.busy}
        onPress={() => history.save(draft)} />
      {/* Later sections (playback) are handed in by the screen. */}
      {extras}
      <HistoryExportButton history={history} snapshot={snapshot} />
      {limited ? (
        <Text style={styles.hint}>軌跡已達繪圖上限，僅顯示較新的部分，原始資料仍保留。</Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: '#F3F6F4',
    overflow: 'hidden',
  },
  sectionHeader: {
    minHeight: 52,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', flexShrink: 0 },
  sectionValue: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  sectionAnswer: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  chevron: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  sectionBody: { paddingHorizontal: 12, paddingBottom: 12 },
  visibility: { marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: '#F3F6F4' },
  eyeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  eyeLabel: { color: colors.ink, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  chipSelected: { backgroundColor: colors.master },
  chipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#FFFFFF' },
  disabled: { opacity: 0.45 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginTop: 6, marginBottom: 4 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stampButton: {
    flexGrow: 1,
    minHeight: 52,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  stampLabel: { color: colors.muted, fontSize: 11 },
  stampValue: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 6 },
  warning: { color: '#75430B', fontSize: 12, lineHeight: 19, marginTop: 6 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20, marginTop: 6 },
});
