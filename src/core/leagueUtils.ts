import { Fixture, LeagueId, Team } from '../models/types';
import { getFixtureCompetitionId, getLeagueDefinition, getLeagueSortIndex, getTeamLeagueId, isLeagueCompetitionId, LEAGUE_ORDER } from './domainRegistry';

export const DIVISION_ORDER: LeagueId[] = [...LEAGUE_ORDER];

export const getLeagueMaxWeeks = (leagueId: LeagueId) => {
  const definition = getLeagueDefinition(leagueId);
  return Math.max(1, (definition.teamCount - 1) * definition.roundsPerOpponent);
};

export const getDivisionMaxWeeks = getLeagueMaxWeeks;

export const getLeagueTeamCount = (leagueId: LeagueId) => getLeagueDefinition(leagueId).teamCount;
export const getDivisionTeamCount = getLeagueTeamCount;

export const getLeaguePromotionSlots = (leagueId: LeagueId) => getLeagueDefinition(leagueId).promotionSlots;
export const getLeagueRelegationSlots = (leagueId: LeagueId) => getLeagueDefinition(leagueId).relegationSlots;

export const getSeasonWeekLimit = (fixtures: Record<string, Fixture>) => (
  Object.values(fixtures).reduce((max, fixture) => Math.max(max, fixture.week), 0)
);

export const sortTeamsByDivisionAndName = (teams: Team[]) => (
  [...teams].sort((left, right) => {
    const leagueDelta = getLeagueSortIndex(getTeamLeagueId(left)) - getLeagueSortIndex(getTeamLeagueId(right));
    if (leagueDelta !== 0) return leagueDelta;
    return left.name.localeCompare(right.name);
  })
);

export const sortTeamsByTable = (teams: Team[]) => (
  [...teams].sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points;
    const leftGoalDiff = left.goalsFor - left.goalsAgainst;
    const rightGoalDiff = right.goalsFor - right.goalsAgainst;
    if (rightGoalDiff !== leftGoalDiff) return rightGoalDiff - leftGoalDiff;
    return right.goalsFor - left.goalsFor;
  })
);

export const buildRoundRobinFixtures = (
  teamIds: string[],
  leagueId: LeagueId,
  fixtureCounterStart = 1
) => {
  const fixtures: Record<string, Fixture> = {};
  const definition = getLeagueDefinition(leagueId);
  const numTeams = teamIds.length;
  const rounds = Math.max(1, numTeams - 1);
  const circleIds = [...teamIds];
  const firstHalf: { home: string; away: string; week: number }[] = [];

  for (let round = 0; round < rounds; round += 1) {
    const week = round + 1;
    for (let index = 0; index < numTeams / 2; index += 1) {
      const teamA = circleIds[index];
      const teamB = circleIds[numTeams - 1 - index];
      const flipHome = (round + index) % 2 === 0;
      firstHalf.push({
        home: flipHome ? teamA : teamB,
        away: flipHome ? teamB : teamA,
        week,
      });
    }
    const lastTeamId = circleIds.pop();
    if (!lastTeamId) break;
    circleIds.splice(1, 0, lastTeamId);
  }

  let fixtureCounter = fixtureCounterStart;
  firstHalf.forEach(fixture => {
    const homeId = `F${fixtureCounter++}`;
    fixtures[homeId] = {
      id: homeId,
      week: fixture.week,
      competitionId: 'League',
      competition: 'League',
      roundNumber: 1,
      roundName: definition.displayName,
      leagueId,
      division: definition.displayName,
      homeTeamId: fixture.home,
      awayTeamId: fixture.away,
      homeScore: null,
      awayScore: null,
      isPlayed: false,
    };

    if (definition.roundsPerOpponent < 2) return;

    const awayId = `F${fixtureCounter++}`;
    fixtures[awayId] = {
      id: awayId,
      week: fixture.week + rounds,
      competitionId: 'League',
      competition: 'League',
      roundNumber: 1,
      roundName: definition.displayName,
      leagueId,
      division: definition.displayName,
      homeTeamId: fixture.away,
      awayTeamId: fixture.home,
      homeScore: null,
      awayScore: null,
      isPlayed: false,
    };
  });

  return { fixtures, nextCounter: fixtureCounter };
};

export const countLeagueFixturesForWeek = (
  fixtures: Record<string, Fixture>,
  week: number
) => Object.values(fixtures)
  .filter(fixture => fixture.week === week && isLeagueCompetitionId(getFixtureCompetitionId(fixture)))
  .length;
