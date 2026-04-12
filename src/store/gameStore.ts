import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BoardObjective,
  CareerRecord,
  CompetitionState,
  Fixture,
  Formation,
  GameState,
  InboxMessage,
  LeagueDivision,
  Manager,
  Player,
  Team,
  TeamTactics,
} from '../models/types';
import { initGameData } from '../utils/initGame';
import { getSlotsForFormation } from '../constants/formations';
import { ENGINE_CONFIG } from '../config/engineConfig';
import {
  resolveCompetitionProgression,
} from '../core/competitionEngine';
import {
  buildBoardObjectives,
  buildBoardProfile,
  clampBoardMetric,
  runBoardReview,
} from '../core/boardEngine';
import {
  DIVISION_ORDER,
  LEAGUE_COMPETITION_BY_DIVISION,
  getSeasonWeekLimit,
} from '../core/leagueUtils';
import {
  simulatePossession,
  quickSimMatch,
  getFormModifier,
  getMoraleModifier,
  buildTeamShapeProfile,
} from '../core/matchEngine';
import { applySubstitutions } from '../core/substitutionEngine';
import { addPlayerStat, scaleLineupForMatch } from '../core/matchUtils';
import { applySharedPostMatchAccounting } from '../core/postMatchAccounting';
import { computeWeeklyTransfers, computeWeeklyProgression } from '../core/progressionEngine';
import { advanceSeason } from '../core/seasonTransition';
import {
  applySeasonEndToCareer,
  buildSeasonSummary,
  createDefaultCareerRecord,
  evaluateSackingRisk,
  generateJobOfferCandidates,
} from '../core/careerEngine';
import { buildGenericManager, deriveInitialBoardApproval, hydrateManagerContext } from '../core/managerUtils';
import { rebuildFormationMap, removePlayerFromTeamSelections } from '../core/formationMapUtils';
import { defaultRandomGenerator } from '../core/random';
import { buildStarterMinuteMap } from '../core/minuteMapUtils';
import { applyMatchInjuries } from '../core/injuryEngine';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import {
  LiveMatchState,
  drainLiveMatchEnergy,
  ensureLiveTeamStarters,
  getPlayersByIds,
  getPossessionIndexForMinute,
  removeLiveMatchFixture,
  updateTeamStats,
} from './liveMatchHelpers';
import {
  buildLegacyInboxMessages,
  generateAssistantWeekMessages,
  generateBoardInboxMessages,
  generateCareerInboxMessages,
  generatePostMatchReportMessage,
  generateSackWarningMessage,
  generateSystemInboxMessages,
  mergeInboxMessages,
  pruneInboxMessagesForManagedTeam,
} from './inboxHelpers';

interface GameStore extends GameState {
  liveMatches: Record<string, LiveMatchState>;
  initializeGame: (userTeamId: string) => void;
  advanceWeek: () => void;
  playMatch: (fixtureId: string) => void;
  markInboxMessageRead: (messageId: string) => void;
  dismissInboxMessage: (messageId: string) => void;
  applyInboxAction: (messageId: string) => void;
  renewPlayerContract: (playerId: string, years: number, wage: number) => { success: boolean; message: string };
  setFormation: (teamId: string, formation: Formation) => void;
  toggleStarting: (playerId: string) => void;
  markAsSub: (playerId: string) => void;
  setTactics: (teamId: string, tactics: Partial<TeamTactics>) => void;
  swapPlayer: (removeId: string | null, addId: string, slotKey?: string) => void;
  swapStartingSlots: (teamId: string, slotA: string, slotB: string) => void;
  skipToEndOfSeason: () => void;
  changeTeam: (teamId: string) => void;
  // Transfer System
  buyPlayer: (playerId: string, fee: number, wageOffered: number) => { success: boolean; message: string };
  listPlayerForSale: (playerId: string, askingPrice: number) => void;
  unlistPlayer: (playerId: string) => void;
  processWeeklyTransfers: () => void;
  // Board System
  checkBoardObjectives: () => void;
  // Live Match Engine
  processMatchMinute: (fixtureId: string, minute: number) => { event: string | null };
  finishLiveMatch: (fixtureId: string) => void;
}





// Safe AsyncStorage wrapper: avoids "native module is null" during startup.
const safeStorage = {
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

const DEFAULT_GAME_STATE: GameState = {
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

const applyLineupSuggestionToTeam = (
  allPlayers: Record<string, Player>,
  teamId: string,
  startingIds: string[],
  subIds: string[]
) => {
  const nextPlayers = { ...allPlayers };
  const startingSet = new Set(startingIds);
  const subSet = new Set(subIds);

  Object.values(allPlayers)
    .filter(player => player.teamId === teamId)
    .forEach(player => {
      nextPlayers[player.id] = {
        ...player,
        isStarting: startingSet.has(player.id),
        isSub: !startingSet.has(player.id) && subSet.has(player.id),
      };
    });

  return nextPlayers;
};

const buildRenewedPlayer = (player: Player, years: number, wage: number): Player => ({
  ...player,
  contractLeft: years,
  wage,
  morale: Math.min(100, player.morale + 6),
});

const clearContractWarningMessages = (messages: InboxMessage[], playerId: string) => (
  messages.map(message => (
    message.category === 'contract_warning' && message.playerId === playerId
      ? { ...message, isRead: true, action: undefined }
      : message
  ))
);

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

const sanitizePersistedState = (state: Partial<GameStore>): Partial<GameStore> => {
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

const updateTransferListingState = (
  players: Record<string, Player>,
  playerId: string,
  isTransferListed: boolean,
  askingPrice: number
) => {
  const player = players[playerId];
  if (!player) return null;
  return {
    ...players,
    [playerId]: { ...player, isTransferListed, askingPrice },
  };
};

const getActiveCompetitionIdsForTeam = (
  teamId: string,
  competitions: Record<string, CompetitionState>
) => (
  Object.values(competitions)
    .filter(competition => competition.entrantTeamIds.includes(teamId))
    .map(competition => competition.id)
);

const buildManagedTeamObjectives = (
  team: Team | undefined,
  competitions: Record<string, CompetitionState> = {}
) => {
  if (!team || team.division === 'Continental') return [];
  return buildBoardObjectives(
    team.clubClass || 'C',
    team.division as LeagueDivision,
    team.boardProfile || buildBoardProfile(team.clubClass || 'C', team.division, Boolean(team.isExternal)),
    getActiveCompetitionIdsForTeam(team.id, competitions)
  );
};

const getSackingApprovalThreshold = (team: Team) => (
  team.boardProfile.patience === 'low'
    ? 28
    : team.boardProfile.patience === 'high'
      ? 18
      : 22
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

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
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
      liveMatches: {},

      initializeGame: (userTeamId) => {
        const data = initGameData();
        
        // Remap 'temp' to first actual team ID
        const actualTeamId = userTeamId === 'temp' ? Object.keys(data.teams)[0] : userTeamId;
        
        // Clear starters for the user's team so they stay in reserves
        Object.values(data.players).forEach(p => {
          if (p.teamId === actualTeamId) {
            p.isStarting = false;
            p.isSub = false;
          }
        });

        const userTeam = data.teams[actualTeamId];
        const objectives = buildManagedTeamObjectives(userTeam, data.competitions);
        const initialNews = ['Season begins! The Premier League simulation is underway.'];
        const inboxMessages = mergeInboxMessages(
          [],
          [
            ...generateAssistantWeekMessages({
              currentWeek: 1,
              userTeamId: actualTeamId,
              teams: data.teams,
              players: data.players,
              fixtures: data.fixtures,
            }),
            ...generateSystemInboxMessages(1, initialNews),
          ]
        );

        set({
          userTeamId: actualTeamId,
          currentWeek: 1,
          teams: data.teams,
          players: data.players,
          fixtures: data.fixtures,
          competitions: data.competitions,
          boardObjectives: objectives,
          news: initialNews,
          inboxMessages,
          careerRecord: createDefaultCareerRecord(),
          liveMatches: {},
        });
      },

      markInboxMessageRead: (messageId: string) => {
        set(state => ({
          inboxMessages: state.inboxMessages.map(message => (
            message.id === messageId ? { ...message, isRead: true } : message
          )),
        }));
      },

      dismissInboxMessage: (messageId: string) => {
        set(state => ({
          inboxMessages: state.inboxMessages.filter(message => message.id !== messageId),
        }));
      },

      renewPlayerContract: (playerId: string, years: number, wage: number) => {
        let result = { success: false, message: '' };
        set(state => {
          const player = state.players[playerId];
          const userTeam = state.userTeamId ? state.teams[state.userTeamId] : null;
          if (!player || !userTeam || player.teamId !== userTeam.id) {
            result = { success: false, message: 'Player is not in your squad.' };
            return state;
          }
          if (years <= 0 || wage <= 0) {
            result = { success: false, message: 'Invalid contract terms.' };
            return state;
          }

          result = {
            success: true,
            message: `${player.name} signs a new ${years}-year deal at GBP ${wage}k/w.`,
          };

          return {
            players: {
              ...state.players,
              [playerId]: buildRenewedPlayer(player, years, wage),
            },
            inboxMessages: clearContractWarningMessages(state.inboxMessages, playerId),
          };
        });
        return result;
      },

      applyInboxAction: (messageId: string) => {
        set(state => {
          const message = state.inboxMessages.find(item => item.id === messageId);
          if (!message?.action) return state;

          let nextPlayers = state.players;
          let nextTeams = state.teams;

          if (message.action.type === 'apply_lineup') {
            const { teamId, formationMap, startingIds, subIds } = message.action.payload;
            const team = state.teams[teamId];
            if (!team) return state;
            nextPlayers = applyLineupSuggestionToTeam(state.players, teamId, startingIds, subIds);
            nextTeams = {
              ...state.teams,
              [teamId]: {
                ...team,
                formationMap,
              },
            };
          } else if (message.action.type === 'apply_tactics') {
            const { teamId, tactics } = message.action.payload;
            const team = state.teams[teamId];
            if (!team) return state;
            nextTeams = {
              ...state.teams,
              [teamId]: {
                ...team,
                tactics: { ...team.tactics, ...tactics },
              },
            };
          } else if (message.action.type === 'renew_contract') {
            const { playerId, years, wage } = message.action.payload;
            const player = state.players[playerId];
            if (!player) return state;
            nextPlayers = {
              ...state.players,
              [playerId]: buildRenewedPlayer(player, years, wage),
            };
            return {
              players: nextPlayers,
              teams: nextTeams,
              inboxMessages: clearContractWarningMessages(state.inboxMessages, playerId),
            };
          } else if (message.action.type === 'accept_job_offer') {
            const { teamId } = message.action.payload;
            const nextTeam = state.teams[teamId];
            if (!nextTeam) return state;
            const boardObjectives = buildManagedTeamObjectives(nextTeam, state.competitions);
            const carriedMessages = pruneInboxMessagesForManagedTeam(
              state.inboxMessages.filter(item => item.category !== 'career_job_offer'),
              teamId
            );
            const nextAssistantMessages = generateAssistantWeekMessages({
              currentWeek: state.currentWeek,
              userTeamId: teamId,
              teams: nextTeams,
              players: nextPlayers,
              fixtures: state.fixtures,
            });
            return {
              userTeamId: teamId,
              boardObjectives,
              players: nextPlayers,
              teams: nextTeams,
              inboxMessages: mergeInboxMessages(carriedMessages, nextAssistantMessages),
            };
          }

          return {
            players: nextPlayers,
            teams: nextTeams,
            inboxMessages: state.inboxMessages.map(item => (
              item.id === messageId
                ? { ...item, isRead: true, action: undefined }
                : item
            )),
          };
        });
      },

      playMatch: (fixtureId: string) => {
        set((state) => {
          const previousPlayers = state.players;
          const { players, teams, fixture } = quickSimMatch(fixtureId, state.players, state.teams, state.fixtures, state.userTeamId);
          const nextFixtures = { ...state.fixtures, [fixtureId]: fixture };
          const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, teams);
          const liveMatches = removeLiveMatchFixture(state.liveMatches || {}, fixtureId);
          const postMatchReport = generatePostMatchReportMessage({
            currentWeek: state.currentWeek,
            userTeamId: state.userTeamId,
            fixture,
            teams,
            players,
            previousPlayers,
          });

          return {
            players,
            teams,
            fixtures: competitionProgression.fixtures,
            competitions: competitionProgression.competitions,
            news: competitionProgression.generatedNews.length > 0
              ? [...competitionProgression.generatedNews, ...state.news].slice(0, 20)
              : state.news,
            liveMatches,
            inboxMessages: mergeInboxMessages(
              state.inboxMessages,
              [
                ...(postMatchReport ? [postMatchReport] : []),
                ...generateSystemInboxMessages(state.currentWeek, competitionProgression.generatedNews),
              ]
            ),
          };
        });
      },

      // Live match engine drains energy per minute and applies substitutions at full time.
      processMatchMinute: (fixtureId: string, minute: number) => {
        let eventMsg: string | null = null;
        const random = defaultRandomGenerator.next;
        set((state) => {
          const fixture = state.fixtures[fixtureId];
          if (!fixture || fixture.isPlayed) return state;

          const updatedPlayers = { ...state.players };
          const updatedFixture = { ...fixture };
          if (updatedFixture.homeScore === null) updatedFixture.homeScore = 0;
          if (updatedFixture.awayScore === null) updatedFixture.awayScore = 0;

          const homeTeam = state.teams[fixture.homeTeamId];
          const awayTeam = state.teams[fixture.awayTeamId];
          const storedLiveState = state.liveMatches?.[fixtureId];
          const sentOffPlayers = new Set(storedLiveState?.sentOffPlayerIds || []);
          const sentOffMinutes = { ...(storedLiveState?.sentOffMinutes || {}) };
          const homeGoalMinutes = [...(storedLiveState?.homeGoalMinutes || [])];
          const awayGoalMinutes = [...(storedLiveState?.awayGoalMinutes || [])];
          const matchYellowCards = new Set(storedLiveState?.yellowCardPlayerIds || []);
          const allowAutoAssign = !storedLiveState?.initialized;
          const firstAttackIsHome = storedLiveState?.firstAttackIsHome ?? (random() < 0.5);

          const homeStarters = ensureLiveTeamStarters(homeTeam.id, state.teams, updatedPlayers, sentOffPlayers, allowAutoAssign);
          const awayStarters = ensureLiveTeamStarters(awayTeam.id, state.teams, updatedPlayers, sentOffPlayers, allowAutoAssign);

          if (homeStarters.length === 0 || awayStarters.length === 0) return state;

          // Energy drain: driven by config
          drainLiveMatchEnergy(updatedPlayers, [...homeStarters, ...awayStarters]);

          const possessionIndex = getPossessionIndexForMinute(minute);
          if (possessionIndex !== null) {
            const homeFormMult = getFormModifier(homeTeam.form);
            const awayFormMult = getFormModifier(awayTeam.form);
            const homeMoraleMult = getMoraleModifier(homeStarters);
            const awayMoraleMult = getMoraleModifier(awayStarters);
            const scaledHome = scaleLineupForMatch(homeStarters, homeFormMult, homeMoraleMult, ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE);
            const scaledAway = scaleLineupForMatch(awayStarters, awayFormMult, awayMoraleMult);
            const isHomeAttacking = ((possessionIndex + (firstAttackIsHome ? 0 : 1)) % 2) === 0;
            const attacker = isHomeAttacking ? homeTeam : awayTeam;
            const defender = isHomeAttacking ? awayTeam : homeTeam;
            const attPlayers = isHomeAttacking ? scaledHome : scaledAway;
            const defPlayers = isHomeAttacking ? scaledAway : scaledHome;
            const homeShape = buildTeamShapeProfile(homeTeam, homeStarters);
            const awayShape = buildTeamShapeProfile(awayTeam, awayStarters);
            const attShape = isHomeAttacking ? homeShape : awayShape;
            const defShape = isHomeAttacking ? awayShape : homeShape;

            const sendOffPlayer = (playerId: string, message: string) => {
              const player = updatedPlayers[playerId];
              if (!player || sentOffPlayers.has(playerId)) return;
              updatedPlayers[playerId] = {
                ...player,
                redCards: player.redCards + 1,
                matchesSuspended: 3,
              };
              sentOffPlayers.add(playerId);
              sentOffMinutes[playerId] = minute;
              eventMsg = message;
            };

            const res = simulatePossession(
              attacker,
              defender,
              attPlayers,
              defPlayers,
              isHomeAttacking ? updatedFixture.homeScore! : updatedFixture.awayScore!,
              isHomeAttacking ? updatedFixture.awayScore! : updatedFixture.homeScore!,
              attShape,
              defShape,
              defaultRandomGenerator
            );
            eventMsg = res.event;

            if (res.goal) {
              if (isHomeAttacking) {
                updatedFixture.homeScore!++;
                homeGoalMinutes.push(minute);
              } else {
                updatedFixture.awayScore!++;
                awayGoalMinutes.push(minute);
              }
              if (res.scorer) addPlayerStat(updatedPlayers, res.scorer.id, 'goals');
              if (res.assister) addPlayerStat(updatedPlayers, res.assister.id, 'assists');
            }
            if (res.foul) {
              const playerId = res.foul.player.id;
              if (!sentOffPlayers.has(playerId)) {
                if (res.foul.type === 'Y') {
                  if (matchYellowCards.has(playerId)) {
                    if (random() < ENGINE_CONFIG.SECOND_YELLOW_RED_CHANCE) {
                      addPlayerStat(updatedPlayers, playerId, 'yellowCards');
                      sendOffPlayer(playerId, `${res.foul.player.name} receives a second yellow and is sent off.`);
                    } else {
                      eventMsg = `${res.foul.player.name} avoids a second yellow after the foul.`;
                    }
                  } else {
                    addPlayerStat(updatedPlayers, playerId, 'yellowCards');
                    matchYellowCards.add(playerId);
                  }
                } else {
                  sendOffPlayer(playerId, `${res.foul.player.name} is shown a straight red card.`);
                }
              }
            }
          }
          if (minute === 45 && !eventMsg) eventMsg = `HALF TIME.`;
          if (minute === 90 && !eventMsg) eventMsg = `FULL TIME.`;

          const liveMatchState: LiveMatchState = {
            initialized: true,
            yellowCardPlayerIds: Array.from(matchYellowCards),
            sentOffPlayerIds: Array.from(sentOffPlayers),
            firstAttackIsHome,
            sentOffMinutes,
            homeGoalMinutes,
            awayGoalMinutes,
            homeStarterIds: storedLiveState?.homeStarterIds || homeStarters.map(p => p.id),
            awayStarterIds: storedLiveState?.awayStarterIds || awayStarters.map(p => p.id),
          };

          return {
            fixtures: { ...state.fixtures, [fixtureId]: updatedFixture },
            players: updatedPlayers,
            liveMatches: { ...(state.liveMatches || {}), [fixtureId]: liveMatchState },
          };
        });
        return { event: eventMsg };
      },

      finishLiveMatch: (fixtureId: string) => {
        const rng = defaultRandomGenerator;
        set((state) => {
          const fixture = state.fixtures[fixtureId];
          if (!fixture || fixture.isPlayed) return state;
          const previousPlayers = state.players;

          const homeTeam = state.teams[fixture.homeTeamId];
          const awayTeam = state.teams[fixture.awayTeamId];
          const liveMatchState = state.liveMatches?.[fixtureId];
          const sentOffMinutes = liveMatchState?.sentOffMinutes || {};
          const sentOffPlayers = new Set(liveMatchState?.sentOffPlayerIds || []);
          const homeGoalMinutes = liveMatchState?.homeGoalMinutes || [];
          const awayGoalMinutes = liveMatchState?.awayGoalMinutes || [];
          const homeTeamStarters = liveMatchState
            ? getPlayersByIds(state.players, liveMatchState.homeStarterIds)
            : Object.values(state.players).filter(player => player.teamId === homeTeam.id && player.isStarting && !isPlayerUnavailable(player));
          const awayTeamStarters = liveMatchState
            ? getPlayersByIds(state.players, liveMatchState.awayStarterIds)
            : Object.values(state.players).filter(player => player.teamId === awayTeam.id && player.isStarting && !isPlayerUnavailable(player));
          const getBench = (teamId: string, starters: Player[]) => {
            const starterIds = new Set(starters.map(player => player.id));
            return Object.values(state.players).filter(player => (
              player.teamId === teamId &&
              player.isSub &&
              !isPlayerUnavailable(player) &&
              !starterIds.has(player.id)
            )).slice(0, 7);
          };
          const updatedPlayers = { ...state.players };

          const hScore = fixture.homeScore || 0;
          const aScore = fixture.awayScore || 0;
          const homeBench = getBench(homeTeam.id, homeTeamStarters);
          const awayBench = getBench(awayTeam.id, awayTeamStarters);
          const homeMinuteMap = buildStarterMinuteMap(homeTeamStarters, sentOffMinutes);
          const awayMinuteMap = buildStarterMinuteMap(awayTeamStarters, sentOffMinutes);
          applySubstitutions(homeTeamStarters, homeBench, sentOffPlayers, homeMinuteMap, homeTeam, hScore, aScore, rng);
          applySubstitutions(awayTeamStarters, awayBench, sentOffPlayers, awayMinuteMap, awayTeam, aScore, hScore, rng);

          const homeParticipants = [...homeTeamStarters, ...homeBench];
          const awayParticipants = [...awayTeamStarters, ...awayBench];
          applySharedPostMatchAccounting({
            teamParticipants: homeParticipants,
            teamStarterIds: new Set(homeTeamStarters.map(player => player.id)),
            minuteMap: homeMinuteMap,
            concededGoalMinutes: awayGoalMinutes,
            concededGoalsTotal: aScore,
            isWin: hScore > aScore,
            isDraw: hScore === aScore,
            teamTactics: homeTeam.tactics,
            updatedPlayers,
            rng,
            applyEnergyDrain: false,
          });
          applySharedPostMatchAccounting({
            teamParticipants: awayParticipants,
            teamStarterIds: new Set(awayTeamStarters.map(player => player.id)),
            minuteMap: awayMinuteMap,
            concededGoalMinutes: homeGoalMinutes,
            concededGoalsTotal: hScore,
            isWin: aScore > hScore,
            isDraw: aScore === hScore,
            teamTactics: awayTeam.tactics,
            updatedPlayers,
            rng,
            applyEnergyDrain: false,
          });
          applyMatchInjuries(homeParticipants, homeMinuteMap, updatedPlayers, rng);
          applyMatchInjuries(awayParticipants, awayMinuteMap, updatedPlayers, rng);

          let winnerTeamId: string | undefined;
          let resolution: Fixture['resolution'] | undefined;
          if (fixture.isKnockout) {
            if (hScore === aScore) {
              const homePenaltyEdge = homeTeamStarters.reduce((sum, player) => sum + player.overallRating, 0) + 25;
              const awayPenaltyEdge = awayTeamStarters.reduce((sum, player) => sum + player.overallRating, 0);
              const totalEdge = Math.max(1, homePenaltyEdge + awayPenaltyEdge);
              winnerTeamId = (rng.next() * totalEdge) < homePenaltyEdge ? homeTeam.id : awayTeam.id;
              resolution = 'penalties';
            } else {
              winnerTeamId = hScore > aScore ? homeTeam.id : awayTeam.id;
              resolution = 'regular';
            }
          }

          const updatedFixture = {
            ...fixture,
            isPlayed: true,
            winnerTeamId,
            resolution,
          };
          const includeTableStats = fixture.competitionType === 'league';

          const updatedTeams = {
            ...state.teams,
            [homeTeam.id]: {
              ...updateTeamStats(homeTeam, hScore, aScore, includeTableStats),
              lastStartingXI: homeTeamStarters.map(p => p.id),
            },
            [awayTeam.id]: {
              ...updateTeamStats(awayTeam, aScore, hScore, includeTableStats),
              lastStartingXI: awayTeamStarters.map(p => p.id),
            },
          };
          const nextFixtures = { ...state.fixtures, [fixtureId]: updatedFixture };
          const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, updatedTeams);
          const liveMatches = removeLiveMatchFixture(state.liveMatches || {}, fixtureId);
          const postMatchReport = generatePostMatchReportMessage({
            currentWeek: state.currentWeek,
            userTeamId: state.userTeamId,
            fixture: updatedFixture,
            teams: updatedTeams,
            players: updatedPlayers,
            previousPlayers,
          });

          return {
            fixtures: competitionProgression.fixtures,
            competitions: competitionProgression.competitions,
            teams: updatedTeams,
            players: updatedPlayers,
            news: competitionProgression.generatedNews.length > 0
              ? [...competitionProgression.generatedNews, ...state.news].slice(0, 20)
              : state.news,
            liveMatches,
            inboxMessages: mergeInboxMessages(
              state.inboxMessages,
              [
                ...(postMatchReport ? [postMatchReport] : []),
                ...generateSystemInboxMessages(state.currentWeek, competitionProgression.generatedNews),
              ]
            ),
          };
        });
      },

      advanceWeek: () => {
        const initialWeek = get().currentWeek;
        set(state => {
          const weekFixtures = Object.values(state.fixtures).filter(f => f.week === state.currentWeek && !f.isPlayed);
          if (weekFixtures.length === 0) return state;

          let updatedPlayers = state.players;
          let updatedTeams = state.teams;
          let updatedFixtures = state.fixtures;
          let updatedCompetitions = state.competitions;
          let updatedLiveMatches = state.liveMatches || {};
          let inboxMessages = state.inboxMessages;
          let competitionNews: string[] = [];

          weekFixtures.forEach(fix => {
            const previousPlayers = updatedPlayers;
            const { players, teams, fixture } = quickSimMatch(
              fix.id,
              updatedPlayers,
              updatedTeams,
              updatedFixtures,
              state.userTeamId
            );
            updatedPlayers = players;
            updatedTeams = teams;
            updatedFixtures = { ...updatedFixtures, [fix.id]: fixture };
            updatedLiveMatches = removeLiveMatchFixture(updatedLiveMatches, fix.id);
            const postMatchReport = generatePostMatchReportMessage({
              currentWeek: state.currentWeek,
              userTeamId: state.userTeamId,
              fixture,
              teams,
              players,
              previousPlayers,
            });
            if (postMatchReport) {
              inboxMessages = mergeInboxMessages(inboxMessages, [postMatchReport]);
            }
          });
          const competitionProgression = resolveCompetitionProgression(updatedFixtures, updatedCompetitions, updatedTeams);
          updatedFixtures = competitionProgression.fixtures;
          updatedCompetitions = competitionProgression.competitions;
          competitionNews = competitionProgression.generatedNews;
          if (competitionNews.length > 0) {
            inboxMessages = mergeInboxMessages(
              inboxMessages,
              generateSystemInboxMessages(state.currentWeek, competitionNews)
            );
          }

          return {
            players: updatedPlayers,
            teams: updatedTeams,
            fixtures: updatedFixtures,
            competitions: updatedCompetitions,
            news: competitionNews.length > 0
              ? [...competitionNews, ...state.news].slice(0, 20)
              : state.news,
            liveMatches: updatedLiveMatches,
            inboxMessages,
          };
        });

        const beforeProgressionPlayers = get().players;
        let generatedProgressionNews: string[] = [];
        set((state) => {
          const progression = computeWeeklyProgression(
            state.currentWeek,
            state.players,
            state.teams,
            state.fixtures,
            state.news,
            state.userTeamId
          );
          generatedProgressionNews = progression.generatedNews;
          return {
            currentWeek: progression.currentWeek,
            news: progression.news,
            players: progression.players,
            teams: progression.teams,
          };
        });

        // Match the analysis scripts: update week state before transfer decisions.
        get().processWeeklyTransfers();

        const beforeBoardState = get();
        get().checkBoardObjectives();
        const afterBoardState = get();
        const boardMessages = beforeBoardState.userTeamId && afterBoardState.userTeamId
          ? generateBoardInboxMessages({
            week: initialWeek,
            teamBefore: beforeBoardState.teams[beforeBoardState.userTeamId],
            teamAfter: afterBoardState.teams[afterBoardState.userTeamId],
            objectivesBefore: beforeBoardState.boardObjectives,
            objectivesAfter: afterBoardState.boardObjectives,
          })
          : [];

        // Career: track consecutive low-approval weeks and generate sack warnings
        const sackMessages: InboxMessage[] = [];
        set(state => {
          if (!state.userTeamId) return state;
          const team = state.teams[state.userTeamId];
          if (!team) return state;
          const { newConsecutiveWeeks, shouldWarn, isSackingImminent } =
            evaluateSackingRisk(team, state.careerRecord.consecutiveLowApprovalWeeks);
          const lowApprovalThreshold = getSackingApprovalThreshold(team);
          if (shouldWarn || isSackingImminent) {
            sackMessages.push(generateSackWarningMessage(
              initialWeek,
              newConsecutiveWeeks,
              state.userTeamId,
              isSackingImminent,
              {
                approval: team.boardApproval,
                threshold: lowApprovalThreshold,
                pressureScore: team.manager.pressureScore,
                replacementRisk: team.manager.replacementRisk,
              }
            ));
          }
          return {
            careerRecord: {
              ...state.careerRecord,
              consecutiveLowApprovalWeeks: newConsecutiveWeeks,
            },
          };
        });

        const weekMessages = [
          ...generateSystemInboxMessages(initialWeek, generatedProgressionNews),
          ...boardMessages,
          ...sackMessages,
        ];

        const postUpdateState = get();
        const seasonWeekLimit = getSeasonWeekLimit(postUpdateState.fixtures, postUpdateState.competitions);
        if (postUpdateState.currentWeek > seasonWeekLimit) {
          set(state => {
            if (!state.userTeamId) {
              const nextSeason = advanceSeason(
                state.players,
                state.teams,
                state.competitions,
                state.userTeamId,
                state.news
              );
              return {
                currentWeek: nextSeason.currentWeek,
                teams: nextSeason.teams,
                players: nextSeason.players,
                fixtures: nextSeason.fixtures,
                competitions: nextSeason.competitions,
                boardObjectives: nextSeason.boardObjectives,
                news: nextSeason.news,
                liveMatches: {},
                inboxMessages: mergeInboxMessages(pruneInboxMessagesForManagedTeam(state.inboxMessages, null), [
                  ...weekMessages,
                  ...generateSystemInboxMessages(nextSeason.currentWeek, nextSeason.generatedNews),
                ]),
              };
            }

            const userTeam = state.teams[state.userTeamId];
            const isSacked = state.careerRecord.consecutiveLowApprovalWeeks >= 4;
            const seasonSummary = buildSeasonSummary(
              state.careerRecord.seasonsManaged + 1,
              userTeam,
              state.teams,
              state.competitions
            );
            if (isSacked) seasonSummary.outcome = 'sacked';

            const { careerRecord: updatedCareer, reputationDelta } = applySeasonEndToCareer(
              state.careerRecord,
              seasonSummary
            );

            const jobOfferTeams = generateJobOfferCandidates(state.teams, state.userTeamId, seasonSummary);
            const careerMessages = generateCareerInboxMessages({
              week: initialWeek,
              summary: seasonSummary,
              reputationDelta,
              careerRecord: updatedCareer,
              jobOfferTeams,
              isSacked,
              sackingContext: isSacked
                ? {
                    consecutiveLowApprovalWeeks: state.careerRecord.consecutiveLowApprovalWeeks,
                    approval: userTeam.boardApproval,
                    threshold: getSackingApprovalThreshold(userTeam),
                    pressureScore: userTeam.manager.pressureScore,
                    replacementRisk: userTeam.manager.replacementRisk,
                  }
                : undefined,
            });

            const nextUserTeamId = isSacked ? null : state.userTeamId;
            const nextSeason = advanceSeason(
              state.players,
              state.teams,
              state.competitions,
              nextUserTeamId,
              state.news
            );
            const nextAssistantMessages = nextUserTeamId
              ? generateAssistantWeekMessages({
                  currentWeek: nextSeason.currentWeek,
                  userTeamId: nextUserTeamId,
                  teams: nextSeason.teams,
                  players: nextSeason.players,
                  fixtures: nextSeason.fixtures,
                })
              : [];
            return {
              currentWeek: nextSeason.currentWeek,
              teams: nextSeason.teams,
              players: nextSeason.players,
              fixtures: nextSeason.fixtures,
              competitions: nextSeason.competitions,
              boardObjectives: nextSeason.boardObjectives,
              news: nextSeason.news,
              userTeamId: nextUserTeamId,
              careerRecord: updatedCareer,
              liveMatches: {},
              inboxMessages: mergeInboxMessages(
                pruneInboxMessagesForManagedTeam(state.inboxMessages, nextUserTeamId),
                [
                  ...weekMessages,
                  ...careerMessages,
                  ...generateSystemInboxMessages(nextSeason.currentWeek, nextSeason.generatedNews),
                  ...nextAssistantMessages,
                ]
              ),
            };
          });
          return;
        }

        const nextAssistantMessages = generateAssistantWeekMessages({
          currentWeek: postUpdateState.currentWeek,
          userTeamId: postUpdateState.userTeamId,
          teams: postUpdateState.teams,
          players: postUpdateState.players,
          fixtures: postUpdateState.fixtures,
          previousPlayers: beforeProgressionPlayers,
        });
        set(state => ({
          inboxMessages: mergeInboxMessages(state.inboxMessages, [...weekMessages, ...nextAssistantMessages]),
        }));
      },

      setFormation: (teamId, formation) => {
        set((state) => {
          const team = state.teams[teamId];
          if (!team) return state;

          const baseNew = formation.split(' ')[0];
          const baseOld = (team.activeFormation || '').split(' ')[0];
          const existingMap = team.formationMap || {};
          const hasExistingMap = Object.keys(existingMap).length > 0;

          // If same base formation and map already exists, just rename and do not shuffle.
          if (baseNew === baseOld && hasExistingMap) {
            const teamStarters = Object.values(state.players)
              .filter(player => player.teamId === teamId && player.isStarting && !isPlayerUnavailable(player));
            const formationMap = rebuildFormationMap(getSlotsForFormation(formation), teamStarters, existingMap);
            return {
              teams: { ...state.teams, [teamId]: { ...team, activeFormation: formation, formationMap } },
            };
          }

          const updatedTeam = { ...team, activeFormation: formation };

          const teamPlayers = Object.values(state.players)
            .filter(player => player.teamId === teamId)
            .sort((a, b) => b.overallRating - a.overallRating);
          const eligibleTeamPlayers = teamPlayers.filter(player => !isPlayerUnavailable(player));

          const updatedPlayers = { ...state.players };

          // Reset all to non-starting
          teamPlayers.forEach(p => { updatedPlayers[p.id] = { ...p, isStarting: false, isSub: false }; });

          // Fill slots: best by rating per sub-position then position
          const formationMap: Record<string, string> = {};
          const slots = getSlotsForFormation(formation);
          let assignedCount = 0;
          // Track which player ids have been assigned
          const assignedIds = new Set<string>();

          slots.forEach((row, rowIdx) => {
             row.forEach((slot, colIdx) => {
                // first prefer exact sub-position match
                let candidate = eligibleTeamPlayers.find(p => p.subPosition === slot.label && !assignedIds.has(p.id));
                // then broad position
                if (!candidate) candidate = eligibleTeamPlayers.find(p => p.position === slot.pos && !assignedIds.has(p.id));
                if (candidate) {
                   updatedPlayers[candidate.id] = { ...updatedPlayers[candidate.id], isStarting: true, isSub: false };
                   formationMap[`${rowIdx}-${colIdx}`] = candidate.id;
                   assignedIds.add(candidate.id);
                   assignedCount++;
                }
             });
          });

          // Fallback: fill remaining slots with any unassigned player
          if (assignedCount < 11) {
            slots.forEach((row, rowIdx) => {
              row.forEach((slot, colIdx) => {
                if (!formationMap[`${rowIdx}-${colIdx}`]) {
                  const p = eligibleTeamPlayers.find(q => !assignedIds.has(q.id));
                  if (p) {
                    updatedPlayers[p.id] = { ...updatedPlayers[p.id], isStarting: true, isSub: false };
                    formationMap[`${rowIdx}-${colIdx}`] = p.id;
                    assignedIds.add(p.id);
                    assignedCount++;
                  }
                }
              });
            });
          }

          updatedTeam.formationMap = formationMap;

          return {
            teams:   { ...state.teams, [teamId]: updatedTeam },
            players: updatedPlayers,
          };
        });
      },

      setTactics: (teamId: string, tactics: Partial<TeamTactics>) => {
        set((state) => {
          const team = state.teams[teamId];
          if (!team) return state;
          const updatedTeams = {
            ...state.teams,
            [teamId]: { ...team, tactics: { ...team.tactics, ...tactics } }
          };
          return { teams: updatedTeams };
        });
      },

      toggleStarting: (playerId: string) => {
        set((state) => {
          const player = state.players[playerId];
          if (!player || isPlayerUnavailable(player)) return state;

          const teamPlayers = Object.values(state.players).filter(p => p.teamId === player.teamId);
          const starters    = teamPlayers.filter(p => p.isStarting && !isPlayerUnavailable(p));

          let updatedTeams = state.teams;
          const removeFromMap = (remId: string) => {
             const team = state.teams[player.teamId];
             if (team && team.formationMap) {
               const newMap = { ...team.formationMap };
               for (const key in newMap) {
                 if (newMap[key] === remId) delete newMap[key];
               }
               updatedTeams = { ...state.teams, [team.id]: { ...team, formationMap: newMap } };
             }
          };

          if (player.isStarting) {
            removeFromMap(playerId);
            return {
              players: { ...state.players, [playerId]: { ...player, isStarting: false, isSub: true } },
              teams: updatedTeams
            };
          } else {
            if (starters.length >= 11) {
              const toSwap = starters.filter(p => p.position === player.position)
                .sort((a, b) => a.overallRating - b.overallRating)[0]
                || starters.sort((a, b) => a.overallRating - b.overallRating)[0];
              removeFromMap(toSwap.id);
              return {
                players: {
                  ...state.players,
                  [toSwap.id]:   { ...toSwap,  isStarting: false, isSub: true },
                  [playerId]:    { ...player,  isStarting: true,  isSub: false },
                },
                teams: updatedTeams
              };
            }
            return {
              players: { ...state.players, [playerId]: { ...player, isStarting: true, isSub: false } }
            };
          }
        });
      },

      markAsSub: (playerId: string) => {
        set((state) => {
          const player = state.players[playerId];
          if (!player || player.isStarting || isPlayerUnavailable(player)) return state;
          return {
            players: {
              ...state.players,
              [playerId]: { ...player, isSub: !player.isSub },
            }
          };
        });
      },

      skipToEndOfSeason: () => {
        const maxWeek = getSeasonWeekLimit(get().fixtures, get().competitions);
        let guard = maxWeek + 2;
        while (get().currentWeek <= maxWeek && guard-- > 0) {
          get().advanceWeek();
          if (get().currentWeek === 1) break;
        }
      },

      swapPlayer: (removeId: string | null, addId: string, slotKey?: string) => {
        set(state => {
          if (!state.players[addId] || isPlayerUnavailable(state.players[addId])) return state;
          const updates: Record<string, typeof state.players[string]> = {};
          if (removeId && state.players[removeId]) {
            updates[removeId] = { ...state.players[removeId], isStarting: false, isSub: true };
          }
          if (state.players[addId]) {
            updates[addId] = { ...state.players[addId], isStarting: true, isSub: false };
          }
          
          let updatedTeams = state.teams;
          if (slotKey && state.userTeamId) {
             const team = state.teams[state.userTeamId];
             const map = { ...(team.formationMap || {}) };
             map[slotKey] = addId;
             updatedTeams = { ...state.teams, [state.userTeamId]: { ...team, formationMap: map } };
          }

          return { players: { ...state.players, ...updates }, teams: updatedTeams };
        });
      },

      swapStartingSlots: (teamId: string, slotA: string, slotB: string) => {
        set(state => {
           const team = state.teams[teamId];
           if (!team || !team.formationMap) return state;
           const map = { ...team.formationMap };
           const playerA = map[slotA];
           const playerB = map[slotB];
           
           if (playerA) map[slotB] = playerA;
           else delete map[slotB];
           
           if (playerB) map[slotA] = playerB;
           else delete map[slotA];

           return { teams: { ...state.teams, [teamId]: { ...team, formationMap: map } } };
        });
      },

      changeTeam: (teamId: string) => {
        set(state => {
          const nextTeam = state.teams[teamId];
          if (!nextTeam) return state;
          const nextAssistantMessages = generateAssistantWeekMessages({
            currentWeek: state.currentWeek,
            userTeamId: teamId,
            teams: state.teams,
            players: state.players,
            fixtures: state.fixtures,
          });
          return {
            userTeamId: teamId,
            boardObjectives: buildManagedTeamObjectives(nextTeam, state.competitions),
            inboxMessages: mergeInboxMessages(
              pruneInboxMessagesForManagedTeam(state.inboxMessages, teamId),
              nextAssistantMessages
            ),
          };
        });
      },

      buyPlayer: (playerId: string, fee: number, wageOffered: number) => {
        let result = { success: false, message: '' };
        set(state => {
          const userTeam = state.userTeamId ? state.teams[state.userTeamId] : null;
          const player = state.players[playerId];
          
          if (!userTeam || !player) {
            result = { success: false, message: 'Invalid team or player.' };
            return state;
          }
          if (userTeam.budget < fee) {
            result = { success: false, message: 'Insufficient transfer funds.' };
            return state;
          }

          if (fee < player.askingPrice * 0.85) {
             result = { success: false, message: `The club rejected your bid of GBP ${fee}m.` };
             return state;
          }

          if (wageOffered > 0 && wageOffered < player.wage * 0.9) {
             result = { success: false, message: `${player.name} rejected your wage offer of GBP ${wageOffered}k/w.` };
             return state;
          }

          const sellingTeam = state.teams[player.teamId];
          const updatedUserTeam = {
            ...userTeam,
            budget: userTeam.budget - fee,
            transferSpend: userTeam.transferSpend + fee,
          };
          const updatedSellingTeam = sellingTeam
            ? removePlayerFromTeamSelections({ ...sellingTeam, budget: sellingTeam.budget + fee }, player.id)
            : undefined;
          const updatedPlayer = {
            ...player,
            teamId: userTeam.id,
            wage: wageOffered > 0 ? wageOffered : player.wage,
            isStarting: false,
            isSub: false,
            isTransferListed: false,
            askingPrice: 0,
            contractLeft: Math.max(player.contractLeft, 3),
          };

          result = { success: true, message: `Successfully purchased ${player.name} for GBP ${fee}m.` };

          return {
            teams: { ...state.teams, [userTeam.id]: updatedUserTeam, ...(updatedSellingTeam ? { [sellingTeam.id]: updatedSellingTeam } : {}) },
            players: { ...state.players, [playerId]: updatedPlayer }
          };
        });
        return result;
      },

      listPlayerForSale: (playerId: string, askingPrice: number) => {
        set(state => {
          const players = updateTransferListingState(state.players, playerId, true, askingPrice);
          if (!players) return state;
          return { players };
        });
      },

      unlistPlayer: (playerId: string) => {
        set(state => {
          const players = updateTransferListingState(state.players, playerId, false, 0);
          if (!players) return state;
          return { players };
        });
      },

      processWeeklyTransfers: () => {
        set(state => computeWeeklyTransfers(state.players, state.teams, state.userTeamId));
      },

      checkBoardObjectives: () => {
         set(state => {
            if (!state.userTeamId) return state;
            const myTeam = state.teams[state.userTeamId];
            const seasonWeekLimit = getSeasonWeekLimit(state.fixtures, state.competitions);
            const review = runBoardReview(
              myTeam,
              state.teams,
              state.boardObjectives,
              {
                isSeasonComplete: state.currentWeek > seasonWeekLimit,
                competitions: state.competitions,
                players: state.players,
              }
            );
            return {
               teams: {
                 ...state.teams,
                 [myTeam.id]: {
                   ...myTeam,
                   boardApproval: review.nextApproval,
                   manager: review.nextManager,
                 },
               },
               boardObjectives: review.updatedObjectives
            };
         });
      },
    }),
    {
      name: 'football-manager-storage',
      storage: createJSONStorage(() => safeStorage),
      version: 8,
      migrate: (persistedState, version) => {
        const rawState = (persistedState || {}) as Partial<GameStore>;
        const sanitized = sanitizePersistedState(rawState);
        if (version < 2) {
          return {
            ...DEFAULT_GAME_STATE,
            ...sanitized,
            liveMatches: {},
          } as GameStore;
        }
        return {
          ...DEFAULT_GAME_STATE,
          ...sanitized,
        } as GameStore;
      },
    }
  )
);
