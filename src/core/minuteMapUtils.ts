import { Player } from '../models/types';

export const clampToMatchMinutes = (value: number) => Math.max(0, Math.min(90, value));

export const buildStarterBenchMinuteMap = (
  starters: Player[],
  bench: Player[],
  starterMinutes = 90
) => {
  const minutes: Record<string, number> = {};
  const starterValue = clampToMatchMinutes(starterMinutes);
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
  sentOffMinutes?: Record<string, number>
) => {
  const minutes: Record<string, number> = {};
  starters.forEach(player => {
    const cap = sentOffMinutes?.[player.id];
    minutes[player.id] = clampToMatchMinutes(cap ?? 90);
  });
  return minutes;
};

export const applyMinuteCaps = (
  minuteMap: Record<string, number>,
  caps: Record<string, number>
) => {
  Object.entries(caps).forEach(([playerId, minute]) => {
    if (minuteMap[playerId] === undefined) return;
    minuteMap[playerId] = Math.min(minuteMap[playerId], clampToMatchMinutes(minute));
  });
};
