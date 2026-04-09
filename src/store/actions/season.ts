import { StoreApi } from 'zustand';
import { evaluateBoardObjectives } from '../../core/boardUtils';
import { advanceCupCompetitions } from '../../core/cupUtils';
import { getFixtureCompetitionId, getTeamLeagueId, isLeagueCompetitionId } from '../../core/domainRegistry';
import { getSeasonWeekLimit } from '../../core/leagueUtils';
import { quickSimMatch } from '../../core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../../core/progressionEngine';
import { advanceSeason } from '../../core/seasonTransition';
import {
  appendRuntimeFixtures,
  buildSimulationRuntime,
  getRuntimeFixturesForWeek,
  refreshRuntimeTeamPlayerIds,
  refreshRuntimeTeamsByLeague,
  SimulationRuntime,
} from '../../core/simulationRuntime';
import { createEmptyTrophyCabinet, ensureTrophyCabinetShape } from '../../core/trophyUtils';
import { buildDefaultUserTactics, generateBoardObjectives, initGameData } from '../../utils/initGame';
import { pauseGamePersistence, resumeGamePersistence } from '../setup';
import { GameStore } from '../types';

type SetState = StoreApi<GameStore>['setState'];
type GetState = StoreApi<GameStore>['getState'];

const SKIP_SEASON_MAX_GUARD_WEEKS = 80;
let activeSeasonSkipJobId = 0;

const getNextFixtureCounter = (fixtures: Record<string, unknown>) => (
  Object.keys(fixtures).reduce((max, fixtureId) => {
    const numericId = Number(fixtureId.slice(1));
    return Number.isFinite(numericId) && numericId > max ? numericId : max;
  }, 0) + 1
);

const shouldProcessCupProgression = (
  fixtures: SeasonSimulationState['fixtures'],
  cups: SeasonSimulationState['cups'],
  currentWeek: number,
  runtime: SimulationRuntime
) => (
  getRuntimeFixturesForWeek(runtime, fixtures, currentWeek).some(fixture => !isLeagueCompetitionId(getFixtureCompetitionId(fixture))) ||
  Object.values(cups).some(cup => !cup.completed && cup.scheduledWeek <= currentWeek)
);

type SeasonSimulationState = Pick<
  GameStore,
  | 'currentWeek'
  | 'season'
  | 'players'
  | 'teams'
  | 'fixtures'
  | 'cups'
  | 'news'
  | 'userTeamId'
  | 'boardObjectives'
  | 'trophyCabinet'
  | 'trophyHistory'
  | 'seasonResults'
  | 'liveMatches'
>;

const simulateWeekState = (
  state: SeasonSimulationState,
  options?: {
    generateNews?: boolean;
    captureEvents?: boolean;
    runtime?: SimulationRuntime;
  }
): { state: SeasonSimulationState; runtime: SimulationRuntime } => {
  const generateNews = options?.generateNews ?? true;
  const captureEvents = options?.captureEvents ?? true;
  const runtime = options?.runtime || buildSimulationRuntime(state);
  let nextPlayers = state.players;
  let nextTeams = state.teams;
  let nextFixtures = state.fixtures;
  let nextCups = state.cups;

  const weekFixtures = getRuntimeFixturesForWeek(runtime, nextFixtures, state.currentWeek);
  weekFixtures.forEach(fixture => {
    if (fixture.isPlayed) return;
    const result = quickSimMatch(
      fixture.id,
      nextPlayers,
      nextTeams,
      nextFixtures,
      state.userTeamId,
      { captureEvents, runtime }
    );
    nextPlayers = result.players;
    nextTeams = result.teams;
    nextFixtures = { ...nextFixtures, [fixture.id]: result.fixture };
  });

  if (shouldProcessCupProgression(nextFixtures, nextCups, state.currentWeek, runtime)) {
    const previousFixtures = nextFixtures;
    const cupProgression = advanceCupCompetitions(
      nextFixtures,
      nextCups,
      state.currentWeek,
      getNextFixtureCounter(nextFixtures)
    );
    appendRuntimeFixtures(runtime, previousFixtures, cupProgression.fixtures);
    nextFixtures = cupProgression.fixtures;
    nextCups = cupProgression.cupStates;
  }

  const progression = computeWeeklyProgression(
    state.currentWeek,
    nextPlayers,
    nextTeams,
    nextFixtures,
    state.news,
    state.userTeamId,
    { generateNews, runtime }
  );
  nextPlayers = progression.players;
  nextTeams = progression.teams;

  const transfers = computeWeeklyTransfers(nextPlayers, nextTeams, state.userTeamId);
  nextPlayers = transfers.players;
  nextTeams = transfers.teams;
  refreshRuntimeTeamPlayerIds(runtime, nextPlayers);
  refreshRuntimeTeamsByLeague(runtime, nextTeams);

  const boardOutcome = evaluateBoardObjectives(nextTeams, state.boardObjectives, state.userTeamId);
  nextTeams = boardOutcome.teams;

  const seasonWeekLimit = getSeasonWeekLimit(nextFixtures);
  if (progression.currentWeek > seasonWeekLimit) {
    const advancedSeasonState = advanceSeason(
      nextPlayers,
      nextTeams,
      nextFixtures,
      nextCups,
      state.userTeamId,
      progression.news,
      state.season || 1,
      ensureTrophyCabinetShape(state.trophyCabinet),
      state.trophyHistory || [],
      state.seasonResults || []
    );
    return {
      state: {
        ...state,
        ...advancedSeasonState,
        userTeamId: state.userTeamId,
        liveMatches: {},
      },
      runtime: buildSimulationRuntime({
        teams: advancedSeasonState.teams,
        players: advancedSeasonState.players,
        fixtures: advancedSeasonState.fixtures,
      }, runtime.random),
    };
  }

  return {
    state: {
      ...state,
      currentWeek: progression.currentWeek,
      players: nextPlayers,
      teams: nextTeams,
      fixtures: nextFixtures,
      cups: nextCups,
      news: progression.news,
      boardObjectives: boardOutcome.boardObjectives,
    },
    runtime,
  };
};

export const createSeasonActions = (set: SetState, get: GetState): Pick<GameStore, 'initializeGame' | 'advanceWeek' | 'advanceMultipleWeeks' | 'skipToEndOfSeason' | 'changeTeam'> => ({
  initializeGame: (userTeamId) => {
    activeSeasonSkipJobId += 1;
    const data = initGameData();
    const actualTeamId = userTeamId === 'temp' ? Object.keys(data.teams)[0] : userTeamId;

    Object.values(data.players).forEach(player => {
      if (player.teamId === actualTeamId) {
        player.isStarting = false;
        player.isSub = false;
      }
    });

    const userTeam = data.teams[actualTeamId];
    if (userTeam) {
      data.teams[actualTeamId] = {
        ...userTeam,
        tactics: buildDefaultUserTactics(),
      };
    }

    const teamClass = data.teamClasses[actualTeamId] || 'C';
    const objectives = userTeam ? generateBoardObjectives(teamClass, getTeamLeagueId(userTeam)) : [];

    set({
      userTeamId: actualTeamId,
      currentWeek: 1,
      season: 1,
      teams: data.teams,
      players: data.players,
      fixtures: data.fixtures,
      cups: data.cups,
      trophyCabinet: createEmptyTrophyCabinet(),
      trophyHistory: [],
      seasonResults: [],
      boardObjectives: objectives,
      news: ['Season begins! The Premier League simulation is underway.'],
      liveMatches: {},
      isSeasonSkipInProgress: false,
    });
  },

  advanceWeek: () => {
    set(state => simulateWeekState(state).state);
  },

  advanceMultipleWeeks: (weeks: number) => {
    const safeWeeks = Math.max(0, Math.min(20, Math.floor(weeks)));
    if (safeWeeks === 0) return;
    for (let index = 0; index < safeWeeks; index += 1) {
      const before = get();
      get().advanceWeek();
      const after = get();
      const didProgress = after.currentWeek !== before.currentWeek || after.season !== before.season;
      if (!didProgress) break;
    }
  },

  skipToEndOfSeason: () => {
    if (get().isSeasonSkipInProgress) return;
    const seasonSkipJobId = ++activeSeasonSkipJobId;
    pauseGamePersistence();
    set({ isSeasonSkipInProgress: true });

    try {
      const initialState = get();
      const targetSeason = initialState.season || 1;
      let simulationState: SeasonSimulationState = {
        currentWeek: initialState.currentWeek,
        season: initialState.season,
        players: initialState.players,
        teams: initialState.teams,
        fixtures: initialState.fixtures,
        cups: initialState.cups,
        news: initialState.news,
        userTeamId: initialState.userTeamId,
        boardObjectives: initialState.boardObjectives,
        trophyCabinet: initialState.trophyCabinet,
        trophyHistory: initialState.trophyHistory,
        seasonResults: initialState.seasonResults,
        liveMatches: initialState.liveMatches,
      };
      let simulationRuntime = buildSimulationRuntime(initialState);
      let skippedWeeks = 0;

      while (skippedWeeks < SKIP_SEASON_MAX_GUARD_WEEKS) {
        if (activeSeasonSkipJobId !== seasonSkipJobId) break;
        if ((simulationState.season || 1) !== targetSeason) break;

        const beforeWeek = simulationState.currentWeek;
        const beforeSeason = simulationState.season || 1;
        const weekResult = simulateWeekState(simulationState, {
          generateNews: false,
          captureEvents: false,
          runtime: simulationRuntime,
        });
        simulationState = weekResult.state;
        simulationRuntime = weekResult.runtime;
        skippedWeeks += 1;

        const didProgress = simulationState.currentWeek !== beforeWeek || (simulationState.season || 1) !== beforeSeason;
        if ((simulationState.season || 1) !== targetSeason) break;
        if (!didProgress) break;
      }

      if (activeSeasonSkipJobId === seasonSkipJobId) {
        set({
          currentWeek: simulationState.currentWeek,
          season: simulationState.season,
          players: simulationState.players,
          teams: simulationState.teams,
          fixtures: simulationState.fixtures,
          cups: simulationState.cups,
          news: simulationState.news,
          boardObjectives: simulationState.boardObjectives,
          trophyCabinet: simulationState.trophyCabinet,
          trophyHistory: simulationState.trophyHistory,
          seasonResults: simulationState.seasonResults,
          liveMatches: simulationState.liveMatches,
        });
      }
    } finally {
      if (activeSeasonSkipJobId === seasonSkipJobId) {
        set({ isSeasonSkipInProgress: false });
      }
      void resumeGamePersistence();
    }
  },

  changeTeam: (teamId: string) => {
    set(state => {
      const team = state.teams[teamId];
      if (!team) return state;

      return {
        userTeamId: teamId,
        boardObjectives: generateBoardObjectives(team.clubClass || 'C', getTeamLeagueId(team)),
      };
    });
  },
});
