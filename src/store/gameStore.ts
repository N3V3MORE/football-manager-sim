import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  Formation,
  GameState,
  Team,
  TeamTactics,
} from '../models/types';
import { initGameData } from '../utils/initGame';
import { TEMP_TEAM_ID } from '../constants';
import {
  runBoardReview,
} from '../core/boardEngine';
import {
  getSeasonWeekLimit,
} from '../core/leagueUtils';
import {
  quickSimMatch,
} from '../core/matchEngine';
import {
  createDefaultCareerRecord,
} from '../core/careerEngine';
import {
  LiveMatchState,
} from './liveMatchHelpers';
import {
  generateAssistantWeekMessages,
  generateSystemInboxMessages,
  mergeInboxMessages,
  pruneInboxMessagesForManagedTeam,
} from './inboxHelpers';
import {
  renewPlayerContractState,
} from './contractActions';
import { applyInboxActionState } from './inboxActions';
import {
  markAsSubState,
  setFormationState,
  setTacticsState,
  swapPlayerState,
  swapStartingSlotsState,
  toggleStartingState,
} from './lineupActions';
import {
  buyPlayerState,
  listPlayerForSaleState,
  processWeeklyTransfersState,
  unlistPlayerState,
} from './transferActions';
import { buildManagedTeamObjectives } from './managedTeamObjectives';
import { DEFAULT_GAME_STATE, safeStorage, sanitizePersistedState } from './persistence';
import { advanceWeekState } from './weekLifecycle';
import { finishLiveMatchState, processLiveMatchMinuteState } from './liveMatchActions';
import { applySharedPostMatchResolution } from './matchResultProcessing';

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

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_GAME_STATE,
      liveMatches: {},

      initializeGame: (userTeamId) => {
        try {
          const data = initGameData();
          
          // Remap TEMP_TEAM_ID to first actual team ID
          const actualTeamId = userTeamId === TEMP_TEAM_ID ? Object.keys(data.teams)[0]! : userTeamId;
          
          // Clear starters for the user's team so they stay in reserves
          Object.values(data.players).forEach(p => {
            if (p.teamId === actualTeamId) {
              p.isStarting = false;
              p.isSub = false;
            }
          });

          const userTeam = data.teams[actualTeamId]!;
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
            userTeamId: actualTeamId!,
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
        } catch (e) {
          console.error('initializeGame failed:', e);
        }
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
        const update = renewPlayerContractState(get(), playerId, years, wage);
        set(update.patch);
        return update.result;
      },

      applyInboxAction: (messageId: string) => {
        set(state => applyInboxActionState(state, messageId));
      },

      playMatch: (fixtureId: string) => {
        set((state) => {
          const previousPlayers = state.players;
          const { players, teams, fixture } = quickSimMatch(fixtureId, state.players, state.teams, state.fixtures, state.userTeamId);
          const nextFixtures = { ...state.fixtures, [fixtureId]: fixture };
          const resolved = applySharedPostMatchResolution({
            state,
            updatedPlayers: players,
            updatedTeams: teams,
            updatedFixtures: nextFixtures,
            updatedCompetitions: state.competitions,
            fixture,
            previousPlayers,
            liveMatches: state.liveMatches,
          });

          return {
            players,
            teams,
            fixtures: resolved.fixtures,
            competitions: resolved.competitions,
            news: resolved.news,
            liveMatches: resolved.liveMatches,
            inboxMessages: resolved.inboxMessages,
          };
        });
      },

      processMatchMinute: (fixtureId: string, minute: number) => {
        const update = processLiveMatchMinuteState(get(), fixtureId, minute);
        set(update.patch);
        return { event: update.event };
      },

      finishLiveMatch: (fixtureId: string) => {
        set(state => finishLiveMatchState(state, fixtureId));
      },

      advanceWeek: () => {
        set(state => advanceWeekState(state));
      },

      setFormation: (teamId, formation) => {
        set(state => setFormationState(state, teamId, formation));
      },

      setTactics: (teamId: string, tactics: Partial<TeamTactics>) => {
        set(state => setTacticsState(state, teamId, tactics));
      },

      toggleStarting: (playerId: string) => {
        set(state => toggleStartingState(state, playerId));
      },

      markAsSub: (playerId: string) => {
        set(state => markAsSubState(state, playerId));
      },

      skipToEndOfSeason: () => {
        set((state) => {
          if (!state.userTeamId) return state;
          const startingSeason = state.careerRecord.seasonsManaged;
          let s = { ...state };
          for (let i = 0; i < 40; i++) {
            s = advanceWeekState(s) as any;
            if (s.careerRecord.seasonsManaged !== startingSeason) break;
          }
          return s;
        });
      },

      swapPlayer: (removeId: string | null, addId: string, slotKey?: string) => {
        set(state => swapPlayerState(state, removeId, addId, slotKey));
      },

      swapStartingSlots: (teamId: string, slotA: string, slotB: string) => {
        set(state => swapStartingSlotsState(state, teamId, slotA, slotB));
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
        const update = buyPlayerState(get(), playerId, fee, wageOffered);
        set(update.patch);
        return update.result;
      },

      listPlayerForSale: (playerId: string, askingPrice: number) => {
        set(state => listPlayerForSaleState(state, playerId, askingPrice));
      },

      unlistPlayer: (playerId: string) => {
        set(state => unlistPlayerState(state, playerId));
      },

      processWeeklyTransfers: () => {
        set(state => processWeeklyTransfersState(state));
      },

      checkBoardObjectives: () => {
         set(state => {
            if (!state.userTeamId) return state;
            const myTeam = state.teams[state.userTeamId]!;
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
                 } as Team,
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
      partialize: (state: GameStore) => {
        const { liveMatches, ...rest } = state;
        return rest;
      },
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
