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
  moveUserManagerToTeam,
} from '../core/careerEngine';
import {
  LiveMatchState,
  pruneInvalidLiveMatches,
  removeLiveMatchFixture,
} from './liveMatchHelpers';
import {
  generateAssistantWeekMessages,
  generatePostMatchReportMessage,
  generateSystemInboxMessages,
  generateTeamSwitchMessage,
  getInboxSeason,
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
import { DEFAULT_GAME_STATE, PERSIST_STORAGE_KEY, ensureReferentialIntegrity, safeStorage, sanitizePersistedState } from './persistence';
import { createFixtureEventRandomGenerator, createSeededRandomGenerator } from '../core/random';
import { advanceWeekState } from './weekLifecycle';
import { finishLiveMatchState, processLiveMatchMinuteState } from './liveMatchActions';

interface GameStore extends GameState {
  liveMatches: Record<string, LiveMatchState>;
  transfersAppliedWeek: number;
  initializeGame: (userTeamId: string, seed?: number) => void;
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
  clearStuckLiveMatches: () => number;
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
      transfersAppliedWeek: 0,

      initializeGame: (userTeamId, seed) => {
        const requestedTeamId = userTeamId === 'temp' ? 'T1' : userTeamId;
        const rngState = Number.isFinite(seed) && seed && seed > 0
          ? Math.floor(seed)
          : Math.floor(Math.random() * 2147483647) + 1;
        const data = initGameData(requestedTeamId, createSeededRandomGenerator(rngState));
        const actualTeamId = data.teams[requestedTeamId] ? requestedTeamId : Object.keys(data.teams)[0];
        
        const players = Object.fromEntries(
          Object.entries(data.players).map(([id, player]) => [
            id,
            player.teamId === actualTeamId
              ? { ...player, isStarting: false, isSub: false }
              : player,
          ])
        );

        const userTeam = data.teams[actualTeamId];
        const objectives = buildManagedTeamObjectives(userTeam, data.competitions);
        const initialNews = [`Season begins! The ${userTeam.division} simulation is underway.`];
        const inboxMessages = mergeInboxMessages(
          [],
          [
            ...generateAssistantWeekMessages({
              currentWeek: 1,
              season: 1,
              userTeamId: actualTeamId,
              teams: data.teams,
              players,
              fixtures: data.fixtures,
            }),
            ...generateSystemInboxMessages(1, initialNews, 1),
          ]
        );

        const initialUserManager = {
          name: userTeam.manager.name,
          nationality: userTeam.manager.nationality,
          dateOfBirth: userTeam.manager.dateOfBirth,
          preferredFormations: userTeam.manager.preferredFormations,
          tacticalIdentity: userTeam.manager.tacticalIdentity,
          transferIdentity: userTeam.manager.transferIdentity,
        };

        set({
          userTeamId: actualTeamId,
          currentWeek: 1,
          teams: data.teams,
          players,
          fixtures: data.fixtures,
          competitions: data.competitions,
          boardObjectives: objectives,
          news: initialNews,
          inboxMessages,
          careerRecord: { ...createDefaultCareerRecord(), userManager: initialUserManager },
          liveMatches: {},
          boardReviewAppliedWeek: 0,
          transfersAppliedWeek: 0,
          rngState,
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
          const seedFixture = state.fixtures[fixtureId];
          const season = seedFixture ? state.competitions[seedFixture.competitionId]?.season || 1 : 1;
          const rng = createFixtureEventRandomGenerator(fixtureId, 0, state.rngState ?? 1, season, 'quick');
          const { players, teams, fixture } = quickSimMatch(fixtureId, state.players, state.teams, state.fixtures, state.userTeamId, { rng });
          const nextFixtures = { ...state.fixtures, [fixtureId]: fixture };
          const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, teams);
          const liveMatches = removeLiveMatchFixture(state.liveMatches || {}, fixtureId);
          const postMatchReport = generatePostMatchReportMessage({
            currentWeek: state.currentWeek,
            season,
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
                ...generateSystemInboxMessages(state.currentWeek, competitionProgression.generatedNews, season),
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
        set(state => {
          const next = advanceWeekState(state);
          // Ensure free-agent team exists if any player was moved there during
          // squad trimming or contract expiry (durable representation for
          // referential integrity).
          const fixedTeams = ensureReferentialIntegrity(next.teams ?? state.teams, next.players ?? state.players);
          return { ...next, teams: fixedTeams };
        });
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
        if (maxWeek <= 0) return;
        let guard = maxWeek + 20;
        try {
          while (get().currentWeek <= maxWeek && guard-- > 0) {
            get().advanceWeek();
            if (get().currentWeek === 1) break;
          }
        } catch (error) {
          console.warn('skipToEndOfSeason failed before season rollover', error);
        }
      },

      clearStuckLiveMatches: () => {
        let clearedCount = 0;
        set(state => {
          const prunedLiveMatches = pruneInvalidLiveMatches(state.liveMatches || {}, {
            currentWeek: state.currentWeek,
            fixtures: state.fixtures,
            teams: state.teams,
            players: state.players,
          });
          const invalidCount = Object.keys(state.liveMatches || {}).length - Object.keys(prunedLiveMatches).length;
          let nextState = { ...state, liveMatches: prunedLiveMatches };
          Object.keys(prunedLiveMatches).forEach(fixtureId => {
            const fixture = nextState.fixtures[fixtureId];
            if (fixture && !fixture.isPlayed && fixture.week <= nextState.currentWeek) {
              nextState = { ...nextState, ...finishLiveMatchState(nextState, fixtureId) };
              clearedCount += 1;
            }
          });
          clearedCount += invalidCount;
          return nextState;
        });
        return clearedCount;
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
          const previousTeamId = state.userTeamId;
          const previousTeam = previousTeamId ? state.teams[previousTeamId] : null;

          const managerMove = moveUserManagerToTeam(
            state.teams,
            previousTeamId,
            teamId,
            state.careerRecord
          );
          const nextTeams = managerMove.teams;

          const nextAssistantMessages = generateAssistantWeekMessages({
            currentWeek: state.currentWeek,
            season: getInboxSeason(state.competitions),
            userTeamId: teamId,
            teams: nextTeams,
            players: state.players,
            fixtures: state.fixtures,
          });

          const switchMessage = previousTeam
            ? generateTeamSwitchMessage(
                state.currentWeek,
                previousTeam.name,
                nextTeam.name,
                nextTeam.division
              )
            : null;

          return {
            userTeamId: teamId,
            teams: nextTeams,
            careerRecord: managerMove.careerRecord,
            boardObjectives: buildManagedTeamObjectives(nextTeams[teamId] || nextTeam, state.competitions),
            inboxMessages: mergeInboxMessages(
              pruneInboxMessagesForManagedTeam(state.inboxMessages, teamId),
              [
                ...(switchMessage ? [switchMessage] : []),
                ...nextAssistantMessages,
              ]
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
        set(state => {
          if (state.transfersAppliedWeek === state.currentWeek) return state;
          const result = processWeeklyTransfersState(state);
          return { ...result, transfersAppliedWeek: state.currentWeek };
        });
      },

      checkBoardObjectives: () => {
         set(state => {
            if (!state.userTeamId) return state;
            if (state.boardReviewAppliedWeek === state.currentWeek) return state;
            const myTeam = state.teams[state.userTeamId];
            if (!myTeam) return state;
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
      name: PERSIST_STORAGE_KEY,
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
