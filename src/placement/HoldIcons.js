import { isChargingHold } from './HoldWords';

// The icon of a hold (2026-10-19, the user's choice from four mockups): a
// pavilion — a roof on two posts over a dot, the dog — for 遮蔽處, a
// lightning bolt for 充電中. Line icons on the receiver-blue disc, as the
// house was, so they stay apart from the coral stays. 24-unit grid, stroked
// 2 units wide; the dot is filled. map/Glyph.js, the live marker's badge and
// the PNG export (ExportDraw, HistoryExportPackage.kt) draw these paths.
export const HOLD_ICON_PATHS = Object.freeze({
  shelter: Object.freeze({ stroke: 'M3.5 10.5 12 4.5l8.5 6zM6.5 10.5v9M17.5 10.5v9',
    fill: 'M14 15.5a2 2 0 1 1-4 0a2 2 0 1 1 4 0' }),
  bolt: Object.freeze({ stroke: 'M13 2.5 5.5 13.5H12l-1 8 7.5-11H12z' }),
});

/** 'bolt' for a hold on the charger, otherwise 'shelter'. */
export const holdIcon = reason => (isChargingHold(reason) ? 'bolt' : 'shelter');
