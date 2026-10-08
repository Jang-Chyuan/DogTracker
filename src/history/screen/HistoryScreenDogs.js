import { makeStyles, resolveStyles } from '../../theme/ThemeProvider';
export const getROUTE_COLOURS = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return [
    themeLiteral.route1,
    themeLiteral.route2,
    themeLiteral.route3,
    themeLiteral.route4,
  ];
});
export function protagonist(dogs, current) {
  return (
    dogs.find(d => d.id === current && d.hasData)?.id ??
    dogs.find(d => d.hasData)?.id ??
    dogs.find(d => d.id === current)?.id ??
    dogs[0]?.id ??
    null
  );
}
export function dogTransition(state, event) {
  const ROUTE_COLOURS = resolveStyles(getROUTE_COLOURS);
  let dogs = state.dogs;
  if (event.type === 'add') {
    if (dogs.some(d => d.id === event.dog.id))
      return { ...state, message: null };
    if (dogs.length === 4) return { ...state, message: '最多同時 4 隻' };
    const slot = [0, 1, 2, 3].find(s => !dogs.some(d => d.slot === s));
    dogs = [
      ...dogs,
      {
        ...event.dog,
        slot,
        colour: ROUTE_COLOURS[slot],
        colourToken: `route${slot + 1}`,
      },
    ];
  }
  if (event.type === 'remove' && dogs.length > 1)
    dogs = dogs.filter(d => d.id !== event.id);
  if (event.type === 'data')
    dogs = dogs.map(d => ({ ...d, hasData: !!event.data[d.id] }));
  const clicked =
    event.type === 'select' ? dogs.find(d => d.id === event.id) : null;
  const current =
    clicked && (clicked.hasData || !dogs.some(d => d.hasData))
      ? clicked.id
      : state.protagonist;
  return {
    ...state,
    dogs,
    protagonist: protagonist(dogs, current),
    message: clicked?.downloadFailed ? '下載失敗　重試' : null,
  };
}
export function rangeOwner(dogs, entryId, mainId, remembered) {
  return dogs.some(d => d.id === entryId) && remembered[entryId]
    ? entryId
    : mainId;
}
export function dogPresentation(dogs) {
  return dogs.map(d => ({
    ...d,
    opacity: d.hasData ? 1 : 0.4,
    removable: dogs.length > 1,
    visible: d.hasData,
  }));
}
