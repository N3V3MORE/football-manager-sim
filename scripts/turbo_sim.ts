import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { Player, Team, Fixture } from '../src/models/types';

/**
 * TURBO SIMULATION RUNNER
 * Bypasses Zustand and React-Native to achieve maximum IPC (Instructions Per Cycle).
 */

async function runTurboSim(seasons = 500) {
  console.log(`\n🚀 STARTING TURBO SIMULATION (${seasons} Seasons)`);
  console.log(`-----------------------------------------------`);
  
  const startTime = Date.now();
  let totalMatches = 0;

  for (let s = 1; s <= seasons; s++) {
    const seasonStart = Date.now();
    
    // 1. Init Season
    const data = initGameData();
    let state = {
      players: data.players,
      teams: data.teams,
      fixtures: data.fixtures,
      currentWeek: 1,
      news: [] as string[]
    };

    // 2. Play 38 Weeks
    for (let w = 1; w <= 38; w++) {
      const weekFixtures = Object.values(state.fixtures).filter(f => f.week === w);
      
      // Play all matches for the week
      for (const fix of weekFixtures) {
        const result = quickSimMatch(fix.id, state.players, state.teams, state.fixtures);
        state.players = result.players;
        state.teams = result.teams;
        state.fixtures[fix.id] = result.fixture;
        totalMatches++;
      }

      // Progression & Transfers (End of Week)
      const prog = computeWeeklyProgression(state.currentWeek, state.players, state.teams, state.fixtures, state.news);
      state.players = prog.players;
      state.teams = prog.teams;
      state.currentWeek = prog.currentWeek;
      state.news = prog.news;

      const trans = computeWeeklyTransfers(state.players, state.teams, null);
      state.players = trans.players;
      state.teams = trans.teams;
    }

    if (s % 50 === 0 || s === seasons) {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`✅ Season ${s}/${seasons} | Elapsed: ${elapsed.toFixed(2)}s | Matches: ${totalMatches}`);
    }
  }

  const finalTime = (Date.now() - startTime) / 1000;
  console.log(`-----------------------------------------------`);
  console.log(`🏆 TURBO SIM COMPLETE!`);
  console.log(`⏱️  Total Time: ${finalTime.toFixed(2)}s`);
  console.log(`📈 Speed: ${(totalMatches / finalTime).toFixed(0)} matches/second`);
  console.log(`⚡ Avg Season: ${(finalTime / seasons * 1000).toFixed(0)}ms`);
}

runTurboSim(500).catch(console.error);
