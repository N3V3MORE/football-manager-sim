import { CompetitionId, CompetitionState, Division, Fixture, LeagueDivision, Team } from '../models/types';

export const DIVISION_ORDER: LeagueDivision[] = ['Premier League', 'Championship', 'League One', 'League Two'];
export const PROMOTION_COUNT = 3;
export const RELEGATION_COUNT = 3;
export const LEAGUE_COMPETITION_BY_DIVISION: Record<LeagueDivision, CompetitionId> = {
  'Premier League': 'premier-league',
  Championship: 'championship',
  'League One': 'league-one',
  'League Two': 'league-two',
};

const DIVISION_MAX_WEEKS: Record<LeagueDivision, number> = {
  'Premier League': 38,
  'Championship': 46,
  'League One': 46,
  'League Two': 46,
};
export const getDivisionMaxWeeks = (division: LeagueDivision) => DIVISION_MAX_WEEKS[division] || 38;

const DIVISION_TEAM_COUNTS: Record<LeagueDivision, number> = {
  'Premier League': 20,
  'Championship': 24,
  'League One': 24,
  'League Two': 24,
};
export const getDivisionTeamCount = (division: LeagueDivision) => DIVISION_TEAM_COUNTS[division] || 20;

export const isLeagueDivision = (division: Division): division is LeagueDivision => (
  DIVISION_ORDER.includes(division as LeagueDivision)
);

export const getSeasonWeekLimit = (
  fixtures: Record<string, Fixture>,
  competitions?: Record<string, CompetitionState>
) => {
  const fixtureLimit = Object.values(fixtures).reduce((max, fixture) => Math.max(max, fixture.week), 0);
  const competitionLimit = competitions
    ? Object.values(competitions).reduce((max, competition) => (
      Math.max(max, ...competition.rounds.map(round => round.week))
    ), 0)
    : 0;
  return Math.max(fixtureLimit, competitionLimit);
};

export const sortTeamsByDivisionAndName = (teams: Team[]) => (
  [...teams].sort((a, b) => {
    const leftDivisionIndex = isLeagueDivision(a.division) ? DIVISION_ORDER.indexOf(a.division) : DIVISION_ORDER.length;
    const rightDivisionIndex = isLeagueDivision(b.division) ? DIVISION_ORDER.indexOf(b.division) : DIVISION_ORDER.length;
    const divisionDelta = leftDivisionIndex - rightDivisionIndex;
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
  division: LeagueDivision,
  fixtureCounterStart = 1,
  weekSlots?: number[]
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
    const firstLegWeek = weekSlots?.[fixture.week - 1] ?? fixture.week;
    const secondLegWeek = weekSlots?.[fixture.week + rounds - 1] ?? fixture.week + rounds;
    fixtures[homeId] = {
      id: homeId,
      week: firstLegWeek,
      division,
      competitionId: LEAGUE_COMPETITION_BY_DIVISION[division],
      competitionType: 'league',
      round: 'league',
      isKnockout: false,
      homeTeamId: fixture.home,
      awayTeamId: fixture.away,
      homeScore: null,
      awayScore: null,
      isPlayed: false,
    };
    fixtures[awayId] = {
      id: awayId,
      week: secondLegWeek,
      division,
      competitionId: LEAGUE_COMPETITION_BY_DIVISION[division],
      competitionType: 'league',
      round: 'league',
      isKnockout: false,
      homeTeamId: fixture.away,
      awayTeamId: fixture.home,
      homeScore: null,
      awayScore: null,
      isPlayed: false,
    };
  });

  return { fixtures, nextCounter: fixtureCounter };
};
