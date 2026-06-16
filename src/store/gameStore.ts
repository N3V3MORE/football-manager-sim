import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  Formation,
  GameState,
  TeamTactics,
} from '../models/types';
import { initGameData } from '../utils/initGame';
import {
  resolveCompetitionProgression,
} from '../core/competitionEngine';
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
  removeLiveMatchFixture,
} from './liveMatchHelpers';
import {
  generateAssistantWeekMessages,
  generatePostMatchReportMessage,
  generateSystemInboxMessages,
  mergeInboxMessages,
  pruneInboxMessagesForManagedTeam,
} from './inboxHelpers';
import {
  renewPlayerContractState,
  StoreActionResult,
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

interface GameStore extends GameState {
  liveMatches: Record<string, LiveMatchState>;
  boardReviewAppliedWeek: number;
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
      boardReviewAppliedWeek: 0,

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
          boardReviewAppliedWeek: 0,
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
        let result: StoreActionResult = { success: false, message: '' };
        set(state => {
          const update = renewPlayerContractState(state, playerId, years, wage);
          result = update.result;
          return update.patch;
        });
        return result;
      },

      applyInboxAction: (messageId: string) => {
        set(state => applyInboxActionState(state, messageId));
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

      processMatchMinute: (fixtureId: string, minute: number) => {
        let eventMsg: string | null = null;
        set(state => {
          const update = processLiveMatchMinuteState(state, fixtureId, minute);
          eventMsg = update.event;
          return update.patch;
        });
        return { event: eventMsg };
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
        const maxWeek = getSeasonWeekLimit(get().fixtures, get().competitions);
        let guard = maxWeek + 2;
        while (get().currentWeek <= maxWeek && guard-- > 0) {
          get().advanceWeek();
          if (get().currentWeek === 1) break;
        }
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
        let result: StoreActionResult = { success: false, message: '' };
        set(state => {
          const update = buyPlayerState(state, playerId, fee, wageOffered);
          result = update.result;
          return update.patch;
        });
        return result;
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
            if (state.boardReviewAppliedWeek === state.currentWeek) return state;
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
               boardObjectives: review.updatedObjectives,
               boardReviewAppliedWeek: state.currentWeek,
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
