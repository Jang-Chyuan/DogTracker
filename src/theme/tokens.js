// The design values DESIGN.md describes. Screens move onto these one by one;
// until a screen has moved, it keeps its own colours (AppTheme, ScreenUI).

export const colors = {
  bg: '#FAF7F6',
  surface: '#FFFFFF',
  text: '#222222',
  textMuted: '#5E5E5E',
  line: '#EDE6E4',
  // Saturated coral is for the dog markers and the selection ring only.
  accent: '#F2867A',
  // Primary actions are a pale fill with dark text, so the screen stays light.
  tonal: '#FFE4DF',
  tonalText: '#A3413A',
  brandSoft: '#FFF1EE',
  ok: '#1E7A3C',
  okBg: '#E4F2E8',
  warn: '#9A5B00',
  warnBg: '#FFF1D6',
  // Problems are a pale card with a red edge and dark red text, not a slab of
  // red: the position, the ⚠ and the words carry it.
  crit: '#7A1D18',
  critBg: '#FFF3F1',
  critLine: '#D64545',
  receiver: '#2D3B45',
  phone: '#1A73E8',
};

export const type = {
  headline: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  status: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
};

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };

export const radius = { button: 999, card: 16, chip: 999, marker: 8 };

// 48dp is the smallest target; primary actions such as 重新連線 are 56dp.
export const touch = { min: 48, primary: 56 };

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
  panel: { duration: 220 },
  camera: { duration: 300 },
  sheetSpring: { damping: 26, stiffness: 260, mass: 1 },
};
