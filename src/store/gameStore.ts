import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameState, Team, Player, Fixture, Formation } from '../models/types';
import { initGameData } from '../utils/initGame';

interface GameStore extends GameState {
  initializeGame: (userTeamId: string) => void;
  advanceWeek: () => void;
  playMatch: (fixtureId: string) => void;
  setFormation: (teamId: string, formation: Formation) => void;
  toggleStarting: (playerId: string) => void;
  markAsSub: (playerId: string) => void;
  setStrategy: (teamId: string, strategy: 'defend' | 'balanced' | 'attack') => void;
  swapPlayer: (removeId: string | null, addId: string) => void;
  skipToEndOfSeason: () => void;
  changeTeam: (teamId: string) => void;
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

// ─── Compute team's attack/defense strengths from its starting XI ─────────────
const computeTeamStrengths = (teamPlayers: Player[], strategy: 'defend' | 'balanced' | 'attack') => {
  const gks  = teamPlayers.filter(p => p.position === 'GK');
  const defs = teamPlayers.filter(p => p.position === 'DEF');
  const mids = teamPlayers.filter(p => p.position === 'MID');
  const fwds = teamPlayers.filter(p => p.position === 'FWD');

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 50;

  // ── Attack potential: FWD finishing ability × MID chance creation ──
  const fwdShooting   = avg(fwds.map(p => p.stats.shooting));
  const fwdRating     = avg(fwds.map(p => p.overallRating));
  const midPassing    = avg(mids.map(p => p.stats.passing));
  const midDribbling  = avg(mids.map(p => p.stats.dribbling));

  // Creation quality 0.5–1.3 (normalised from FIFA stats 1–99)
  const midCreation   = clamp((midPassing + midDribbling) / (2 * 99) * 1.8, 0.5, 1.3);

  // Raw attack power 0–3.8 (peaks only for elite FWDs with elite MID support)
  const rawAttack     = (fwdShooting / 99) * (fwdRating / 99) * midCreation * 3.8;

  // ── Defense suppression 0.35–1.0 ──
  const defAvg        = avg(defs.map(p => p.stats.defending));
  const gkReflex      = avg(gks.map(p => p.stats.gk_reflexes ?? p.stats.defending));
  const midDefending  = avg(mids.map(p => p.stats.defending));

  const rawDef        = 0.35
    + (defAvg  / 99) * 0.35   // backline quality
    + (gkReflex / 99) * 0.20  // keeper saves
    + (midDefending / 99) * 0.10; // pressing intensity

  // ── Strategy multipliers ──
  let attackMult = 1.0;
  let defMult    = 1.0;
  if (strategy === 'attack')  { attackMult = 1.30; defMult = 0.75; }
  if (strategy === 'defend')  { attackMult = 0.65; defMult = 1.35; }

  return {
    attack: rawAttack * attackMult,
    defense: clamp(rawDef * defMult, 0.25, 1.0),
  };
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
      const creation = (p.stats.passing + p.stats.dribbling) / (2 * 99);
      let weight = 0;
      if (p.position === 'MID') weight = creation * 2.5;
      if (p.position === 'FWD') weight = creation * 1.2;
      if (p.position === 'DEF') weight = creation * 0.3;
      return { player: p, weight: Math.max(weight, 0.01) };
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

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      currentWeek: 1,
      userTeamId: null,
      teams: {},
      players: {},
      fixtures: {},
      news: [],

      initializeGame: (userTeamId) => {
        const data = initGameData();
        
        // Clear starters for the user's team so they stay in reserves
        Object.values(data.players).forEach(p => {
          if (p.teamId === userTeamId) {
            p.isStarting = false;
            p.isSub = false;
          }
        });

        set({
          userTeamId,
          currentWeek: 1,
          teams: data.teams,
          players: data.players,
          fixtures: data.fixtures,
          news: ['Season begins! The Premier League simulation is underway.'],
        });
      },

      playMatch: (fixtureId: string) => {
        set((state) => {
          const fixture = state.fixtures[fixtureId];
          if (!fixture || fixture.isPlayed) return state;

          const homeTeam = state.teams[fixture.homeTeamId];
          const awayTeam = state.teams[fixture.awayTeamId];

          const homeTeamPlayers = Object.values(state.players).filter(p => p.teamId === homeTeam.id && p.isStarting);
          const awayTeamPlayers = Object.values(state.players).filter(p => p.teamId === awayTeam.id && p.isStarting);

          // ── Compute strengths ──
          const homeStrategy = homeTeam.strategy || 'balanced';
          const awayStrategy = awayTeam.strategy  || 'balanced';

          const homeStr = computeTeamStrengths(homeTeamPlayers, homeStrategy);
          const awayStr = computeTeamStrengths(awayTeamPlayers, awayStrategy);

          // ── Modifiers ──
          const homeFormMod   = formModifier(homeTeam.form);
          const awayFormMod   = formModifier(awayTeam.form);
          const homeMoraleMod = moraleModifier(homeTeamPlayers);
          const awayMoraleMod = moraleModifier(awayTeamPlayers);
          const homeAdvantage = 1.08; // home ground +8%

          // ── Expected goals (lambda) ──
          // Home attack vs Away defense, scaled by modifiers
          const homeLambdaRaw = (homeStr.attack / awayStr.defense) * homeFormMod * homeMoraleMod * homeAdvantage;
          const awayLambdaRaw = (awayStr.attack / homeStr.defense) * awayFormMod * awayMoraleMod;

          // Scale into realistic range: ratio=1.0 (equal teams) → lambda ~1.2
          const homeLambda = clamp(homeLambdaRaw * 0.55, 0.15, 6.0);
          const awayLambda = clamp(awayLambdaRaw * 0.55, 0.15, 6.0);

          const homeScore = poissonSample(homeLambda);
          const awayScore = poissonSample(awayLambda);

          // ── Update player stats ──
          const updatedPlayers = { ...state.players };

          const assignGoalsAndAssists = (score: number, teamPlayers: Player[]) => {
            if (score === 0 || teamPlayers.length === 0) return;
            const scorerWeights  = buildScorerWeights(teamPlayers);
            const for1 = (n: number) => Array.from({ length: n });

            for1(score).forEach(() => {
              const scorer = weightedRandom(scorerWeights);
              updatedPlayers[scorer.id] = { ...updatedPlayers[scorer.id], goals: updatedPlayers[scorer.id].goals + 1 };

              // ~70% chance of an assist
              if (Math.random() < 0.70) {
                const assistWeights = buildAssisterWeights(teamPlayers, scorer.id);
                if (assistWeights.length > 0) {
                  const assister = weightedRandom(assistWeights);
                  updatedPlayers[assister.id] = { ...updatedPlayers[assister.id], assists: updatedPlayers[assister.id].assists + 1 };
                }
              }
            });
          };

          assignGoalsAndAssists(homeScore, homeTeamPlayers);
          assignGoalsAndAssists(awayScore, awayTeamPlayers);

          // ── Cards — GKs very rarely booked (97% threshold), outfield 85% ──
          const assignCards = (teamPlayers: Player[]) => {
            teamPlayers.forEach(p => {
              const yellowThreshold = p.position === 'GK' ? 0.97 : 0.85;
              const redThreshold    = p.position === 'GK' ? 0.998 : 0.990;
              if (Math.random() > yellowThreshold) {
                updatedPlayers[p.id] = { ...updatedPlayers[p.id], yellowCards: updatedPlayers[p.id].yellowCards + 1 };
              }
              if (Math.random() > redThreshold) {
                updatedPlayers[p.id] = { ...updatedPlayers[p.id], redCards: updatedPlayers[p.id].redCards + 1 };
              }
            });
          };
          assignCards(homeTeamPlayers);
          assignCards(awayTeamPlayers);

          // ── Clean sheets ──
          if (awayScore === 0) {
            homeTeamPlayers.filter(p => p.position === 'GK' || p.position === 'DEF').forEach(p => {
              updatedPlayers[p.id] = { ...updatedPlayers[p.id], cleanSheets: updatedPlayers[p.id].cleanSheets + 1 };
            });
          }
          if (homeScore === 0) {
            awayTeamPlayers.filter(p => p.position === 'GK' || p.position === 'DEF').forEach(p => {
              updatedPlayers[p.id] = { ...updatedPlayers[p.id], cleanSheets: updatedPlayers[p.id].cleanSheets + 1 };
            });
          }

          const updatedFixture = { ...fixture, homeScore, awayScore, isPlayed: true };

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
            [homeTeam.id]: { ...updateTeamStats(homeTeam, homeScore, awayScore), lastStartingXI: homeTeamPlayers.map(p => p.id) },
            [awayTeam.id]: { ...updateTeamStats(awayTeam, awayScore, homeScore), lastStartingXI: awayTeamPlayers.map(p => p.id) },
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

          return {
            currentWeek: state.currentWeek + 1,
            news: [...newNews, ...state.news].slice(0, 20),
          };
        });
      },

      setFormation: (teamId, formation) => {
        set((state) => {
          const team = state.teams[teamId];
          if (!team) return state;

          const updatedTeam = { ...team, activeFormation: formation };

          // Parse formation numbers — strip variant labels (e.g. '4-3-3 Attack' → '4-3-3')
          const baseFmt = formation.split(' ')[0];
          const parts   = baseFmt.split('-').map(n => parseInt(n, 10));
          const reqDef  = parts[0];
          const reqFwd  = parts[parts.length - 1];
          let reqMid = 0;
          for (let i = 1; i < parts.length - 1; i++) reqMid += parts[i];

          const teamPlayers = Object.values(state.players)
            .filter(p => p.teamId === teamId)
            .sort((a, b) => b.overallRating - a.overallRating);

          let gkCount = 0, defCount = 0, midCount = 0, fwdCount = 0;
          const updatedPlayers = { ...state.players };

          // Reset all to non-starting
          teamPlayers.forEach(p => { updatedPlayers[p.id] = { ...p, isStarting: false }; });

          // Fill slots: best by rating per position
          teamPlayers.forEach(p => {
            if (p.position === 'GK'  && gkCount  < 1)      { updatedPlayers[p.id] = { ...updatedPlayers[p.id], isStarting: true }; gkCount++; }
            if (p.position === 'DEF' && defCount < reqDef)  { updatedPlayers[p.id] = { ...updatedPlayers[p.id], isStarting: true }; defCount++; }
            if (p.position === 'MID' && midCount < reqMid)  { updatedPlayers[p.id] = { ...updatedPlayers[p.id], isStarting: true }; midCount++; }
            if (p.position === 'FWD' && fwdCount < reqFwd)  { updatedPlayers[p.id] = { ...updatedPlayers[p.id], isStarting: true }; fwdCount++; }
          });

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

          if (player.isStarting) {
            return {
              players: { ...state.players, [playerId]: { ...player, isStarting: false, isSub: true } }
            };
          } else {
            if (starters.length >= 11) {
              const toSwap = starters.filter(p => p.position === player.position)
                .sort((a, b) => a.overallRating - b.overallRating)[0]
                || starters.sort((a, b) => a.overallRating - b.overallRating)[0];
              return {
                players: {
                  ...state.players,
                  [toSwap.id]:   { ...toSwap,  isStarting: false, isSub: true },
                  [playerId]:    { ...player,  isStarting: true,  isSub: false },
                }
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
        // Simulate all remaining unplayed fixtures week by week
        const state = get();
        const allFixtures = Object.values(state.fixtures);
        const maxWeek = allFixtures.reduce((max, f) => Math.max(max, f.week), 0);
        let week = state.currentWeek;
        while (week <= maxWeek) {
          const weekFixtures = Object.values(get().fixtures).filter(f => f.week === week && !f.isPlayed);
          weekFixtures.forEach(fix => get().playMatch(fix.id));
          week++;
        }
        set((state) => ({
          currentWeek: maxWeek + 1,
          news: ['Season complete! Check the league table for final standings.', ...state.news].slice(0, 20),
        }));
      },

      swapPlayer: (removeId: string | null, addId: string) => {
        set(state => {
          const updates: Record<string, typeof state.players[string]> = {};
          if (removeId && state.players[removeId]) {
            updates[removeId] = { ...state.players[removeId], isStarting: false };
          }
          if (state.players[addId]) {
            updates[addId] = { ...state.players[addId], isStarting: true, isSub: false };
          }
          return { players: { ...state.players, ...updates } };
        });
      },

      changeTeam: (teamId: string) => {
        set({ userTeamId: teamId });
      },
    }),
    {
      name: 'football-manager-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
