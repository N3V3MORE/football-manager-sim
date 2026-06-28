import { Player } from '../models/types';

export const REGULATION_MATCH_MINUTES = 90;
export const EXTRA_TIME_MATCH_MINUTES = 120;

export const clampToMatchMinutes = (value: number, maxMinutes = REGULATION_MATCH_MINUTES) => (
  Math.max(0, Math.min(maxMinutes, value))
);

export const buildStarterBenchMinuteMap = (
  starters: Player[],
  bench: Player[],
  starterMinutes = REGULATION_MATCH_MINUTES,
  maxMinutes = REGULATION_MATCH_MINUTES
) => {
  const minutes: Record<string, number> = {};
  const starterValue = clampToMatchMinutes(starterMinutes, maxMinutes);
  starters.forEach(player => {
    minutes[player.id] = starterValue;
  });
  bench.forEach(player => {
    if (minutes[player.id] === undefined) minutes[player.id] = 0;
  });
  return minutes;
};

export const buildStarterMinuteMap = (
  starters: Player[],
  sentOffMinutes?: Record<string, number>,
  maxMinutes = REGULATION_MATCH_MINUTES
) => {
  const minutes: Record<string, number> = {};
  starters.forEach(player => {
    const cap = sentOffMinutes?.[player.id];
    minutes[player.id] = clampToMatchMinutes(cap ?? maxMinutes, maxMinutes);
  });
  return minutes;
};

export const applyMinuteCaps = (
  minuteMap: Record<string, number>,
  caps: Record<string, number>,
  maxMinutes = REGULATION_MATCH_MINUTES
) => {
  Object.entries(caps).forEach(([playerId, minute]) => {
    if (minuteMap[playerId] === undefined) return;
    minuteMap[playerId] = Math.min(minuteMap[playerId], clampToMatchMinutes(minute, maxMinutes));
  });
};
