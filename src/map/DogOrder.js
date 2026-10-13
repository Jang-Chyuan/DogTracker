// The one stable order of the dogs on the live map (DESIGN.md「摘要卡片」換狗):
// the dog whose card is open first, then dogs with a problem, then by
// signal-source number. Never by distance or screen position, which change
// with every camera move. The card's ‹ › step through it (DogSwitch).

/**
 * Array.sort comparator over dog markers ({ slaveId, problem, selected }).
 */
export const compareDogOrder = (left, right) => Number(!!right.selected) - Number(!!left.selected)
  || Number(!!right.problem) - Number(!!left.problem)
  || left.slaveId - right.slaveId;
