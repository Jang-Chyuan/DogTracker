// The one stable order of the live map's dogs (DESIGN.md §9.6, #139): the dog
// whose card is open first, then dogs with a problem, then by signal-source
// number. Not by distance or screen position, which change with every camera
// move (real phone: faces sorted by distance swapped places between renders).
// The card's ‹ › switch uses it (DogSwitch.switchOrder).

/** Array.sort comparator over DogMarkers.dogMarkers items. */
export const compareDogOrder = (left, right) => Number(!!right.selected) - Number(!!left.selected)
  || Number(!!right.problem) - Number(!!left.problem)
  || left.slaveId - right.slaveId;
