import {
  COMPETITION_DEFINITIONS,
  COMPETITION_IDS,
  DEFAULT_LEAGUE_ID,
  HydrationCompatibilityError,
  getCompetitionRoundName,
  getLeagueDefinition,
  getLeagueDisplayName,
  mapLegacyCompetitionId,
  mapLegacyLeagueId,
  resolveCanonicalCompetitionId,
  resolveCanonicalLeagueId,
} from '../../core/domainRegistry';
import { buildInitialCupStates } from '../../core/cupUtils';
import { extractTraitIds } from '../../core/tacticalEffects';
import { createEmptyTrophyCabinet } from '../../core/trophyUtils';
import { CupCompetition, CupState, Fixture, Player, SeasonResult, Team, TrophyCabinet, TrophyHistoryEntry } from '../../models/types';
import { GameStore } from '../types';

type HydrationSnapshot = Partial<
  Pick<
    GameStore,
    | 'teams'
    | 'players'
    | 'cups'
    | 'fixtures'
    | 'season'
    | 'isSeasonSkipInProgress'
    | 'trophyCabinet'
    | 'trophyHistory'
    | 'seasonResults'
    | 'currentWeek'
    | 'userTeamId'
    | 'news'
    | 'boardObjectives'
    | 'liveMatches'
  >
>;

const ensureCanonicalLeagueId = (rawLeagueId?: string | null, legacyDivision?: string | null, entity = 'league') => (
  resolveCanonicalLeagueId(rawLeagueId, legacyDivision, entity, 'leagueId')
);

const ensureCanonicalCompetitionId = (
  rawCompetitionId?: string | null,
  legacyCompetition?: string | null,
  entity = 'competition'
) => resolveCanonicalCompetitionId(rawCompetitionId, legacyCompetition, entity, 'competitionId');

const sanitizeTeam = (team: Team): Team => {
  const { division: _division, ...rest } = team;
  const leagueId = ensureCanonicalLeagueId(team.leagueId, team.division, 'team');
  return {
    ...rest,
    leagueId,
    countryId: team.countryId || getLeagueDefinition(leagueId).countryId,
    clubClass: team.clubClass || 'C',
  };
};

const sanitizePlayer = (player: Player): Player => ({
  ...player,
  traitIds: Array.isArray(player.traitIds) ? player.traitIds : extractTraitIds(player),
});

const sanitizeFixture = (fixture: Fixture, teams: Record<string, Team>): Fixture => {
  const { competition: _competition, division: _division, ...rest } = fixture;
  const competitionId = ensureCanonicalCompetitionId(fixture.competitionId, fixture.competition, 'fixture');
  const fallbackLeagueId = teams[fixture.homeTeamId]?.leagueId || teams[fixture.awayTeamId]?.leagueId || DEFAULT_LEAGUE_ID;
  const leagueId = fixture.leagueId || fixture.division
    ? ensureCanonicalLeagueId(fixture.leagueId, fixture.division, 'fixture')
    : fallbackLeagueId;
  const roundNumber = fixture.roundNumber || 1;
  const roundName = fixture.roundName
    || (competitionId === COMPETITION_IDS.LEAGUE
      ? getLeagueDisplayName(leagueId)
      : getCompetitionRoundName(competitionId, roundNumber));

  return {
    ...rest,
    competitionId,
    leagueId,
    roundNumber,
    roundName,
  };
};

const sanitizeCupState = (competitionKey: string, cup: CupState): CupState => {
  const { competition: _competition, ...rest } = cup;
  return {
    ...rest,
    competitionId: ensureCanonicalCompetitionId(cup.competitionId, cup.competition || competitionKey, 'cup') as CupCompetition,
  };
};

const sanitizeTrophyCabinet = (cabinet?: Partial<TrophyCabinet> | null) => {
  const normalizedCabinet = createEmptyTrophyCabinet();
  Object.entries(cabinet || {}).forEach(([competitionKey, trophyCount]) => {
    const canonicalCompetitionId = COMPETITION_DEFINITIONS[competitionKey]
      ? competitionKey
      : mapLegacyCompetitionId(competitionKey);
    if (canonicalCompetitionId && typeof trophyCount === 'number') {
      normalizedCabinet[canonicalCompetitionId] = trophyCount;
    }
  });
  return normalizedCabinet;
};

const sanitizeTrophyHistory = (history?: TrophyHistoryEntry[] | null) => (
  (history || []).map(entry => ({
    competitionId: ensureCanonicalCompetitionId(entry.competitionId, entry.competition, 'trophy-history'),
    season: entry.season,
    teamId: entry.teamId,
    teamName: entry.teamName,
  }))
);

const parseLegacyLeagueIdFromResult = (value?: string) => {
  if (!value) return DEFAULT_LEAGUE_ID;
  const match = value.match(/\(([^)]+)\)/);
  const legacyLeagueName = match?.[1];
  return mapLegacyLeagueId(legacyLeagueName) || DEFAULT_LEAGUE_ID;
};

const sanitizeSeasonResults = (results?: SeasonResult[] | null) => (
  (results || []).map(result => {
    if (result.leagueId && result.leagueResult && result.competitions) {
      return {
        ...result,
        leagueId: ensureCanonicalLeagueId(result.leagueId, undefined, 'season-result'),
      };
    }

    const legacyCompetitions = (result as SeasonResult & {
      competitions?: {
        league?: string;
        carabaoCup?: string;
        faCup?: string;
        ucl?: string;
      };
    }).competitions || {};
    return {
      season: result.season,
      teamId: result.teamId,
      teamName: result.teamName,
      leagueId: parseLegacyLeagueIdFromResult(legacyCompetitions.league),
      leagueResult: legacyCompetitions.league || `- (${getLeagueDisplayName(DEFAULT_LEAGUE_ID)})`,
      competitions: {
        [COMPETITION_IDS.CARABAO_CUP]: legacyCompetitions.carabaoCup || 'Did not participate',
        [COMPETITION_IDS.FA_CUP]: legacyCompetitions.faCup || 'Did not participate',
        [COMPETITION_IDS.UEFA_CHAMPIONS_LEAGUE]: legacyCompetitions.ucl || 'Not active yet',
      },
    };
  })
);

const sanitizeTeams = (teams?: Record<string, Team>) => Object.fromEntries(
  Object.entries(teams || {}).map(([teamId, team]) => [teamId, sanitizeTeam(team)])
) as Record<string, Team>;

const sanitizePlayers = (players?: Record<string, Player>) => Object.fromEntries(
  Object.entries(players || {}).map(([playerId, player]) => [playerId, sanitizePlayer(player)])
) as Record<string, Player>;

const sanitizeFixtures = (fixtures: Record<string, Fixture> | undefined, teams: Record<string, Team>) => Object.fromEntries(
  Object.entries(fixtures || {}).map(([fixtureId, fixture]) => [fixtureId, sanitizeFixture(fixture, teams)])
) as Record<string, Fixture>;

const sanitizeCups = (cups: Record<string, CupState> | undefined, teams: Record<string, Team>) => {
  const normalizedCups = cups && Object.keys(cups).length > 0
    ? Object.fromEntries(
        Object.entries(cups).map(([competitionId, cup]) => [
          ensureCanonicalCompetitionId(cup.competitionId, cup.competition || competitionId, 'cup'),
          sanitizeCupState(competitionId, cup),
        ])
      )
    : buildInitialCupStates(teams);

  return normalizedCups as Record<CupCompetition, CupState>;
};

const buildNormalizedState = (
  persistedState: HydrationSnapshot,
  currentState: GameStore
): HydrationSnapshot => {
  const teams = sanitizeTeams(persistedState.teams);
  const players = sanitizePlayers(persistedState.players);
  const fixtures = sanitizeFixtures(persistedState.fixtures, teams);
  const cups = sanitizeCups(persistedState.cups, teams);

  return {
    ...persistedState,
    teams,
    players,
    fixtures,
    cups,
    season: persistedState.season && persistedState.season > 0 ? persistedState.season : currentState.season,
    currentWeek: persistedState.currentWeek && persistedState.currentWeek > 0 ? persistedState.currentWeek : currentState.currentWeek,
    isSeasonSkipInProgress: false,
    trophyCabinet: sanitizeTrophyCabinet(persistedState.trophyCabinet),
    trophyHistory: sanitizeTrophyHistory(persistedState.trophyHistory),
    seasonResults: sanitizeSeasonResults(persistedState.seasonResults),
  };
};

export const normalizeHydratedState = (
  persistedState: unknown,
  currentState: GameStore
): HydrationSnapshot => {
  try {
    return buildNormalizedState((persistedState || {}) as HydrationSnapshot, currentState);
  } catch (error) {
    if (__DEV__ && error instanceof HydrationCompatibilityError) {
      throw error;
    }
    return {
      teams: currentState.teams,
      players: currentState.players,
      fixtures: currentState.fixtures,
      cups: currentState.cups,
      season: currentState.season,
      currentWeek: currentState.currentWeek,
      userTeamId: currentState.userTeamId,
      news: currentState.news,
      boardObjectives: currentState.boardObjectives,
      liveMatches: currentState.liveMatches,
      isSeasonSkipInProgress: false,
      trophyCabinet: createEmptyTrophyCabinet(),
      trophyHistory: [],
      seasonResults: [],
    };
  }
};

export const getHydrationRepairs = (state: HydrationSnapshot) => state;
export const hasHydrationRepairs = (repairs: HydrationSnapshot) => Object.keys(repairs).length > 0;
