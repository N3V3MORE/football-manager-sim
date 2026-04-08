import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { advanceCupCompetitions } from '../src/core/cupUtils';
import { getFixtureCompetitionId, isLeagueCompetitionId } from '../src/core/domainRegistry';
import {
  appendRuntimeFixtures,
  buildSimulationRuntime,
  getRuntimeFixturesForWeek,
  refreshRuntimeTeamPlayerIds,
  refreshRuntimeTeamsByLeague,
} from '../src/core/simulationRuntime';

const getNextFixtureCounter = (fixtures: Record<string, unknown>) => (
  Object.keys(fixtures).reduce((max, fixtureId) => {
    const numericId = Number(fixtureId.slice(1));
    return Number.isFinite(numericId) && numericId > max ? numericId : max;
  }, 0) + 1
);

async function runTurboSim(seasons = 500) {
  console.log(`\nSTARTING TURBO SIMULATION (${seasons} seasons)`);
  console.log('-----------------------------------------------');

  const startTime = Date.now();
  let totalMatches = 0;

  for (let season = 1; season <= seasons; season++) {
    const data = initGameData();
    let state = {
      players: data.players,
      teams: data.teams,
      fixtures: data.fixtures,
      cups: data.cups,
      currentWeek: 1,
      news: [] as string[],
    };
    let runtime = buildSimulationRuntime(state);
    const seasonWeeks = getSeasonWeekLimit(state.fixtures);

    for (let week = 1; week <= seasonWeeks; week++) {
      const weekFixtures = getRuntimeFixturesForWeek(runtime, state.fixtures, week);

      for (const fixture of weekFixtures) {
        const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, null, {
          captureEvents: false,
          runtime,
        });
        state.players = result.players;
        state.teams = result.teams;
        state.fixtures[fixture.id] = result.fixture;
        totalMatches++;
      }

      const shouldProcessCupProgression = weekFixtures.some(fixture => !isLeagueCompetitionId(getFixtureCompetitionId(fixture))) ||
        Object.values(state.cups).some(cup => !cup.completed && cup.scheduledWeek <= week);
      if (shouldProcessCupProgression) {
        const previousFixtures = state.fixtures;
        const cupProgression = advanceCupCompetitions(
          state.fixtures,
          state.cups,
          week,
          getNextFixtureCounter(state.fixtures)
        );
        appendRuntimeFixtures(runtime, previousFixtures, cupProgression.fixtures);
        state.fixtures = cupProgression.fixtures;
        state.cups = cupProgression.cupStates;
      }

      const progression = computeWeeklyProgression(
        state.currentWeek,
        state.players,
        state.teams,
        state.fixtures,
        state.news,
        null,
        { generateNews: false, runtime }
      );
      state.players = progression.players;
      state.teams = progression.teams;
      state.currentWeek = progression.currentWeek;
      state.news = progression.news;

      const transfers = computeWeeklyTransfers(state.players, state.teams, null);
      state.players = transfers.players;
      state.teams = transfers.teams;
      refreshRuntimeTeamPlayerIds(runtime, state.players);
      refreshRuntimeTeamsByLeague(runtime, state.teams);
    }

    if (season % 50 === 0 || season === seasons) {
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`[OK] Season ${season}/${seasons} | Elapsed: ${elapsed.toFixed(2)}s | Matches: ${totalMatches}`);
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
