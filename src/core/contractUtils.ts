import { Player, Team } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { isContractExpiringSoon } from './playerStatusUtils';

const C = ENGINE_CONFIG.CONTRACTS;

export const getRenewalOffer = (player: Player) => {
  const years = player.age <= C.YOUNG_AGE_THRESHOLD ? 4 : player.age <= C.PEAK_AGE_THRESHOLD ? 3 : player.age <= C.VETERAN_AGE_THRESHOLD ? 2 : 1;
  const wageMultiplier = player.age <= C.YOUNG_AGE_THRESHOLD ? C.YOUNG_WAGE_MULTIPLIER : player.age <= C.PEAK_AGE_THRESHOLD ? C.PEAK_WAGE_MULTIPLIER : C.VETERAN_WAGE_MULTIPLIER;
  return {
    years,
    wage: Math.max(player.wage, Math.round(player.wage * wageMultiplier)),
  };
};

export const shouldRenewContract = (player: Player, team: Team) => {
  if (!isContractExpiringSoon(player)) return false;
  if (player.overallRating >= 79) return true;
  if (player.isStarting && player.overallRating >= 72) return true;
  if (team.division === 'Premier League' && player.overallRating >= 75) return true;
  return false;
};

export const getContractAdviceLabel = (player: Player, team: Team) => {
  if (shouldRenewContract(player, team)) return 'renew';
  if (player.marketValue >= 12 && player.age <= 29) return 'cash in';
  return 'replace';
};
