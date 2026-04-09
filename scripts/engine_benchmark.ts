import { performance } from 'perf_hooks';
import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { advanceCupCompetitions } from '../src/core/cupUtils';
import { advanceSeason } from '../src/core/seasonTransition';
import {
  appendRuntimeFixtures,
  buildSimulationRuntime,
  getRuntimeFixturesForWeek,
  refreshRuntimeTeamPlayerIds,
  refreshRuntimeTeamsByLeague,
  SimulationRuntime,
} from '../src/core/simulationRuntime';
import { createEmptyTrophyCabinet } from '../src/core/trophyUtils';
import { getFixtureCompetitionId, isLeagueCompetitionId } from '../src/core/domainRegistry';

type BenchmarkState = ReturnType<typeof initGameData> & {
  currentWeek: number;
  season: number;
  news: string[];
};

type PhaseTotals = {
  matchSimMs: number;
  cupProgressionMs: number;
  progressionMs: number;
  transferMs: number;
  seasonTransitionMs: number;
  totalMatches: number;
};

const DEFAULT_BENCH_SEASONS = [10, 50];
const DEFAULT_BENCHMARK_SEED = 20260408;

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const measurePhase = <T,>(totals: PhaseTotals, phase: keyof Omit<PhaseTotals, 'totalMatches'>, task: () => T) => {
  const start = performance.now();
  const result = task();
  totals[phase] += performance.now() - start;
  return result;
};

const getNextFixtureCounter = (fixtures: Record<string, unknown>) => (
  Object.keys(fixtures).reduce((max, fixtureId) => {
    const numericId = Number(fixtureId.slice(1));
    return Number.isFinite(numericId) && numericId > max ? numericId : max;
  }, 0) + 1
);

const shouldProcessCupProgression = (
  state: BenchmarkState,
  runtime: SimulationRuntime
) => (
  getRuntimeFixturesForWeek(runtime, state.fixtures, state.currentWeek)
    .some(fixture => !isLeagueCompetitionId(getFixtureCompetitionId(fixture))) ||
  Object.values(state.cups).some(cup => !cup.completed && cup.scheduledWeek <= state.currentWeek)
);

const createBenchmarkState = (): BenchmarkState => {
  const data = initGameData();
  return {
    ...data,
    currentWeek: 1,
    season: 1,
    news: [],
  };
};

const runSingleBenchmark = (seasonCount: number, seed: number) => {
  const totals: PhaseTotals = {
    matchSimMs: 0,
    cupProgressionMs: 0,
    progressionMs: 0,
    transferMs: 0,
    seasonTransitionMs: 0,
    totalMatches: 0,
  };
  const originalRandom = Math.random;
  Math.random = createSeededRandom(seed);
  const startedAt = performance.now();

  try {
    for (let seasonIndex = 0; seasonIndex < seasonCount; seasonIndex += 1) {
      let state = createBenchmarkState();
      let runtime = buildSimulationRuntime(state, Math.random);
      const targetSeason = state.season;

      while (state.season === targetSeason) {
        const weekFixtures = getRuntimeFixturesForWeek(runtime, state.fixtures, state.currentWeek);
        measurePhase(totals, 'matchSimMs', () => {
          weekFixtures.forEach(fixture => {
            if (fixture.isPlayed) return;
            const result = quickSimMatch(
              fixture.id,
              state.players,
              state.teams,
              state.fixtures,
              null,
              { captureEvents: false, runtime, random: Math.random }
            );
            state.players = result.players;
            state.teams = result.teams;
            state.fixtures = { ...state.fixtures, [fixture.id]: result.fixture };
            totals.totalMatches += 1;
          });
        });

        if (shouldProcessCupProgression(state, runtime)) {
          measurePhase(totals, 'cupProgressionMs', () => {
            const previousFixtures = state.fixtures;
            const cupProgression = advanceCupCompetitions(
              state.fixtures,
              state.cups,
              state.currentWeek,
              getNextFixtureCounter(state.fixtures)
            );
            appendRuntimeFixtures(runtime, previousFixtures, cupProgression.fixtures);
            state.fixtures = cupProgression.fixtures;
            state.cups = cupProgression.cupStates;
          });
        }

        const progression = measurePhase(totals, 'progressionMs', () => (
          computeWeeklyProgression(
            state.currentWeek,
            state.players,
            state.teams,
            state.fixtures,
            state.news,
            null,
            { generateNews: false, runtime }
          )
        ));
        state.players = progression.players;
        state.teams = progression.teams;
        state.currentWeek = progression.currentWeek;
        state.news = progression.news;

        const transfers = measurePhase(totals, 'transferMs', () => (
          computeWeeklyTransfers(state.players, state.teams, null)
        ));
        state.players = transfers.players;
        state.teams = transfers.teams;
        refreshRuntimeTeamPlayerIds(runtime, state.players);
        refreshRuntimeTeamsByLeague(runtime, state.teams);

        const seasonWeekLimit = getSeasonWeekLimit(state.fixtures);
        if (state.currentWeek > seasonWeekLimit) {
          const seasonTransition = measurePhase(totals, 'seasonTransitionMs', () => (
            advanceSeason(
              state.players,
              state.teams,
              state.fixtures,
              state.cups,
              null,
              state.news,
              state.season,
              createEmptyTrophyCabinet(),
              [],
              []
            )
          ));
          state = {
            ...state,
            ...seasonTransition,
            news: seasonTransition.news,
          };
          runtime = buildSimulationRuntime(state, Math.random);
        }
      }
    }
  } finally {
    Math.random = originalRandom;
  }

  const totalMs = performance.now() - startedAt;
  return { seasonCount, seed, totalMs, totals };
};

const formatMs = (value: number) => `${value.toFixed(1)}ms`;

const reportBenchmark = (seasonCount: number, seed: number) => {
  const result = runSingleBenchmark(seasonCount, seed);
  const totalPhaseMs =
    result.totals.matchSimMs +
    result.totals.cupProgressionMs +
    result.totals.progressionMs +
    result.totals.transferMs +
    result.totals.seasonTransitionMs;

  console.log(`\n--- ENGINE BENCHMARK (${seasonCount} seasons, seed ${seed}) ---`);
  console.log(`Total time: ${formatMs(result.totalMs)}`);
  console.log(`Matches: ${result.totals.totalMatches}`);
  console.log(`Speed: ${(result.totals.totalMatches / Math.max(0.001, result.totalMs / 1000)).toFixed(0)} matches/sec`);
  console.log(`Avg season: ${formatMs(result.totalMs / seasonCount)}`);
  console.log(`Match sim: ${formatMs(result.totals.matchSimMs)}`);
  console.log(`Cup progression: ${formatMs(result.totals.cupProgressionMs)}`);
  console.log(`Weekly progression: ${formatMs(result.totals.progressionMs)}`);
  console.log(`Transfers: ${formatMs(result.totals.transferMs)}`);
  console.log(`Season transition: ${formatMs(result.totals.seasonTransitionMs)}`);
  console.log(`Accounted engine time: ${formatMs(totalPhaseMs)}`);
};

const benchmarkSeasons = (process.env.BENCH_SEASONS || '')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isFinite(value) && value > 0);
const seasonTargets = benchmarkSeasons.length > 0 ? benchmarkSeasons : DEFAULT_BENCH_SEASONS;
const seed = Number(process.env.BENCH_SEED ?? DEFAULT_BENCHMARK_SEED);

seasonTargets.forEach(seasonCount => reportBenchmark(seasonCount, seed));
