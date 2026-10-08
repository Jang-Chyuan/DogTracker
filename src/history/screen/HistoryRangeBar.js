// The range bar of H2b (判定表「範圍條的軌道」「範圍條的右端和「現在」」
// 「範圍」): where its handles sit and what a drag of one makes of the range.
// Pure: HistoryRangeBar.js (the component) draws and drags it.
import { nearestRecord } from './HistoryScreenRange';

const MINUTE = 60000;
// The right end counts as reached this close to it (in track widths), so the
// end handle can be put back on 「跟著現在」 without pixel precision.
const RIGHT_EDGE_SHARE = 0.015;

/** The track: today 00:00 to this minute; another day 00:00 to 24:00. */
export function rangeTrack({ dayStart, dayEnd, today, now }) {
  return { start: dayStart, end: today ? Math.max(dayStart + MINUTE, Math.min(now, dayEnd)) : dayEnd };
}

/** Where a time sits on a track `width` wide (clamped to it). */
export function xOfTime(time, width, track) {
  const share = (time - track.start) / (track.end - track.start);
  return Math.max(0, Math.min(1, share)) * width;
}

/** The time under `x` on a track `width` wide. */
export function timeOfX(x, width, track) {
  return track.start + Math.max(0, Math.min(1, x / width)) * (track.end - track.start);
}

/**
 * The handles of a range: start at its first fix; end at its last fix, or —
 * following now — at the track's right end, labelled with this minute
 * (把手下面一律寫時刻，不寫「現在」).
 */
export function rangeHandles({ start, end, following }, track) {
  return { start, end: following ? track.end : end, following: !!following };
}

/**
 * A handle dragged to `x`: the minute under it snapped to the nearest fix of
 * the day (`dayPoints`). The end handle at the right end of today's track
 * follows now again. Returns { range, valid, atEdge }: `valid` false when the
 * start would not be at least a minute before the end (and before the end's
 * fix), which the bar refuses (彈回、震兩下); `atEdge` when the handle reached
 * either end of the track (拖到頭).
 */
export function dragRangeHandle(current, handle, x, width, { track, dayPoints, today }) {
  const time = timeOfX(x, width, track);
  const atEdge = x <= 0 || x >= width;
  if (!dayPoints.length) return { range: current, valid: false, atEdge };
  const lastFix = dayPoints[dayPoints.length - 1].time;
  if (handle === 'end' && today && x >= width * (1 - RIGHT_EDGE_SHARE)) {
    const range = { ...current, end: lastFix, following: true };
    return { range, valid: lastFix - range.start >= MINUTE, atEdge };
  }
  const snapped = nearestRecord(dayPoints, Math.round(time / MINUTE) * MINUTE).time;
  const range = handle === 'start' ? { ...current, start: snapped }
    : { ...current, end: snapped, following: false };
  const end = range.following ? lastFix : range.end;
  return { range, valid: end - range.start >= MINUTE, atEdge };
}

/** Whether the day's fixes span at least a minute (else the bar is off). */
export function rangeBarEnabled(dayPoints) {
  return dayPoints.length > 1 && dayPoints[dayPoints.length - 1].time - dayPoints[0].time >= MINUTE;
}

/**
 * TalkBack's step on a handle (判定表「範圍條兩端」: 上下滑每次 1 分鐘): the
 * first fix at least a minute later (`direction` 1) or earlier (-1). The end
 * stepped past the day's last fix today follows now again; stepped down from
 * following now it is that last fix. Returns { range, valid }.
 */
export function stepRangeHandle(current, handle, direction, { dayPoints, today }) {
  if (!dayPoints.length) return { range: current, valid: false };
  const lastFix = dayPoints[dayPoints.length - 1].time;
  const from = handle === 'start' ? current.start : current.following ? lastFix + MINUTE : current.end;
  const next = direction > 0 ? dayPoints.find(p => p.time >= from + MINUTE)
    : [...dayPoints].reverse().find(p => p.time <= from - MINUTE);
  let range;
  if (handle === 'end' && direction > 0 && !next) {
    if (!today || current.following) return { range: current, valid: false };
    range = { ...current, end: lastFix, following: true };
  } else if (!next) return { range: current, valid: false };
  else range = handle === 'start' ? { ...current, start: next.time } : { ...current, end: next.time, following: false };
  const end = range.following ? lastFix : range.end;
  return { range, valid: end - range.start >= MINUTE };
}
