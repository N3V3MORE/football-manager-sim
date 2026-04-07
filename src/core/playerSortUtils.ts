import { Player } from '../models/types';

const POSITION_ORDER: Record<Player['position'], number> = {
  GK: 0,
  DEF: 1,
  MID: 2,
  FWD: 3,
};

export const sortPlayersByPositionGroup = (players: Player[]) => (
  [...players].sort((a, b) => {
    const posDiff = POSITION_ORDER[a.position] - POSITION_ORDER[b.position];
    if (posDiff !== 0) return posDiff;
    return b.overallRating - a.overallRating;
  })
);
