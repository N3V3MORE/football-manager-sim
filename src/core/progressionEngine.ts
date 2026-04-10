import { Player, Team, Fixture } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { applyTacticalAdaptation } from './tacticalAdaptationEngine';
import { getSeasonWeekLimit } from './leagueUtils';
import { RandomGenerator, resolveRandom } from './random';

export { computeWeeklyTransfers } from './transferEngine';

export const computeWeeklyProgression = (
  currentWeek: number,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  oldNews: string[],
  userTeamId: string | null = null,
  rng?: RandomGenerator
): {
  players: Record<string, Player>;
  teams: Record<string, Team>;
  currentWeek: number;
  news: string[];
  generatedNews: string[];
} => {
  const random = resolveRandom(rng);
  const playedFixtures = Object.values(fixtures).filter(f => f.week === currentWeek);
  const seasonWeekLimit = getSeasonWeekLimit(fixtures);
  const newNews: string[] = [];

  const bigWins = playedFixtures.filter(f => Math.abs((f.homeScore ?? 0) - (f.awayScore ?? 0)) >= 3);
  if (bigWins.length > 0) {
    const fixture = bigWins[Math.floor(random() * bigWins.length)];
    const winner = (fixture.homeScore! > fixture.awayScore!) ? teams[fixture.homeTeamId] : teams[fixture.awayTeamId];
    const loser = (fixture.homeScore! > fixture.awayScore!) ? teams[fixture.awayTeamId] : teams[fixture.homeTeamId];
    const winningScore = Math.max(fixture.homeScore!, fixture.awayScore!);
    const losingScore = Math.min(fixture.homeScore!, fixture.awayScore!);
    newNews.push(`${winner.name} thrashes ${loser.name} ${winningScore}-${losingScore}!`);
  }

  const allPlayers = Object.values(players);
  const updatedPlayers = { ...players };
  allPlayers.forEach(player => {
    const newEnergy = Math.min(100, player.energy + ENGINE_CONFIG.WEEKLY_ENERGY_RECOVERY);
    const newSuspension = Math.max(0, player.matchesSuspended - 1);
    const newInjuryWeeks = Math.max(0, (player.injuryWeeks || 0) - 1);
    if (
      newEnergy !== player.energy ||
      newSuspension !== player.matchesSuspended ||
      newInjuryWeeks !== (player.injuryWeeks || 0)
    ) {
      updatedPlayers[player.id] = {
        ...player,
        energy: newEnergy,
        matchesSuspended: newSuspension,
        injuryWeeks: newInjuryWeeks,
        injuryType: newInjuryWeeks > 0 ? player.injuryType : undefined,
      };
    }
  });

  const updatedTeams = { ...teams };
  Object.values(updatedTeams).forEach(team => {
    const teamPlayers = Object.values(updatedPlayers).filter(player => player.teamId === team.id);
    const weeklyWageTotalThousand = teamPlayers.reduce((sum, player) => sum + (player.wage || 0), 0);
    const wageCostM = weeklyWageTotalThousand / 1000;
    let newBudget = team.budget - wageCostM;

    const homeFixture = playedFixtures.find(fixture => fixture.homeTeamId === team.id);
    if (homeFixture) {
      newBudget += 1.0 + (team.points * 0.05);
    }

    updatedTeams[team.id] = { ...team, budget: Math.max(0, newBudget) };
  });

  applyTacticalAdaptation(
    updatedPlayers,
    updatedTeams,
    userTeamId ? new Set([userTeamId]) : new Set<string>(),
    rng
  );

  const sortedByGoals = [...allPlayers].sort((a, b) => b.goals - a.goals);
  if (sortedByGoals.length > 0 && sortedByGoals[0].goals > 0) {
    const top = sortedByGoals[0];
    newNews.push(`${top.name} (${teams[top.teamId]?.name}) leads the golden boot with ${top.goals} goals.`);
    if (random() > 0.5 && sortedByGoals.length > 1) {
      const contenderCount = Math.min(3, sortedByGoals.length - 1);
      const other = sortedByGoals[1 + Math.floor(random() * contenderCount)];
      if (other && other.goals > 0) {
        newNews.push(`${other.name} continues his excellent form for ${teams[other.teamId]?.name}!`);
      }
    }
  } else if (playedFixtures.length > 0) {
    newNews.push(`Week ${currentWeek} concludes with intense scenes across the league.`);
  }

  if (currentWeek === seasonWeekLimit) {
    Object.values(updatedPlayers).forEach(player => {
      let overallRating = player.overallRating;
      if (player.age <= 24) {
        overallRating += Math.floor(random() * 3) + 1;
      } else if (player.age >= 32) {
        overallRating -= Math.floor(random() * 2);
      }

      updatedPlayers[player.id] = {
        ...player,
        overallRating,
        age: player.age + 1,
        contractLeft: Math.max(0, player.contractLeft - 1),
      };
    });
    newNews.push('The season has concluded! Check your squad for player growth and updates.');
  }

  return {
    currentWeek: currentWeek + 1,
    news: [...newNews, ...oldNews].slice(0, 20),
    generatedNews: newNews,
    players: updatedPlayers,
    teams: updatedTeams,
  };
};
