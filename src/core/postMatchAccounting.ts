import { Player } from '../models/types';
import { addPlayerStat } from './matchUtils';

export const CLEAN_SHEET_MINUTES_REQUIRED = 60;

export const didConcedeInWindow = (
  concededGoalMinutes: number[],
  windowStartMinute: number,
  windowEndMinute: number,
  concededGoalsTotal: number
) => {
  if (windowEndMinute <= windowStartMinute) return true;
  if (concededGoalMinutes.length === 0) return concededGoalsTotal > 0;
  return concededGoalMinutes.some(minute => minute > windowStartMinute && minute <= windowEndMinute);
};

export const qualifiesForWindowedCleanSheet = (
  concededGoalMinutes: number[],
  windowStartMinute: number,
  windowEndMinute: number,
  concededGoalsTotal: number
) => {
  const minutes = Math.max(0, windowEndMinute - windowStartMinute);
  return minutes >= CLEAN_SHEET_MINUTES_REQUIRED &&
    !didConcedeInWindow(concededGoalMinutes, windowStartMinute, windowEndMinute, concededGoalsTotal);
};

export const applyWindowedCleanSheets = (
  teamParticipants: Player[],
  teamStarterIds: Set<string>,
  minuteMap: Record<string, number>,
  concededGoalMinutes: number[],
  concededGoalsTotal: number,
  updatedPlayers: Record<string, Player>
) => {
  teamParticipants
    .filter(player => player.position === 'GK' || player.position === 'DEF')
    .forEach(player => {
      const minutes = Math.max(0, Math.min(90, minuteMap[player.id] || 0));
      if (minutes <= 0) return;
      const isStarter = teamStarterIds.has(player.id);
      const windowStart = isStarter ? 0 : Math.max(0, 90 - minutes);
      const windowEnd = isStarter ? minutes : 90;
      if (qualifiesForWindowedCleanSheet(concededGoalMinutes, windowStart, windowEnd, concededGoalsTotal)) {
        addPlayerStat(updatedPlayers, player.id, 'cleanSheets');
      }
    });
};
