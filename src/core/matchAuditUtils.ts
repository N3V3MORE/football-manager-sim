import type { Fixture } from '../models/types';

const ADMINISTRATIVE_RESOLUTIONS = new Set<Fixture['resolution']>(['forfeit', 'void']);

export const isScoreLogMismatch = ({
  homeScore,
  awayScore,
  scorerGoals,
  resolution,
}: {
  homeScore: number;
  awayScore: number;
  scorerGoals: number;
  resolution?: Fixture['resolution'];
}) => (
  !ADMINISTRATIVE_RESOLUTIONS.has(resolution) &&
  scorerGoals !== homeScore + awayScore
);
