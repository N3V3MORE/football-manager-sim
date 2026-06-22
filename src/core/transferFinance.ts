import { Player } from '../models/types';

export const MIN_WAGE_ACCEPTANCE_RATIO = 0.9;

export const getMinimumAcceptedWage = (player: Player): number => (
  Math.max(1, Math.ceil(player.wage * MIN_WAGE_ACCEPTANCE_RATIO))
);

export const isWageOfferAccepted = (player: Player, wage: number): boolean => (
  Number.isFinite(wage) && wage >= getMinimumAcceptedWage(player)
);
