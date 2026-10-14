// The down chevron on the line leaving a stay (history list and PNG export,
// 2026-10-14): a solid arrowhead, notched at the top, on the 24-unit icon
// grid. `from` / `to` are where the shape starts and ends down that grid: the
// line is cleared around the shape, not around the empty corners of its box.
// (The thin 「∨」 #163 drew was lighter than a car's 3dp line and read as a
// break in it; the user found it merged into the stay's node.)
export const LEAVE_SHAPE = { path: 'M2.5 6L12 11L21.5 6L12 19Z', from: 6, to: 19 };
