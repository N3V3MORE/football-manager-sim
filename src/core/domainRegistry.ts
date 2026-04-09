import {
  CompetitionDefinition,
  CompetitionId,
  CountryDefinition,
  CountryId,
  CupCompetitionId,
  Fixture,
  LeagueDefinition,
  LeagueId,
  Team,
  TrophyCompetitionId,
  WorldConfig,
} from '../models/types';

export const COUNTRY_IDS = {
  ENGLAND: 'england',
} as const satisfies Record<string, CountryId>;

export const LEAGUE_IDS = {
  PREMIER_LEAGUE: 'england-premier-league',
  CHAMPIONSHIP: 'england-championship',
  LEAGUE_ONE: 'england-league-one',
  LEAGUE_TWO: 'england-league-two',
} as const satisfies Record<string, LeagueId>;

export const COMPETITION_IDS = {
  LEAGUE: 'league',
  CARABAO_CUP: 'england-carabao-cup',
  FA_CUP: 'england-fa-cup',
  UEFA_CHAMPIONS_LEAGUE: 'uefa-champions-league',
} as const satisfies Record<string, CompetitionId>;

export const DEFAULT_COUNTRY_ID: CountryId = COUNTRY_IDS.ENGLAND;
export const DEFAULT_LEAGUE_ID: LeagueId = LEAGUE_IDS.PREMIER_LEAGUE;
export const DEFAULT_COMPETITION_ID: CompetitionId = COMPETITION_IDS.LEAGUE;
export const DEFAULT_TROPHY_COMPETITION_ID: TrophyCompetitionId = COMPETITION_IDS.FA_CUP;

export const legacyDivisionNameToLeagueId: Record<string, LeagueId> = {
  'Premier League': LEAGUE_IDS.PREMIER_LEAGUE,
  Championship: LEAGUE_IDS.CHAMPIONSHIP,
  'League One': LEAGUE_IDS.LEAGUE_ONE,
  'League Two': LEAGUE_IDS.LEAGUE_TWO,
};

export const legacyCompetitionNameToCompetitionId: Record<string, CompetitionId> = {
  League: COMPETITION_IDS.LEAGUE,
  'Carabao Cup': COMPETITION_IDS.CARABAO_CUP,
  'FA Cup': COMPETITION_IDS.FA_CUP,
  'UEFA Champions League': COMPETITION_IDS.UEFA_CHAMPIONS_LEAGUE,
};

export const COUNTRY_DEFINITIONS: Record<CountryId, CountryDefinition> = {
  [COUNTRY_IDS.ENGLAND]: {
    id: COUNTRY_IDS.ENGLAND,
    displayName: 'England',
    reelHint: 'Swipe left for countries, then scroll down through the pyramid',
    sortOrder: 1,
  },
};

export const LEAGUE_DEFINITIONS: Record<LeagueId, LeagueDefinition> = {
  [LEAGUE_IDS.PREMIER_LEAGUE]: {
    id: LEAGUE_IDS.PREMIER_LEAGUE,
    countryId: COUNTRY_IDS.ENGLAND,
    displayName: 'Premier League',
    tier: 1,
    teamCount: 20,
    roundsPerOpponent: 2,
    promotionSlots: 0,
    relegationSlots: 3,
    newsPriority: 100,
  },
  [LEAGUE_IDS.CHAMPIONSHIP]: {
    id: LEAGUE_IDS.CHAMPIONSHIP,
    countryId: COUNTRY_IDS.ENGLAND,
    displayName: 'Championship',
    tier: 2,
    teamCount: 24,
    roundsPerOpponent: 2,
    promotionSlots: 3,
    relegationSlots: 3,
    newsPriority: 80,
  },
  [LEAGUE_IDS.LEAGUE_ONE]: {
    id: LEAGUE_IDS.LEAGUE_ONE,
    countryId: COUNTRY_IDS.ENGLAND,
    displayName: 'League One',
    tier: 3,
    teamCount: 24,
    roundsPerOpponent: 2,
    promotionSlots: 3,
    relegationSlots: 3,
    newsPriority: 60,
  },
  [LEAGUE_IDS.LEAGUE_TWO]: {
    id: LEAGUE_IDS.LEAGUE_TWO,
    countryId: COUNTRY_IDS.ENGLAND,
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
  [COMPETITION_IDS.LEAGUE]: {
    id: COMPETITION_IDS.LEAGUE,
    type: 'league',
    displayName: 'League',
    countryScope: COUNTRY_IDS.ENGLAND,
    trackedForTrophies: false,
    fixtureStrategy: 'round-robin',
    roundNames: [],
    startWeek: 1,
    spacingWeeks: 0,
    sortPriority: 0,
  },
  [COMPETITION_IDS.CARABAO_CUP]: {
    id: COMPETITION_IDS.CARABAO_CUP,
    type: 'domestic-cup',
    displayName: 'Carabao Cup',
    countryScope: COUNTRY_IDS.ENGLAND,
    trackedForTrophies: true,
    fixtureStrategy: 'knockout',
    roundNames: ['Round 1', 'Round 2', 'Round 3', 'Quarter-Final', 'Semi-Final', 'Final'],
    startWeek: 1,
    spacingWeeks: 4,
    sortPriority: 10,
  },
  [COMPETITION_IDS.FA_CUP]: {
    id: COMPETITION_IDS.FA_CUP,
    type: 'domestic-cup',
    displayName: 'FA Cup',
    countryScope: COUNTRY_IDS.ENGLAND,
    trackedForTrophies: true,
    fixtureStrategy: 'knockout',
    roundNames: ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Quarter-Final', 'Semi-Final', 'Final'],
    startWeek: 2,
    spacingWeeks: 4,
    sortPriority: 20,
  },
  [COMPETITION_IDS.UEFA_CHAMPIONS_LEAGUE]: {
    id: COMPETITION_IDS.UEFA_CHAMPIONS_LEAGUE,
    type: 'continental-cup',
    displayName: 'UEFA Champions League',
    countryScope: 'europe',
    trackedForTrophies: true,
    fixtureStrategy: 'inactive',
    roundNames: ['League Phase', 'Round of 16', 'Quarter-Final', 'Semi-Final', 'Final'],
    startWeek: 3,
    spacingWeeks: 2,
    sortPriority: 30,
  },
};

export const WORLD_CONFIG: WorldConfig = {
  countries: COUNTRY_DEFINITIONS,
  leagues: LEAGUE_DEFINITIONS,
  competitions: COMPETITION_DEFINITIONS,
};

type RegistryValidationIssue = {
  code:
    | 'country-id-mismatch'
    | 'league-id-mismatch'
    | 'competition-id-mismatch'
    | 'missing-country-reference'
    | 'invalid-competition-scope'
    | 'duplicate-league-tier'
    | 'duplicate-country-sort-order'
    | 'duplicate-competition-sort-priority'
    | 'missing-tracked-competition'
    | 'invalid-round-config';
  id: string;
  detail: string;
};

export class HydrationCompatibilityError extends Error {
  constructor(
    message: string,
    readonly entity: string,
    readonly field: string,
    readonly rawValue: unknown
  ) {
    super(message);
    this.name = 'HydrationCompatibilityError';
  }
}

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
  sortPriority: 999,
});

const refreshLeagueOrder = (target: LeagueId[]) => {
  target.splice(
    0,
    target.length,
    ...Object.values(LEAGUE_DEFINITIONS)
      .sort((left, right) => left.tier - right.tier || left.displayName.localeCompare(right.displayName))
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
      .sort((left, right) => left.sortPriority - right.sortPriority || left.displayName.localeCompare(right.displayName))
      .map(definition => definition.id)
  );
  trackedTrophyIds.splice(
    0,
    trackedTrophyIds.length,
    ...Object.values(COMPETITION_DEFINITIONS)
      .filter(definition => definition.trackedForTrophies)
      .sort((left, right) => left.sortPriority - right.sortPriority || left.displayName.localeCompare(right.displayName))
      .map(definition => definition.id)
  );
};

export const LEAGUE_ORDER: LeagueId[] = [];
export const ACTIVE_CUP_COMPETITION_IDS: CupCompetitionId[] = [];
export const TRACKED_TROPHY_COMPETITION_IDS: TrophyCompetitionId[] = [];

const getDuplicateValues = (values: number[]) => values.filter((value, index) => values.indexOf(value) !== index);

export const validateWorldConfig = (config: WorldConfig = WORLD_CONFIG) => {
  const issues: RegistryValidationIssue[] = [];
  const countryIds = new Set(Object.keys(config.countries));
  const duplicateCountrySortOrders = getDuplicateValues(Object.values(config.countries).map(definition => definition.sortOrder));
  const duplicateCompetitionSortPriorities = getDuplicateValues(
    Object.values(config.competitions).map(definition => definition.sortPriority)
  );
  const tiersByCountry = Object.values(config.leagues).reduce<Record<string, number[]>>((acc, definition) => {
    if (!acc[definition.countryId]) acc[definition.countryId] = [];
    acc[definition.countryId].push(definition.tier);
    return acc;
  }, {});

  Object.entries(config.countries).forEach(([countryId, definition]) => {
    if (definition.id !== countryId) {
      issues.push({ code: 'country-id-mismatch', id: countryId, detail: `Country key ${countryId} does not match definition id ${definition.id}.` });
    }
  });

  Object.entries(config.leagues).forEach(([leagueId, definition]) => {
    if (definition.id !== leagueId) {
      issues.push({ code: 'league-id-mismatch', id: leagueId, detail: `League key ${leagueId} does not match definition id ${definition.id}.` });
    }
    if (!countryIds.has(definition.countryId)) {
      issues.push({ code: 'missing-country-reference', id: leagueId, detail: `League ${leagueId} references missing country ${definition.countryId}.` });
    }
  });

  Object.entries(config.competitions).forEach(([competitionId, definition]) => {
    if (definition.id !== competitionId) {
      issues.push({
        code: 'competition-id-mismatch',
        id: competitionId,
        detail: `Competition key ${competitionId} does not match definition id ${definition.id}.`,
      });
    }
    if (definition.countryScope !== 'europe' && !countryIds.has(definition.countryScope)) {
      issues.push({
        code: 'invalid-competition-scope',
        id: competitionId,
        detail: `Competition ${competitionId} references invalid country scope ${definition.countryScope}.`,
      });
    }
    if (definition.type === 'league' && definition.roundNames.length > 0) {
      issues.push({
        code: 'invalid-round-config',
        id: competitionId,
        detail: `League competition ${competitionId} cannot define knockout round names.`,
      });
    }
    if (definition.fixtureStrategy === 'round-robin' && definition.roundNames.length > 0) {
      issues.push({
        code: 'invalid-round-config',
        id: competitionId,
        detail: `Round-robin competition ${competitionId} cannot define knockout round names.`,
      });
    }
  });

  Object.entries(tiersByCountry).forEach(([countryId, tiers]) => {
    getDuplicateValues(tiers).forEach(value => {
      issues.push({
        code: 'duplicate-league-tier',
        id: `${countryId}:${value}`,
        detail: `Duplicate league tier ${value} in country ${countryId}.`,
      });
    });
  });
  duplicateCountrySortOrders.forEach(value => {
    issues.push({ code: 'duplicate-country-sort-order', id: String(value), detail: `Duplicate country sort order ${value}.` });
  });
  duplicateCompetitionSortPriorities.forEach(value => {
    issues.push({
      code: 'duplicate-competition-sort-priority',
      id: String(value),
      detail: `Duplicate competition sort priority ${value}.`,
    });
  });

  TRACKED_TROPHY_COMPETITION_IDS.forEach(competitionId => {
    if (!config.competitions[competitionId]) {
      issues.push({
        code: 'missing-tracked-competition',
        id: competitionId,
        detail: `Tracked competition ${competitionId} is missing from the registry.`,
      });
    }
  });

  return issues;
};

const assertValidWorldConfig = () => {
  const issues = validateWorldConfig();
  if (issues.length === 0) return;
  const message = `Invalid world config:\n${issues.map(issue => `- [${issue.code}] ${issue.detail}`).join('\n')}`;
  throw new Error(message);
};

refreshLeagueOrder(LEAGUE_ORDER);
refreshCompetitionCaches(ACTIVE_CUP_COMPETITION_IDS, TRACKED_TROPHY_COMPETITION_IDS);
assertValidWorldConfig();

export const registerLeagueDefinition = (definition: LeagueDefinition) => {
  LEAGUE_DEFINITIONS[definition.id] = definition;
  refreshLeagueOrder(LEAGUE_ORDER);
  assertValidWorldConfig();
  return definition;
};

export const registerCompetitionDefinition = (definition: CompetitionDefinition) => {
  COMPETITION_DEFINITIONS[definition.id] = definition;
  refreshCompetitionCaches(ACTIVE_CUP_COMPETITION_IDS, TRACKED_TROPHY_COMPETITION_IDS);
  assertValidWorldConfig();
  return definition;
};

export const getCountryDefinition = (countryId?: CountryId | null) => (
  COUNTRY_DEFINITIONS[countryId || DEFAULT_COUNTRY_ID] || COUNTRY_DEFINITIONS[DEFAULT_COUNTRY_ID]
);

export const getLeagueDefinition = (leagueId?: LeagueId | null) => (
  LEAGUE_DEFINITIONS[leagueId || DEFAULT_LEAGUE_ID] || buildFallbackLeagueDefinition(leagueId || DEFAULT_LEAGUE_ID)
);

export const getCompetitionDefinition = (competitionId?: CompetitionId | null) => (
  COMPETITION_DEFINITIONS[competitionId || DEFAULT_COMPETITION_ID]
  || buildFallbackCompetitionDefinition(competitionId || DEFAULT_COMPETITION_ID)
);

export const mapLegacyLeagueId = (legacyValue?: string | null): LeagueId | undefined => (
  legacyValue ? legacyDivisionNameToLeagueId[legacyValue] : undefined
);

export const mapLegacyCompetitionId = (legacyValue?: string | null): CompetitionId | undefined => (
  legacyValue ? legacyCompetitionNameToCompetitionId[legacyValue] : undefined
);

export const resolveCanonicalLeagueId = (
  rawLeagueId?: LeagueId | null,
  legacyDivision?: string | null,
  entity = 'league',
  field = 'leagueId',
  fallbackToDefault = false
): LeagueId => {
  if (rawLeagueId && LEAGUE_DEFINITIONS[rawLeagueId]) return rawLeagueId;
  const mappedLeagueId = mapLegacyLeagueId(legacyDivision);
  if (mappedLeagueId) return mappedLeagueId;
  if (fallbackToDefault) return DEFAULT_LEAGUE_ID;
  throw new HydrationCompatibilityError(`Unable to resolve canonical league id for ${entity}.`, entity, field, rawLeagueId || legacyDivision);
};

export const resolveCanonicalCompetitionId = (
  rawCompetitionId?: CompetitionId | null,
  legacyCompetition?: string | null,
  entity = 'competition',
  field = 'competitionId',
  fallbackToDefault = false
): CompetitionId => {
  if (rawCompetitionId && COMPETITION_DEFINITIONS[rawCompetitionId]) return rawCompetitionId;
  const mappedCompetitionId = mapLegacyCompetitionId(legacyCompetition);
  if (mappedCompetitionId) return mappedCompetitionId;
  if (fallbackToDefault) return DEFAULT_COMPETITION_ID;
  throw new HydrationCompatibilityError(
    `Unable to resolve canonical competition id for ${entity}.`,
    entity,
    field,
    rawCompetitionId || legacyCompetition
  );
};

export const getTeamLeagueId = (team?: Pick<Team, 'leagueId' | 'division'> | null): LeagueId => (
  resolveCanonicalLeagueId(team?.leagueId, team?.division, 'team', 'leagueId', true)
);

export const getFixtureCompetitionId = (fixture?: Pick<Fixture, 'competitionId' | 'competition'> | null): CompetitionId => (
  resolveCanonicalCompetitionId(fixture?.competitionId, fixture?.competition, 'fixture', 'competitionId', true)
);

export const getFixtureLeagueId = (fixture?: Pick<Fixture, 'leagueId' | 'division'> | null): LeagueId | undefined => {
  if (!fixture?.leagueId && !fixture?.division) return undefined;
  return resolveCanonicalLeagueId(fixture?.leagueId, fixture?.division, 'fixture', 'leagueId', true);
};

export const getCountryDisplayName = (countryId?: CountryId | null) => getCountryDefinition(countryId).displayName;
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

export const getCompetitionSortRank = (competitionId?: CompetitionId | null) => (
  getCompetitionDefinition(competitionId).sortPriority
);

export const getCompetitionRoundName = (competitionId: CompetitionId, roundNumber: number) => (
  getCompetitionDefinition(competitionId).roundNames[roundNumber - 1] || `Round ${roundNumber}`
);

export const getCountryLeagues = (countryId?: CountryId | null) => (
  LEAGUE_ORDER.filter(leagueId => getLeagueDefinition(leagueId).countryId === (countryId || DEFAULT_COUNTRY_ID))
);

export const getTrackedCompetitionIds = () => [...TRACKED_TROPHY_COMPETITION_IDS];
