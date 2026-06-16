import { Player, Team } from '../models/types';
import { isContractExpiringSoon } from './playerStatusUtils';

export const getRenewalOffer = (player: Player) => {
  const years = player.age <= 23 ? 4 : player.age <= 29 ? 3 : player.age <= 33 ? 2 : 1;
  const wageMultiplier = player.age <= 23 ? 1.15 : player.age <= 29 ? 1.18 : 1.08;
  return {
    years,
    wage: Math.max(player.wage, Math.round(player.wage * wageMultiplier)),
  };
};

export const shouldRenewContract = (player: Player, team: Team) => {
  if (!isContractExpiringSoon(player)) return false;
  if (player.age >= 33 && player.overallRating < 80) return false;
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
