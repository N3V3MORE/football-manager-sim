import { Team } from '../models/types';

export const applyMatchResult = (
  team: Team,
  goalsFor: number,
  goalsAgainst: number,
  includeTableStats = true
) => {
  let points = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  if (goalsFor > goalsAgainst) { points = 3; wins = 1; }
  else if (goalsFor === goalsAgainst) { points = 1; draws = 1; }
  else { losses = 1; }

  const formToken = wins ? 'W' : draws ? 'D' : 'L';
  const updatedManager = { ...team.manager, record: { ...team.manager.record, played: team.manager.record.played + 1, goalsFor: team.manager.record.goalsFor + goalsFor, goalsAgainst: team.manager.record.goalsAgainst + goalsAgainst, wins: team.manager.record.wins + wins, draws: team.manager.record.draws + draws, losses: team.manager.record.losses + losses } };
  if (!includeTableStats) {
    return {
      ...team,
      form: [...(team.form || []), formToken].slice(-5),
      manager: updatedManager,
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
    form: [...(team.form || []), formToken].slice(-5),
    manager: updatedManager,
  };
};
