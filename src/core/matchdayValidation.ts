import { Player } from '../models/types';
import { isPlayerUnavailable } from './playerStatusUtils';

export type MatchdayXIValidation = {
  ok: boolean;
  reason?: string;
  goalkeeperId?: string;
};

export type MatchdayXIValidationOptions = {
  teamId?: string;
  designatedGoalkeeperId?: string;
  allowEmergencyGoalkeeper?: boolean;
};

export const selectDesignatedGoalkeeperId = (
  players: Player[],
  existingGoalkeeperId?: string
) => {
  const naturalGoalkeepers = players.filter(player => player.position === 'GK');
  if (existingGoalkeeperId && naturalGoalkeepers.some(player => player.id === existingGoalkeeperId)) return existingGoalkeeperId;
  if (naturalGoalkeepers.length > 0) {
    return [...naturalGoalkeepers].sort((a, b) => b.overallRating - a.overallRating)[0].id;
  }
  return undefined;
};

export const selectEmergencyGoalkeeperId = (players: Player[]) => (
  [...players]
    .filter(player => player.position !== 'GK')
    .sort((a, b) => {
      const aScore = (a.stats.defending || 50) + a.overallRating * 0.25 + a.stats.physical * 0.15;
      const bScore = (b.stats.defending || 50) + b.overallRating * 0.25 + b.stats.physical * 0.15;
      return bScore - aScore;
    })[0]?.id
);

export const validateMatchdayXI = (
  players: Player[],
  options: MatchdayXIValidationOptions = {}
): MatchdayXIValidation => {
  const uniquePlayers = Array.from(new Map(players.map(player => [player.id, player])).values());
  if (uniquePlayers.length !== players.length) return { ok: false, reason: 'Matchday XI contains duplicate players.' };
  if (uniquePlayers.length < 7) return { ok: false, reason: 'A match cannot start or continue with fewer than seven players.' };
  if (uniquePlayers.length > 11) return { ok: false, reason: 'A matchday XI cannot contain more than eleven players.' };

  const ineligible = uniquePlayers.find(player => (
    (options.teamId && player.teamId !== options.teamId) || isPlayerUnavailable(player)
  ));
  if (ineligible) return { ok: false, reason: `${ineligible.name} is not eligible for this matchday XI.` };

  const naturalGoalkeepers = uniquePlayers.filter(player => player.position === 'GK');
  if (naturalGoalkeepers.length > 1) {
    return { ok: false, reason: 'A matchday XI cannot place a goalkeeper in an outfield slot.' };
  }
  const designated = options.designatedGoalkeeperId
    ? uniquePlayers.find(player => player.id === options.designatedGoalkeeperId)
    : naturalGoalkeepers[0];
  if (!designated) return { ok: false, reason: 'A matchday XI requires a designated goalkeeper.' };
  if (naturalGoalkeepers.length === 1 && designated.id !== naturalGoalkeepers[0].id) {
    return { ok: false, reason: 'The natural goalkeeper must be the designated goalkeeper.' };
  }
  if (designated.position !== 'GK' && !options.allowEmergencyGoalkeeper) {
    return { ok: false, reason: 'The designated goalkeeper must be a goalkeeper.' };
  }
  return { ok: true, goalkeeperId: designated.id };
};
