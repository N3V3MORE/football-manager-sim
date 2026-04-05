import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameState, Team, Player, Formation, TeamTactics } from '../models/types';
import { initGameData, generateBoardObjectives } from '../utils/initGame';
import { getSlotsForFormation } from '../constants/formations';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { autoAssignLineup, simulatePossession, getFormModifier, getMoraleModifier, quickSimMatch } from '../core/matchEngine';
import { computeWeeklyTransfers, computeWeeklyProgression } from '../core/progressionEngine';

interface GameStore extends GameState {
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




// Safe AsyncStorage wrapper — avoids "native module is null" during startup
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
        const objectives = userTeam ? generateBoardObjectives(teamClass, userTeam.name) : [];

        set({
          userTeamId: actualTeamId,
          currentWeek: 1,
          teams: data.teams,
          players: data.players,
          fixtures: data.fixtures,
          boardObjectives: objectives,
          news: ['Season begins! The Premier League simulation is underway.'],
        });
      },

      playMatch: (fixtureId: string) => {
        set((state) => {
          const { players, teams, fixture } = quickSimMatch(fixtureId, state.players, state.teams, state.fixtures);
          return {
            players,
            teams,
            fixtures: { ...state.fixtures, [fixtureId]: fixture }
          };
        });
      },

      processMatchMinute: (fixtureId: string, minute: number) => {
        let eventMsg: string | null = null;
        set((state) => {
          const fixture = state.fixtures[fixtureId];
          if (!fixture || fixture.isPlayed) return state;

          const updatedPlayers = { ...state.players };
          const updatedFixture = { ...fixture };
          if (updatedFixture.homeScore === null) updatedFixture.homeScore = 0;
          if (updatedFixture.awayScore === null) updatedFixture.awayScore = 0;

          const homeTeam = state.teams[fixture.homeTeamId];
          const awayTeam = state.teams[fixture.awayTeamId];
          
          const getTeamStarters = (teamId: string) => {
            let starters = Object.values(updatedPlayers).filter(p => p.teamId === teamId && p.isStarting && p.matchesSuspended === 0);
            if (starters.length < 11) {
              const team = state.teams[teamId];
              const lineupUpdates = autoAssignLineup(teamId, updatedPlayers, team.activeFormation);
              Object.keys(lineupUpdates).forEach(id => {
                 updatedPlayers[id] = { ...updatedPlayers[id], ...lineupUpdates[id] };
              });
              starters = Object.values(updatedPlayers).filter(p => p.teamId === teamId && p.isStarting && p.matchesSuspended === 0);
            }
            return starters;
          };

          const homeStarters = getTeamStarters(homeTeam.id);
          const awayStarters = getTeamStarters(awayTeam.id);

          if (homeStarters.length === 0 || awayStarters.length === 0) return state;

          // Energy drain: driven by config
          [...homeStarters, ...awayStarters].forEach(p => {
            updatedPlayers[p.id].energy = Math.max(0, updatedPlayers[p.id].energy - ENGINE_CONFIG.ENERGY_DRAIN_PER_MINUTE);
          });

          // Simulate 1 possession per minute
          const isHomeAttacking = Math.random() > 0.5;
          const attacker = isHomeAttacking ? homeTeam : awayTeam;
          const defender = isHomeAttacking ? awayTeam : homeTeam;
          const attPlayers = isHomeAttacking ? homeStarters : awayStarters;
          const defPlayers = isHomeAttacking ? awayStarters : homeStarters;

          const res = simulatePossession(
            attacker, 
            defender, 
            attPlayers, 
            defPlayers, 
            isHomeAttacking ? updatedFixture.homeScore! : updatedFixture.awayScore!, 
            isHomeAttacking ? updatedFixture.awayScore! : updatedFixture.homeScore!
          );
          if (res.goal) {
            if (isHomeAttacking) updatedFixture.homeScore!++; else updatedFixture.awayScore!++;
            if (res.scorer) updatedPlayers[res.scorer.id].goals++;
            if (res.assister) updatedPlayers[res.assister.id].assists++;
          }
          if (res.foul) {
             if (res.foul.type === 'Y') updatedPlayers[res.foul.player.id].yellowCards++;
             else {
               updatedPlayers[res.foul.player.id].redCards++;
               updatedPlayers[res.foul.player.id].matchesSuspended = 3;
             }
          }
          
          eventMsg = res.event;
          if (minute === 45 && !eventMsg) eventMsg = `⏱️ HALF TIME.`;
          if (minute === 90 && !eventMsg) eventMsg = `⏱️ FULL TIME.`;

          return { fixtures: { ...state.fixtures, [fixtureId]: updatedFixture }, players: updatedPlayers };
        });
        return { event: eventMsg };
      },

      finishLiveMatch: (fixtureId: string) => {
        set((state) => {
          const fixture = state.fixtures[fixtureId];
          if (!fixture || fixture.isPlayed) return state;

          const homeTeam = state.teams[fixture.homeTeamId];
          const awayTeam = state.teams[fixture.awayTeamId];
          const homeTeamPlayers = Object.values(state.players).filter(p => p.teamId === homeTeam.id && p.isStarting && p.matchesSuspended === 0);
          const awayTeamPlayers = Object.values(state.players).filter(p => p.teamId === awayTeam.id && p.isStarting && p.matchesSuspended === 0);

          const updatedPlayers = { ...state.players };

          const hScore = fixture.homeScore || 0;
          const aScore = fixture.awayScore || 0;

          const assignPostMatchStatsLive = (teamStarters: Player[], teamGoals: number, oppGoals: number, isWin: boolean, isDraw: boolean) => {
            teamStarters.forEach(p => { 
                let rating = 6.0 + (Math.random() * 1.2 - 0.4);
                if (isWin) rating += 0.8;
                if (isDraw) rating += 0.2;
                if (!isWin && !isDraw) rating -= 0.6;
                // Live match energy drains per minute, no bulk drain here

                if (oppGoals === 0 && (p.position === 'DEF' || p.position === 'GK')) {
                   updatedPlayers[p.id].cleanSheets++;
                   rating += 1.0;
                }
                rating += (p.impactCoefficient - 1.0); 

                rating = Math.max(1.0, Math.min(10.0, Math.round(rating * 10) / 10));

                updatedPlayers[p.id] = {
                   ...updatedPlayers[p.id],
                   minutesPlayed: (updatedPlayers[p.id].minutesPlayed || 0) + 90,
                   matchRatingHistory: [...(updatedPlayers[p.id].matchRatingHistory || []), rating]
                };
            });
          };

          assignPostMatchStatsLive(homeTeamPlayers, hScore, aScore, hScore > aScore, hScore === aScore);
          assignPostMatchStatsLive(awayTeamPlayers, aScore, hScore, aScore > hScore, aScore === hScore);

          const updatedFixture = { ...fixture, isPlayed: true };

          const updateTeamStats = (t: Team, goalsFor: number, goalsAgainst: number) => {
            let pts = 0, w = 0, d = 0, l = 0;
            if (goalsFor > goalsAgainst)      { pts = 3; w = 1; }
            else if (goalsFor === goalsAgainst) { pts = 1; d = 1; }
            else                               { l = 1; }
            const formToken = w ? 'W' : d ? 'D' : 'L';
            const newForm = [...(t.form || []), formToken].slice(-5);
            return {
              ...t,
              points: t.points + pts,
              goalsFor: t.goalsFor + goalsFor,
              goalsAgainst: t.goalsAgainst + goalsAgainst,
              wins:    t.wins + w,
              draws:   t.draws + d,
              losses:  t.losses + l,
              played:  t.played + 1,
              form:    newForm,
            };
          };

          const updatedTeams = {
            ...state.teams,
            [homeTeam.id]: { ...updateTeamStats(homeTeam, hScore, aScore), lastStartingXI: homeTeamPlayers.map(p => p.id) },
            [awayTeam.id]: { ...updateTeamStats(awayTeam, aScore, hScore), lastStartingXI: awayTeamPlayers.map(p => p.id) },
          };

          return {
            fixtures: { ...state.fixtures, [fixtureId]: updatedFixture },
            teams: updatedTeams,
            players: updatedPlayers,
          };
        });
      },

      advanceWeek: () => {
        const currentState = get();
        const weekFixtures = Object.values(currentState.fixtures).filter(f => f.week === currentState.currentWeek);
        weekFixtures.forEach(fix => {
          if (!fix.isPlayed) get().playMatch(fix.id);
        });

        // Run AI transfers
        get().processWeeklyTransfers();
        
        // Evaluate board objectives
        get().checkBoardObjectives();

        set((state) => {
           return computeWeeklyProgression(
             state.currentWeek,
             state.players,
             state.teams,
             state.fixtures,
             state.news
           );
        });
      },

      setFormation: (teamId, formation) => {
        set((state) => {
          const team = state.teams[teamId];
          if (!team) return state;

          const baseNew = formation.split(' ')[0];
          const baseOld = (team.activeFormation || '').split(' ')[0];
          const existingMap = team.formationMap || {};
          const hasExistingMap = Object.keys(existingMap).length > 0;

          // If same base formation and map already exists — just rename, don't shuffle
          if (baseNew === baseOld && hasExistingMap) {
            return {
              teams: { ...state.teams, [teamId]: { ...team, activeFormation: formation } },
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
        while (get().currentWeek <= maxWeek) {
          get().advanceWeek();
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
             result = { success: false, message: `The club rejected your bid of £${fee}m.` };
             return state;
          }

          if (wageOffered > 0 && wageOffered < player.wage * 0.9) {
             result = { success: false, message: `${player.name} rejected your wage offer of £${wageOffered}k/w.` };
             return state;
          }

          const sellingTeam = state.teams[player.teamId];
          const updatedUserTeam = { ...userTeam, budget: userTeam.budget - fee };
          const updatedSellingTeam = sellingTeam ? { ...sellingTeam, budget: sellingTeam.budget + fee } : undefined;
          const updatedPlayer = { ...player, teamId: userTeam.id, wage: wageOffered > 0 ? wageOffered : player.wage, isStarting: false, isSub: false, isTransferListed: false, askingPrice: 0 };

          result = { success: true, message: `Successfully purchased ${player.name} for £${fee}m.` };

          return {
            teams: { ...state.teams, [userTeam.id]: updatedUserTeam, ...(updatedSellingTeam ? { [sellingTeam.id]: updatedSellingTeam } : {}) },
            players: { ...state.players, [playerId]: updatedPlayer }
          };
        });
        return result;
      },

      listPlayerForSale: (playerId: string, askingPrice: number) => {
        set(state => {
          const player = state.players[playerId];
          if (!player) return state;
          return {
            players: { ...state.players, [playerId]: { ...player, isTransferListed: true, askingPrice } }
          };
        });
      },

      unlistPlayer: (playerId: string) => {
        set(state => {
          const player = state.players[playerId];
          if (!player) return state;
          return {
            players: { ...state.players, [playerId]: { ...player, isTransferListed: false, askingPrice: 0 } }
          };
        });
      },

      processWeeklyTransfers: () => {
        set(state => computeWeeklyTransfers(state.players, state.teams, state.userTeamId));
      },

      checkBoardObjectives: () => {
         set(state => {
            if (!state.userTeamId) return state;
            const myTeam = state.teams[state.userTeamId];
            let approvalChange = 0;
            const updatedObjectives = state.boardObjectives.map(obj => {
               let isMet = obj.met;
               switch (obj.type) {
                  case 'position':
                     // We would evaluate this only late in the season, or continuously.
                     // A bit complex since position keeps changing. 
                     break;
                  case 'wins':
                     if (myTeam.wins >= obj.target && !isMet) {
                        isMet = true;
                        approvalChange += 10;
                     }
                     break;
                  // More obj types...
                  default: break;
               }
               return { ...obj, met: isMet };
            });
            
            // Random board pressure if we lose
            if (myTeam.form && myTeam.form[myTeam.form.length - 1] === 'L') {
               approvalChange -= 2;
            } else if (myTeam.form && myTeam.form[myTeam.form.length - 1] === 'W') {
               approvalChange += 1;
            }

            const newApproval = Math.min(100, Math.max(0, myTeam.boardApproval + approvalChange));

            // Not fully causing game over yet, just tracking it!
            return {
               teams: { ...state.teams, [myTeam.id]: { ...myTeam, boardApproval: newApproval } },
               boardObjectives: updatedObjectives
            };
         });
      },
    }),
    {
      name: 'football-manager-storage',
      storage: createJSONStorage(() => safeStorage),
    }
  )
);
