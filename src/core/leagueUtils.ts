import { Division, Fixture, Team } from '../models/types';

export const DIVISION_ORDER: Division[] = ['Premier League', 'Championship', 'League One', 'League Two'];
export const PROMOTION_COUNT = 3;
export const RELEGATION_COUNT = 3;

const DIVISION_MAX_WEEKS: Record<Division, number> = {
  'Premier League': 38,
  'Championship': 46,
  'League One': 46,
  'League Two': 46,
};
export const getDivisionMaxWeeks = (division: Division) => DIVISION_MAX_WEEKS[division] || 38;

const DIVISION_TEAM_COUNTS: Record<Division, number> = {
  'Premier League': 20,
  'Championship': 24,
  'League One': 24,
  'League Two': 24,
};
export const getDivisionTeamCount = (division: Division) => DIVISION_TEAM_COUNTS[division] || 20;

export const getSeasonWeekLimit = (fixtures: Record<string, Fixture>) => (
  Object.values(fixtures).reduce((max, fixture) => Math.max(max, fixture.week), 0)
);

export const sortTeamsByDivisionAndName = (teams: Team[]) => (
  [...teams].sort((a, b) => {
    const divisionDelta = DIVISION_ORDER.indexOf(a.division) - DIVISION_ORDER.indexOf(b.division);
    if (divisionDelta !== 0) return divisionDelta;
    return a.name.localeCompare(b.name);
  })
);

export const sortTeamsByTable = (teams: Team[]) => (
  [...teams].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const diffA = a.goalsFor - a.goalsAgainst;
    const diffB = b.goalsFor - b.goalsAgainst;
    if (diffB !== diffA) return diffB - diffA;
    return b.goalsFor - a.goalsFor;
  })
);

export const buildRoundRobinFixtures = (
  teamIds: string[],
  division: Division,
  fixtureCounterStart = 1
) => {
  const fixtures: Record<string, Fixture> = {};
  const hasOddTeamCount = teamIds.length % 2 !== 0;
  const circleIds: (string | null)[] = hasOddTeamCount ? [...teamIds, null] : [...teamIds];
  const numTeams = circleIds.length;
  const rounds = numTeams - 1;
  const firstHalf: { home: string; away: string; week: number }[] = [];

  for (let round = 0; round < rounds; round++) {
    const week = round + 1;
    for (let i = 0; i < numTeams / 2; i++) {
      const teamA = circleIds[i];
      const teamB = circleIds[numTeams - 1 - i];
      if (!teamA || !teamB) continue;
      const flipHome = (round + i) % 2 === 0;
      firstHalf.push({ home: flipHome ? teamA : teamB, away: flipHome ? teamB : teamA, week });
    }
    const last = circleIds.pop()!;
    circleIds.splice(1, 0, last);
  }

  let fixtureCounter = fixtureCounterStart;
  firstHalf.forEach(fixture => {
    const homeId = `F${fixtureCounter++}`;
    const awayId = `F${fixtureCounter++}`;
    fixtures[homeId] = {
      id: homeId,
      week: fixture.week,
      division,
      homeTeamId: fixture.home,
      awayTeamId: fixture.away,
      homeScore: null,
      awayScore: null,
      isPlayed: false,
    };
    fixtures[awayId] = {
      id: awayId,
      week: fixture.week + rounds,
      division,
      homeTeamId: fixture.away,
      awayTeamId: fixture.home,
      homeScore: null,
      awayScore: null,
      isPlayed: false,
    };
  });

  return { fixtures, nextCounter: fixtureCounter };
};
