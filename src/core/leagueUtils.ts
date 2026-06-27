import { CompetitionId, CompetitionState, Division, Fixture, LeagueDivision, Team } from '../models/types';
import { dateOrdinalToWeek } from '../utils/calendar';

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

type RoundRobinMatch = { home: string; away: string };

const createLeagueFixture = (
  id: string,
  dateOrdinal: number,
  division: LeagueDivision,
  homeTeamId: string,
  awayTeamId: string
): Fixture => ({
  id,
  week: dateOrdinalToWeek(dateOrdinal),
  dateOrdinal,
  division,
  competitionId: LEAGUE_COMPETITION_BY_DIVISION[division],
  competitionType: 'league',
  round: 'league',
  isKnockout: false,
  homeTeamId,
  awayTeamId,
  homeScore: null,
  awayScore: null,
  isPlayed: false,
});

const getFirstHalfHomeCounts = (rounds: RoundRobinMatch[][], teamIds: string[]) => {
  const counts = Object.fromEntries(teamIds.map(teamId => [teamId, 0]));
  rounds.forEach(round => {
    round.forEach(fixture => {
      counts[fixture.home] = (counts[fixture.home] || 0) + 1;
    });
  });
  return counts;
};

const getMaxHomeAwayStreak = (rounds: RoundRobinMatch[][], teamIds: string[]) => {
  const sequences = Object.fromEntries(teamIds.map(teamId => [teamId, [] as ('H' | 'A')[]]));
  const fullRounds = [
    ...rounds,
    ...[...rounds].reverse().map(round => round.map(fixture => ({ home: fixture.away, away: fixture.home }))),
  ];

  fullRounds.forEach(round => {
    round.forEach(fixture => {
      sequences[fixture.home]?.push('H');
      sequences[fixture.away]?.push('A');
    });
  });

  return Object.values(sequences).reduce((max, sequence) => {
    let current = 0;
    let previous: 'H' | 'A' | null = null;
    sequence.forEach(token => {
      current = token === previous ? current + 1 : 1;
      previous = token;
      max = Math.max(max, current);
    });
    return max;
  }, 0);
};

const getHomeBalanceScore = (counts: Record<string, number>, target: number) => (
  Object.values(counts).reduce((sum, count) => sum + Math.abs(count - target), 0)
);

const balanceFirstHalfHomeAssignments = (rounds: RoundRobinMatch[][], teamIds: string[]) => {
  const target = (teamIds.length - 1) / 2;
  const targetMin = Math.floor(target);
  const targetMax = Math.ceil(target);

  for (let iteration = 0; iteration < teamIds.length * 4; iteration += 1) {
    const counts = getFirstHalfHomeCounts(rounds, teamIds);
    if (Object.values(counts).every(count => count >= targetMin && count <= targetMax)) return;

    const currentScore = getHomeBalanceScore(counts, target);
    let bestRoundIndex = -1;
    let bestFixtureIndex = -1;
    let bestScore = Infinity;

    rounds.forEach((round, roundIndex) => {
      round.forEach((fixture, fixtureIndex) => {
        const nextCounts = { ...counts };
        nextCounts[fixture.home] -= 1;
        nextCounts[fixture.away] += 1;
        const nextScore = getHomeBalanceScore(nextCounts, target);
        if (nextScore >= currentScore) return;

        const testRounds = rounds.map(roundFixtures => roundFixtures.map(item => ({ ...item })));
        testRounds[roundIndex][fixtureIndex] = { home: fixture.away, away: fixture.home };
        const streak = getMaxHomeAwayStreak(testRounds, teamIds);
        if (streak > 3) return;

        const score = nextScore + (streak * 0.01);
        if (score < bestScore) {
          bestRoundIndex = roundIndex;
          bestFixtureIndex = fixtureIndex;
          bestScore = score;
        }
      });
    });

    if (bestRoundIndex < 0 || bestFixtureIndex < 0) break;
    const fixture = rounds[bestRoundIndex][bestFixtureIndex];
    rounds[bestRoundIndex][bestFixtureIndex] = { home: fixture.away, away: fixture.home };
  }
};

const assertRoundRobinSchedule = (rounds: RoundRobinMatch[][], teamIds: string[]) => {
  const expectedPairCount = teamIds.length * (teamIds.length - 1) / 2;
  const seenPairs = new Set<string>();
  const expectedRoundMatches = Math.floor(teamIds.length / 2);

  rounds.forEach((round, roundIndex) => {
    const roundTeams = new Set<string>();
    if (teamIds.length % 2 === 0 && round.length !== expectedRoundMatches) {
      throw new Error(`Round ${roundIndex + 1} has ${round.length} fixtures; expected ${expectedRoundMatches}.`);
    }

    round.forEach(fixture => {
      if (roundTeams.has(fixture.home) || roundTeams.has(fixture.away)) {
        throw new Error(`Round ${roundIndex + 1} contains a duplicate team.`);
      }
      roundTeams.add(fixture.home);
      roundTeams.add(fixture.away);

      const pairKey = [fixture.home, fixture.away].sort().join('|');
      if (seenPairs.has(pairKey)) throw new Error(`Duplicate first-half opponent pair: ${pairKey}.`);
      seenPairs.add(pairKey);
    });
  });

  if (teamIds.length % 2 === 0 && seenPairs.size !== expectedPairCount) {
    throw new Error(`Expected ${expectedPairCount} first-half pairs, got ${seenPairs.size}.`);
  }

  const counts = Object.values(getFirstHalfHomeCounts(rounds, teamIds));
  const minHomes = Math.min(...counts);
  const maxHomes = Math.max(...counts);
  if (maxHomes - minHomes > 1) throw new Error(`First-half home totals are imbalanced (${minHomes}-${maxHomes}).`);

  const maxStreak = getMaxHomeAwayStreak(rounds, teamIds);
  if (maxStreak > 3) throw new Error(`Home/away streak too long: ${maxStreak}.`);
};

const buildLeagueFixtureId = (season: number, counter: number): string =>
  season > 1 ? `F${season}-${counter}` : `F${counter}`;

export const buildRoundRobinFixtures = (
  teamIds: string[],
  division: LeagueDivision,
  season: number,
  fixtureCounterStart = 1,
  dateOrdinals?: number[]
) => {
  const fixtures: Record<string, Fixture> = {};
  const indexedIds: (string | null)[] = teamIds.length % 2 !== 0 ? [...teamIds, null] : [...teamIds];
  const numTeams = indexedIds.length;
  const rounds = numTeams - 1;
  if (dateOrdinals && dateOrdinals.length < rounds * 2) {
    throw new RangeError(`buildRoundRobinFixtures requires dateOrdinals length >= ${rounds * 2} for ${teamIds.length} teams, got ${dateOrdinals.length}`);
  }

  const firstHalfRounds: RoundRobinMatch[][] = [];
  for (let round = 0; round < rounds; round += 1) {
    const roundFixtures: RoundRobinMatch[] = [];
    for (let i = 0; i < numTeams / 2; i += 1) {
      let homeIndex = (round + i) % (numTeams - 1);
      let awayIndex = (round + numTeams - 1 - i) % (numTeams - 1);
      if (i === 0) awayIndex = numTeams - 1;
      if (round % 2 === 1) [homeIndex, awayIndex] = [awayIndex, homeIndex];

      const home = indexedIds[homeIndex];
      const away = indexedIds[awayIndex];
      if (home && away) roundFixtures.push({ home, away });
    }
    firstHalfRounds.push(roundFixtures);
  }

  balanceFirstHalfHomeAssignments(firstHalfRounds, teamIds);
  assertRoundRobinSchedule(firstHalfRounds, teamIds);

  let fixtureCounter = fixtureCounterStart;
  firstHalfRounds.forEach((roundFixtures, roundIndex) => {
    const dateOrdinal = dateOrdinals?.[roundIndex] ?? roundIndex * 7;
    roundFixtures.forEach(fixture => {
      const fixtureId = buildLeagueFixtureId(season, fixtureCounter++);
      fixtures[fixtureId] = createLeagueFixture(fixtureId, dateOrdinal, division, fixture.home, fixture.away);
    });
  });

  [...firstHalfRounds].reverse().forEach((roundFixtures, secondHalfIndex) => {
    const dateOrdinal = dateOrdinals?.[rounds + secondHalfIndex] ?? (rounds + secondHalfIndex) * 7;
    roundFixtures.forEach(fixture => {
      const fixtureId = buildLeagueFixtureId(season, fixtureCounter++);
      fixtures[fixtureId] = createLeagueFixture(fixtureId, dateOrdinal, division, fixture.away, fixture.home);
    });
  });

  return { fixtures, nextCounter: fixtureCounter };
};
