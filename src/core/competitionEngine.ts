import {
  CompetitionId,
  CompetitionResultSummary,
  CompetitionRoundKey,
  CompetitionRoundState,
  CompetitionState,
  CompetitionType,
  Fixture,
  LeagueDivision,
  Team,
} from '../models/types';
import {
  buildRoundRobinFixtures,
  DIVISION_ORDER,
  LEAGUE_COMPETITION_BY_DIVISION,
  sortTeamsByDivisionAndName,
  sortTeamsByTable,
} from './leagueUtils';
import { RandomGenerator, resolveRandom } from './random';
import { isPlayableClub } from './freeAgentPool';
import { dateOrdinalToWeek } from '../utils/calendar';

const PREMIER_LEAGUE_DATE_ORDINALS = Array.from({ length: 42 }, (_, index) => index * 7)
  .filter(dateOrdinal => ![21, 84, 126, 189].includes(dateOrdinal));
const EFL_LEAGUE_DATE_ORDINALS = [...Array.from({ length: 42 }, (_, index) => index * 7), 31, 94, 164, 234]
  .sort((left, right) => left - right);
const CARABAO_DATE_ORDINALS = [17, 45, 73, 115, 143, 178, 199];
const FA_CUP_DATE_ORDINALS = [150, 171, 185, 206, 227, 276, 294];
const EUROPE_DATE_ORDINALS = [192, 220, 255, 306];
export const MAX_SCHEDULED_SEASON_WEEK = 52;

const CONTINENTAL_CLUB_NAMES = [
  'Aurelia Madrid',
  'Cataluna Sporting',
  'Rhine Athletic',
  'Torino FC',
  'Lisbon Mariners',
  'Amsterdam Borough',
  'Paris Red Star',
  'Prague Union',
];

const COMPETITION_NAMES: Record<CompetitionId, string> = {
  'premier-league': 'Premier League',
  championship: 'Championship',
  'league-one': 'League One',
  'league-two': 'League Two',
  'carabao-cup': 'Carabao Cup',
  'fa-cup': 'FA Cup',
  europe: 'Europe',
};

const COMPETITION_SHORT_NAMES: Record<CompetitionId, string> = {
  'premier-league': 'PL',
  championship: 'Champ',
  'league-one': 'L1',
  'league-two': 'L2',
  'carabao-cup': 'Carabao',
  'fa-cup': 'FA Cup',
  europe: 'Europe',
};

const COMPETITION_ACCENTS: Record<CompetitionId, string> = {
  'premier-league': '#38bdf8',
  championship: '#60a5fa',
  'league-one': '#a78bfa',
  'league-two': '#818cf8',
  'carabao-cup': '#38bdf8',
  'fa-cup': '#22c55e',
  europe: '#f59e0b',
};

const ROUND_LABELS: Record<CompetitionRoundKey, string> = {
  league: 'League Season',
  round_1: 'Round 1',
  round_2: 'Round 2',
  round_3: 'Round 3',
  round_4: 'Round 4',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-final',
  semi_final: 'Semi-final',
  final: 'Final',
};

const KNOCKOUT_ROUND_ORDER: Record<CompetitionRoundKey, number> = {
  round_1: 1,
  round_2: 2,
  round_3: 3,
  round_4: 4,
  round_of_16: 5,
  quarter_final: 6,
  semi_final: 7,
  final: 8,
  league: 0,
};

const DOMESTIC_CUP_ROUNDS: CompetitionRoundKey[] = [
  'round_1',
  'round_2',
  'round_3',
  'round_4',
  'quarter_final',
  'semi_final',
  'final',
];

const EUROPE_ROUNDS: CompetitionRoundKey[] = [
  'round_of_16',
  'quarter_final',
  'semi_final',
  'final',
];

const DIVISION_STRENGTH: Record<Team['division'], number> = {
  'Premier League': 0,
  Championship: 1,
  'League One': 2,
  'League Two': 3,
  Continental: 1,
};

const CLUB_CLASS_STRENGTH: Record<string, number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
};

const createRoundState = (
  key: CompetitionRoundKey,
  dateOrdinal: number
): CompetitionRoundState => ({
  key,
  label: ROUND_LABELS[key],
  week: dateOrdinalToWeek(dateOrdinal),
  dateOrdinal,
  entrantTeamIds: [],
  fixtureIds: [],
  byeTeamIds: [],
  winnerTeamIds: [],
  completed: false,
});

const isPowerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;

const getNextKnockoutFieldSize = (entrantCount: number) => {
  if (entrantCount <= 2) return 1;
  if (isPowerOfTwo(entrantCount)) return entrantCount / 2;
  let target = 1;
  while (target * 2 < entrantCount) target *= 2;
  return target;
};

const extractFixtureCounter = (fixtureId: string): number => {
  const stripped = fixtureId.replace(/^F/, '');
  const scopedMatch = stripped.match(/^\d+-(\d+)$/);
  if (scopedMatch) return Number(scopedMatch[1]);
  const legacyNum = Number(stripped);
  return Number.isFinite(legacyNum) ? legacyNum : NaN;
};

const getNextFixtureCounter = (fixtures: Record<string, Fixture>) => (
  Object.keys(fixtures).reduce((max, fixtureId) => {
    const counter = extractFixtureCounter(fixtureId);
    return Number.isFinite(counter) ? Math.max(max, counter + 1) : max;
  }, 1)
);

const buildFixtureId = (season: number, counter: number): string =>
  season > 1 ? `F${season}-${counter}` : `F${counter}`;

const getSeededTeamIds = (
  teamIds: string[],
  teams: Record<string, Team>
) => [...teamIds].sort((leftId, rightId) => {
  const left = teams[leftId];
  const right = teams[rightId];
  if (!left || !right) return leftId.localeCompare(rightId);

  const divisionDelta = DIVISION_STRENGTH[left.division] - DIVISION_STRENGTH[right.division];
  if (divisionDelta !== 0) return divisionDelta;

  const classDelta = (CLUB_CLASS_STRENGTH[left.clubClass || 'F'] || 9) - (CLUB_CLASS_STRENGTH[right.clubClass || 'F'] || 9);
  if (classDelta !== 0) return classDelta;

  if (right.budget !== left.budget) return right.budget - left.budget;
  return left.name.localeCompare(right.name);
});

const scheduleKnockoutRound = (
  competitionId: CompetitionId,
  competitionType: CompetitionType,
  season: number,
  round: CompetitionRoundState,
  teamIds: string[],
  teams: Record<string, Team>,
  fixtureCounterStart: number,
  rng?: RandomGenerator
): {
  round: CompetitionRoundState;
  fixtures: Record<string, Fixture>;
  nextCounter: number;
} => {
  const random = resolveRandom(rng);
  const seededTeamIds = getSeededTeamIds(teamIds, teams);
  const nextFieldSize = getNextKnockoutFieldSize(seededTeamIds.length);
  const teamsPlayingRaw = seededTeamIds.length <= 2 || isPowerOfTwo(seededTeamIds.length)
    ? seededTeamIds
    : seededTeamIds.slice((nextFieldSize * 2) - seededTeamIds.length);
  const byeTeamIds = seededTeamIds.length <= 2 || isPowerOfTwo(seededTeamIds.length)
    ? []
    : seededTeamIds.slice(0, seededTeamIds.length - teamsPlayingRaw.length);

  // Shuffle teamsPlaying to avoid deterministic strongest-vs-weakest pairing.
  const teamsPlaying = [...teamsPlayingRaw];
  for (let i = teamsPlaying.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [teamsPlaying[i], teamsPlaying[j]] = [teamsPlaying[j], teamsPlaying[i]];
  }

  const fixtures: Record<string, Fixture> = {};
  let fixtureCounter = fixtureCounterStart;
  for (let index = 0; index < teamsPlaying.length - 1; index += 2) {
    let homeTeamId = teamsPlaying[index];
    let awayTeamId = teamsPlaying[index + 1];
    if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) continue;
    // Randomise home/away to avoid bias towards stronger-seeded team.
    if (random() < 0.5) {
      [homeTeamId, awayTeamId] = [awayTeamId, homeTeamId];
    }
    const fixtureId = buildFixtureId(season, fixtureCounter++);
    fixtures[fixtureId] = {
      id: fixtureId,
      week: round.week,
      dateOrdinal: round.dateOrdinal,
      competitionId,
      competitionType,
      round: round.key,
      isKnockout: true,
      homeTeamId,
      awayTeamId,
      homeScore: null,
      awayScore: null,
      isPlayed: false,
    };
  }

  return {
    round: {
      ...round,
      entrantTeamIds: seededTeamIds,
      fixtureIds: Object.keys(fixtures),
      byeTeamIds,
      winnerTeamIds: [],
      completed: false,
    },
    fixtures,
    nextCounter: fixtureCounter,
  };
};

const buildLeagueCompetitionState = (
  division: LeagueDivision,
  teamIds: string[],
  fixtureIds: string[],
  season: number,
  firstDateOrdinal: number
): CompetitionState => ({
  id: LEAGUE_COMPETITION_BY_DIVISION[division],
  name: COMPETITION_NAMES[LEAGUE_COMPETITION_BY_DIVISION[division]],
  shortName: COMPETITION_SHORT_NAMES[LEAGUE_COMPETITION_BY_DIVISION[division]],
  type: 'league',
  season,
  leagueDivision: division,
  entrantTeamIds: teamIds,
  rounds: [{
    key: 'league',
    label: ROUND_LABELS.league,
    week: dateOrdinalToWeek(firstDateOrdinal),
    dateOrdinal: firstDateOrdinal,
    entrantTeamIds: teamIds,
    fixtureIds,
    byeTeamIds: [],
    winnerTeamIds: [],
    completed: false,
  }],
  currentRound: 'league',
  eliminatedTeamIds: [],
});

const buildKnockoutCompetition = (
  competitionId: CompetitionId,
  competitionType: CompetitionType,
  season: number,
  entrantTeamIds: string[],
  dateOrdinalSlots: number[],
  roundKeys: CompetitionRoundKey[],
  teams: Record<string, Team>,
  fixtureCounterStart: number,
  rng?: RandomGenerator
): {
  competition: CompetitionState;
  fixtures: Record<string, Fixture>;
  nextCounter: number;
} => {
  const rounds = roundKeys.map((key, index) => createRoundState(key, dateOrdinalSlots[index] ?? dateOrdinalSlots[dateOrdinalSlots.length - 1]));
  const scheduledRound = scheduleKnockoutRound(
    competitionId,
    competitionType,
    season,
    rounds[0],
    entrantTeamIds,
    teams,
    fixtureCounterStart,
    rng
  );
  rounds[0] = scheduledRound.round;

  return {
    competition: {
      id: competitionId,
      name: COMPETITION_NAMES[competitionId],
      shortName: COMPETITION_SHORT_NAMES[competitionId],
      type: competitionType,
      season,
      entrantTeamIds,
      rounds,
      currentRound: rounds[0]?.key,
      eliminatedTeamIds: [],
    },
    fixtures: scheduledRound.fixtures,
    nextCounter: scheduledRound.nextCounter,
  };
};

export const getCompetitionName = (competitionId: CompetitionId) => COMPETITION_NAMES[competitionId];

export const getCompetitionShortName = (competitionId: CompetitionId) => COMPETITION_SHORT_NAMES[competitionId];

export const getCompetitionRoundLabel = (round: CompetitionRoundKey) => ROUND_LABELS[round];

export const getCompetitionAccent = (competitionId: CompetitionId) => COMPETITION_ACCENTS[competitionId];

export const getContinentalClubNames = () => [...CONTINENTAL_CLUB_NAMES];

export const buildInitialEuropeQualifiedTeamIds = (teams: Record<string, Team>) => (
  sortTeamsByTable(Object.values(teams).filter(team => isPlayableClub(team) && team.division === 'Premier League'))
    .sort((left, right) => {
      if (right.points !== left.points) return right.points - left.points;
      if (right.budget !== left.budget) return right.budget - left.budget;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 8)
    .map(team => team.id)
);

export const getSeasonEuropeQualifiedTeamIds = (
  teams: Record<string, Team>,
  competitions: Record<string, CompetitionState>
) => {
  const premierTable = sortTeamsByTable(
    Object.values(teams).filter(team => isPlayableClub(team) && team.division === 'Premier League')
  );
  const qualifiedTeamIds: string[] = [];
  const seen = new Set<string>();
  const addTeam = (teamId?: string) => {
    if (!teamId || seen.has(teamId) || !teams[teamId]) return;
    seen.add(teamId);
    qualifiedTeamIds.push(teamId);
  };

  premierTable.slice(0, 6).forEach(team => addTeam(team.id));
  addTeam(competitions['fa-cup']?.championTeamId);
  addTeam(competitions['carabao-cup']?.championTeamId);

  let tableIndex = 6;
  while (qualifiedTeamIds.length < 8 && tableIndex < premierTable.length) {
    addTeam(premierTable[tableIndex]?.id);
    tableIndex += 1;
  }

  return qualifiedTeamIds.slice(0, 8);
};

export const buildSeasonCompetitionBundle = (
  teams: Record<string, Team>,
  season: number,
  europeQualifiedTeamIds?: string[],
  rng?: RandomGenerator
): {
  fixtures: Record<string, Fixture>;
  competitions: Record<string, CompetitionState>;
} => {
  const fixtures: Record<string, Fixture> = {};
  const competitions: Record<string, CompetitionState> = {};
  let fixtureCounter = 1;

  DIVISION_ORDER.forEach(division => {
    const divisionTeamIds = sortTeamsByDivisionAndName(
      Object.values(teams).filter(team => isPlayableClub(team) && team.division === division)
    ).map(team => team.id);
    const leagueDateOrdinals = division === 'Premier League' ? PREMIER_LEAGUE_DATE_ORDINALS : EFL_LEAGUE_DATE_ORDINALS;
    const generated = buildRoundRobinFixtures(
      divisionTeamIds,
      division,
      season,
      fixtureCounter,
      leagueDateOrdinals
    );
    fixtureCounter = generated.nextCounter;
    Object.assign(fixtures, generated.fixtures);
    competitions[LEAGUE_COMPETITION_BY_DIVISION[division]] = buildLeagueCompetitionState(
      division,
      divisionTeamIds,
      Object.keys(generated.fixtures),
      season,
      leagueDateOrdinals[0] ?? 0
    );
  });

  const englishClubIds = Object.values(teams)
    .filter(team => isPlayableClub(team) && !team.isExternal && team.countryId === 'england')
    .map(team => team.id);

  const carabaoBundle = buildKnockoutCompetition(
    'carabao-cup',
    'domestic_cup',
    season,
    englishClubIds,
    CARABAO_DATE_ORDINALS,
    DOMESTIC_CUP_ROUNDS,
    teams,
    fixtureCounter,
    rng
  );
  Object.assign(fixtures, carabaoBundle.fixtures);
  competitions['carabao-cup'] = carabaoBundle.competition;
  fixtureCounter = carabaoBundle.nextCounter;

  const faCupBundle = buildKnockoutCompetition(
    'fa-cup',
    'domestic_cup',
    season,
    englishClubIds,
    FA_CUP_DATE_ORDINALS,
    DOMESTIC_CUP_ROUNDS,
    teams,
    fixtureCounter,
    rng
  );
  Object.assign(fixtures, faCupBundle.fixtures);
  competitions['fa-cup'] = faCupBundle.competition;
  fixtureCounter = faCupBundle.nextCounter;

  const externalClubIds = Object.values(teams)
    .filter(team => isPlayableClub(team) && team.isExternal)
    .map(team => team.id);
  const englishEuropeEntrants = (europeQualifiedTeamIds && europeQualifiedTeamIds.length > 0)
    ? europeQualifiedTeamIds
    : buildInitialEuropeQualifiedTeamIds(teams);
  const europeEntrants = [...englishEuropeEntrants.slice(0, 8), ...externalClubIds.slice(0, 8)];
  const europeBundle = buildKnockoutCompetition(
    'europe',
    'continental',
    season,
    europeEntrants,
    EUROPE_DATE_ORDINALS,
    EUROPE_ROUNDS,
    teams,
    fixtureCounter,
    rng
  );
  Object.assign(fixtures, europeBundle.fixtures);
  competitions.europe = europeBundle.competition;

  const lastScheduledWeek = Math.max(
    0,
    ...Object.values(fixtures).map(fixture => fixture.week),
    ...Object.values(competitions).flatMap(competition => competition.rounds.map(round => round.week))
  );
  if (lastScheduledWeek > MAX_SCHEDULED_SEASON_WEEK) {
    throw new Error(`Season schedule extends to week ${lastScheduledWeek}, beyond week ${MAX_SCHEDULED_SEASON_WEEK}.`);
  }

  return { fixtures, competitions };
};

const resolveFixtureWinnerId = (fixture: Fixture, rng?: RandomGenerator): string | undefined => {
  if (fixture.winnerTeamId) return fixture.winnerTeamId;
  if (fixture.resolution === 'void' || fixture.resolution === 'forfeit') return undefined;
  if ((fixture.homeScore || 0) > (fixture.awayScore || 0)) return fixture.homeTeamId;
  if ((fixture.awayScore || 0) > (fixture.homeScore || 0)) return fixture.awayTeamId;
  // Tied knockout: resolve via penalty shootout instead of silently advancing the home team.
  if (fixture.isKnockout) {
    const random = resolveRandom(rng);
    const winnerTeamId = random() < 0.5 ? fixture.homeTeamId : fixture.awayTeamId;
    fixture.winnerTeamId = winnerTeamId;
    fixture.resolution = 'penalties';
    return winnerTeamId;
  }
  // Non-knockout tie (should not normally reach competition progression).
  return fixture.homeTeamId;
};

const resolveFixtureLoserIds = (fixture: Fixture, rng?: RandomGenerator): string[] => {
  if (fixture.resolution === 'void') return [fixture.homeTeamId, fixture.awayTeamId];
  const winnerTeamId = resolveFixtureWinnerId(fixture, rng);
  if (!winnerTeamId) return [];
  return [winnerTeamId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId];
};

const describeRoundDraw = (
  competitionName: string,
  round: CompetitionRoundState,
  fixtures: Record<string, Fixture>,
  teams: Record<string, Team>
) => {
  const ties = round.fixtureIds
    .slice(0, 3)
    .map(fixtureId => {
      const fixture = fixtures[fixtureId];
      if (!fixture) return null;
      const homeTeam = teams[fixture.homeTeamId];
      const awayTeam = teams[fixture.awayTeamId];
      if (!homeTeam || !awayTeam) return null;
      return `${homeTeam.name} vs ${awayTeam.name}`;
    })
    .filter((value): value is string => Boolean(value));
  if (ties.length === 0) return `${competitionName} ${round.label} draw complete.`;
  return `${competitionName} ${round.label} draw: ${ties.join('; ')}.`;
};

export const resolveCompetitionProgression = (
  fixtures: Record<string, Fixture>,
  competitions: Record<string, CompetitionState>,
  teams: Record<string, Team>,
  rng?: RandomGenerator
): {
  fixtures: Record<string, Fixture>;
  competitions: Record<string, CompetitionState>;
  generatedNews: string[];
} => {
  const nextFixtures = { ...fixtures };
  const nextCompetitions = { ...competitions };
  const generatedNews: string[] = [];
  let fixtureCounter = getNextFixtureCounter(fixtures);

  Object.values(nextCompetitions)
    .filter(competition => competition.type !== 'league')
    .forEach(competition => {
      const currentRoundIndex = competition.rounds.findIndex(round => round.key === competition.currentRound);
      if (currentRoundIndex < 0) return;
      const currentRound = competition.rounds[currentRoundIndex];
      if (currentRound.completed || currentRound.fixtureIds.length === 0) return;
      if (currentRound.fixtureIds.some(fixtureId => !nextFixtures[fixtureId]?.isPlayed)) return;

      const winnerTeamIds = currentRound.fixtureIds
        .map(fixtureId => resolveFixtureWinnerId(nextFixtures[fixtureId], rng))
        .filter((teamId): teamId is string => Boolean(teamId));
      const loserTeamIds = currentRound.fixtureIds.flatMap(fixtureId => resolveFixtureLoserIds(nextFixtures[fixtureId], rng));
      const updatedRound: CompetitionRoundState = {
        ...currentRound,
        completed: true,
        winnerTeamIds,
      };
      const updatedCompetition: CompetitionState = {
        ...competition,
        rounds: competition.rounds.map((round, index) => (
          index === currentRoundIndex ? updatedRound : round
        )),
        eliminatedTeamIds: Array.from(new Set([...competition.eliminatedTeamIds, ...loserTeamIds])),
      };
      const advancingTeamIds = [...currentRound.byeTeamIds, ...winnerTeamIds];
      const nextRoundIndex = currentRoundIndex + 1;

      if (nextRoundIndex >= updatedCompetition.rounds.length || advancingTeamIds.length <= 1) {
        const finalFixture = currentRound.fixtureIds[currentRound.fixtureIds.length - 1];
        if (advancingTeamIds.length > 0) {
          updatedCompetition.championTeamId = advancingTeamIds[0];
        }
        updatedCompetition.runnerUpTeamId = finalFixture ? resolveFixtureLoserIds(nextFixtures[finalFixture], rng)[0] : undefined;
        updatedCompetition.currentRound = currentRound.key;
        nextCompetitions[competition.id] = updatedCompetition;
        const champion = updatedCompetition.championTeamId ? teams[updatedCompetition.championTeamId] : null;
        if (champion) {
          generatedNews.push(`${champion.name} win the ${updatedCompetition.name}.`);
        }
        return;
      }

      const nextRound = updatedCompetition.rounds[nextRoundIndex];
      const scheduledRound = scheduleKnockoutRound(
        updatedCompetition.id,
        updatedCompetition.type,
        updatedCompetition.season,
        nextRound,
        advancingTeamIds,
        teams,
        fixtureCounter,
        rng
      );
      fixtureCounter = scheduledRound.nextCounter;
      Object.assign(nextFixtures, scheduledRound.fixtures);
      updatedCompetition.rounds[nextRoundIndex] = scheduledRound.round;
      updatedCompetition.currentRound = scheduledRound.round.key;
      nextCompetitions[competition.id] = updatedCompetition;
      generatedNews.push(describeRoundDraw(updatedCompetition.name, scheduledRound.round, scheduledRound.fixtures, teams));
    });

  return {
    fixtures: nextFixtures,
    competitions: nextCompetitions,
    generatedNews,
  };
};

export const getCompetitionResultForTeam = (
  competition: CompetitionState | undefined,
  teamId: string
): CompetitionResultSummary | null => {
  if (!competition || !competition.entrantTeamIds.includes(teamId)) return null;
  if (competition.championTeamId === teamId) {
    return { competitionId: competition.id, name: competition.name, finish: 'winner' };
  }
  if (competition.runnerUpTeamId === teamId) {
    return { competitionId: competition.id, name: competition.name, finish: 'runner_up' };
  }

  for (const round of competition.rounds) {
    if (!round.completed) continue;
    if (!round.entrantTeamIds.includes(teamId)) continue;
    if (round.winnerTeamIds.includes(teamId) || round.byeTeamIds.includes(teamId)) continue;
    return { competitionId: competition.id, name: competition.name, finish: round.key };
  }

  const activeRound = competition.rounds.find(round => round.key === competition.currentRound);
  if (activeRound && activeRound.entrantTeamIds.includes(teamId)) {
    return { competitionId: competition.id, name: competition.name, finish: activeRound.key };
  }

  return { competitionId: competition.id, name: competition.name, finish: 'not_qualified' };
};

export const getTeamBestCompetitionRound = (
  competition: CompetitionState | undefined,
  teamId: string
) => {
  const result = getCompetitionResultForTeam(competition, teamId);
  if (!result) return null;
  if (result.finish === 'winner') return 'final';
  if (result.finish === 'runner_up') return 'final';
  if (result.finish === 'not_qualified') return null;
  return result.finish;
};

export const hasReachedCompetitionRound = (
  competition: CompetitionState | undefined,
  teamId: string,
  targetRound: CompetitionRoundKey
) => {
  const bestRound = getTeamBestCompetitionRound(competition, teamId);
  if (!bestRound) return false;
  return KNOCKOUT_ROUND_ORDER[bestRound] >= KNOCKOUT_ROUND_ORDER[targetRound];
};

export const getCompetitionPanelForTeam = (
  competitionId: CompetitionId,
  competitions: Record<string, CompetitionState>,
  fixtures: Record<string, Fixture>,
  teams: Record<string, Team>,
  teamId: string,
  currentWeek: number
) => {
  const competition = competitions[competitionId];
  const team = teams[teamId];
  const teamName = team?.name || 'Your club';
  const title = competitionId === 'carabao-cup'
    ? 'Carabao'
    : competitionId === 'fa-cup'
      ? 'FA Cup'
      : getCompetitionName(competitionId);

  if (!competition || competition.entrantTeamIds.length === 0) {
    return {
      title,
      status: competitionId === 'europe' ? 'Starts next season' : 'Not active',
      note: competitionId === 'europe'
        ? 'Continental places are assigned on the next rollover'
        : 'Competition state will begin with the next season',
      accent: getCompetitionAccent(competitionId),
    };
  }

  const result = getCompetitionResultForTeam(competition, teamId);
  if (!result) {
    return {
      title,
      status: 'Not entered',
      note: competitionId === 'europe'
        ? 'No European place secured'
        : 'No current participation',
      accent: getCompetitionAccent(competitionId),
    };
  }

  if (result.finish === 'winner') {
    return {
      title,
      status: 'Winner',
      note: `${teamName} lifted the trophy`,
      accent: getCompetitionAccent(competitionId),
    };
  }

  if (result.finish === 'runner_up') {
    return {
      title,
      status: 'Runner-up',
      note: 'Fell in the final',
      accent: getCompetitionAccent(competitionId),
    };
  }

  if (competition.eliminatedTeamIds.includes(teamId)) {
    return {
      title,
      status: 'Exited',
      note: `Reached ${result.finish === 'not_qualified' ? 'qualification' : getCompetitionRoundLabel(result.finish)}`,
      accent: getCompetitionAccent(competitionId),
    };
  }

  if (!competition.rounds.length) {
    return {
      title,
      status: 'Active',
      note: 'Competition in progress',
      accent: getCompetitionAccent(competitionId),
    };
  }

  const currentRound = competition.rounds.find(round => round.key === competition.currentRound) || competition.rounds[0];
  const activeFixture = currentRound?.fixtureIds
    .map(fixtureId => fixtures[fixtureId])
    .find(fixture => fixture && (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId));

  if (activeFixture) {
    const opponentId = activeFixture.homeTeamId === teamId ? activeFixture.awayTeamId : activeFixture.homeTeamId;
    const opponent = teams[opponentId];
    return {
      title,
      status: getCompetitionRoundLabel(currentRound.key),
      note: activeFixture.week > currentWeek
        ? `Draw complete: ${opponent?.name || 'TBD'} next`
        : `${opponent?.name || 'TBD'} ${activeFixture.isPlayed ? 'played' : 'up next'}`,
      accent: getCompetitionAccent(competitionId),
    };
  }

  if (currentRound?.byeTeamIds.includes(teamId)) {
    return {
      title,
      status: 'Bye',
      note: `Direct to ${getCompetitionRoundLabel(competition.rounds[Math.min(
        competition.rounds.length - 1,
        competition.rounds.findIndex(round => round.key === currentRound.key) + 1
      )]?.key || currentRound.key)}`,
      accent: getCompetitionAccent(competitionId),
    };
  }

  return {
    title,
    status: getCompetitionRoundLabel(currentRound?.key || 'league'),
    note: 'Awaiting next tie',
    accent: getCompetitionAccent(competitionId),
  };
};
