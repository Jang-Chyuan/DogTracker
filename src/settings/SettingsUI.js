import React, { createContext, useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, radius, settingIcon, size, space, touch, type } from '../theme/tokens';

// The v3 settings look (design 「設定首頁的分組」「設定裡的紅色「!」」): light
// pages, white rounded cards of 56dp rows, group names in 12sp muted text,
// a tinted 36dp icon on the left of each settings home row.

/** The 16dp red 「!」 (design 「設定裡的紅色「!」」). */
export function ProblemBang({ style }) {
  return (
    <View style={[styles.bang, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Text style={styles.bangText} allowFontScaling={false}>!</Text>
    </View>
  );
}

/** A group name over its card. */
export function GroupTitle({ children }) {
  return <Text style={styles.group} accessibilityRole="header">{children}</Text>;
}

// Rows on the page itself (flat) line up with the group names.
const Flat = createContext(false);

/**
 * Rows with a line between them: in a rounded card with a 1dp frame
 * (settings home, S1), or `flat` on the page with a line above each row
 * (subpages, S2/S4), as in the mockups.
 */
export function GroupCard({ children, testID, flat = false }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <Flat.Provider value={flat}>
      <View style={flat ? styles.flat : styles.card} testID={testID}>
        {rows.map((row, index) => (
          <View key={row.key ?? index}>
            {(flat || index > 0) && <View style={styles.divider} />}
            {row}
          </View>
        ))}
      </View>
    </Flat.Provider>
  );
}

// The 2dp line icons of the settings home (design 「設定首頁」 icons), drawn
// on their tinted squares (tokens.settingIcon).
const ICONS = {
  receiver: (
    <>
      <Rect x={6} y={10} width={12} height={10} rx={2} />
      <Path d="M12 10V5" />
      <Path d="M8.5 4.5a5 5 0 0 1 7 0" />
    </>
  ),
  phone: (
    <>
      <Rect x={7} y={2.5} width={10} height={19} rx={2.5} />
      <Path d="M11 18.5h2" />
    </>
  ),
  account: <Path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
  diagnostics: (
    <>
      <Path d="M8 6h13M8 12h13M8 18h13" />
      <Path d="M3 6h.01M3 12h.01M3 18h.01" />
    </>
  ),
  alerts: (
    <>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  advanced: (
    <>
      <Path d="M14.7 6.3a4 4 0 0 0 5 5L21 13a6 6 0 0 1-8-8l1.7 1.3Z" />
      <Path d="m13 11-8.5 8.5a2.1 2.1 0 0 1-3-3L10 8" />
    </>
  ),
};

export function SettingIcon({ kind }) {
  const tint = settingIcon[kind] || settingIcon.advanced;
  return (
    <View style={[styles.icon, { backgroundColor: tint.bg }]}>
      <Svg width={size.icon.row} height={size.icon.row} viewBox="0 0 24 24" fill="none" stroke={tint.line}
        strokeWidth={size.icon.stroke} strokeLinecap="round" strokeLinejoin="round">
        {ICONS[kind]}
      </Svg>
    </View>
  );
}

const Chevron = () => <Text style={styles.chevron} allowFontScaling={false}>›</Text>;

/**
 * A settings home row: icon, name over a short description, the usual
 * status on the right — or only the red 「!」 when something needs handling.
 */
export function HomeRow({ row, onPress }) {
  return (
    <Pressable testID={`settings-row-${row.id}`} accessibilityRole="button" accessibilityLabel={row.label}
      onPress={onPress} style={({ pressed }) => [styles.homeRow, pressed && styles.pressed]}>
      <SettingIcon kind={row.id} />
      <View style={styles.middle}>
        <Text style={styles.name} numberOfLines={1}>{row.title}</Text>
        {row.subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{row.subtitle}</Text> : null}
      </View>
      {row.problem ? <ProblemBang /> : (
        <View style={styles.status}>
          {row.status.map(line => <Text key={line} style={styles.statusText} numberOfLines={1}>{line}</Text>)}
        </View>
      )}
      <Chevron />
    </Pressable>
  );
}

/**
 * A subpage row (S2, S4): an optional red 「!」 before the name, the name
 * over an optional second line, and on the right a value (`right`, one or
 * two lines) or an action (`action`, crit-red when it fixes a problem).
 * `leading` replaces the 「!」 (S2's receiver icon). Pressable when `onPress`.
 */
export function ListRow({ title, detail, detailTone, right, rightTone, action, actionTone = 'crit',
  problem = false, leading = null, titleTone, onPress, chevron = false, label, testID, accessibilityState, children }) {
  const rowStyle = useContext(Flat) ? [styles.listRow, styles.flatRow] : styles.listRow;
  const rights = Array.isArray(right) ? right : right ? [right] : [];
  const body = (
    <>
      {problem ? <ProblemBang style={styles.leadBang} /> : leading}
      <View style={styles.middle}>
        <Text style={[styles.rowTitle, titleTone && TONES[titleTone]]} numberOfLines={1}>{title}</Text>
        {detail ? <Text style={[styles.rowDetail, detailTone && TONES[detailTone]]} numberOfLines={2}>{detail}</Text>
          : null}
      </View>
      {rights.length > 0 && (
        <View style={styles.status}>
          {rights.map((line, index) => (
            <Text key={`${index}-${line}`} style={[styles.rowRight, rightTone?.[index] && TONES[rightTone[index]]]}
              numberOfLines={1}>{line}</Text>
          ))}
        </View>
      )}
      {action ? <Text style={[styles.action, TONES[actionTone]]}>{action}</Text> : null}
      {children}
      {chevron ? <Chevron /> : null}
    </>
  );
  if (!onPress) {
    return <View testID={testID} style={rowStyle} accessible accessibilityLabel={label}>{body}</View>;
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      accessibilityState={accessibilityState} style={({ pressed }) => [rowStyle, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const TONES = StyleSheet.create({
  crit: { color: colors.crit },
  // 未允許 on S6 (the mockup's amber).
  warn: { color: colors.warn },
  critAction: { color: colors.problemBadge },
  tonal: { color: colors.tonalText },
  muted: { color: colors.textMuted },
  // A value on the right in bold (S3 「12 筆」「10:04」, as .v7li .r).
  mutedBold: { color: colors.textMuted, fontWeight: '700' },
  danger: { color: colors.problemBadge },
  plain: { color: colors.text },
});

export const settingsStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: space.l, paddingBottom: space.xxl },
  // A page without group names starts its first card 16dp under the header.
  firstCard: { paddingTop: space.l },
  footer: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: space.l },
  empty: { ...type.caption, color: colors.textMuted },
});

const styles = StyleSheet.create({
  bang: {
    width: size.badge.size, height: size.badge.size, borderRadius: size.badge.size / 2,
    backgroundColor: colors.problemBadge, alignItems: 'center', justifyContent: 'center',
  },
  bangText: { color: colors.surface, fontSize: 11, lineHeight: 14, fontWeight: '900' },
  leadBang: { marginRight: space.m },
  // DESIGN.md 「設定區塊」: group names 13sp bold textMuted, 24dp above.
  group: { ...type.captionBold, color: colors.textMuted, marginTop: space.xl, marginBottom: space.s,
    marginLeft: space.xs },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.alertCard, borderWidth: 1, borderColor: colors.line,
    overflow: 'hidden',
  },
  flat: { backgroundColor: colors.surface },
  divider: { height: 1, backgroundColor: colors.line },
  icon: {
    width: 36, height: 36, borderRadius: radius.settingIcon, alignItems: 'center', justifyContent: 'center',
    marginRight: space.m,
  },
  homeRow: {
    minHeight: touch.row, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l,
    paddingVertical: space.s + 2,
  },
  listRow: {
    minHeight: touch.row, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l,
    paddingVertical: space.s + 2,
  },
  flatRow: { paddingHorizontal: space.xs },
  pressed: { backgroundColor: colors.pressedOverlay },
  middle: { flex: 1, minWidth: 0, justifyContent: 'center' },
  name: { ...type.status, color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted, marginTop: 2 },
  status: { alignItems: 'flex-end', marginLeft: space.s, flexShrink: 0 },
  statusText: { ...type.caption, color: colors.textMuted },
  chevron: { fontSize: 20, lineHeight: 24, color: colors.iconMuted, marginLeft: space.s },
  rowTitle: { ...type.status, color: colors.text },
  rowDetail: { ...type.small, color: colors.textMuted, marginTop: 2 },
  rowRight: { ...type.caption, color: colors.textMuted },
  action: { ...type.captionBold, marginLeft: space.s },
});
