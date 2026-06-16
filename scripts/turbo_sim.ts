import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';

async function runTurboSim(seasons = 500) {
  console.log(`\nSTARTING TURBO SIMULATION (${seasons} seasons)`);
  console.log('-----------------------------------------------');

  const startTime = Date.now();
  let totalMatches = 0;

  for (let season = 1; season <= seasons; season++) {
    try {
      const data = initGameData();
      let state = {
        players: data.players,
        teams: data.teams,
        fixtures: data.fixtures,
        currentWeek: 1,
        news: [] as string[],
      };
      const seasonWeeks = getSeasonWeekLimit(state.fixtures);

      for (let week = 1; week <= seasonWeeks; week++) {
        const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);

        for (const fixture of weekFixtures) {
          const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures);
          state.players = result.players;
          state.teams = result.teams;
          state.fixtures[fixture.id] = result.fixture;
          totalMatches++;
        }

        const progression = computeWeeklyProgression(
          state.currentWeek,
          state.players,
          state.teams,
          state.fixtures,
          state.news
        );
        state.players = progression.players;
        state.teams = progression.teams;
        state.currentWeek = progression.currentWeek;
        state.news = progression.news;

        const transfers = computeWeeklyTransfers(state.players, state.teams, null);
        state.players = transfers.players;
        state.teams = transfers.teams;
      }

      if (season % 50 === 0 || season === seasons) {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`[OK] Season ${season}/${seasons} | Elapsed: ${elapsed.toFixed(2)}s | Matches: ${totalMatches}`);
      }
    } catch (error) {
      console.error(`[FAIL] Season ${season} failed:`, error);
    }
  }

  const finalTime = (Date.now() - startTime) / 1000;
  console.log('-----------------------------------------------');
  console.log('TURBO SIM COMPLETE');
  console.log(`Total time: ${finalTime.toFixed(2)}s`);
  console.log(`Speed: ${(totalMatches / finalTime).toFixed(0)} matches/second`);
  console.log(`Average season: ${(finalTime / seasons * 1000).toFixed(0)}ms`);
}

const seasons = Number(process.env.TURBO_SEASONS ?? 500);
runTurboSim(Number.isFinite(seasons) && seasons > 0 ? seasons : 500).catch(error => {
  console.error('[FAIL] Turbo simulation failed:', error);
  process.exit(1);
});
