import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BoardObjective,
  CareerRecord,
  CompetitionState,
  Fixture,
  GameState,
  InboxMessage,
  LeagueDivision,
  Manager,
  Player,
  Team,
} from '../models/types';
import { buildBoardProfile, clampBoardMetric } from '../core/boardEngine';
import { DIVISION_ORDER, LEAGUE_COMPETITION_BY_DIVISION } from '../core/leagueUtils';
import { buildGenericManager, deriveInitialBoardApproval, hydrateManagerContext } from '../core/managerUtils';
import { buildLegacyInboxMessages } from './inboxHelpers';
import { LiveMatchState } from './liveMatchHelpers';
import { buildManagedTeamObjectives } from './managedTeamObjectives';

export type PersistedStoreState = Partial<GameState & {
  liveMatches: Record<string, LiveMatchState>;
}>;

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
  careerRecord: DEFAULT_CAREER_RECORD,
};

export const safeStorage = {
  getItem: async (key: string) => {
    try { return await AsyncStorage.getItem(key); } catch { return null; }
  },
  setItem: async (key: string, value: string) => {
    try { await AsyncStorage.setItem(key, value); } catch { /* silent */ }
  },
  removeItem: async (key: string) => {
    try { await AsyncStorage.removeItem(key); } catch { /* silent */ }
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
            boardProfile,
            manager,
            transferSpend: Number.isFinite(typedTeam.transferSpend) ? typedTeam.transferSpend : 0,
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
        return [
          playerId,
          {
            ...typedPlayer,
            injuryWeeks: Number.isFinite(typedPlayer.injuryWeeks) ? typedPlayer.injuryWeeks : 0,
            injuryType: typedPlayer.injuryWeeks ? typedPlayer.injuryType : undefined,
          },
        ];
      })
    ) as Record<string, Player>
    : {};

  const rawCareer = state.careerRecord && typeof state.careerRecord === 'object'
    ? state.careerRecord as Partial<CareerRecord>
    : {};
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
  };

  const fixtures = state.fixtures && typeof state.fixtures === 'object'
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

  const competitions = state.competitions && typeof state.competitions === 'object'
    ? state.competitions as Record<string, CompetitionState>
    : buildLegacyLeagueCompetitions(teams, fixtures, careerRecord.seasonsManaged + 1);
  const userTeamId = typeof state.userTeamId === 'string' ? state.userTeamId : null;
  const migratedBoardObjectives = userTeamId && teams[userTeamId]
    ? reconcileBoardObjectives(
        state.boardObjectives,
        buildManagedTeamObjectives(teams[userTeamId], competitions)
      )
    : [];

  return {
    ...state,
    currentWeek: Number.isFinite(state.currentWeek) && (state.currentWeek || 0) > 0 ? state.currentWeek : 1,
    teams,
    players,
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
    liveMatches: state.liveMatches && typeof state.liveMatches === 'object' ? state.liveMatches : {},
    careerRecord,
  };
};
