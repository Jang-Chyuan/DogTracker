// Original light design values. ThemeProvider combines these with the exact
// dark palette; views read useTheme rather than importing a static palette.
// DESIGN.md and DesignTokens.test.js keep both schemes in step.

export const colors = {
  bg: '#FAF7F6',
  surface: '#FFFFFF',
  text: '#222222',
  textMuted: '#5E5E5E',
  line: '#EDE6E4',
  skeleton: '#EDE6E4',
  skeletonHighlight: '#F7F2F0',
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
  // A4 日: pale grounds behind the curve — the 高活動 0.8 以上 / 低活動 0.05 以下
  // zones and the time of each 休息 / 劇烈 run. No text on them except the two
  // zone labels (warn / textMuted).
  activityHighBand: '#FDE7D6',
  activityLowBand: '#E6ECF3',
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
  // History list pills (screen and exported PNG): 出發、結束、恢復記錄 on
  // pillPlain, 室內 on pillIndoor (receiver text).
  pillPlain: '#F1EEEC',
  pillIndoor: '#E6EEF3',
  // Red words of an action that deletes or a failure to act on (中斷連線、
  // 刪除全部狗資料、Wi-Fi 刪除／重試). Light keeps problemBadge's red.
  critAction: '#B3261E',
  // D0's white line dog (the launch screen and its handover), both themes.
  splashLine: '#FFFFFF',
};

export const routeColors = [
  colors.route1,
  colors.route2,
  colors.route3,
  colors.route4,
];

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
export const fontWeight = { medium: '500' };

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
  // 窄螢幕 (設計稿「320dp 寬」): the history top row goes compact.
  narrowWidth: 320,
  screenEdge: 16,
  floatingGap: 12,
  cardPadding: 16,
  belowStatusBar: 8,
  framePadding: 24,
  emptyStatePadding: 32,
  // How far a covered native map is moved off screen (its surface is not
  // hidden by opacity or by an opaque page over it).
  offscreen: 100000,
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
  snackbar: 999,
  stayRow: 12,
  settingIcon: 999,
  cursorLabel: 16,
  mapLabel: 999,
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

// Border weights: line frames, outlined controls, selection and graphic rings (§4 / §15).
export const border = {
  hairline: 1,
  regular: 1.5,
  strong: 2,
  graphicFine: 1.6,
  graphicBold: 2.4,
  extraStrong: 2.5,
  heavy: 3,
  emphasis: 4,
};
// Existing weight overrides retain their original rendering without inventing a type size.
export const weights = { medium: '600' };

export const size = {
  icon: {
    canvas: 24,
    stroke: 2,
    map: 22,
    row: 20,
    walk: 20,
    pencil: 20,
    adjust: 18,

    // Icon roles used by compact actions and navigation (§5 / §15).
    inline: 16,
    // The back icon of every page header (066: 22 was too small to hit).
    navigation: 28,
    smallAction: 18,
    visibility: 26,
    stat: 15,
  },
  marker: {
    normal: 40,
    attention: 48,
    selectedGrowth: 8,
    border: border.extraStrong,
    labelGap: 2,

    // Dog marker bitmap canvas, shadow placement and stale-ring clearance (§15).
    canvas: 168,
    // The widest name text in a tag (D14 MARKER_WIDTH adds the capsule).
    textWidth: 156,
    headroom: 8,
    staleRingOutset: 3,
    selectedShadowDrop: 3,
    shadowDrop: 1,
    labelSafety: 8,
  },
  badge: {
    size: 16,
    border: border.regular,
    glyph: 9,
    problemAngle: Math.PI / 4,
    houseDrop: 0.25,
    // Graphic exclamation text metrics (map/card/settings badges, §15).
    problemLine: 10,
    problemWeight: '900',
    cardWeight: '800',
  },
  // D14: capsules (full radius), 12 when the name wraps to two lines.
  mapLabel: {
    radius: radius.full,
    radiusWrapped: 12,
    paddingV: 2,
    paddingH: 8,
    border: border.hairline,
    halo: 3,
    maxLines: 2,
  },
  phoneDot: {
    size: 14,
    border: border.heavy,
    staleAfterMs: 3000,
    // Phone marker bitmap canvas and live GPS disc.
    canvas: 30,
    liveDisc: 20,
  },
  floatingButton: 48,
  chip: { height: 36, paddingH: 12, avatar: 20, leadBorder: border.strong },
  todayPill: { height: 48, paddingH: 16, iconGap: 6 },
  groupTag: { height: 32, paddingH: 8, problemDot: 8, dotGap: 6, safety: 8 },
  edgeHint: {
    height: 36,
    avatar: 24,
    overlap: 6,
    maxAvatars: 3,
    problemBorder: border.strong,

    // Width of the outward-pointing edge-hint arrow (§15).
    arrow: 10,
  },
  card: {
    avatar: 40,
    labelWidth: 72,
    warnIcon: 18,
    // A3 direction arrow accompanying the headline distance.
    directionIcon: 26,
    maxRatio: 0.75,
  },
  activity: {
    segmented: 36,
    chart: 200,
    totalRow: 56,
    // A4 chart labels, legend swatches and high-zone label placement (§15).
    barLabel: 40,
    legendSwatch: 10,
    zoneLabelInset: 2,
    // D20 day view: 96 quarter-hour bars, 1dp apart, 1.5dp top corners; an
    // empty quarter is a 3dp no-data line.
    dayBarGap: 1,
    dayBarRadius: 1.5,
    dayGapHeight: 3,
    // A quarter with readings is at least this tall (visible at 0).
    dayBarMin: 3,

    // activity axis label in its illustration/layout specification.
    axisLabel: 44,
    // activity band min in its illustration/layout specification.
    bandMin: 1,
  },
  alertCard: {
    edge: border.emphasis,
    border: border.hairline,
    icon: 32,
    buttonHeight: 28,
    gap: 8,
    // Alert dismissal icon and original floating-card shadow (§15).
    closeIcon: 24,
    shadowDrop: 3,
    // A6 grows with its words up to this, then scrolls inside (設計稿「A6 卡片的高度」).
    a6MaxHeight: 180,
    // With a large font A6 grows past 180dp, to at most this share of the screen.
    a6MaxScreenShare: 0.5,
  },
  smallChip: { height: 28 },
  listRow: { avatar: 32 },
  // 判定表「載入中、產生中」: the small spinner (export, downloads).
  spinner: 20,
  edit: {
    avatar: 96,
    camera: 36,
    pencil: 16,
    choice: 48,
    colorDot: 32,
    // A5 camera overlap and minimum editable dog-name field.
    cameraOverhang: 2,
    nameMinimum: 64,

    // edit preview in its illustration/layout specification.
    preview: 80,
    // edit choice ring clearance in its illustration/layout specification.
    choiceRingClearance: 8,
    // edit color ring clearance in its illustration/layout specification.
    colorRingClearance: 8,
  },
  switch: { width: 52, height: 32 },
  input: { height: 56, border: border.regular, focusBorder: border.strong },
  progress: { segments: 4, height: 4, gap: 4 },
  scanFrame: {
    inset: 96,
    corner: 4,
    // QR scanning beam thickness and end shape.
    beam: 2,
    beamRadius: 1,

    // scanFrame minimum in its illustration/layout specification.
    minimum: 160,
  },
  splash: {
    canvas: 240,
    visible: 160,
    // splash handover canvas in its illustration/layout specification.
    handoverCanvas: 288,
  },
  rangeRing: { radiusM: 1000 },
  route: {
    walk: 4,
    upcoming: 3,
    secondary: 3,
    drive: 2,
    faded: 2,
    fadedDash: [4, 4],
    breakAfterMs: 180000,
  },
  stopMarker: { size: 22, border: border.strong },
  timeMarker: {
    size: 7,
    border: border.graphicFine,
    endSize: 9,
    endBorder: border.graphicBold,
    // Inset of the time-marker halo text graphic (§15).
    labelInset: 3,
  },
  cursor: {
    dot: 16,
    border: border.heavy,
    halo: 32,
    labelGap: 12,
    labelPaddingV: 4,
    labelPaddingH: 10,

    // History cursor label collision footprint and graphic text metrics.
    collisionBoxWidth: 146,
    collisionBoxHeight: 58,
    labelTextMax: 160,
    timeGlyphLine: 20,
    detailGlyphLine: 17,

    // cursor label halo expansion in its illustration/layout specification.
    labelHaloExpansion: 16,
  },
  rangeBar: {
    track: 6,
    handle: 24,
    handleBorder: border.heavy,
    frameBorder: border.regular,
    // Range labels and track-to-summary alignment (§15).
    labelHeight: 18,
    labelBaselineLift: 6,
    summaryOverlap: 14,
    labelEdgeGap: 2,
  },
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
    node: {
      start: 16,
      stop: 24,
      end: 18,
      resume: 12,
      hold: 24,
      holdGlyph: 14,
      border: border.heavy,

      // Node baselines inside the timeline track (§13).
      departureDrop: 2,
      stayLift: 3,
      endDrop: 1,
    },

    // History timeline section-row footprint (§13).
    sectionHeight: 40,

    // §13 timeline status pills.
    pill: {
      height: 18,
    },
  },
  sheet: {
    collapsed: 140,
    maxRatio: 0.75,
    emptyRatio: 0.4,
    // Bottom-sheet grab handle and collapsed dog-card footprint (§15).
    handleLength: 32,
    cardHandleLength: 36,
    handleThickness: 4,
    handleTarget: 20,
    collapsedCard: 76,
    // Dog-card sheet stops: header reservation, enlarged title and screen clearance.
    headerReserve: 28,
    titleReserve: 36,
    expandedClearance: 110,
    compactFloor: 160,
    compactRatio: 0.43,
  },
  calendarDot: 5,

  // Fixed-pixel PNG layout specification (判定表「匯出」), independent of screen dp/sp.
  export: {
    // H10 PNG header floor and legend text reservation.
    headerMin: 120,
    legendReserve: 160,
    width: 1080,
    maxHeight: 2400,
    mapHeight: 1080,
    footerHeight: 60,
    side: 48,
    timeColumn: 150,
    trackColumn: 80,
    titleFont: 40,
    titleWeight: 'bold',
    subtitleFont: 28,
    fontFamily: 'app',
    addressWeight: 'bold',
    addressFont: 40,
    addressLine: 52,
    timeFont: 36,
    endTimeFont: 28,
    detailFont: 30,
    detailLine: 42,
    pillHeight: 52,
    pillPadding: 20,
    secondLine: 64,
    nodeSize: 64,
    movementIcon: 72,
    legendFont: 28,
    legendWeight: 'bold',
    legendHeight: 56,
    sectionFont: 36,
    sectionDetailFont: 28,
    sectionWeight: 'bold',
    sectionHeight: 72,
    footerFont: 24,
    placeMin: 140,
    movementMin: 96,
    rowGap: 36,
    dottedLine: { diameter: 9, gap: 21 },
    driveLine: 9,
    gapLine: { width: 6, dash: [18, 12] },
    sectionInset: 24,
    glyphInset: 20,
    rowInset: 8,
    legendSwatchWidth: 32,
    legendTextInset: 44,
    legendGap: 12,
    glyphSize: 40,
    sectionRadius: 4,
    timeInset: 16,
    sectionTextInset: 28,
    departureRadius: 22,
    nodeBorder: 6,
    endRadius: 27,
    titleLine: 52,
    subtitleLine: 38,
    sectionLine: 48,
    routeScale: 3,

    // export movement inset in its illustration/layout specification.
    movementInset: 54,
    // export map inset in its illustration/layout specification.
    mapInset: 128,
    // export header top in its illustration/layout specification.
    headerTop: 32,
    // export title gap in its illustration/layout specification.
    titleGap: 8,
    // export header bottom in its illustration/layout specification.
    headerBottom: 24,
    // export legend bottom in its illustration/layout specification.
    legendBottom: 16,
    // export legend trailing in its illustration/layout specification.
    legendTrailing: 40,
    // export legend swatch height in its illustration/layout specification.
    legendSwatchHeight: 12,
    // export legend swatch radius in its illustration/layout specification.
    legendSwatchRadius: 6,
    // export departure border in its illustration/layout specification.
    departureBorder: 8,
    // export resume radius in its illustration/layout specification.
    resumeRadius: 16,
    // export end border in its illustration/layout specification.
    endBorder: 12,
    // export node digit in its illustration/layout specification.
    nodeDigit: 32,
    // export node digit line in its illustration/layout specification.
    nodeDigitLine: 40,
    // export end time line in its illustration/layout specification.
    endTimeLine: 40,
    // export section edge in its illustration/layout specification.
    sectionEdge: 8,
    // export section padding in its illustration/layout specification.
    sectionPadding: 12,
    // export item gap in its illustration/layout specification.
    itemGap: 20,
  },

  // 24-unit SVG glyph grid: battery, receiver and phone silhouettes.
  glyph: {
    batteryBodyWidth: 17,
    batteryBodyHeight: 10,
    batteryFillHeight: 6,
    batteryFillMin: 1.5,
    batteryFillSpan: 13,
    receiverBodyWidth: 12,
    receiverBodyHeight: 10,
    phoneBodyWidth: 12,
    phoneBodyHeight: 19,

    // glyph settings phone width in its illustration/layout specification.
    settingsPhoneWidth: 10,
  },

  // Diagnostics raw-data column minimums by field.
  diagnostics: {
    columnWidth: {
      time: 84,
      receiverId: 64,
      sourceId: 64,
      latitude: 96,
      longitude: 104,
      distance: 76,
      speed: 92,
      satellites: 52,
      precision: 64,
      activity: 72,
      dogBattery: 92,
      receiverBattery: 104,
      signalStrength: 64,
      signalNoise: 56,
      sequence: 60,
    },
  },

  // Empty-state sitting-dog illustration canvas.
  sittingDog: {
    canvas: 80,
  },

  // Receiver silhouette and attached number-tag dimensions.
  receiver: {
    tagPaddingH: 3,

    // receiver tag minimum in its illustration/layout specification.
    tagMinimum: 18,
    // receiver tag overhang in its illustration/layout specification.
    tagOverhang: 6,
    // receiver body width in its illustration/layout specification.
    bodyWidth: 12,
    // receiver body height in its illustration/layout specification.
    bodyHeight: 9,
  },

  // Settings home icon tile (§15).
  settings: {
    icon: 36,
  },

  // Map data-source capsule and connection notice stack.
  mapSource: {
    height: 36,
    statusDot: 7,
    noticeLimit: 108,

    // mapSource notice top reserve in its illustration/layout specification.
    noticeTopReserve: 44,
  },

  // Password input interior and compact retry row.
  login: {
    passwordHeight: 52,
    retryHeight: 32,
  },

  // Permission result icon disc in onboarding.
  permission: {
    statusDisc: 24,
  },

  // Confirmation dialog readable content limit and action width (§5).
  dialog: {
    contentLimit: 400,
    actionMinimum: 64,
    shadowDrop: 6,
  },

  // History loading placeholder line.
  skeleton: {
    line: 14,
    // D8 shaped skeletons (H3c list, A4, S3, S8).
    padding: 16,
    rowGap: 12,
    rowSpacing: 24,
    timelineRow: 64,
    labelGap: 10,
    chart: 180,
  },

  // 「看哪幾隻狗」 rows (清單列: at least 56dp, avatar 32dp; user 2026-10-09)
  // and the selected radio indicator.
  historyPicker: {
    row: 56,
    avatar: 32,
    radio: 20,
    radioFillRing: 6,
    // Plus sign inside the history dog-picker button.
    addGlyph: 18,
  },

  // History top capsules: avatar sizes, overlap and text reservation (§15).
  historyTop: {
    phoneAvatar: 32,
    capsuleTextMax: 80,
    avatar: 26,
    companionAvatar: 18,
    avatarOverlap: 6,
    slotLimit: 240,
    exportDisc: 36,
    caretGlyph: 10,
    // 「＋」 in a dashed accent circle, avatar-sized (user 2026-10-09, B).
    plusRing: 32,
    plusRingDash: [3, 3],
  },

  // History face name tag and stale-ring clearance (§15 map labels).
  historyFace: {
    labelHeight: 22,
    // H7 secondary dog cursor face.
    companion: 32,
    staleOutset: 4,
  },

  // Calendar today capsule and cell gutter around the selection frame.
  calendar: {
    todayPill: 32,

    // calendar cell gutter in its illustration/layout specification.
    cellGutter: 4,
  },

  // History date selector capsule (§15).
  datePill: {
    height: 40,
  },

  // H3 month selector capsule (§15 bottom calendar sheet).
  monthPill: {
    height: 40,
  },

  // Circular loading indicator over the map.
  mapLoading: {
    spinnerDisc: 36,
  },

  // Settings gear problem dot and its corner inset (§15).
  gear: {
    problemDot: 10,
    problemDotInset: 2,
  },

  // Illustrated avatar viewBox grid; independent of displayed avatar diameter.
  avatar: {
    artGrid: 100,

    // avatar photo source in its illustration/layout specification.
    photoSource: 512,
  },

  signalBars: {
    // signalBars canvas width in its illustration/layout specification.
    canvasWidth: 16,
    // signalBars canvas height in its illustration/layout specification.
    canvasHeight: 12,
    // signalBars bar width in its illustration/layout specification.
    barWidth: 3,
  },

  historyPanel: {
    // historyPanel corner in its illustration/layout specification.
    corner: 24,
  },

  mapFrame: {
    // mapFrame history controls in its illustration/layout specification.
    historyControls: 56,
    // mapFrame history panel in its illustration/layout specification.
    historyPanel: 48,
    // mapFrame label half in its illustration/layout specification.
    labelHalf: 72,
  },
};

// 大字體 (DESIGN.md §3.4): the system font scales where layouts change.
export const fontScale = {
  // 130%: lines that would be cut wrap; the history top row goes compact.
  large: 1.3,
  // 200% (Android's 1.8 and 2.0 steps): the calendar becomes a list of days,
  // and the history dog capsule keeps only the face.
  calendarList: 1.8,
  faceOnly: 1.8,
  // Words placed inside a graphic grow only this far (A4 chart labels, the
  // times under the range bar's handles).
  graphicTextMax: 1.15,
  // The timeline's times grow until 「07:02」 fills the 72dp column.
  timeColumnTextMax: 1.5,
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
  // 減少動態效果: a slide becomes this fade (the launch's own reduced fade too).
  reducedFade: { duration: 200 },
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

// Explicit semantic values that have no original palette entry.
// Dark values for light tokens added after the design's dark table
// (dark-tokens.json): the history list pills of #70 and critAction. Each follows the dark
// rules — a fill one step brighter than the panel it sits on (elevated
// #302827, like the light pill on white), its text still above 4.5:1.
//   pillPlain  #3D3432: textMuted 5.70:1, against elevated 1.19:1 (light 1.13:1)
//   pillIndoor #2A3A44: receiver 5.77:1, against elevated 1.23:1
//   critAction #FFB4AB: 9.44:1 on surface, 8.48:1 on elevated
export const darkAdditions = {
  pillPlain: '#3D3432',
  pillIndoor: '#2A3A44',
  // Dark problemBadge is only 3.37:1 as text on surface; the dark rule
  // 「會刪資料的動作 crit（深色是淡紅字）」 gives crit's #FFB4AB (9.44:1).
  critAction: '#FFB4AB',
  // A4 日 grounds, from the design's dark A4 mockup: warn 7.6:1 on the high
  // ground, textMuted 6.8:1 on the low one; the curve (route1) above 3:1 on both.
  activityHighBand: '#362A21',
  activityLowBand: '#212B36',
  // D0's dog stays white on the dark launch screen (design 深色模式「啟動畫面」).
  splashLine: '#FFFFFF',
};

export const extras = {
  elevated: colors.surface,
  grabHandle: colors.sheetHandle,
  switchOff: colors.line,
  floatingOutline: colors.line,
  onWarnIcon: '#FFFFFF',
  routeCasing: '#FFFFFF',
  staleLine: '#5B645F',
  avatarFrameMap: '#FFFFFF',
};
