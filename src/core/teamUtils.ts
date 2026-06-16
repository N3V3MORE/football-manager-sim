import { Team } from '../models/types';

export const applyMatchResult = (
  team: Team,
  goalsFor: number,
  goalsAgainst: number,
  includeTableStats = true
): Team => {
  let points = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  if (goalsFor > goalsAgainst) { points = 3; wins = 1; }
  else if (goalsFor === goalsAgainst) { points = 1; draws = 1; }
  else { losses = 1; }

  // W/D/L token derived from the result of this single match
  const formToken = wins ? 'W' : draws ? 'D' : 'L';
  if (!includeTableStats) {
    return {
      ...team,
      // team.form may be undefined for newly initialised teams; default to empty array
      form: [...(team.form || []), formToken].slice(-5),
    };
  }

  return {
    ...team,
    points: team.points + points,
    goalsFor: team.goalsFor + goalsFor,
    goalsAgainst: team.goalsAgainst + goalsAgainst,
    wins: team.wins + wins,
    draws: team.draws + draws,
    losses: team.losses + losses,
    played: team.played + 1,
    // team.form may be undefined for newly initialised teams; default to empty array
    form: [...(team.form || []), formToken].slice(-5),
  };
};
