import { emptyTrackingPoint } from '../models/TrackingPoint';
import { mergePositionSamples } from './RouteSamples';
import { emptyLiveRoute } from './LiveRouteWindow';

function emptySourceState() {
  return {
    point: emptyTrackingPoint,
    ready: false,
    caughtUp: false,
    route: emptyLiveRoute(),
    positionSamples: [],
    historyLoaded: false,
    initialSnapshotReady: false,
  };
}

export function createTrackingSourceState() {
  return { real: emptySourceState(), demo: emptySourceState() };
}

function updateSource(state, source, update) {
  const previous = state[source];
  const next = update(previous);
  return next === previous ? state : { ...state, [source]: next };
}

export function trackingSourceReducer(state, action) {
  if (action.type === 'reset-all') return createTrackingSourceState();
  return updateSource(state, action.source, previous => {
    switch (action.type) {
      case 'ready':
        return previous.ready ? previous : { ...previous, ready: true };
      case 'refreshing':
        return previous.caughtUp ? { ...previous, caughtUp: false } : previous;
      case 'caught-up':
        return previous.caughtUp ? previous : { ...previous, caughtUp: true };
      case 'latest':
        if (!action.point) return previous;
        return {
          ...previous,
          point: action.point,
          positionSamples: mergePositionSamples(
            previous.positionSamples,
            [action.point],
            action.point,
          ),
        };
      case 'position-context':
        if (!action.rows.length) return previous;
        return {
          ...previous,
          positionSamples: mergePositionSamples(
            previous.positionSamples,
            action.rows,
            previous.point,
          ),
        };
      case 'initial-snapshot-ready':
        return previous.initialSnapshotReady
          ? previous
          : { ...previous, initialSnapshotReady: true };
      case 'route':
        return previous.route === action.route
          ? previous
          : { ...previous, route: action.route };
      case 'history-loading':
        return { ...previous, historyLoaded: false };
      case 'history-loaded':
        return previous.historyLoaded
          ? previous
          : { ...previous, historyLoaded: true };
      case 'rows': {
        if (!action.rows.length) return previous;
        const newest = action.rows.reduce((latest, row) =>
          !latest || row.id > latest.id ? row : latest,
        );
        const nextPoint =
          newest.id > (previous.point.id ?? 0) ? newest : previous.point;
        return {
          ...previous,
          positionSamples: mergePositionSamples(
            previous.positionSamples,
            action.rows,
            nextPoint,
          ),
          // History backfill must never rewind the live status card.
          point: nextPoint,
        };
      }
      case 'reset-source':
        return { ...emptySourceState(), ready: previous.ready };
      default:
        return previous;
    }
  });
}
