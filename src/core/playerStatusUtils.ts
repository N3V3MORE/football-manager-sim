import { Player } from '../models/types';

export const isPlayerInjured = (player: Player) => (player.injuryWeeks || 0) > 0;

export const isPlayerUnavailable = (player: Player) => (
  player.matchesSuspended > 0 || isPlayerInjured(player)
);

export const getPlayerAvailabilityStatus = (player: Player) => {
  if (player.matchesSuspended > 0) {
    return `${player.matchesSuspended} match suspension${player.matchesSuspended === 1 ? '' : 's'}`;
  }
  if (isPlayerInjured(player)) {
    return `${player.injuryType || 'Injured'}${player.injuryWeeks > 0 ? ` (${player.injuryWeeks}w)` : ''}`;
  }
  return 'Available';
};

export const isContractExpiringSoon = (player: Player) => player.contractLeft <= 1;

export const formatContractLength = (player: Player) => {
  const years = player.contractLeft;
  if (!Number.isFinite(years) || years <= 0) return 'Expires now';
  if (years === 1) return '1y left';
  return `${years}y left`;
};
