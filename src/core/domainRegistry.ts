import {
  CompetitionDefinition,
  CompetitionId,
  CupCompetitionId,
  Fixture,
  LeagueDefinition,
  LeagueId,
  Team,
  TrophyCompetitionId,
} from '../models/types';

export const DEFAULT_COUNTRY_ID = 'england';
export const DEFAULT_LEAGUE_ID: LeagueId = 'Premier League';
export const DEFAULT_COMPETITION_ID: CompetitionId = 'League';
export const DEFAULT_TROPHY_COMPETITION_ID: TrophyCompetitionId = 'FA Cup';

export const LEAGUE_DEFINITIONS: Record<LeagueId, LeagueDefinition> = {
  'Premier League': {
    id: 'Premier League',
    countryId: DEFAULT_COUNTRY_ID,
    displayName: 'Premier League',
    tier: 1,
    teamCount: 20,
    roundsPerOpponent: 2,
    promotionSlots: 0,
    relegationSlots: 3,
    newsPriority: 100,
  },
  Championship: {
    id: 'Championship',
    countryId: DEFAULT_COUNTRY_ID,
    displayName: 'Championship',
    tier: 2,
    teamCount: 24,
    roundsPerOpponent: 2,
    promotionSlots: 3,
    relegationSlots: 3,
    newsPriority: 80,
  },
  'League One': {
    id: 'League One',
    countryId: DEFAULT_COUNTRY_ID,
    displayName: 'League One',
    tier: 3,
    teamCount: 24,
    roundsPerOpponent: 2,
    promotionSlots: 3,
    relegationSlots: 3,
    newsPriority: 60,
  },
  'League Two': {
    id: 'League Two',
    countryId: DEFAULT_COUNTRY_ID,
    displayName: 'League Two',
    tier: 4,
    teamCount: 24,
    roundsPerOpponent: 2,
    promotionSlots: 3,
    relegationSlots: 0,
    newsPriority: 40,
  },
};

export const COMPETITION_DEFINITIONS: Record<CompetitionId, CompetitionDefinition> = {
  League: {
    id: 'League',
    type: 'league',
    displayName: 'League',
    countryScope: DEFAULT_COUNTRY_ID,
    trackedForTrophies: false,
    fixtureStrategy: 'round-robin',
    roundNames: [],
    startWeek: 1,
    spacingWeeks: 0,
  },
  'Carabao Cup': {
    id: 'Carabao Cup',
    type: 'domestic-cup',
    displayName: 'Carabao Cup',
    countryScope: DEFAULT_COUNTRY_ID,
    trackedForTrophies: true,
    fixtureStrategy: 'knockout',
    roundNames: ['Round 1', 'Round 2', 'Round 3', 'Quarter-Final', 'Semi-Final', 'Final'],
    startWeek: 1,
    spacingWeeks: 4,
  },
  'FA Cup': {
    id: 'FA Cup',
    type: 'domestic-cup',
    displayName: 'FA Cup',
    countryScope: DEFAULT_COUNTRY_ID,
    trackedForTrophies: true,
    fixtureStrategy: 'knockout',
    roundNames: ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Quarter-Final', 'Semi-Final', 'Final'],
    startWeek: 2,
    spacingWeeks: 4,
  },
  'UEFA Champions League': {
    id: 'UEFA Champions League',
    type: 'continental-cup',
    displayName: 'UEFA Champions League',
    countryScope: 'europe',
    trackedForTrophies: true,
    fixtureStrategy: 'inactive',
    roundNames: ['League Phase', 'Round of 16', 'Quarter-Final', 'Semi-Final', 'Final'],
    startWeek: 3,
    spacingWeeks: 2,
  },
};

const buildFallbackLeagueDefinition = (leagueId: LeagueId): LeagueDefinition => ({
  id: leagueId,
  countryId: DEFAULT_COUNTRY_ID,
  displayName: leagueId,
  tier: Number.MAX_SAFE_INTEGER,
  teamCount: 20,
  roundsPerOpponent: 2,
  promotionSlots: 0,
  relegationSlots: 0,
  newsPriority: 0,
});

const buildFallbackCompetitionDefinition = (competitionId: CompetitionId): CompetitionDefinition => ({
  id: competitionId,
  type: competitionId === DEFAULT_COMPETITION_ID ? 'league' : 'domestic-cup',
  displayName: competitionId,
  countryScope: DEFAULT_COUNTRY_ID,
  trackedForTrophies: false,
  fixtureStrategy: competitionId === DEFAULT_COMPETITION_ID ? 'round-robin' : 'knockout',
  roundNames: [],
  startWeek: 1,
  spacingWeeks: 4,
});

const refreshLeagueOrder = (target: LeagueId[]) => {
  target.splice(
    0,
    target.length,
    ...Object.values(LEAGUE_DEFINITIONS)
      .sort((left, right) => left.tier - right.tier)
      .map(definition => definition.id)
  );
};

const refreshCompetitionCaches = (
  activeCupIds: CupCompetitionId[],
  trackedTrophyIds: TrophyCompetitionId[]
) => {
  activeCupIds.splice(
    0,
    activeCupIds.length,
    ...Object.values(COMPETITION_DEFINITIONS)
      .filter(definition => definition.type !== 'league' && definition.fixtureStrategy === 'knockout')
      .map(definition => definition.id)
  );
  trackedTrophyIds.splice(
    0,
    trackedTrophyIds.length,
    ...Object.values(COMPETITION_DEFINITIONS)
      .filter(definition => definition.trackedForTrophies)
      .map(definition => definition.id)
  );
};

export const LEAGUE_ORDER: LeagueId[] = [];
export const ACTIVE_CUP_COMPETITION_IDS: CupCompetitionId[] = [];
export const TRACKED_TROPHY_COMPETITION_IDS: TrophyCompetitionId[] = [];

refreshLeagueOrder(LEAGUE_ORDER);
refreshCompetitionCaches(ACTIVE_CUP_COMPETITION_IDS, TRACKED_TROPHY_COMPETITION_IDS);

export const registerLeagueDefinition = (definition: LeagueDefinition) => {
  LEAGUE_DEFINITIONS[definition.id] = definition;
  refreshLeagueOrder(LEAGUE_ORDER);
  return definition;
};

export const registerCompetitionDefinition = (definition: CompetitionDefinition) => {
  COMPETITION_DEFINITIONS[definition.id] = definition;
  refreshCompetitionCaches(ACTIVE_CUP_COMPETITION_IDS, TRACKED_TROPHY_COMPETITION_IDS);
  return definition;
};

export const getLeagueDefinition = (leagueId?: LeagueId | null) => (
  LEAGUE_DEFINITIONS[leagueId || DEFAULT_LEAGUE_ID] || buildFallbackLeagueDefinition(leagueId || DEFAULT_LEAGUE_ID)
);

export const getCompetitionDefinition = (competitionId?: CompetitionId | null) => (
  COMPETITION_DEFINITIONS[competitionId || DEFAULT_COMPETITION_ID] || buildFallbackCompetitionDefinition(competitionId || DEFAULT_COMPETITION_ID)
);

export const getTeamLeagueId = (team?: Pick<Team, 'leagueId' | 'division'> | null): LeagueId => (
  team?.leagueId || team?.division || DEFAULT_LEAGUE_ID
);

export const getFixtureCompetitionId = (fixture?: Pick<Fixture, 'competitionId' | 'competition'> | null): CompetitionId => (
  fixture?.competitionId || fixture?.competition || DEFAULT_COMPETITION_ID
);

export const getFixtureLeagueId = (fixture?: Pick<Fixture, 'leagueId' | 'division'> | null): LeagueId | undefined => (
  fixture?.leagueId || fixture?.division
);

export const getLeagueDisplayName = (leagueId?: LeagueId | null) => getLeagueDefinition(leagueId).displayName;
export const getCompetitionDisplayName = (competitionId?: CompetitionId | null) => getCompetitionDefinition(competitionId).displayName;

export const isLeagueCompetitionId = (competitionId?: CompetitionId | null) => getCompetitionDefinition(competitionId).type === 'league';
export const isCupCompetitionId = (competitionId?: CompetitionId | null) => getCompetitionDefinition(competitionId).type !== 'league';
export const isTrackedTrophyCompetitionId = (competitionId?: CompetitionId | null) => (
  getCompetitionDefinition(competitionId).trackedForTrophies
);

export const getLeagueSortIndex = (leagueId?: LeagueId | null) => {
  const id = leagueId || DEFAULT_LEAGUE_ID;
  const index = LEAGUE_ORDER.indexOf(id);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
};

export const getCompetitionSortRank = (competitionId?: CompetitionId | null) => {
  const definition = getCompetitionDefinition(competitionId);
  if (definition.type === 'league') return 0;
  if (competitionId === 'Carabao Cup') return 1;
  if (competitionId === 'FA Cup') return 2;
  if (competitionId === 'UEFA Champions League') return 3;
  return 10;
};

export const getCompetitionRoundName = (competitionId: CompetitionId, roundNumber: number) => (
  getCompetitionDefinition(competitionId).roundNames[roundNumber - 1] || `Round ${roundNumber}`
);
