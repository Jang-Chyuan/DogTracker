import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import DogAvatar from '../dogs/DogAvatar';
import Glyph from './Glyph';
import { useInitialFocus } from '../utils/a11yFocus';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { radius, size as sizes, space, touch, type } from '../theme/tokens';
import { denseDogChoices } from './DenseDogNames';

// Candidate explicit entry only. Marker taps never call this component's open
// handler. Modal lives at screen level, not outside a clipped map/card parent.
export default function DenseDogSelector({ markers, avatars = {}, sourceKey, onSelect, style }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const choices = useMemo(() => denseDogChoices(markers), [markers]);
  const members = JSON.stringify(choices.map(marker => [marker.slaveId, marker.masterId ?? null]));
  const [session, setSession] = useState(null);
  const [focusBack, setFocusBack] = useState(false);
  const sessionRef = useRef(null);
  const entry = useRef(null), title = useRef(null);
  const visible = session?.source === sourceKey && session?.members === members && choices.length > 1;
  const current = useRef(null);
  const mounted = useRef(true);
  current.current = { sourceKey, members, choices, onSelect };
  useInitialFocus(title, visible);
  useInitialFocus(entry, focusBack && !visible);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sessionRef.current = null;
    };
  }, []);
  // Membership/scope changes close, rather than silently reorder the rows
  // under the user's finger or show a dog removed from the accepted source.
  useEffect(() => {
    if (session && !visible) {
      sessionRef.current = null;
      setSession(null);
      setFocusBack(false);
    }
  }, [session, visible]);
  const close = () => {
    sessionRef.current = null;
    setSession(null);
    setFocusBack(true);
  };
  const pick = (id, opened) => {
    const latest = current.current;
    if (!mounted.current || !latest || sessionRef.current !== opened || latest.sourceKey !== opened.source
      || latest.members !== opened.members || !latest.choices.some(marker => marker.slaveId === id)) return;
    close();
    latest.onSelect?.(id);
  };
  if (choices.length < 2) return null;
  const problems = choices.filter(marker => marker.problem).length;
  return (
    <>
      <Pressable ref={entry} testID="dense-dog-entry" accessibilityRole="button"
        accessibilityLabel={t('c1256', { count: choices.length, problems })}
        style={({ pressed }) => [styles.entry, style, pressed && styles.pressed]}
        onPress={() => {
          if (!mounted.current || !current.current || current.current.sourceKey !== sourceKey || current.current.members !== members) return;
          const opened = { source: sourceKey, members };
          setFocusBack(false);
          sessionRef.current = opened;
          setSession(opened);
        }}>
        <Glyph name="dog-list" color={colors.text} size={sizes.icon.map} />
      </Pressable>
      {visible && <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <View style={[styles.scrim, { paddingTop: insets.top + space.m, paddingBottom: insets.bottom + space.m }]}>
          <Pressable testID="dense-dog-outside" style={StyleSheet.absoluteFill}
            accessibilityLabel={t('c765')} accessibilityRole="button" onPress={close} />
          <View testID="dense-dog-picker" accessibilityViewIsModal
            style={[styles.sheet, { maxHeight: Math.max(touch.min, height - insets.top - insets.bottom - 2 * space.m) }]}>
            <View style={styles.header}>
              <Text ref={title} accessibilityRole="header" style={styles.title}>{t('c1254')}</Text>
              <Pressable testID="dense-dog-close" accessibilityRole="button"
                accessibilityLabel={t('c765')} style={({ pressed }) => [styles.close, pressed && styles.pressed]} onPress={close}>
                <Text style={styles.closeText}>{t('c765')}</Text>
              </Pressable>
            </View>
            <ScrollView testID="dense-dog-rows" style={styles.rows} keyboardShouldPersistTaps="handled">
              {choices.map(marker => <Pressable key={marker.slaveId}
                testID={`dense-dog-row-${marker.slaveId}`} accessibilityRole="button"
                accessibilityState={{ selected: !!marker.selected }} accessibilityLabel={marker.label}
                style={({ pressed }) => [styles.row, marker.selected && styles.selected, pressed && styles.pressed]}
                onPress={() => pick(marker.slaveId, session)}>
                <DogAvatar avatar={avatars?.[marker.slaveId]} size={sizes.listRow.avatar} stale={marker.stale} />
                <View style={styles.words}>
                  <Text style={styles.name}>{marker.name}</Text>
                  {marker.note && <Text style={[styles.note, marker.problem && styles.problemNote]}>{marker.note.text}</Text>}
                </View>
              </Pressable>)}
            </ScrollView>
          </View>
        </View>
      </Modal>}
    </>
  );
}

const getStyles = makeStyles(theme => StyleSheet.create({
  entry: { height: touch.min, width: touch.min, minHeight: touch.min, minWidth: touch.min,
    justifyContent: 'center', alignItems: 'center', borderRadius: radius.full,
    backgroundColor: theme.colors.surface, flexShrink: 0, ...theme.shadow.floating, ...theme.floatingBorder },
  pressed: { backgroundColor: theme.colors.pressedOverlay },
  scrim: { flex: 1, justifyContent: 'flex-end', padding: space.m, backgroundColor: theme.colors.scrim },
  sheet: { borderRadius: radius.menu, backgroundColor: theme.colors.surface, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.m },
  title: { ...type.title, flex: 1, color: theme.colors.text },
  close: { minHeight: touch.min, minWidth: touch.min, justifyContent: 'center', padding: space.m },
  closeText: { ...type.status, color: theme.colors.text },
  rows: { flexGrow: 0, flexShrink: 1 },
  row: { minHeight: touch.min + space.s, padding: space.m, flexDirection: 'row', alignItems: 'center', gap: space.m },
  words: { flex: 1 },
  name: { ...type.status, color: theme.colors.text },
  note: { ...type.caption, color: theme.colors.textMuted },
  problemNote: { color: theme.colors.crit },
  selected: { backgroundColor: theme.colors.pressedOverlay },
}));
