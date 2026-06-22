import { Position, Team } from '../models/types';

export type SquadPolicy = {
  structuralMinimum: number;
  positionalMinimums: Record<Position, number>;
  preferredDepth: Record<Position, number>;
  preferredSquadSize: number;
  maximumSquadSize: number;
};

const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

const sumDepth = (depth: Record<Position, number>) => (
  POSITIONS.reduce((sum, position) => sum + depth[position], 0)
);

export const getSquadPolicy = (team: Team): SquadPolicy => {
  const isPremierLevel = team.division === 'Premier League' || team.division === 'Continental';
  const isAmbitious = team.boardProfile.ambition === 'elite' || team.boardProfile.ambition === 'europe';
  const isPromotion = team.boardProfile.ambition === 'promotion';

  const structuralFloor = team.division === 'Premier League'
    ? 21
    : team.division === 'Championship'
      ? 20
      : 18;
  const positionalMinimums: Record<Position, number> = isPremierLevel || isPromotion || isAmbitious
    ? { GK: 2, DEF: 6, MID: 6, FWD: 4 }
    : { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  const preferredDepth: Record<Position, number> = isAmbitious
    ? { GK: 2, DEF: 7, MID: 7, FWD: 5 }
    : (isPremierLevel || isPromotion)
      ? { GK: 2, DEF: 6, MID: 6, FWD: 4 }
      : { GK: 2, DEF: 5, MID: 5, FWD: 3 };

  return {
    structuralMinimum: Math.max(structuralFloor, sumDepth(positionalMinimums)),
    positionalMinimums,
    preferredDepth,
    preferredSquadSize: 24,
    maximumSquadSize: 28,
  };
};
