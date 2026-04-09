import assert from 'node:assert/strict';
import { generateBoardObjectives, initGameData } from '../src/utils/initGame';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { createSeededRandomGenerator } from '../src/core/random';
import {
  applySharedPostMatchAccounting,
  applyWindowedCleanSheets,
  didConcedeInWindow,
  qualifiesForWindowedCleanSheet,
} from '../src/core/postMatchAccounting';
import { applySubstitutions } from '../src/core/substitutionEngine';
import { advanceSeason } from '../src/core/seasonTransition';
import { Player } from '../src/models/types';
import { evaluateBoardObjectives } from '../src/store/boardObjectiveHelpers';

const runInvariantChecks = () => {
  assert.equal(didConcedeInWindow([], 0, 90, 0), false);
  assert.equal(didConcedeInWindow([30], 0, 29, 1), false);
  assert.equal(didConcedeInWindow([30], 0, 90, 1), true);
  assert.equal(qualifiesForWindowedCleanSheet([61], 0, 29, 1), false);
  assert.equal(qualifiesForWindowedCleanSheet([61], 0, 60, 1), true);

  const basePlayer = Object.values(initGameData().players).find(player => player.position === 'DEF');
  assert.ok(basePlayer, 'Expected at least one defender');
  const shortCameo: Player = { ...basePlayer!, id: 'short-cameo', cleanSheets: 0, position: 'DEF' };
  const qualifiedCameo: Player = { ...basePlayer!, id: 'qualified-cameo', cleanSheets: 0, position: 'DEF' };
  const fullWindow: Player = { ...basePlayer!, id: 'full-window', cleanSheets: 0, position: 'DEF' };
  const players = {
    [shortCameo.id]: shortCameo,
    [qualifiedCameo.id]: qualifiedCameo,
    [fullWindow.id]: fullWindow,
  };
  applyWindowedCleanSheets(
    [shortCameo, qualifiedCameo, fullWindow],
    new Set([shortCameo.id, qualifiedCameo.id, fullWindow.id]),
    { [shortCameo.id]: 29, [qualifiedCameo.id]: 60, [fullWindow.id]: 90 },
    [61],
    1,
    players
  );
  assert.equal(players[shortCameo.id].cleanSheets, 0);
  assert.equal(players[qualifiedCameo.id].cleanSheets, 1);
  assert.equal(players[fullWindow.id].cleanSheets, 0);

  const energyProbe: Player = {
    ...basePlayer!,
    id: 'energy-probe',
    position: 'DEF',
    energy: 80,
    minutesPlayed: 0,
    matchRatingHistory: [],
  };
  const energyPlayers = { [energyProbe.id]: energyProbe };
  applySharedPostMatchAccounting({
    teamParticipants: [energyProbe],
    teamStarterIds: new Set([energyProbe.id]),
    minuteMap: { [energyProbe.id]: 90 },
    concededGoalMinutes: [],
    concededGoalsTotal: 1,
    isWin: false,
    isDraw: false,
    teamTactics: {
      mentality: 'Balanced',
      passingStyle: 'Mixed',
      tempo: 'Normal',
      defensiveLine: 'Standard',
      pressing: 'Medium',
    },
    updatedPlayers: energyPlayers,
    rng: { next: () => 0.5 },
    applyEnergyDrain: false,
  });
  assert.equal(energyPlayers[energyProbe.id].energy, 80);
  assert.equal(energyPlayers[energyProbe.id].minutesPlayed, 90);

  const starterA: Player = {
    ...basePlayer!,
    id: 'starter-a',
    name: 'Starter A',
    position: 'MID',
    subPosition: 'CM',
    altPositions: ['CM'],
    energy: 5,
    overallRating: 65,
  };
  const starterB: Player = {
    ...basePlayer!,
    id: 'starter-b',
    name: 'Starter B',
    position: 'MID',
    subPosition: 'CM',
    altPositions: ['CM'],
    energy: 95,
    overallRating: 75,
  };
  const benchC: Player = {
    ...basePlayer!,
    id: 'bench-c',
    name: 'Bench C',
    position: 'MID',
    subPosition: 'CM',
    altPositions: ['CM'],
    energy: 0,
    overallRating: 90,
  };
  const benchD: Player = {
    ...basePlayer!,
    id: 'bench-d',
    name: 'Bench D',
    position: 'MID',
    subPosition: 'CM',
    altPositions: ['CM'],
    energy: 10,
    overallRating: 30,
  };
  let starters = [starterA, starterB];
  let bench = [benchC, benchD];
  const minuteMap = {
    [starterA.id]: 90,
    [starterB.id]: 90,
    [benchC.id]: 0,
    [benchD.id]: 0,
  };
  const baseTeam = Object.values(initGameData().teams)[0];
  const mockTeam = {
    ...baseTeam,
    tactics: {
      mentality: 'Balanced' as const,
      passingStyle: 'Mixed' as const,
      tempo: 'Normal' as const,
      defensiveLine: 'Standard' as const,
      pressing: 'Medium' as const,
    },
  };
  applySubstitutions(starters, bench, new Set(), minuteMap, mockTeam, 0, 1, { next: () => 0.1 }, {
    maxSubsOverride: 1,
    minuteOverride: 60,
    onSubstitution: (off, on) => {
      starters = starters.map(player => player.id === off.id ? on : player);
      bench = bench.filter(player => player.id !== on.id);
    },
  });
  applySubstitutions(starters, bench, new Set(), minuteMap, mockTeam, 0, 1, { next: () => 0.1 }, {
    maxSubsOverride: 1,
    minuteOverride: 70,
    onSubstitution: (off, on) => {
      starters = starters.map(player => player.id === off.id ? on : player);
      bench = bench.filter(player => player.id !== on.id);
    },
  });
  assert.equal(minuteMap[benchC.id], 10);
  assert.equal(minuteMap[benchD.id], 20);

  const seededData = initGameData();
  const [leadTeam, otherTeam] = Object.values(seededData.teams).slice(0, 2);
  const syntheticTeams = {
    ...seededData.teams,
    [leadTeam.id]: {
      ...leadTeam,
      points: 99,
      wins: 38,
      played: 38,
      transferSpend: 999,
      goalsFor: 120,
      goalsAgainst: 20,
    },
    [otherTeam.id]: {
      ...otherTeam,
      points: 40,
      wins: 10,
      played: 38,
      transferSpend: 0,
      goalsFor: 50,
      goalsAgainst: 60,
    },
  };
  const syntheticObjectives = generateBoardObjectives('A', leadTeam.name, leadTeam.division);
  const inSeasonObjectiveResult = evaluateBoardObjectives(
    syntheticObjectives,
    syntheticTeams[leadTeam.id],
    syntheticTeams,
    { isSeasonComplete: false }
  );
  assert.equal(inSeasonObjectiveResult.updatedObjectives.find(objective => objective.type === 'position')?.met, false);

  const objectiveResult = evaluateBoardObjectives(
    syntheticObjectives,
    syntheticTeams[leadTeam.id],
    syntheticTeams,
    { isSeasonComplete: true }
  );
  assert.equal(objectiveResult.updatedObjectives.find(objective => objective.type === 'position')?.met, true);
  assert.equal(objectiveResult.updatedObjectives.find(objective => objective.type === 'wins')?.met, true);
  assert.equal(objectiveResult.updatedObjectives.find(objective => objective.type === 'spend')?.met, true);

  const seededPlayers = Object.fromEntries(
    Object.entries(initGameData().players).map(([id, player]) => [
      id,
      {
        ...player,
        minutesPlayed: 500,
        goals: 8,
        assists: 6,
        cleanSheets: 4,
        yellowCards: 3,
        redCards: 1,
        matchRatingHistory: [6.5, 7.3, 8.0],
        matchesSuspended: 2,
      },
    ])
  );
  const nextSeason = advanceSeason(seededPlayers, initGameData().teams, null, []);
  Object.values(nextSeason.players).forEach(player => {
    assert.equal(player.matchesSuspended, 0);
    assert.equal(player.minutesPlayed, 0);
    assert.equal(player.goals, 0);
    assert.equal(player.assists, 0);
    assert.equal(player.cleanSheets, 0);
    assert.equal(player.yellowCards, 0);
    assert.equal(player.redCards, 0);
    assert.deepEqual(player.matchRatingHistory, []);
  });
};

const runSeason = (seed: number) => {
  const rng = createSeededRandomGenerator(seed);
  const data = initGameData();
  let state = {
    players: data.players,
    teams: data.teams,
    fixtures: data.fixtures,
    currentWeek: 1,
    news: [] as string[],
  };

  let totalGoals = 0;
  let yellowCards = 0;
  let redCards = 0;
  const seasonWeekLimit = getSeasonWeekLimit(state.fixtures);
  const formationUsage = { back3: 0, back4: 0, back5: 0 };

  for (let week = 1; week <= seasonWeekLimit; week++) {
    const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);
    for (const fixture of weekFixtures) {
      const beforeCards = Object.values(state.players).reduce(
        (acc, player) => ({ yellow: acc.yellow + player.yellowCards, red: acc.red + player.redCards }),
        { yellow: 0, red: 0 }
      );
      const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, null, { rng });
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fixture.id] = result.fixture;
      totalGoals += (result.fixture.homeScore || 0) + (result.fixture.awayScore || 0);

      const afterCards = Object.values(state.players).reduce(
        (acc, player) => ({ yellow: acc.yellow + player.yellowCards, red: acc.red + player.redCards }),
        { yellow: 0, red: 0 }
      );
      yellowCards += (afterCards.yellow - beforeCards.yellow);
      redCards += (afterCards.red - beforeCards.red);
    }

    const progression = computeWeeklyProgression(
      state.currentWeek,
      state.players,
      state.teams,
      state.fixtures,
      state.news,
      null,
      rng
    );
    state.players = progression.players;
    state.teams = progression.teams;
    state.currentWeek = progression.currentWeek;
    state.news = progression.news;

    const transfers = computeWeeklyTransfers(state.players, state.teams, null, rng);
    state.players = transfers.players;
    state.teams = transfers.teams;

    Object.values(state.teams).forEach(team => {
      if (team.activeFormation.startsWith('3')) formationUsage.back3 += 1;
      else if (team.activeFormation.startsWith('5')) formationUsage.back5 += 1;
      else formationUsage.back4 += 1;
    });
  }

  const matches = Object.values(state.fixtures).length;
  return {
    avgGoalsPerMatch: totalGoals / Math.max(1, matches),
    yellowCards,
    redCards,
    formationUsage,
  };
};

const runThresholdChecks = () => {
  const seasons = [20260513, 20260514, 20260515].map(runSeason);
  const avgGoals = seasons.reduce((sum, season) => sum + season.avgGoalsPerMatch, 0) / seasons.length;
  const totalYellow = seasons.reduce((sum, season) => sum + season.yellowCards, 0);
  const totalRed = seasons.reduce((sum, season) => sum + season.redCards, 0);
  const formationUsage = seasons.reduce(
    (acc, season) => ({
      back3: acc.back3 + season.formationUsage.back3,
      back4: acc.back4 + season.formationUsage.back4,
      back5: acc.back5 + season.formationUsage.back5,
    }),
    { back3: 0, back4: 0, back5: 0 }
  );

  assert.ok(avgGoals >= 3.0 && avgGoals <= 4.8, `Expected avg goals between 3.0 and 4.8, got ${avgGoals.toFixed(2)}`);
  assert.ok(totalYellow > 0, 'Expected at least one yellow card across threshold runs');
  assert.ok(totalRed > 0, 'Expected at least one red card across threshold runs');
  assert.ok(formationUsage.back3 > 0, 'Expected some back-3 usage');
  assert.ok(formationUsage.back5 > 0, 'Expected some back-5 usage');
};

const run = () => {
  console.log('--- CI REGRESSION CHECKS ---');
  runInvariantChecks();
  console.log('[OK] Invariant checks passed');
  runThresholdChecks();
  console.log('[OK] Seasonal threshold checks passed');
  console.log('--- CI REGRESSION COMPLETE ---');
};

run();
