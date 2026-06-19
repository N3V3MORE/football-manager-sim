import { Player, TeamTactics } from '../models/types';
import { addPlayerStat } from './matchUtils';
import { clampToMatchMinutes } from './minuteMapUtils';
import { RandomGenerator, resolveRandom } from './random';
import { ENGINE_CONFIG } from '../config/engineConfig';

export const CLEAN_SHEET_MINUTES_REQUIRED = 60;

export type PlayerMatchContribution = {
  goals?: number;
  assists?: number;
  yellowCards?: number;
  redCards?: number;
};

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
  playerMatchContributions?: Record<string, PlayerMatchContribution>;
};

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
  playerMatchContributions = {},
}: SharedPostMatchInput) => {
  const random = resolveRandom(rng);
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
      (teamTactics.tempo === 'Fast' ? ENGINE_CONFIG.TEMPO_FAST_DRAIN_MULTIPLIER : 1.0) *
      (teamTactics.pressing === 'High' ? ENGINE_CONFIG.PRESSING_HIGH_DRAIN_MULTIPLIER : 1.0);
    const drain = ENGINE_CONFIG.BASE_POST_MATCH_ENERGY_DRAIN * (minutes / 90) * drainMultiplier;
    let rating = ENGINE_CONFIG.BASE_MATCH_RATING + (random() * ENGINE_CONFIG.MATCH_RATING_RANDOM_SPREAD + ENGINE_CONFIG.MATCH_RATING_RANDOM_SHIFT);
    if (isWin) rating += ENGINE_CONFIG.MATCH_RATING_WIN_BONUS;
    if (isDraw) rating += ENGINE_CONFIG.MATCH_RATING_DRAW_BONUS;
    if (!isWin && !isDraw) rating -= ENGINE_CONFIG.MATCH_RATING_LOSS_PENALTY;
    const isStarter = teamStarterIds.has(player.id);
    const windowStart = isStarter ? 0 : Math.max(0, 90 - minutes);
    const windowEnd = isStarter ? minutes : 90;
    const hasCleanSheetWindow = qualifiesForWindowedCleanSheet(
      concededGoalMinutes,
      windowStart,
      windowEnd,
      concededGoalsTotal
    );
    if ((player.position === 'DEF' || player.position === 'GK') && hasCleanSheetWindow) {
      rating += ENGINE_CONFIG.MATCH_RATING_CLEAN_SHEET_BONUS;
    }
    const contribution = playerMatchContributions[player.id] || {};
    rating += (contribution.goals || 0) * 0.75;
    rating += (contribution.assists || 0) * 0.45;
    rating -= (contribution.yellowCards || 0) * 0.25;
    rating -= (contribution.redCards || 0) * 1.25;
    rating += (player.impactCoefficient ?? 1.0) - 1.0;
    if (minutes < 30) rating -= ENGINE_CONFIG.MATCH_RATING_SHORT_CAMEO_PENALTY;
    rating = Math.max(1.0, Math.min(10.0, Math.round(rating * 10) / 10));

    // Post-match morale adjustment based on result.
    let moraleDelta = 0;
    if (isWin) {
      moraleDelta = minutes >= 60 ? 4 : 2;
    } else if (isDraw) {
      moraleDelta = minutes >= 45 ? 1 : 0;
    } else {
      moraleDelta = minutes >= 30 ? -3 : -1;
    }
    // Capped to min 0, max 100.
    const newMorale = Math.max(0, Math.min(100, (updatedPlayers[player.id].morale || 50) + moraleDelta));

    updatedPlayers[player.id] = {
      ...updatedPlayers[player.id],
      energy: applyEnergyDrain
        ? Math.max(0, updatedPlayers[player.id].energy - drain)
        : updatedPlayers[player.id].energy,
      minutesPlayed: (updatedPlayers[player.id].minutesPlayed || 0) + minutes,
      matchRatingHistory: [...(updatedPlayers[player.id].matchRatingHistory || []), rating].slice(-15),
      morale: newMorale,
    };
  });
};
