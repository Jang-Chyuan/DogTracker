// The stable order of the faces in an off-screen hint (DESIGN.md §9.6, #139):
// the dog whose card is open first, then by signal-source number. Not by
// distance or screen position, which change with every camera move (real
// phone: faces sorted by distance swapped places between renders). Only
// EdgeHints uses it, and a hint holds only dogs with a problem, so there is
// no "problems first" step (audit B F15: an earlier one was never in §9.6).
// The card's row of dogs has its own order, by number only, the open dog in
// its own place (DogSwitch.switchOrder, DESIGN.md §15「換狗」, #151).

/** Array.sort comparator over DogMarkers.dogMarkers items. */
export const compareDogOrder = (left, right) => Number(!!right.selected) - Number(!!left.selected)
  || left.slaveId - right.slaveId;
