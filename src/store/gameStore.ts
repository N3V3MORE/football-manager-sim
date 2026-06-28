import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  Formation,
  GameState,
  PlayerRole,
  StatKey,
  TeamTactics,
} from '../models/types';
import { initGameData } from '../utils/initGame';
import {
  createDefaultCareerRecord,
} from '../core/careerEngine';
import {
  LiveMatchState,
  pruneInvalidLiveMatches,
} from './liveMatchHelpers';
import { generateAssistantWeekMessages } from './inboxAssistant';
import { generateSystemInboxMessages, mergeInboxMessages } from './inboxCore';
import {
  renewPlayerContractState,
  StoreActionResult,
} from './contractActions';
import { applyInboxActionState } from './inboxActions';
import {
  markAsSubState,
  setPlayerRoleState,
  setFormationState,
  setTacticsState,
  swapPlayerState,
  swapStartingSlotsState,
  toggleStartingState,
} from './lineupActions';
import {
  acceptTransferCounterState,
  approachPlayerState,
  buyPlayerState,
  listPlayerForSaleState,
  signFreeAgentState,
  submitBidState,
  unlistPlayerState,
  withdrawTransferNegotiationState,
} from './transferActions';
import { buildManagedTeamObjectives } from './managedTeamObjectives';
import { DEFAULT_GAME_STATE, PERSIST_STORAGE_KEY, ensureReferentialIntegrity, safeStorage, sanitizePersistedState } from './persistence';
import { createSeededRandomGenerator } from '../core/random';
import { advanceWeekState, skipToEndOfSeasonState } from './weekLifecycle';
import { finishLiveMatchState, makeLiveSubstitutionsState, processLiveMatchMinuteState, setLiveMatchFormationState } from './liveMatchActions';
import { playMatchState } from './fixtureResolution';
import { changeTeamState } from './careerActions';

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
  setTrainingFocus: (playerId: string, focus: StatKey | null) => void;
  setPlayerRole: (teamId: string, slotKey: string, role: PlayerRole) => void;
  setTactics: (teamId: string, tactics: Partial<TeamTactics>) => void;
  swapPlayer: (removeId: string | null, addId: string, slotKey?: string) => void;
  swapStartingSlots: (teamId: string, slotA: string, slotB: string) => void;
  skipToEndOfSeason: () => void;
  clearStuckLiveMatches: () => number;
  changeTeam: (teamId: string) => void;
  // Transfer System
  approachPlayer: (playerId: string) => { success: boolean; message: string };
  buyPlayer: (playerId: string, fee: number, wageOffered: number) => { success: boolean; message: string };
  submitTransferBid: (negotiationId: string, fee: number, wageOffered: number) => { success: boolean; message: string };
  acceptTransferCounter: (negotiationId: string) => { success: boolean; message: string };
  withdrawTransferNegotiation: (negotiationId: string) => void;
  signFreeAgent: (playerId: string, wageOffered: number) => { success: boolean; message: string };
  listPlayerForSale: (playerId: string, askingPrice: number) => void;
  unlistPlayer: (playerId: string) => void;
  // Live Match Engine
  processMatchMinute: (fixtureId: string, minute: number) => { event: string | null };
  finishLiveMatch: (fixtureId: string) => void;
  makeLiveSubstitutions: (fixtureId: string, replacements: { offPlayerId: string; onPlayerId: string }[]) => { success: boolean; message: string };
  setLiveMatchFormation: (fixtureId: string, teamId: string, formation: Formation) => { success: boolean; message: string };
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
          pendingNegotiations: [],
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
        set(state => playMatchState(state, fixtureId));
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

      makeLiveSubstitutions: (fixtureId, replacements) => {
        let result = { success: false, message: '' };
        set(state => {
          const update = makeLiveSubstitutionsState(state, fixtureId, replacements);
          result = update.result;
          return update.patch;
        });
        return result;
      },

      setLiveMatchFormation: (fixtureId, teamId, formation) => {
        let result = { success: false, message: '' };
        set(state => {
          const update = setLiveMatchFormationState(state, fixtureId, teamId, formation);
          result = update.result;
          return update.patch;
        });
        return result;
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

      setTrainingFocus: (playerId: string, focus: StatKey | null) => {
        set(state => {
          const player = state.players[playerId];
          if (!player || player.teamId !== state.userTeamId) return state;
          return {
            players: {
              ...state.players,
              [playerId]: {
                ...player,
                trainingFocus: focus,
                trainingXp: player.trainingXp ?? 0,
                trainingStatProgress: player.trainingStatProgress ?? 0,
                trainingStatGains: player.trainingStatGains ?? {},
              },
            },
          };
        });
      },

      setPlayerRole: (teamId: string, slotKey: string, role: PlayerRole) => {
        set(state => setPlayerRoleState(state, teamId, slotKey, role));
      },

      skipToEndOfSeason: () => {
        set(state => skipToEndOfSeasonState(state));
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
        set(state => changeTeamState(state, teamId));
      },

      approachPlayer: (playerId: string) => {
        let result: StoreActionResult = { success: false, message: '' };
        set(state => {
          const update = approachPlayerState(state, playerId);
          result = update.result;
          return update.patch;
        });
        return result;
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

      submitTransferBid: (negotiationId: string, fee: number, wageOffered: number) => {
        let result: StoreActionResult = { success: false, message: '' };
        set(state => {
          const update = submitBidState(state, negotiationId, fee, wageOffered);
          result = update.result;
          return update.patch;
        });
        return result;
      },

      acceptTransferCounter: (negotiationId: string) => {
        let result: StoreActionResult = { success: false, message: '' };
        set(state => {
          const update = acceptTransferCounterState(state, negotiationId);
          result = update.result;
          return update.patch;
        });
        return result;
      },

      withdrawTransferNegotiation: (negotiationId: string) => {
        set(state => withdrawTransferNegotiationState(state, negotiationId));
      },

      signFreeAgent: (playerId: string, wageOffered: number) => {
        let result: StoreActionResult = { success: false, message: '' };
        set(state => {
          const update = signFreeAgentState(state, playerId, wageOffered);
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
    }),
    {
      name: PERSIST_STORAGE_KEY,
      storage: createJSONStorage(() => safeStorage),
      version: 9,
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
        // v9: stop writing the deprecated `suspensionAppliedWeek` field. Strip it
        // from any players carried over from older saves; same-match suspension
        // skipping is driven by `suspensionAppliedFixtureId`, so removal is safe.
        const migrated = version < 9 && sanitized.players
          ? {
              ...sanitized,
              players: Object.fromEntries(
                Object.entries(sanitized.players).map(([id, player]) => {
                  if (player.suspensionAppliedWeek === undefined) return [id, player];
                  const cleaned = { ...player };
                  delete cleaned.suspensionAppliedWeek;
                  return [id, cleaned];
                })
              ),
            }
          : sanitized;
        return {
          ...DEFAULT_GAME_STATE,
          ...migrated,
        } as GameStore;
      },
    }
  )
);
