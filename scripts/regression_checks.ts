import * as fs from 'fs';
import * as path from 'path';
import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import {
  didConcedeInWindow,
  applyWindowedCleanSheets,
  qualifiesForWindowedCleanSheet,
} from '../src/core/postMatchAccounting';
import { Player } from '../src/models/types';
import { useGameStore } from '../src/store/gameStore';

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const readSource = (filePath: string) => fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');

const checkCleanSheetWindows = () => {
  assert(!didConcedeInWindow([], 0, 90, 0), 'Empty conceded-minute list with 0 conceded should be clean');
  assert(!didConcedeInWindow([30], 0, 29, 1), 'Player subbed before concession should keep clean sheet');
  assert(didConcedeInWindow([30], 0, 90, 1), 'Player on pitch for concession should not keep clean sheet');
  assert(
    !qualifiesForWindowedCleanSheet([61], 0, 29, 1),
    'Short defensive cameo should not qualify for clean-sheet stat'
  );
  assert(
    qualifiesForWindowedCleanSheet([61], 0, 60, 1),
    'Starter subbed after 60 minutes before concession should qualify for clean-sheet stat'
  );

  const basePlayer = Object.values(initGameData().players).find(player => player.position === 'DEF');
  assert(basePlayer, 'Regression setup needs a defender fixture player');

  const shortSubbedBeforeGoal: Player = { ...basePlayer!, id: 'cs-short', cleanSheets: 0, position: 'DEF' };
  const qualifiedBeforeGoal: Player = { ...basePlayer!, id: 'cs-qualified', cleanSheets: 0, position: 'DEF' };
  const playedThroughGoal: Player = { ...basePlayer!, id: 'cs-through', cleanSheets: 0, position: 'DEF' };
  const updatedPlayers = {
    [shortSubbedBeforeGoal.id]: shortSubbedBeforeGoal,
    [qualifiedBeforeGoal.id]: qualifiedBeforeGoal,
    [playedThroughGoal.id]: playedThroughGoal,
  };

  applyWindowedCleanSheets(
    [shortSubbedBeforeGoal, qualifiedBeforeGoal, playedThroughGoal],
    new Set([shortSubbedBeforeGoal.id, qualifiedBeforeGoal.id, playedThroughGoal.id]),
    { [shortSubbedBeforeGoal.id]: 29, [qualifiedBeforeGoal.id]: 60, [playedThroughGoal.id]: 90 },
    [61],
    1,
    updatedPlayers
  );

  assert(updatedPlayers[shortSubbedBeforeGoal.id].cleanSheets === 0, 'Short subbed-off player should not get clean sheet');
  assert(updatedPlayers[qualifiedBeforeGoal.id].cleanSheets === 1, 'Qualified subbed-off player before concession should get clean sheet');
  assert(updatedPlayers[playedThroughGoal.id].cleanSheets === 0, 'Player on pitch for concession should not get clean sheet');
};

const checkLiveSentOffMinutes = () => {
  useGameStore.getState().initializeGame('T1');
  const state = useGameStore.getState();
  const fixture = Object.values(state.fixtures)
    .find(item => item.homeTeamId !== 'T1' && item.awayTeamId !== 'T1');
  assert(fixture, 'Regression setup needs a non-user fixture');

  const homeStarterIds = Object.values(state.players)
    .filter(player => player.teamId === fixture!.homeTeamId && player.isStarting)
    .map(player => player.id);
  const awayStarterIds = Object.values(state.players)
    .filter(player => player.teamId === fixture!.awayTeamId && player.isStarting)
    .map(player => player.id);
  assert(homeStarterIds.length > 0 && awayStarterIds.length > 0, 'Regression setup needs live starters');

  const sentOffPlayerId = homeStarterIds[0];
  const beforeMinutes = state.players[sentOffPlayerId].minutesPlayed || 0;

  useGameStore.setState(prev => ({
    fixtures: {
      ...prev.fixtures,
      [fixture!.id]: { ...fixture!, homeScore: 0, awayScore: 0, isPlayed: false },
    },
    liveMatches: {
      ...(prev.liveMatches || {}),
      [fixture!.id]: {
        initialized: true,
        yellowCardPlayerIds: [],
        sentOffPlayerIds: [sentOffPlayerId],
        sentOffMinutes: { [sentOffPlayerId]: 42 },
        homeGoalMinutes: [],
        awayGoalMinutes: [],
        homeStarterIds,
        awayStarterIds,
      },
    },
  }));

  useGameStore.getState().finishLiveMatch(fixture!.id);
  const after = useGameStore.getState().players[sentOffPlayerId];
  assert(
    (after.minutesPlayed || 0) - beforeMinutes === 42,
    `Sent-off live player should receive 42 minutes, got ${(after.minutesPlayed || 0) - beforeMinutes}`
  );
};

const checkBranchGuards = () => {
  const matchEngine = readSource('src/core/matchEngine.ts');
  const gameStore = readSource('src/store/gameStore.ts');

  assert(
    /if \(matchYellowCards\.has\(playerId\)\)[\s\S]*addPlayerStat\(updatedPlayers, playerId, 'yellowCards'\);[\s\S]*sendOffPlayer/.test(matchEngine),
    'Quick sim second-yellow branch must add yellow-card stat before red'
  );
  assert(
    /if \(matchYellowCards\.has\(playerId\)\)[\s\S]*addPlayerStat\(updatedPlayers, playerId, 'yellowCards'\);[\s\S]*sendOffPlayer/.test(gameStore),
    'Live sim second-yellow branch must add yellow-card stat before red'
  );
  assert(
    /simulatePossession\([\s\S]*attShape,[\s\S]*defShape[\s\S]*\)/.test(matchEngine),
    'Quick sim must pass formation shape into simulatePossession'
  );
  assert(
    /buildTeamShapeProfile\(homeTeam, homeStarters\)[\s\S]*simulatePossession\([\s\S]*attShape,[\s\S]*defShape[\s\S]*\)/.test(gameStore),
    'Live sim must pass formation shape into simulatePossession'
  );
};

const checkSeededFormationDiversity = () => {
  const originalRandom = Math.random;
  Math.random = createSeededRandom(20260513);
  const formationUsage = { back3: 0, back4: 0, back5: 0 };

  try {
    for (let season = 1; season <= 5; season++) {
      const data = initGameData();
      let state = {
        players: data.players,
        teams: data.teams,
        fixtures: data.fixtures,
        currentWeek: 1,
        news: [] as string[],
      };

      for (let week = 1; week <= 38; week++) {
        const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);
        weekFixtures.forEach(fixture => {
          const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures);
          state.players = result.players;
          state.teams = result.teams;
          state.fixtures[fixture.id] = result.fixture;
        });

        const progression = computeWeeklyProgression(state.currentWeek, state.players, state.teams, state.fixtures, state.news);
        state.players = progression.players;
        state.teams = progression.teams;
        state.currentWeek = progression.currentWeek;
        state.news = progression.news;

        const transfers = computeWeeklyTransfers(state.players, state.teams, null);
        state.players = transfers.players;
        state.teams = transfers.teams;

        Object.values(state.teams).forEach(team => {
          if (team.activeFormation.startsWith('3')) formationUsage.back3++;
          else if (team.activeFormation.startsWith('5')) formationUsage.back5++;
          else formationUsage.back4++;
        });
      }
    }
  } finally {
    Math.random = originalRandom;
  }

  assert(formationUsage.back3 > 0, `Seeded formation run produced no back-3 usage: ${JSON.stringify(formationUsage)}`);
  assert(formationUsage.back5 > 0, `Seeded formation run produced no back-5 usage: ${JSON.stringify(formationUsage)}`);
  console.log(`Formation usage: ${JSON.stringify(formationUsage)}`);
};

const runRegressionChecks = () => {
  console.log('--- ENGINE REGRESSION CHECKS ---');
  checkCleanSheetWindows();
  console.log('[OK] Clean-sheet window checks passed');
  checkLiveSentOffMinutes();
  console.log('[OK] Live sent-off minute check passed');
  checkBranchGuards();
  console.log('[OK] Second-yellow and shape parity guards passed');
  checkSeededFormationDiversity();
  console.log('[OK] Seeded formation diversity check passed');
  console.log('--- REGRESSION CHECKS COMPLETE ---');
};

runRegressionChecks();
