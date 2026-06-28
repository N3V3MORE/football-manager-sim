import { Player } from '../models/types';

export const getRenewalOffer = (player: Player) => {
  const years = player.age <= 23 ? 4 : player.age <= 29 ? 3 : player.age <= 33 ? 2 : 1;
  const wageMultiplier = player.age <= 23 ? 1.15 : player.age <= 29 ? 1.18 : 1.08;
  return {
    years,
    wage: Math.max(player.wage, Math.round(player.wage * wageMultiplier)),
  };
};
