import { Player } from '../models/types';

export const isPlayerInjured = (player: Player) => (player.injuryWeeks || 0) > 0;

export const isPlayerUnavailable = (player: Player) => (
  player.matchesSuspended > 0 || isPlayerInjured(player)
);

/**
 * Returns a human-readable availability status string for UI display.
 * This function bridges core status logic (suspension / injury checks) with
 * presentation — it lives in core because the checks depend on core types,
 * but the returned strings are intended for display purposes.
 */
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
  if (years === 1) return '1y left';
  if (years <= 0) return 'Expires now';
  return `${years}y left`;
};
