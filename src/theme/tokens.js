// The design values DESIGN.md describes (v3 UI). Screens move onto these one by
// one; until a screen has moved, it keeps its own colours (AppTheme, ScreenUI).
// DESIGN.md lists every colour here with its hex value, and
// __tests__/DesignTokens.test.js keeps the two in step.

export const colors = {
  bg: '#FAF7F6',
  surface: '#FFFFFF',
  text: '#222222',
  textMuted: '#5E5E5E',
  line: '#EDE6E4',
  // Saturated coral is a shape colour (default dog avatar, range selection,
  // selected-row edge). White text on it is only 2.49:1, so never put text on it.
  accent: '#F2867A',
  // Primary actions are a pale fill with dark text, so the screen stays light.
  tonal: '#FFE4DF',
  tonalText: '#A3413A',
  brandSoft: '#FFF1EE',
  ok: '#1E7A3C',
  okBg: '#E4F2E8',
  warn: '#9A5B00',
  warnBg: '#FFF1D6',
  // Problems are dark red words on a pale card, not a slab of red.
  crit: '#7A1D18',
  critBg: '#FFF3F1',
  // A line colour (alert card edge, out-of-range dashed line); no text on it.
  critLine: '#D64545',
  // Receiver icon in settings and the indoor-hold house badge.
  receiver: '#3E5A6B',
  // Ring and number tag of the receiver icon (settings).
  receiverRing: '#5B7A8C',
  phone: '#1A73E8',
  phoneStale: '#9AA59F',
  iconMuted: '#8A948F',
  // The bottom snackbar is white with a shadow, like a card; no dark slab.
  snackbar: '#FFFFFF',
  scrim: 'rgba(20,24,22,0.45)',
  pressedOverlay: 'rgba(0,0,0,0.08)',

  // v3 additions.
  activityLow: '#3E5A8C',
  activityNormal: '#D3CCC4',
  // Chart fill only; the card's 劇烈活動 text uses activityHighText.
  activityHigh: '#E07A2E',
  activityHighText: '#B85A12',
  // The one red "!" for every dog problem, on the map and on card rows.
  problemBadge: '#B3261E',
  // Amber "!" circle in front of the card's 快離開接收範圍 value.
  warnIcon: '#9A5B00',
  // History cursor resting in a gap with no data (not used on the live map).
  staleRing: '#6B7470',
  // Illustrated avatar face once a dog has no new position (photos go grey).
  staleFace: '#C9CFCC',
  routeFaded: '#7C8796',
  mapLabelHalo: '#FFFFFF',
  // Dog route colour slots: the dog opened from its card takes route1; added
  // dogs keep their slot, a new dog takes the lowest free one.
  route1: '#D9604F',
  route2: '#2F6FA8',
  route3: '#4E8A2E',
  route4: '#8A55B0',
  // Lines of a dog face drawn on its route colour (history cursor faces, H7).
  onRoute: '#FFFFFF',
  // The grab handle on top of a bottom sheet or the history panel.
  sheetHandle: '#B9C3BD',
  alertBorder: '#F4CFC9',
  alertIconBg: '#FDE7E4',
  // The second line of a problem card (top card): muted red-brown.
  alertDetail: '#8A5A55',
  // Receiver range ring (1 km): drawn with rangeRingOpacity below.
  rangeRing: '#5B7A8C',
  // Timeline track where there is no data (long dash).
  noDataLine: '#C9CFCC',
  // Grey map background when the base map cannot load.
  mapFallback: '#ECEEEC',
};

export const routeColors = [colors.route1, colors.route2, colors.route3, colors.route4];

// Settings home icons: tinted 36dp square (bg) with a 2dp line icon (line).
export const settingIcon = {
  receiver: { bg: '#E6EEF3', line: '#3E5A6B' },
  phone: { bg: '#E8F0FD', line: '#1A73E8' },
  account: { bg: '#EEEAF7', line: '#5E4FA3' },
  diagnostics: { bg: '#F1EEEC', line: '#6B7470' },
  advanced: { bg: '#F1EEEC', line: '#6B7470' },
  map: { bg: '#EAF2E4', line: '#4E7A2E' },
  alerts: { bg: '#FBECE9', line: '#B3261E' },
};

export const opacity = {
  disabled: 0.4,
  rangeRingStroke: 0.55,
  rangeRingFill: 0.06,
  phoneAccuracy: 0.15,
  cursorHalo: 0.18,
  routeUpcoming: 0.3,
  routeBeforeCursor: 0.5,
  routeAfterCursor: 0.2,
  // The protagonist's face glow among several dogs (H7), in its route colour.
  faceGlow: 0.28,
};

// Text styles. Key text is at least 16sp and nothing is below 13sp, except the
// text inside graphics and the small second lines listed in DESIGN.md §3.
export const type = {
  headline: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  nameEdit: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  status: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  cardTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  value: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  captionBold: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  mapLabel: { fontSize: 13, lineHeight: 16, fontWeight: '700' },
  small: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  stopNumber: { fontSize: 12, lineHeight: 14, fontWeight: '700' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
};

// Text styles allowed under 13sp (DESIGN.md §3 exceptions) and their floor.
export const smallTypeExceptions = { small: 12, stopNumber: 12, micro: 11 };

// Times, distances and the timeline's time column use tabular figures.
export const tabularNumbers = { fontVariant: ['tabular-nums'] };

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };

export const layout = {
  screenEdge: 16,
  floatingGap: 12,
  cardPadding: 16,
  belowStatusBar: 8,
  framePadding: 24,
  emptyStatePadding: 32,
};

export const radius = {
  full: 999,
  button: 999,
  chip: 999,
  card: 16,
  sheet: 16,
  menu: 16,
  scanFrame: 16,
  alertCard: 14,
  rangeFrame: 14,
  input: 12,
  snackbar: 12,
  stayRow: 12,
  settingIcon: 10,
  cursorLabel: 10,
  mapLabel: 6,
  dialog: 24,
};

// 48dp is the smallest target; primary actions (開始使用, 看軌跡) are 56dp.
export const touch = {
  min: 48,
  primary: 56,
  secondary: 48,
  row: 56,
  cardRow: 48,
  cardRowTwoLine: 64,
  subpageHeader: 56,
  calendarCell: 44,
};

export const size = {
  icon: { canvas: 24, stroke: 2, map: 22, row: 20, walk: 20, pencil: 20, adjust: 18 },
  marker: { normal: 40, attention: 48, selectedGrowth: 8, border: 2.5, labelGap: 2 },
  badge: { size: 16, border: 1.5, glyph: 9, offset: 4, offsetLarge: 6 },
  mapLabel: { paddingV: 2, paddingH: 6, border: 1, halo: 3, maxLines: 2 },
  phoneDot: { size: 14, border: 3, staleAfterMs: 3000 },
  floatingButton: 48,
  chip: { height: 36, paddingH: 12, avatar: 20, leadBorder: 2 },
  todayPill: { height: 48, paddingH: 16, iconGap: 6 },
  groupTag: { height: 32, paddingH: 10, problemDot: 8 },
  edgeHint: { height: 36, avatar: 24, overlap: 6, maxAvatars: 3, problemBorder: 2 },
  overlapMenu: { width: 240, row: 56, avatar: 32, maxRows: 5 },
  card: { avatar: 40, labelWidth: 72, warnIcon: 18, maxRatio: 0.75 },
  activity: { segmented: 36, chart: 200, totalRow: 56 },
  alertCard: { edge: 4, border: 1, icon: 32, buttonHeight: 28, gap: 8 },
  smallChip: { height: 28 },
  listRow: { avatar: 32 },
  edit: { avatar: 96, camera: 36, pencil: 16, choice: 48, colorDot: 32 },
  switch: { width: 52, height: 32 },
  input: { height: 56, border: 1.5, focusBorder: 2 },
  progress: { segments: 4, height: 4, gap: 4 },
  scanFrame: { inset: 96, corner: 4 },
  splash: { canvas: 240, visible: 160 },
  rangeRing: { radiusM: 1000 },
  route: { walk: 4, upcoming: 3, secondary: 3, drive: 2, faded: 2, fadedDash: [4, 4], breakAfterMs: 180000 },
  stopMarker: { size: 22, border: 2 },
  timeMarker: { size: 7, border: 1.6, endSize: 9, endBorder: 2.4 },
  cursor: { dot: 16, border: 3, halo: 32, labelGap: 12, labelPaddingV: 4, labelPaddingH: 8 },
  rangeBar: { track: 6, handle: 24, handleBorder: 3, frameBorder: 1.5 },
  timeline: {
    timeColumn: 54,
    timeColumnMax: 72,
    track: 36,
    dot: 3,
    dotGap: 7,
    driveLine: 3,
    noDataLine: 2,
    noDataDash: [6, 4],
    rowGap: 12,
    icon: 20,
    node: { start: 16, stop: 24, end: 18, resume: 12, hold: 24, holdGlyph: 14, border: 3 },
  },
  sheet: { collapsed: 140, maxRatio: 0.75, emptyRatio: 0.4, dataSourceRow: 48 },
  calendarDot: 5,
};

export const shadow = {
  floating: {
    shadowColor: '#3A2420',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
};

export const motion = {
  // cubic-bezier(0.23, 1, 0.32, 1)
  easeOut: [0.23, 1, 0.32, 1],
  press: { scale: 0.97, duration: 120 },
  cardRise: { duration: 220 },
  rangeExpand: { duration: 220 },
  rangeCollapse: { duration: 180 },
  cursorJump: { duration: 220 },
  camera: { duration: 300 },
  splashMax: 800,
  sheetSpring: { damping: 26, stiffness: 260, mass: 1 },
  alertCardVisibleMs: 5000,
  snackbarVisibleMs: 5000,
};

// Touch haptics follow the system setting and are off under TalkBack; alert
// vibration follows the alerts 震動 switch.
export const haptics = {
  cursorTenMinutes: 'EFFECT_TICK',
  cursorHour: 'EFFECT_CLICK',
  stop: 'EFFECT_DOUBLE_CLICK',
  edge: 'EFFECT_HEAVY_CLICK',
  rangeRelease: 'EFFECT_TICK',
  dateChange: 'EFFECT_TICK',
  rangeRejected: 'EFFECT_DOUBLE_CLICK',
  alert: [200, 100, 200],
  alertCritical: [500, 150, 200, 150, 500],
  alertMinIntervalMs: 120000,
};
