import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameState, Team, Player, Formation } from '../models/types';
import { initGameData, generateBoardObjectives } from '../utils/initGame';
import { getSlotsForFormation } from '../constants/formations';

interface GameStore extends GameState {
  initializeGame: (userTeamId: string) => void;
  advanceWeek: () => void;
  playMatch: (fixtureId: string) => void;
  setFormation: (teamId: string, formation: Formation) => void;
  toggleStarting: (playerId: string) => void;
  markAsSub: (playerId: string) => void;
  setStrategy: (teamId: string, strategy: 'defend' | 'balanced' | 'attack') => void;
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

// ─── Poisson sampler ──────────────────────────────────────────────────────────
// Approximates Poisson-distributed random integer for a given lambda.
// Uses Knuth's algorithm: multiply uniforms until product < e^-lambda.
const poissonSample = (lambda: number): number => {
  const L = Math.exp(-Math.max(lambda, 0));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
};

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

// ─── Support: Auto-assign best XI for AI or simulated matches ────────────────
const autoAssignLineup = (teamId: string, players: Record<string, Player>, formation: string) => {
  const teamPlayers = Object.values(players)
    .filter(p => p.teamId === teamId)
    .sort((a, b) => b.overallRating - a.overallRating);

  const slots = getSlotsForFormation(formation);
  const assignedIds = new Set<string>();
  const updates: Record<string, Partial<Player>> = {};

  // Reset all
  teamPlayers.forEach(p => {
    updates[p.id] = { isStarting: false, isSub: false };
  });

  slots.forEach((row) => {
    row.forEach((slot) => {
      let candidate = teamPlayers.find(p => p.subPosition === slot.label && !assignedIds.has(p.id));
      if (!candidate) candidate = teamPlayers.find(p => p.position === slot.pos && !assignedIds.has(p.id));
      if (!candidate) candidate = teamPlayers.find(p => !assignedIds.has(p.id));

      if (candidate) {
        updates[candidate.id] = { isStarting: true, isSub: false };
        assignedIds.add(candidate.id);
      }
    });
  });

  return updates;
};

// ─── Duel Logic: Weighted attribute check ────────────────────────────────────
const runDuel = (attrA: number, attrB: number, luckFactor: number = 0.2): boolean => {
  const rollA = attrA * (1 - luckFactor + Math.random() * luckFactor * 2);
  const rollB = attrB * (1 - luckFactor + Math.random() * luckFactor * 2);
  return rollA > rollB;
};

// ─── Tier 3 Match Engine Phase Simulation ────────────────────────────────────
const simulatePossession = (
  attacker: Team, 
  defender: Team, 
  attPlayers: Player[], 
  defPlayers: Player[]
): { goal: boolean; scorer?: Player; assister?: Player; event: string | null; foul?: { player: Player; type: 'Y' | 'R' } } => {
  
  const midsAtt = attPlayers.filter(p => p.position === 'MID');
  const fwdsAtt = attPlayers.filter(p => p.position === 'FWD');
  const defsDef = defPlayers.filter(p => p.position === 'DEF');
  const gksDef  = defPlayers.filter(p => p.position === 'GK');

  if (attPlayers.length === 0 || defPlayers.length === 0) return { goal: false, event: null };

  // Only ~22% of possessions turn into a 'Big Moment'
  if (Math.random() > 0.22) return { goal: false, event: null };

  // Phase 1: Midfield Build-up
  const activeMid = midsAtt[Math.floor(Math.random() * midsAtt.length)] || attPlayers[0];
  const midDefending = defPlayers.reduce((sum, p) => sum + p.stats.defending, 0) / defPlayers.length;
  
  if (!runDuel(activeMid.stats.passing * 1.1, midDefending, 0.3)) {
    return { goal: false, event: null }; // Intercepted
  }

  // Phase 2: Final Third / Chance Creation
  const activeAttacker = [...fwdsAtt, ...midsAtt][Math.floor(Math.random() * (fwdsAtt.length + midsAtt.length))] || attPlayers[0];
  const activeDefender = defsDef[Math.floor(Math.random() * defsDef.length)] || defPlayers[0];

  // Restrict impact moments: only players >= 87 (impact > 1.3) have a very small chance (~3%) to trigger a life-changing moment per possession.
  // Over ~35 possessions per game, this happens maybe 1-2 times per team per game.
  const isAttackerImpact = (activeAttacker.impactCoefficient || 1) >= 1.35 && Math.random() < 0.03;
  const isDefenderImpact = (activeDefender.impactCoefficient || 1) >= 1.35 && Math.random() < 0.03;

  const isThroughBall = activeAttacker.stats.passing > 78 && Math.random() > 0.6;
  let attackStat = isThroughBall ? activeAttacker.stats.passing : activeAttacker.stats.dribbling;
  if (isAttackerImpact) attackStat *= 1.4; // Star moment
  else attackStat *= 1.05;
  
  let defendStat = activeDefender.stats.defending;
  if (isDefenderImpact) defendStat *= 1.4; // Star moment

  if (!runDuel(attackStat, defendStat, 0.25)) {
    if (isDefenderImpact) {
      return { goal: false, event: `🛡️ BRILLIANT DEFENDING! ${activeDefender.name} pulls off a last-ditch slide tackle to save ${defender.name}!` };
    }
    // Tackle happened. Check for foul/card
    if (Math.random() > 0.94) {
      const type = Math.random() > 0.9 ? 'R' : 'Y';
      return { goal: false, event: `💥 CRUNCHING TACKLE! ${activeDefender.name} stops ${activeAttacker.name} but sees ${type === 'R' ? '🟥 RED' : '🟨 YELLOW'}!`, foul: { player: activeDefender, type } };
    }
    return { goal: false, event: null };
  }

  // Phase 3: Finishing
  const gk = gksDef[0] || defPlayers[0];
  const isGkImpact = (gk.impactCoefficient || 1) >= 1.35 && Math.random() < 0.03;
  
  let shotStat = activeAttacker.stats.shooting * 1.15;
  if (isAttackerImpact) shotStat *= 1.4;

  let reflexStat = (gk.stats.gk_reflexes || gk.stats.defending);
  if (isGkImpact) reflexStat *= 1.4;

  const shotSuccess = runDuel(shotStat, reflexStat, 0.2);

  if (shotSuccess) {
    // Find assister randomly among eligible players
    const eligibleAssisters = attPlayers.filter(p => p.id !== activeAttacker.id && (p.position === 'MID' || p.position === 'FWD'));
    const assister = eligibleAssisters.length > 0 
      ? eligibleAssisters[Math.floor(Math.random() * eligibleAssisters.length)] 
      : undefined;
    
    let eventDesc = `⚽ GOAL! ${activeAttacker.name} drills it into the corner!`;
    if (isAttackerImpact && activeAttacker.position === 'FWD') {
      eventDesc = `🚀 SCREAMER! ${activeAttacker.name} blasts it from 30 yards out! Unstoppable!`;
    } else if (isAttackerImpact && activeAttacker.position === 'MID') {
      eventDesc = `🪄 MAGIC! ${activeAttacker.name} dances past three defenders and scores!`;
    } else if (isThroughBall) {
      eventDesc = `🎯 PERFECT PASS! ${assister?.name || 'A teammate'} splits the defense and ${activeAttacker.name} FINISHES!`;
    }

    return { goal: true, scorer: activeAttacker, assister, event: eventDesc };
  } else {
    if (isGkImpact) {
      return { goal: false, event: `🧱 UNBELIEVABLE! ${gk.name} pulls off a miraculous triple-save to deny ${activeAttacker.name}!` };
    }
    return { goal: false, event: `🧤 GREAT SAVE! ${gk.name} denies ${activeAttacker.name} from close range!` };
  }
};

// ─── Form modifier: last 5 games as ±10% ─────────────────────────────────────
const formModifier = (form: string[]): number => {
  if (!form || form.length === 0) return 1.0;
  const wins   = form.filter(x => x === 'W').length;
  const losses = form.filter(x => x === 'L').length;
  // +2% per win, -2% per loss (max last 5 → ±10%)
  return 1.0 + (wins * 0.02) - (losses * 0.02);
};

// ─── Morale modifier ─────────────────────────────────────────────────────────
const moraleModifier = (teamPlayers: Player[]): number => {
  if (teamPlayers.length === 0) return 1.0;
  const avgMorale = teamPlayers.reduce((s, p) => s + p.morale, 0) / teamPlayers.length;
  // 50 morale = 1.0, 100 morale = 1.05, 0 morale = 0.95
  return 1.0 + ((avgMorale - 50) / 50) * 0.05;
};

// ─── Weighted scorer selection ────────────────────────────────────────────────
// Weight FWDs by shooting^1.5 / 99^1.5, MIDs by shooting^0.7, DEFs near-zero
const buildScorerWeights = (teamPlayers: Player[]) => {
  return teamPlayers
    .filter(p => p.position !== 'GK')
    .map(p => {
      const shot = p.stats.shooting / 99;
      let weight = 0;
      if (p.position === 'FWD') weight = Math.pow(shot, 1.5) * 3.0;
      if (p.position === 'MID') weight = Math.pow(shot, 0.9) * 1.0;
      if (p.position === 'DEF') weight = Math.pow(shot, 2.0) * 0.15;
      return { player: p, weight: Math.max(weight, 0.01) };
    });
};

const buildAssisterWeights = (teamPlayers: Player[], scorerId: string) => {
  return teamPlayers
    .filter(p => p.position !== 'GK' && p.id !== scorerId)
    .map(p => {
      const creation = (p.stats.passing + p.stats.dribbling) / 2;
      // Add a large base weight (10) so anyone can realistically get the assist
      let weight = 10;
      // Add bonus scaling for position and skill
      if (p.position === 'MID') weight += (creation / 80) * 15;
      if (p.position === 'FWD') weight += (creation / 80) * 10;
      if (p.position === 'DEF') weight += (creation / 80) * 5;
      
      return { player: p, weight };
    });
};

const weightedRandom = <T>(items: { player: T; weight: number }[]): T => {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let rand = Math.random() * total;
  for (const item of items) {
    rand -= item.weight;
    if (rand <= 0) return item.player;
  }
  return items[items.length - 1].player;
};

// ─────────────────────────────────────────────────────────────────────────────

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
        // Generate objectives manually if not provided
        const objectives = userTeam ? generateBoardObjectives('C', userTeam.name) : [];

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
          const fixture = state.fixtures[fixtureId];
          if (!fixture || fixture.isPlayed) return state;

          const updatedPlayers = { ...state.players };
          const updatedTeams = { ...state.teams };

          const getTeamStarters = (teamId: string) => {
            let starters = Object.values(updatedPlayers).filter(p => p.teamId === teamId && p.isStarting && p.matchesSuspended === 0);
            if (starters.length === 0) {
              const team = updatedTeams[teamId];
              const lineupUpdates = autoAssignLineup(teamId, updatedPlayers, team.activeFormation);
              Object.keys(lineupUpdates).forEach(id => {
                 updatedPlayers[id] = { ...updatedPlayers[id], ...lineupUpdates[id] };
              });
              starters = Object.values(updatedPlayers).filter(p => p.teamId === teamId && p.isStarting && p.matchesSuspended === 0);
            }
            return starters;
          };

          const homeTeam = updatedTeams[fixture.homeTeamId];
          const awayTeam = updatedTeams[fixture.awayTeamId];
          const homeStarters = getTeamStarters(fixture.homeTeamId);
          const awayStarters = getTeamStarters(fixture.awayTeamId);

          let hScore = 0;
          let aScore = 0;

          // Run ~35 possessions (Major moments ~6-8 per game)
          const TOTAL_POSSESSIONS = 35;
          for (let i = 0; i < TOTAL_POSSESSIONS; i++) {
            const isHomeAttacking = i % 2 === 0;
            const attacker = isHomeAttacking ? homeTeam : awayTeam;
            const defender = isHomeAttacking ? awayTeam : homeTeam;
            const attPlayers = isHomeAttacking ? homeStarters : awayStarters;
            const defPlayers = isHomeAttacking ? awayStarters : homeStarters;

            const res = simulatePossession(attacker, defender, attPlayers, defPlayers);
            if (res.goal) {
              if (isHomeAttacking) hScore++; else aScore++;
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
          }

          // Clean sheets
          if (aScore === 0) {
            homeStarters.filter(p => p.position === 'GK' || p.position === 'DEF').forEach(p => {
              updatedPlayers[p.id].cleanSheets++;
            });
          }
          if (hScore === 0) {
            awayStarters.filter(p => p.position === 'GK' || p.position === 'DEF').forEach(p => {
              updatedPlayers[p.id].cleanSheets++;
            });
          }

          // Energy drain
          homeStarters.forEach(p => { updatedPlayers[p.id].energy = Math.max(0, updatedPlayers[p.id].energy - 25); });
          awayStarters.forEach(p => { updatedPlayers[p.id].energy = Math.max(0, updatedPlayers[p.id].energy - 25); });

          const updatedFixture = { ...fixture, homeScore: hScore, awayScore: aScore, isPlayed: true };

          const updateLog = (t: Team, gf: number, ga: number) => {
            const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
            const token = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
            return {
              ...t,
              played: t.played + 1,
              wins: t.wins + (gf > ga ? 1 : 0),
              draws: t.draws + (gf === ga ? 1 : 0),
              losses: t.losses + (gf < ga ? 1 : 0),
              goalsFor: t.goalsFor + gf,
              goalsAgainst: t.goalsAgainst + ga,
              points: t.points + pts,
              form: [...(t.form || []), token].slice(-5),
              lastStartingXI: (t.id === fixture.homeTeamId ? homeStarters : awayStarters).map(p => p.id)
            };
          };

          updatedTeams[homeTeam.id] = updateLog(homeTeam, hScore, aScore);
          updatedTeams[awayTeam.id] = updateLog(awayTeam, aScore, hScore);

          return { fixtures: { ...state.fixtures, [fixtureId]: updatedFixture }, teams: updatedTeams, players: updatedPlayers };
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
          const homeStarters = Object.values(updatedPlayers).filter(p => p.teamId === homeTeam.id && p.isStarting && p.matchesSuspended === 0);
          const awayStarters = Object.values(updatedPlayers).filter(p => p.teamId === awayTeam.id && p.isStarting && p.matchesSuspended === 0);

          if (homeStarters.length === 0 || awayStarters.length === 0) return state;

          // Energy drain: ~0.25 per minute
          [...homeStarters, ...awayStarters].forEach(p => {
            updatedPlayers[p.id].energy = Math.max(0, updatedPlayers[p.id].energy - 0.25);
          });

          // Simulate 1 possession per minute
          const isHomeAttacking = Math.random() > 0.5;
          const attacker = isHomeAttacking ? homeTeam : awayTeam;
          const defender = isHomeAttacking ? awayTeam : homeTeam;
          const attPlayers = isHomeAttacking ? homeStarters : awayStarters;
          const defPlayers = isHomeAttacking ? awayStarters : homeStarters;

          const res = simulatePossession(attacker, defender, attPlayers, defPlayers);
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

          // Clean sheets
          const hScore = fixture.homeScore || 0;
          const aScore = fixture.awayScore || 0;

          if (aScore === 0) {
            homeTeamPlayers.filter(p => p.position === 'GK' || p.position === 'DEF').forEach(p => {
              updatedPlayers[p.id] = { ...updatedPlayers[p.id], cleanSheets: updatedPlayers[p.id].cleanSheets + 1 };
            });
          }
          if (hScore === 0) {
            awayTeamPlayers.filter(p => p.position === 'GK' || p.position === 'DEF').forEach(p => {
              updatedPlayers[p.id] = { ...updatedPlayers[p.id], cleanSheets: updatedPlayers[p.id].cleanSheets + 1 };
            });
          }

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
          const playedFixtures = Object.values(state.fixtures).filter(f => f.week === state.currentWeek);
          const newNews: string[] = [];

          const bigWins = playedFixtures.filter(f => Math.abs((f.homeScore ?? 0) - (f.awayScore ?? 0)) >= 3);
          if (bigWins.length > 0) {
            const f = bigWins[Math.floor(Math.random() * bigWins.length)];
            const winner = (f.homeScore! > f.awayScore!) ? state.teams[f.homeTeamId] : state.teams[f.awayTeamId];
            const loser  = (f.homeScore! > f.awayScore!) ? state.teams[f.awayTeamId] : state.teams[f.homeTeamId];
            const ws = Math.max(f.homeScore!, f.awayScore!);
            const ls = Math.min(f.homeScore!, f.awayScore!);
            newNews.push(`${winner.name} thrashes ${loser.name} ${ws}-${ls}!`);
          }

          const allPlayers = Object.values(state.players);
          const updatedPlayers = { ...state.players };
          allPlayers.forEach(p => {
             const newEnergy = Math.min(100, p.energy + 15);
             const newSusp = Math.max(0, p.matchesSuspended - 1);
             if (newEnergy !== p.energy || newSusp !== p.matchesSuspended) {
               updatedPlayers[p.id] = { ...p, energy: newEnergy, matchesSuspended: newSusp };
             }
          });

          // Finance updates
          const updatedTeams = { ...state.teams };
          Object.values(updatedTeams).forEach(team => {
             // Calculate weekly wages
             const teamPlayers = allPlayers.filter(p => p.teamId === team.id);
             const weeklyWageTotalThousand = teamPlayers.reduce((sum, p) => sum + (p.wage || 0), 0);
             // 1000k = 1M
             const wageCostM = weeklyWageTotalThousand / 1000;
             let newBudget = team.budget - wageCostM;

             // Matchday revenue if they were home
             const homeFix = playedFixtures.find(f => f.homeTeamId === team.id);
             if (homeFix) {
                const revenueM = 1.0 + (team.points * 0.05); // Basic form-based revenue
                newBudget += revenueM;
             }
             
             updatedTeams[team.id] = { ...team, budget: newBudget };
          });


          const sortedByGoals = [...allPlayers].sort((a, b) => b.goals - a.goals);
          if (sortedByGoals.length > 0 && sortedByGoals[0].goals > 0) {
            const top = sortedByGoals[0];
            newNews.push(`${top.name} (${state.teams[top.teamId]?.name}) leads the golden boot with ${top.goals} goals.`);
            if (Math.random() > 0.5 && sortedByGoals.length > 2) {
              const other = sortedByGoals[1 + Math.floor(Math.random() * 3)];
              if (other && other.goals > 0) {
                newNews.push(`${other.name} continues his excellent form for ${state.teams[other.teamId]?.name}!`);
              }
            }
          } else if (playedFixtures.length > 0) {
            newNews.push(`Week ${state.currentWeek} concludes with intense scenes across the league.`);
          }

          if (state.currentWeek === 38) {
             Object.values(updatedPlayers).forEach(p => {
                if (p.age <= 24) {
                   p.overallRating += Math.floor(Math.random() * 3) + 1; // +1 to +3
                } else if (p.age >= 32) {
                   p.overallRating -= Math.floor(Math.random() * 2); // 0 to -1
                }
                p.age += 1;
                p.contractLeft = Math.max(0, p.contractLeft - 1);
             });
             newNews.push('The season has concluded! Check your squad for player growth and updates.');
          }

          return {
            currentWeek: state.currentWeek + 1,
            news: [...newNews, ...state.news].slice(0, 20),
            players: updatedPlayers,
            teams: updatedTeams,
          };
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

      setStrategy: (teamId, strategy) => {
        set((state) => {
          const team = state.teams[teamId];
          if (!team) return state;
          return { teams: { ...state.teams, [teamId]: { ...team, strategy } } };
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
        set(state => {
          const { players, teams, userTeamId } = state;
          const updatedPlayers = { ...players };
          const updatedTeams = { ...teams };
          
          Object.values(updatedPlayers).forEach(p => {
             if (p.teamId !== userTeamId && !p.isStarting && Math.random() < 0.05) {
                updatedPlayers[p.id] = { ...p, isTransferListed: true, askingPrice: p.marketValue };
             }
          });

          const listedPlayers = Object.values(updatedPlayers).filter(p => p.isTransferListed && p.teamId !== userTeamId && !p.isStarting);
          const aiTeams = Object.values(updatedTeams).filter(t => t.id !== userTeamId);

          aiTeams.forEach(team => {
             const teamPlayers = Object.values(updatedPlayers).filter(p => p.teamId === team.id && p.isStarting);
             if (teamPlayers.length === 0) return;
             const weakest = teamPlayers.sort((a, b) => a.overallRating - b.overallRating)[0];
             
             const targets = listedPlayers.filter(p => 
               (p.position === weakest.position || p.subPosition === weakest.subPosition) && 
               p.overallRating > weakest.overallRating && 
               team.budget >= p.askingPrice &&
               p.teamId !== team.id
             );
             
             if (targets.length > 0) {
                const target = targets.sort((a,b) => b.overallRating - a.overallRating)[0];
                if (Math.random() < 0.3) {
                   updatedTeams[team.id] = { ...team, budget: team.budget - target.askingPrice };
                   if (updatedTeams[target.teamId]) {
                      updatedTeams[target.teamId] = { ...updatedTeams[target.teamId], budget: updatedTeams[target.teamId].budget + target.askingPrice };
                   }
                   updatedPlayers[target.id] = { ...target, teamId: team.id, isTransferListed: false, askingPrice: 0, isStarting: false, isSub: false };
                }
             }
          });

          return { players: updatedPlayers, teams: updatedTeams };
        });
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
