import { Player, TeamTactics } from '../models/types';
import { addPlayerStat } from './matchUtils';
import { RandomGenerator } from './random';
import { ENGINE_CONFIG } from '../config/engineConfig';

export const CLEAN_SHEET_MINUTES_REQUIRED = 60;

export const didConcedeInWindow = (
  concededGoalMinutes: number[],
  windowStartMinute: number,
  windowEndMinute: number,
  concededGoalsTotal: number
) => {
  if (windowEndMinute <= windowStartMinute) return true;
  if (concededGoalMinutes.length === 0) {
    if (concededGoalsTotal <= 0) return false;
    // Without minute-level data, only deny clean sheets for full-match windows.
    return windowStartMinute <= 0 && windowEndMinute >= 90;
  }
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

type SharedPostMatchInput = {
  teamParticipants: Player[];
  teamStarterIds: Set<string>;
  minuteMap: Record<string, number>;
  concededGoalMinutes: number[];
  concededGoalsTotal: number;
  isWin: boolean;
  isDraw: boolean;
  teamTactics: TeamTactics;
  updatedPlayers: Record<string, Player>;
  rng?: RandomGenerator;
  applyEnergyDrain?: boolean;
};

const clampToMatchMinutes = (value: number) => Math.max(0, Math.min(90, value));

export const applySharedPostMatchAccounting = ({
  teamParticipants,
  teamStarterIds,
  minuteMap,
  concededGoalMinutes,
  concededGoalsTotal,
  isWin,
  isDraw,
  teamTactics,
  updatedPlayers,
  rng,
  applyEnergyDrain = true,
}: SharedPostMatchInput) => {
  const random = rng || Math.random;
  applyWindowedCleanSheets(
    teamParticipants,
    teamStarterIds,
    minuteMap,
    concededGoalMinutes,
    concededGoalsTotal,
    updatedPlayers
  );

  teamParticipants.forEach(player => {
    const minutes = clampToMatchMinutes(minuteMap[player.id] || 0);
    if (minutes <= 0) return;

    const drainMultiplier =
      (teamTactics.tempo === 'Fast' ? ENGINE_CONFIG.POST_MATCH.TEMPO_FAST_DRAIN_MULTIPLIER : 1.0) *
      (teamTactics.pressing === 'High' ? ENGINE_CONFIG.POST_MATCH.PRESSING_HIGH_DRAIN_MULTIPLIER : 1.0);
    const drain = ENGINE_CONFIG.POST_MATCH.BASE_ENERGY_DRAIN * (minutes / 90) * drainMultiplier;
    let rating = ENGINE_CONFIG.POST_MATCH.BASE_MATCH_RATING + (random() * ENGINE_CONFIG.POST_MATCH.MATCH_RATING_RANDOM_SPREAD + ENGINE_CONFIG.POST_MATCH.MATCH_RATING_RANDOM_SHIFT);
    if (isWin) rating += ENGINE_CONFIG.POST_MATCH.MATCH_RATING_WIN_BONUS;
    if (isDraw) rating += ENGINE_CONFIG.POST_MATCH.MATCH_RATING_DRAW_BONUS;
    if (!isWin && !isDraw) rating -= ENGINE_CONFIG.POST_MATCH.MATCH_RATING_LOSS_PENALTY;
    if (concededGoalsTotal === 0 && (player.position === 'DEF' || player.position === 'GK')) {
      rating += ENGINE_CONFIG.POST_MATCH.MATCH_RATING_CLEAN_SHEET_BONUS;
    }
    rating += (player.impactCoefficient - 1.0);
    if (minutes < 30) rating -= ENGINE_CONFIG.POST_MATCH.MATCH_RATING_SHORT_CAMEO_PENALTY;
    rating = Math.max(1.0, Math.min(10.0, Math.round(rating * 10) / 10));

    const currentPlayer = updatedPlayers[player.id]!;
    updatedPlayers[player.id] = {
      ...currentPlayer,
      energy: applyEnergyDrain
        ? Math.max(0, currentPlayer.energy - drain)
        : currentPlayer.energy,
      minutesPlayed: (currentPlayer.minutesPlayed || 0) + minutes,
      matchRatingHistory: [...(currentPlayer.matchRatingHistory || []), rating],
    } as Player;
  });
};
