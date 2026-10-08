import { size as sizes } from '../theme/tokens';

// Face size includes its white frame; badge size includes its ring.
export function problemBadgePosition(size, badgeSize = sizes.badge.size) {
  const inset = size * (1 - Math.cos(sizes.badge.problemAngle)) / 2 - badgeSize / 2;
  return { top: inset, right: inset };
}

export function houseBadgePosition(size, badgeSize = sizes.badge.size) {
  const radius = size / 2;
  const drop = size * sizes.badge.houseDrop;
  return {
    top: radius + drop - badgeSize / 2,
    left: radius - Math.sqrt(radius * radius - drop * drop) - badgeSize / 2,
  };
}
