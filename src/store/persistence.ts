import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BoardObjective,
  CareerRecord,
  CompetitionId,
  CompetitionState,
  Fixture,
  Formation,
  GameState,
  InboxMessage,
  LeagueDivision,
  Manager,
  Player,
  Team,
  UserManagerIdentity,
} from '../models/types';
import { buildBoardProfile, clampBoardMetric } from '../core/boardEngine';
import { DIVISION_ORDER, LEAGUE_COMPETITION_BY_DIVISION } from '../core/leagueUtils';
import { buildUserManagerIdentity } from '../core/careerEngine';
import { buildGenericManager, deriveInitialBoardApproval, hydrateManagerContext } from '../core/managerUtils';
import { buildLegacyInboxMessages } from './inboxHelpers';
import { LiveMatchState, pruneInvalidLiveMatches } from './liveMatchHelpers';
import { buildManagedTeamObjectives } from './managedTeamObjectives';
import { createFreeAgentTeam, FREE_AGENT_TEAM_ID } from '../core/freeAgentPool';

export type PersistedStoreState = Partial<GameState & {
  liveMatches: Record<string, LiveMatchState>;
  transfersAppliedWeek: number;
}>;

interface PersistedStorageEnvelope {
  state?: PersistedStoreState;
  version?: number;
}

export interface PersistLoadError {
  key: string;
  message: string;
}

export const PERSIST_STORAGE_KEY = 'football-manager-storage';

let persistLoadError: PersistLoadError | null = null;

export const getPersistLoadError = (): PersistLoadError | null => persistLoadError;

export const clearPersistLoadError = () => {
  persistLoadError = null;
};

const setPersistLoadError = (key: string, message: string) => {
  persistLoadError = { key, message };
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const unpackPersistedState = (parsed: unknown): PersistedStoreState => {
  if (!isRecord(parsed)) return {};
  const envelope = parsed as PersistedStorageEnvelope;
  return isRecord(envelope.state) ? envelope.state : parsed as PersistedStoreState;
};

const DEFAULT_CAREER_RECORD: CareerRecord = {
  seasonsManaged: 0,
  totalWins: 0,
  totalDraws: 0,
  totalLosses: 0,
  totalGoalsFor: 0,
  totalGoalsAgainst: 0,
  reputation: 50,
  trophies: [],
  seasonHistory: [],
  consecutiveLowApprovalWeeks: 0,
};

const VALID_FORMATIONS: readonly Formation[] = [
  '4-3-3',
  '3-4-3',
  '5-2-3',
  '4-4-2',
  '4-2-3-1',
  '3-5-2',
  '4-1-4-1',
  '4-3-2-1',
  '3-4-2-1',
  '4-5-1',
  '4-2-2-2',
  '3-2-4-1',
];

const VALID_COMPETITION_IDS: ReadonlySet<CompetitionId> = new Set([
  ...Object.values(LEAGUE_COMPETITION_BY_DIVISION),
  'carabao-cup',
  'fa-cup',
  'europe',
]);

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.round(clampNumber(value, min, max, fallback));

/** Simple string→number hash for deriving per-fixture RNG seeds. */
export const hashStringToSeed = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit int
  }
  return hash >>> 0;
};

/** Ensure every player.teamId points to a valid team by creating a durable
 *  free-agent team when needed. Returns the (possibly augmented) teams record. */
export const ensureReferentialIntegrity = (
  teams: Record<string, Team>,
  players: Record<string, Player>
): Record<string, Team> => {
  let result = teams;
  const needsFreeAgent = Object.values(players).some(
    p => p.teamId === FREE_AGENT_TEAM_ID || !result[p.teamId]
  );
  if (needsFreeAgent && !result[FREE_AGENT_TEAM_ID]) {
    result = { ...result, [FREE_AGENT_TEAM_ID]: createFreeAgentTeam() };
  }
  return result;
};

/** Result of a load attempt, distinguishing corrupt saves from missing ones. */
export interface LoadResult {
  status: 'ok' | 'missing' | 'corrupt';
  data: PersistedStoreState | null;
  error?: string;
}

/** Reads and parses a persisted state blob, distinguishing missing storage
 *  from corrupt JSON so callers can surface a distinct error. */
export const safeLoadState = async (key: string): Promise<LoadResult> => {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return { status: 'missing', data: null, error: 'AsyncStorage read failed' };
  }
  if (raw === null) return { status: 'missing', data: null };
  try {
    const data = unpackPersistedState(JSON.parse(raw));
    return { status: 'ok', data };
  } catch (parseError) {
    return { status: 'corrupt', data: null, error: `Corrupt save JSON: ${(parseError as Error).message}` };
  }
};

export const DEFAULT_GAME_STATE: GameState = {
  currentWeek: 1,
  userTeamId: null,
  teams: {},
  players: {},
  fixtures: {},
  competitions: {},
  news: [],
  inboxMessages: [],
  boardObjectives: [],
  boardReviewAppliedWeek: 0,
  careerRecord: DEFAULT_CAREER_RECORD,
  rngState: Math.floor(Math.random() * 2147483647) + 1,
};

export const safeStorage = {
  getItem: async (key: string) => {
    let raw: string | null;
    try {
      raw = await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      JSON.parse(raw);
      if (persistLoadError?.key === key) clearPersistLoadError();
      return raw;
    } catch (parseError) {
      const message = `Your saved game could not be loaded because the save data is corrupt. ${(parseError as Error).message}`;
      setPersistLoadError(key, message);
      console.warn('corrupt save ignored:', parseError);
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try { await AsyncStorage.setItem(key, value); } catch (e) { console.warn('save failed:', e); }
  },
  removeItem: async (key: string) => {
    try { await AsyncStorage.removeItem(key); } catch (e) { console.warn('remove failed:', e); }
  },
};

const buildLegacyLeagueCompetitions = (
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  season: number
): Record<string, CompetitionState> => Object.fromEntries(
  DIVISION_ORDER
    .map((division): [string, CompetitionState] | null => {
      const entrantTeamIds = Object.values(teams)
        .filter(team => team.division === division)
        .map(team => team.id);
      if (entrantTeamIds.length === 0) return null;

      const fixtureIds = Object.values(fixtures)
        .filter(fixture => fixture.division === division)
        .map(fixture => fixture.id);
      const competitionId = LEAGUE_COMPETITION_BY_DIVISION[division];

      return [
        competitionId,
        {
          id: competitionId,
          name: division,
          shortName: division === 'Premier League' ? 'PL' : division,
          type: 'league',
          season,
          leagueDivision: division,
          entrantTeamIds,
          rounds: [{
            key: 'league',
            label: 'League Season',
            week: 1,
            entrantTeamIds,
            fixtureIds,
            byeTeamIds: [],
            winnerTeamIds: [],
            completed: false,
          }],
          currentRound: 'league',
          eliminatedTeamIds: [],
        },
      ];
    })
    .filter((entry): entry is [string, CompetitionState] => Boolean(entry))
);

const getBoardObjectiveMigrationKey = (
  objective: Pick<BoardObjective, 'type' | 'target' | 'competitionId' | 'targetRound'>
) => [
  objective.type,
  objective.target,
  objective.competitionId || '',
  objective.targetRound || '',
].join('|');

const reconcileBoardObjectives = (
  persistedObjectives: unknown,
  nextObjectives: BoardObjective[]
): BoardObjective[] => {
  if (!Array.isArray(persistedObjectives) || nextObjectives.length === 0) return nextObjectives;

  const persistedByKey = new Map<string, Partial<BoardObjective>>();
  persistedObjectives.forEach(objective => {
    if (!objective || typeof objective !== 'object') return;
    const typedObjective = objective as Partial<BoardObjective>;
    const { target } = typedObjective;
    if (typeof typedObjective.type !== 'string' || typeof target !== 'number' || !Number.isFinite(target)) return;

    const key = getBoardObjectiveMigrationKey({
      type: typedObjective.type as BoardObjective['type'],
      target,
      competitionId: typedObjective.competitionId,
      targetRound: typedObjective.targetRound,
    });
    if (!persistedByKey.has(key)) {
      persistedByKey.set(key, typedObjective);
    }
  });

  return nextObjectives.map(objective => {
    const persistedObjective = persistedByKey.get(getBoardObjectiveMigrationKey(objective));
    if (!persistedObjective) return objective;

    return {
      ...objective,
      id: typeof persistedObjective.id === 'string' && persistedObjective.id.length > 0
        ? persistedObjective.id
        : objective.id,
      met: typeof persistedObjective.met === 'boolean'
        ? persistedObjective.met
        : objective.met,
    };
  });
};

const isValidUserManagerIdentity = (value: unknown): value is UserManagerIdentity => {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Partial<UserManagerIdentity>;
  return typeof identity.name === 'string' && identity.name.trim().length > 0 &&
    typeof identity.nationality === 'string' && identity.nationality.trim().length > 0 &&
    typeof identity.dateOfBirth === 'string' && identity.dateOfBirth.trim().length > 0 &&
    Array.isArray(identity.preferredFormations) && identity.preferredFormations.length > 0 &&
    identity.preferredFormations.every(formation => VALID_FORMATIONS.includes(formation as Formation)) &&
    typeof identity.tacticalIdentity === 'string' && identity.tacticalIdentity.trim().length > 0 &&
    typeof identity.transferIdentity === 'string' && identity.transferIdentity.trim().length > 0;
};

export const sanitizePersistedState = (state: PersistedStoreState): PersistedStoreState => {
  const teams = state.teams && typeof state.teams === 'object'
    ? Object.fromEntries(
      Object.entries(state.teams).map(([teamId, team]) => {
        const typedTeam = (team && typeof team === 'object' ? team : {}) as Partial<Team>;
        const division = (typedTeam.division || 'Premier League') as Team['division'];
        const boardProfile = typedTeam.boardProfile && typeof typedTeam.boardProfile === 'object'
          ? typedTeam.boardProfile
          : buildBoardProfile(typedTeam.clubClass || 'C', division, Boolean(typedTeam.isExternal));
        const managerSource = typedTeam.manager && typeof typedTeam.manager === 'object'
          ? typedTeam.manager as Manager
          : buildGenericManager(
              typedTeam.name || teamId,
              teamId,
              division,
              60,
              boardProfile
            );
        const manager = hydrateManagerContext(managerSource, boardProfile, division);

        return [
          teamId,
          {
            ...typedTeam,
            id: typedTeam.id || teamId,
            name: typedTeam.name || teamId,
            division,
            countryId: typedTeam.countryId || (typedTeam.isExternal ? 'continental' : 'england'),
            clubClass: typedTeam.clubClass || 'C',
            boardProfile,
            manager,
            tactics: typedTeam.tactics && typeof typedTeam.tactics === 'object'
              ? typedTeam.tactics
              : { mentality: 'Balanced', passingStyle: 'Mixed', tempo: 'Normal', defensiveLine: 'Standard', pressing: 'Medium' } as Team['tactics'],
            transferSpend: Number.isFinite(typedTeam.transferSpend) ? typedTeam.transferSpend : 0,
            budget: Number.isFinite(typedTeam.budget) ? Math.max(0, typedTeam.budget!) : 20,
            operatingBudget: Number.isFinite(typedTeam.operatingBudget)
              ? Math.max(0, typedTeam.operatingBudget!)
              : undefined,
            boardApproval: Number.isFinite(typedTeam.boardApproval)
              ? clampBoardMetric(typedTeam.boardApproval!)
              : deriveInitialBoardApproval(manager, boardProfile),
          },
        ];
      })
    ) as Record<string, Team>
    : {};

  const players = state.players && typeof state.players === 'object'
    ? Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => {
        const typedPlayer = (player && typeof player === 'object' ? player : {}) as Partial<Player>;
        const validStringId = typeof typedPlayer.id === 'string' && typedPlayer.id.trim() === playerId
          ? typedPlayer.id
          : '';
        return [
          playerId,
          {
            ...typedPlayer,
            id: validStringId || playerId,
            overallRating: clampInt(typedPlayer.overallRating, 1, 99, 50),
            age: clampInt(typedPlayer.age, 16, 50, 25),
            marketValue: clampNumber(typedPlayer.marketValue, 0, 500, 1),
            wage: clampNumber(typedPlayer.wage, 0, 1000, 5),
            contractLeft: clampInt(typedPlayer.contractLeft, 0, 10, 1),
            morale: clampInt(typedPlayer.morale, 0, 100, 50),
            energy: clampInt(typedPlayer.energy, 0, 100, 100),
            injuryWeeks: clampInt(typedPlayer.injuryWeeks, 0, 52, 0),
            injuryType: clampInt(typedPlayer.injuryWeeks, 0, 52, 0) > 0 ? typedPlayer.injuryType : undefined,
            injuryAppliedWeek: Number.isFinite(typedPlayer.injuryAppliedWeek) ? typedPlayer.injuryAppliedWeek : undefined,
            matchesSuspended: clampInt(typedPlayer.matchesSuspended, 0, 10, 0),
            suspensionAppliedWeek: Number.isFinite(typedPlayer.suspensionAppliedWeek) ? typedPlayer.suspensionAppliedWeek : undefined,
            matchRatingHistory: Array.isArray(typedPlayer.matchRatingHistory) ? typedPlayer.matchRatingHistory : [],
            goals: clampInt(typedPlayer.goals, 0, 999, 0),
            assists: clampInt(typedPlayer.assists, 0, 999, 0),
            cleanSheets: clampInt(typedPlayer.cleanSheets, 0, 99, 0),
            yellowCards: clampInt(typedPlayer.yellowCards, 0, 99, 0),
            redCards: clampInt(typedPlayer.redCards, 0, 20, 0),
            minutesPlayed: clampInt(typedPlayer.minutesPlayed, 0, 99999, 0),
          },
        ];
      })
    ) as Record<string, Player>
    : {};

  // --- Referential integrity validation: players → teams ---
  let validatedPlayers = players;
  let validatedTeams = teams;

  // Ensure a durable free-agent team exists if any player references it or if
  // we need to reassign broken player→team references.
  const ensureFreeAgentTeam = (targetTeams: Record<string, Team>): Record<string, Team> => {
    if (targetTeams[FREE_AGENT_TEAM_ID]) return targetTeams;
    return { ...targetTeams, [FREE_AGENT_TEAM_ID]: createFreeAgentTeam() };
  };

  const brokenPlayerIds: string[] = [];
  Object.entries(validatedPlayers).forEach(([playerId, player]) => {
    if (!validatedTeams[player.teamId]) {
      brokenPlayerIds.push(playerId);
    }
  });

  if (brokenPlayerIds.length > 0) {
    validatedTeams = ensureFreeAgentTeam(validatedTeams);
    const fixedEntries = Object.entries(validatedPlayers).map(([playerId, player]) => {
      if (brokenPlayerIds.includes(playerId)) {
        // Move to free-agent pool and strip starting/sub status to avoid
        // formation-map corruption on the (missing) original team.
        return [
          playerId,
          {
            ...player,
            teamId: FREE_AGENT_TEAM_ID,
            isStarting: false,
            isSub: false,
            isTransferListed: false,
            askingPrice: 0,
          },
        ];
      }
      return [playerId, player];
    });
    validatedPlayers = Object.fromEntries(fixedEntries) as Record<string, Player>;
  }

  const unresolvedPlayerIds = Object.entries(validatedPlayers)
    .filter(([, player]) => !validatedTeams[player.teamId])
    .map(([playerId]) => playerId);
  if (unresolvedPlayerIds.length > 0) {
    validatedTeams = ensureFreeAgentTeam(validatedTeams);
    validatedPlayers = Object.fromEntries(
      Object.entries(validatedPlayers).map(([playerId, player]) => [
        playerId,
        unresolvedPlayerIds.includes(playerId)
          ? { ...player, teamId: FREE_AGENT_TEAM_ID, isStarting: false, isSub: false }
          : player,
      ])
    ) as Record<string, Player>;
  }

  // If the free-agent team wasn't created above but players already reference it
  // (e.g. persisted __free_agent__ from weekLifecycle squad trimming), create it now.
  const hasFreeAgentPlayers = Object.values(validatedPlayers).some(p => p.teamId === FREE_AGENT_TEAM_ID);
  if (hasFreeAgentPlayers) {
    validatedTeams = ensureFreeAgentTeam(validatedTeams);
  }

  const userTeamId = typeof state.userTeamId === 'string' && validatedTeams[state.userTeamId]
    ? state.userTeamId
    : null;
  const rawCareer = state.careerRecord && typeof state.careerRecord === 'object'
    ? state.careerRecord as Partial<CareerRecord>
    : {};
  const userManager = isValidUserManagerIdentity(rawCareer.userManager)
    ? rawCareer.userManager
    : userTeamId && validatedTeams[userTeamId]
      ? buildUserManagerIdentity(validatedTeams[userTeamId].manager)
      : undefined;
  const careerRecord: CareerRecord = {
    seasonsManaged: Number.isFinite(rawCareer.seasonsManaged) ? rawCareer.seasonsManaged! : 0,
    totalWins: Number.isFinite(rawCareer.totalWins) ? rawCareer.totalWins! : 0,
    totalDraws: Number.isFinite(rawCareer.totalDraws) ? rawCareer.totalDraws! : 0,
    totalLosses: Number.isFinite(rawCareer.totalLosses) ? rawCareer.totalLosses! : 0,
    totalGoalsFor: Number.isFinite(rawCareer.totalGoalsFor) ? rawCareer.totalGoalsFor! : 0,
    totalGoalsAgainst: Number.isFinite(rawCareer.totalGoalsAgainst) ? rawCareer.totalGoalsAgainst! : 0,
    reputation: Number.isFinite(rawCareer.reputation) ? rawCareer.reputation! : 50,
    trophies: Array.isArray(rawCareer.trophies) ? rawCareer.trophies : [],
    seasonHistory: Array.isArray(rawCareer.seasonHistory) ? rawCareer.seasonHistory : [],
    consecutiveLowApprovalWeeks: Number.isFinite(rawCareer.consecutiveLowApprovalWeeks) ? rawCareer.consecutiveLowApprovalWeeks! : 0,
    ...(userManager ? { userManager } : {}),
  };

  const rawFixtures = state.fixtures && typeof state.fixtures === 'object'
    ? Object.fromEntries(
      Object.entries(state.fixtures).map(([fixtureId, fixture]) => {
        const typedFixture = (fixture && typeof fixture === 'object' ? fixture : {}) as Partial<Fixture>;
        const division = typedFixture.division as LeagueDivision | undefined;
        return [
          fixtureId,
          {
            ...typedFixture,
            id: typedFixture.id || fixtureId,
            competitionId: typedFixture.competitionId || (division ? LEAGUE_COMPETITION_BY_DIVISION[division] : 'premier-league'),
            competitionType: typedFixture.competitionType || 'league',
            round: typedFixture.round || 'league',
            isKnockout: Boolean(typedFixture.isKnockout),
            isPlayed: Boolean(typedFixture.isPlayed),
            homeScore: typedFixture.homeScore ?? null,
            awayScore: typedFixture.awayScore ?? null,
          },
        ];
      })
    ) as Record<string, Fixture>
    : {};

  // --- Referential integrity validation: fixtures → teams ---
  // Drop fixtures whose home or away team no longer exists before deriving
  // competition membership.
  const teamValidFixtures = Object.fromEntries(
    Object.entries(rawFixtures).filter(([, fixture]) =>
      validatedTeams[fixture.homeTeamId] && validatedTeams[fixture.awayTeamId]
    )
  ) as Record<string, Fixture>;

  const persistedCompetitions = state.competitions && typeof state.competitions === 'object'
    ? Object.fromEntries(
      Object.entries(state.competitions)
        .filter(([competitionId, competition]) =>
          VALID_COMPETITION_IDS.has(competitionId as CompetitionId) &&
          Boolean(competition) &&
          typeof competition === 'object'
        )
        .map(([competitionId, competition]) => {
          const typedCompetition = competition as CompetitionState;
          return [
            competitionId,
            {
              ...typedCompetition,
              id: competitionId as CompetitionId,
              rounds: Array.isArray(typedCompetition.rounds) ? typedCompetition.rounds : [],
            },
          ];
        })
    ) as Record<string, CompetitionState>
    : {};
  const baseCompetitions = Object.keys(persistedCompetitions).length > 0
    ? persistedCompetitions
    : buildLegacyLeagueCompetitions(validatedTeams, teamValidFixtures, careerRecord.seasonsManaged + 1);

  // --- Referential integrity validation: fixtures → competitions ---
  // Keep fixtures only when their competition exists. For legacy league saves,
  // repair an invalid competitionId from the fixture division when unambiguous.
  const fixtures = Object.fromEntries(
    Object.entries(teamValidFixtures)
      .map(([fixtureId, fixture]): [string, Fixture] | null => {
        if (VALID_COMPETITION_IDS.has(fixture.competitionId) && baseCompetitions[fixture.competitionId]) {
          return [fixtureId, fixture];
        }

        const repairedCompetitionId = fixture.division
          ? LEAGUE_COMPETITION_BY_DIVISION[fixture.division]
          : undefined;
        if (repairedCompetitionId && baseCompetitions[repairedCompetitionId]) {
          return [
            fixtureId,
            {
              ...fixture,
              competitionId: repairedCompetitionId,
              competitionType: baseCompetitions[repairedCompetitionId].type,
              round: fixture.round || baseCompetitions[repairedCompetitionId].currentRound || 'league',
            },
          ];
        }

        return null;
      })
      .filter((entry): entry is [string, Fixture] => Boolean(entry))
  ) as Record<string, Fixture>;

  const competitions = Object.fromEntries(
    Object.entries(baseCompetitions).map(([competitionId, competition]) => [
      competitionId,
      {
        ...competition,
        id: competitionId as CompetitionId,
        rounds: Array.isArray(competition.rounds)
          ? competition.rounds.map(round => ({
              ...round,
              fixtureIds: Array.isArray(round.fixtureIds)
                ? round.fixtureIds.filter(fixtureId => fixtures[fixtureId]?.competitionId === competitionId)
                : [],
            }))
          : [],
      },
    ])
  ) as Record<string, CompetitionState>;
  const migratedBoardObjectives = userTeamId && validatedTeams[userTeamId]
    ? reconcileBoardObjectives(
        state.boardObjectives,
        buildManagedTeamObjectives(validatedTeams[userTeamId], competitions)
      )
    : [];

  const currentWeek = Number.isFinite(state.currentWeek) && (state.currentWeek || 0) > 0 ? state.currentWeek! : 1;
  const liveMatches = state.liveMatches && typeof state.liveMatches === 'object'
    ? pruneInvalidLiveMatches(
        Object.fromEntries(
          Object.entries(state.liveMatches).filter(([, liveState]) => {
            const ls = liveState as Partial<LiveMatchState>;
            return Boolean(ls) && typeof ls === 'object' &&
              Array.isArray(ls.homeStarterIds) && ls.homeStarterIds.length > 0 &&
              Array.isArray(ls.awayStarterIds) && ls.awayStarterIds.length > 0;
          })
        ) as Record<string, LiveMatchState>,
        { currentWeek, fixtures, teams: validatedTeams, players: validatedPlayers }
      )
    : {};

  // Seed persistence: carry forward existing seed or derive a new one.
  const rngState = Number.isFinite(state.rngState) && (state.rngState ?? 0) > 0
    ? state.rngState!
    : Math.floor(Math.random() * 2147483647) + 1;

  return {
    ...state,
    currentWeek,
    userTeamId,
    teams: validatedTeams,
    players: validatedPlayers,
    fixtures,
    competitions,
    news: Array.isArray(state.news) ? state.news : [],
    inboxMessages: Array.isArray(state.inboxMessages)
      ? state.inboxMessages as InboxMessage[]
      : buildLegacyInboxMessages(
        Array.isArray(state.news) ? state.news : [],
        Number.isFinite(state.currentWeek) && (state.currentWeek || 0) > 0 ? state.currentWeek || 1 : 1
      ),
    boardObjectives: migratedBoardObjectives,
    liveMatches,
    careerRecord,
    boardReviewAppliedWeek: Number.isFinite(state.boardReviewAppliedWeek) ? state.boardReviewAppliedWeek : 0,
    transfersAppliedWeek: Number.isFinite(state.transfersAppliedWeek) ? state.transfersAppliedWeek : 0,
    rngState,
  };
};
