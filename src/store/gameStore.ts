import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameState, Player, Formation, Team, TeamTactics } from '../models/types';
import { initGameData, generateBoardObjectives } from '../utils/initGame';
import { getSlotsForFormation } from '../constants/formations';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { getSeasonWeekLimit } from '../core/leagueUtils';
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
import { rebuildFormationMap, removePlayerFromTeamSelections } from '../core/formationMapUtils';
import { defaultRandomGenerator } from '../core/random';
import { buildStarterMinuteMap } from '../core/minuteMapUtils';
import {
  LiveMatchState,
  drainLiveMatchEnergy,
  ensureLiveTeamStarters,
  getPlayersByIds,
  getPossessionIndexForMinute,
  removeLiveMatchFixture,
  updateTeamStats,
} from './liveMatchHelpers';
import { clampBoardMetric, evaluateBoardObjectives, getFormApprovalDelta } from './boardObjectiveHelpers';

interface GameStore extends GameState {
  liveMatches: Record<string, LiveMatchState>;
  initializeGame: (userTeamId: string) => void;
  advanceWeek: () => void;
  playMatch: (fixtureId: string) => void;
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

const DEFAULT_GAME_STATE: GameState = {
  currentWeek: 1,
  userTeamId: null,
  teams: {},
  players: {},
  fixtures: {},
  news: [],
  boardObjectives: [],
};

const sanitizePersistedState = (state: Partial<GameStore>): Partial<GameStore> => {
  const teams = state.teams && typeof state.teams === 'object'
    ? Object.fromEntries(
      Object.entries(state.teams).map(([teamId, team]) => {
        const typedTeam = (team && typeof team === 'object' ? team : {}) as Partial<Team>;
        return [
          teamId,
          {
            ...typedTeam,
            transferSpend: Number.isFinite(typedTeam.transferSpend) ? typedTeam.transferSpend : 0,
          },
        ];
      })
    ) as Record<string, Team>
    : {};

  return {
  ...state,
  currentWeek: Number.isFinite(state.currentWeek) && (state.currentWeek || 0) > 0 ? state.currentWeek : 1,
  teams,
  players: state.players && typeof state.players === 'object' ? state.players : {},
  fixtures: state.fixtures && typeof state.fixtures === 'object' ? state.fixtures : {},
  news: Array.isArray(state.news) ? state.news : [],
  boardObjectives: Array.isArray(state.boardObjectives) ? state.boardObjectives : [],
  liveMatches: state.liveMatches && typeof state.liveMatches === 'object' ? state.liveMatches : {},
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

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      currentWeek: 1,
      userTeamId: null,
      teams: {},
      players: {},
      fixtures: {},
      news: [],
      boardObjectives: [],
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
        const teamClass = data.teamClasses[actualTeamId] || 'C';
        const objectives = userTeam ? generateBoardObjectives(teamClass, userTeam.name, userTeam.division) : [];

        set({
          userTeamId: actualTeamId,
          currentWeek: 1,
          teams: data.teams,
          players: data.players,
          fixtures: data.fixtures,
          boardObjectives: objectives,
          news: ['Season begins! The Premier League simulation is underway.'],
          liveMatches: {},
        });
      },

      playMatch: (fixtureId: string) => {
        set((state) => {
          const { players, teams, fixture } = quickSimMatch(fixtureId, state.players, state.teams, state.fixtures, state.userTeamId);
          const liveMatches = removeLiveMatchFixture(state.liveMatches || {}, fixtureId);

          return {
            players,
            teams,
            fixtures: { ...state.fixtures, [fixtureId]: fixture },
            liveMatches,
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

          const homeTeam = state.teams[fixture.homeTeamId];
          const awayTeam = state.teams[fixture.awayTeamId];
          const liveMatchState = state.liveMatches?.[fixtureId];
          const sentOffMinutes = liveMatchState?.sentOffMinutes || {};
          const sentOffPlayers = new Set(liveMatchState?.sentOffPlayerIds || []);
          const homeGoalMinutes = liveMatchState?.homeGoalMinutes || [];
          const awayGoalMinutes = liveMatchState?.awayGoalMinutes || [];
          const homeTeamStarters = liveMatchState
            ? getPlayersByIds(state.players, liveMatchState.homeStarterIds)
            : Object.values(state.players).filter(p => p.teamId === homeTeam.id && p.isStarting && p.matchesSuspended === 0);
          const awayTeamStarters = liveMatchState
            ? getPlayersByIds(state.players, liveMatchState.awayStarterIds)
            : Object.values(state.players).filter(p => p.teamId === awayTeam.id && p.isStarting && p.matchesSuspended === 0);
          const getBench = (teamId: string, starters: Player[]) => {
            const starterIds = new Set(starters.map(player => player.id));
            return Object.values(state.players).filter(player => (
              player.teamId === teamId &&
              player.isSub &&
              player.matchesSuspended === 0 &&
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

          const updatedFixture = { ...fixture, isPlayed: true };

          const updatedTeams = {
            ...state.teams,
            [homeTeam.id]: { ...updateTeamStats(homeTeam, hScore, aScore), lastStartingXI: homeTeamStarters.map(p => p.id) },
            [awayTeam.id]: { ...updateTeamStats(awayTeam, aScore, hScore), lastStartingXI: awayTeamStarters.map(p => p.id) },
          };
          const liveMatches = removeLiveMatchFixture(state.liveMatches || {}, fixtureId);

          return {
            fixtures: { ...state.fixtures, [fixtureId]: updatedFixture },
            teams: updatedTeams,
            players: updatedPlayers,
            liveMatches,
          };
        });
      },

      advanceWeek: () => {
        set(state => {
          const weekFixtures = Object.values(state.fixtures).filter(f => f.week === state.currentWeek && !f.isPlayed);
          if (weekFixtures.length === 0) return state;

          let updatedPlayers = state.players;
          let updatedTeams = state.teams;
          let updatedFixtures = state.fixtures;
          let updatedLiveMatches = state.liveMatches || {};

          weekFixtures.forEach(fix => {
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
          });

          return {
            players: updatedPlayers,
            teams: updatedTeams,
            fixtures: updatedFixtures,
            liveMatches: updatedLiveMatches,
          };
        });

        set((state) => {
           return computeWeeklyProgression(
             state.currentWeek,
             state.players,
             state.teams,
             state.fixtures,
             state.news,
             state.userTeamId
           );
        });

        // Match the analysis scripts: update week state before transfer decisions.
        get().processWeeklyTransfers();
        get().checkBoardObjectives();

        const postProgressionState = get();
        const seasonWeekLimit = getSeasonWeekLimit(postProgressionState.fixtures);
        if (postProgressionState.currentWeek > seasonWeekLimit) {
          set(state => ({
            ...advanceSeason(state.players, state.teams, state.userTeamId, state.news),
            userTeamId: state.userTeamId,
            liveMatches: {},
          }));
        }
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
              .filter(p => p.teamId === teamId && p.isStarting && p.matchesSuspended === 0);
            const formationMap = rebuildFormationMap(getSlotsForFormation(formation), teamStarters, existingMap);
            return {
              teams: { ...state.teams, [teamId]: { ...team, activeFormation: formation, formationMap } },
            };
          }

          const updatedTeam = { ...team, activeFormation: formation };

          const teamPlayers = Object.values(state.players)
            .filter(p => p.teamId === teamId)
            .sort((a, b) => b.overallRating - a.overallRating);

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
                let candidate = teamPlayers.find(p => p.subPosition === slot.label && !assignedIds.has(p.id));
                // then broad position
                if (!candidate) candidate = teamPlayers.find(p => p.position === slot.pos && !assignedIds.has(p.id));
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
                  const p = teamPlayers.find(q => !assignedIds.has(q.id));
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
          if (!player) return state;

          const teamPlayers = Object.values(state.players).filter(p => p.teamId === player.teamId);
          const starters    = teamPlayers.filter(p => p.isStarting);

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
          if (!player || player.isStarting) return state;
          return {
            players: {
              ...state.players,
              [playerId]: { ...player, isSub: !player.isSub },
            }
          };
        });
      },

      skipToEndOfSeason: () => {
        const maxWeek = Object.values(get().fixtures).reduce((max, f) => Math.max(max, f.week), 0);
        let guard = maxWeek + 2;
        while (get().currentWeek <= maxWeek && guard-- > 0) {
          get().advanceWeek();
          if (get().currentWeek === 1) break;
        }
      },

      swapPlayer: (removeId: string | null, addId: string, slotKey?: string) => {
        set(state => {
          const updates: Record<string, typeof state.players[string]> = {};
          if (removeId && state.players[removeId]) {
            updates[removeId] = { ...state.players[removeId], isStarting: false };
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
        set({ userTeamId: teamId });
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
          const updatedPlayer = { ...player, teamId: userTeam.id, wage: wageOffered > 0 ? wageOffered : player.wage, isStarting: false, isSub: false, isTransferListed: false, askingPrice: 0 };

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
            const manager = myTeam.manager;
            const seasonWeekLimit = getSeasonWeekLimit(state.fixtures);
            const objectiveResult = evaluateBoardObjectives(
              state.boardObjectives,
              myTeam,
              state.teams,
              { isSeasonComplete: state.currentWeek > seasonWeekLimit }
            );
            const approvalChange = objectiveResult.approvalChange + getFormApprovalDelta(myTeam.form || []);
            const updatedObjectives = objectiveResult.updatedObjectives;

            const newApproval = clampBoardMetric(myTeam.boardApproval + approvalChange);
            const nextManager = {
              ...manager,
              boardTrust: clampBoardMetric(manager.boardTrust + approvalChange),
              jobSecurity: clampBoardMetric(manager.jobSecurity + Math.round(approvalChange / 2)),
            };

            // Not fully causing game over yet, just tracking it!
            return {
               teams: { ...state.teams, [myTeam.id]: { ...myTeam, boardApproval: newApproval, manager: nextManager } },
               boardObjectives: updatedObjectives
            };
         });
      },
    }),
    {
      name: 'football-manager-storage',
      storage: createJSONStorage(() => safeStorage),
      version: 3,
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
