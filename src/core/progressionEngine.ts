import { Player, Team, Fixture } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { applyTacticalAdaptation } from './tacticalAdaptationEngine';
import { getSeasonWeekLimit, sortTeamsByTable } from './leagueUtils';
import {
  getFixtureCompetitionId,
  getFixtureLeagueId,
  getLeagueDefinition,
  getTeamLeagueId,
  isLeagueCompetitionId,
} from './domainRegistry';
import { buildSimulationRuntime, getRuntimeFixturesForWeek, getRuntimeTeamsForLeague, SimulationRuntime } from './simulationRuntime';

export { computeWeeklyTransfers } from './transferEngine';

export const computeWeeklyProgression = (
  currentWeek: number,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  oldNews: string[],
  userTeamId: string | null = null,
  options?: { generateNews?: boolean; runtime?: SimulationRuntime }
): { players: Record<string, Player>, teams: Record<string, Team>, currentWeek: number, news: string[] } => {
  const generateNews = options?.generateNews ?? true;
  const runtime = options?.runtime || buildSimulationRuntime({ teams, players, fixtures });
  const playedFixtures = getRuntimeFixturesForWeek(runtime, fixtures, currentWeek);
  const seasonWeekLimit = getSeasonWeekLimit(fixtures);
  const newNews: string[] = [];
  if (generateNews) {
    const leagueFixtures = playedFixtures.filter(fixture => isLeagueCompetitionId(getFixtureCompetitionId(fixture)));
    const fixturesByDivision = leagueFixtures.reduce<Record<string, Fixture[]>>((acc, fixture) => {
      const leagueId = getFixtureLeagueId(fixture) || getTeamLeagueId(teams[fixture.homeTeamId]);
      if (!acc[leagueId]) acc[leagueId] = [];
      acc[leagueId].push(fixture);
      return acc;
    }, {});

    Object.entries(fixturesByDivision).forEach(([leagueId, divisionFixtures]) => {
      const scoredFixtures = divisionFixtures.filter(fixture => fixture.homeScore !== null && fixture.awayScore !== null);
      if (scoredFixtures.length === 0) return;
      const leagueLabel = getLeagueDefinition(leagueId).displayName;

      const headline = [...scoredFixtures].sort((a, b) => {
        const totalA = (a.homeScore || 0) + (a.awayScore || 0);
        const totalB = (b.homeScore || 0) + (b.awayScore || 0);
        if (totalB !== totalA) return totalB - totalA;
        const marginA = Math.abs((a.homeScore || 0) - (a.awayScore || 0));
        const marginB = Math.abs((b.homeScore || 0) - (b.awayScore || 0));
        return marginB - marginA;
      })[0];

      const headlineHome = teams[headline.homeTeamId];
      const headlineAway = teams[headline.awayTeamId];
      newNews.push(
        `${leagueLabel} GW${currentWeek}: ${headlineHome.name} ${headline.homeScore}-${headline.awayScore} ${headlineAway.name}.`
      );

      const cleanSheetFixture = scoredFixtures.find(fixture => (fixture.homeScore || 0) === 0 || (fixture.awayScore || 0) === 0);
      if (cleanSheetFixture) {
        const homeScore = cleanSheetFixture.homeScore || 0;
        const awayScore = cleanSheetFixture.awayScore || 0;
        const winnerId = homeScore > awayScore ? cleanSheetFixture.homeTeamId : cleanSheetFixture.awayTeamId;
        const loserId = winnerId === cleanSheetFixture.homeTeamId ? cleanSheetFixture.awayTeamId : cleanSheetFixture.homeTeamId;
        const winnerScore = Math.max(homeScore, awayScore);
        const loserScore = Math.min(homeScore, awayScore);
        if (winnerScore > loserScore) {
          newNews.push(`${teams[winnerId].name} keeps a clean sheet in a ${winnerScore}-${loserScore} win over ${teams[loserId].name}.`);
        }
      }

      const divisionTable = sortTeamsByTable(getRuntimeTeamsForLeague(runtime, teams, leagueId));
      if (divisionTable.length > 1) {
        const leader = divisionTable[0];
        const challenger = divisionTable[1];
        const pointGap = Math.max(0, leader.points - challenger.points);
        newNews.push(`${leagueLabel}: ${leader.name} lead on ${leader.points} pts, ${pointGap} clear of ${challenger.name}.`);
      }
    });
  }

  const allPlayers = Object.values(players);
  const updatedPlayers = { ...players };
  const weeklyWagesByTeamId: Record<string, number> = {};
  allPlayers.forEach(player => {
    const newEnergy = Math.min(100, player.energy + ENGINE_CONFIG.WEEKLY_ENERGY_RECOVERY);
    const newSuspension = Math.max(0, player.matchesSuspended - 1);
    weeklyWagesByTeamId[player.teamId] = (weeklyWagesByTeamId[player.teamId] || 0) + (player.wage || 0);
    if (newEnergy !== player.energy || newSuspension !== player.matchesSuspended) {
      updatedPlayers[player.id] = { ...player, energy: newEnergy, matchesSuspended: newSuspension };
    }
  });

  const updatedTeams = { ...teams };
  const homeFixtureTeamIds = new Set(playedFixtures.map(fixture => fixture.homeTeamId));
  Object.values(updatedTeams).forEach(team => {
    const wageCostM = (weeklyWagesByTeamId[team.id] || 0) / 1000;
    let newBudget = team.budget - wageCostM;

    if (homeFixtureTeamIds.has(team.id)) {
      newBudget += 1.0 + (team.points * 0.05);
    }

    updatedTeams[team.id] = { ...team, budget: newBudget };
  });

  applyTacticalAdaptation(
    updatedPlayers,
    updatedTeams,
    userTeamId ? new Set([userTeamId]) : new Set<string>()
  );

  if (generateNews) {
    const sortedByGoals = [...allPlayers].sort((a, b) => b.goals - a.goals);
    const sortedByAssists = [...allPlayers].sort((a, b) => b.assists - a.assists);
    if (sortedByGoals.length > 0 && sortedByGoals[0].goals > 0) {
      const top = sortedByGoals[0];
      newNews.push(`${top.name} of ${teams[top.teamId]?.name} leads the golden boot race with ${top.goals} goals.`);
    }
    if (sortedByAssists.length > 0 && sortedByAssists[0].assists > 0) {
      const creator = sortedByAssists[0];
      newNews.push(`${creator.name} (${teams[creator.teamId]?.name}) tops the assist chart with ${creator.assists}.`);
    } else if (playedFixtures.length > 0) {
      newNews.push(`GW${currentWeek} concludes with tight standings battles across England.`);
    }
  }

  if (currentWeek === seasonWeekLimit) {
    Object.values(updatedPlayers).forEach(player => {
      let overallRating = player.overallRating;
      if (player.age <= 24) {
        overallRating += Math.floor(Math.random() * 3) + 1;
      } else if (player.age >= 32) {
        overallRating -= Math.floor(Math.random() * 2);
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
    news: [...newNews, ...oldNews].slice(0, 30),
    players: updatedPlayers,
    teams: updatedTeams,
  };
};
