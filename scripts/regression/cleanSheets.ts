import assert from 'node:assert/strict';
import { generateBoardObjectives, initGameData } from '../../src/utils/initGame';
import { quickSimMatch } from '../../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../../src/core/progressionEngine';
import { createSeededRandomGenerator } from '../../src/core/random';
import {
  buildBoardObjectives,
  buildBoardProfile,
  evaluateBoardObjectives,
  runBoardReview,
} from '../../src/core/boardEngine';
import {
  applySharedPostMatchAccounting,
  applyWindowedCleanSheets,
  didConcedeInWindow,
  qualifiesForWindowedCleanSheet,
} from '../../src/core/postMatchAccounting';
import { applySubstitutions } from '../../src/core/substitutionEngine';
import { advanceSeason } from '../../src/core/seasonTransition';
import { appointReplacementManager } from '../../src/core/managerUtils';
import { LeagueDivision, Player } from '../../src/models/types';
import { isPlayerUnavailable } from '../../src/core/playerStatusUtils';
import { useGameStore } from '../../src/store/gameStore';
import {
  generateAssistantWeekMessages,
  generatePostMatchReportMessage,
  generateSystemInboxMessages,
  MAX_INBOX_MESSAGES,
  mergeInboxMessages,
} from '../../src/store/inboxHelpers';

export const run = () => {
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
    rng: () => 0.5,
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
  assert.equal(minuteMap[starterA.id], 60);
  assert.equal(minuteMap[starterB.id], 90);
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
  const syntheticObjectives = generateBoardObjectives(
    'A',
    leadTeam.name,
    (leadTeam.division === 'Continental' ? 'Premier League' : leadTeam.division) as LeagueDivision
  );
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

  const repeatedPositionCheck = evaluateBoardObjectives(
    objectiveResult.updatedObjectives,
    syntheticTeams[leadTeam.id],
    syntheticTeams,
    { isSeasonComplete: true }
  );
  assert.equal(repeatedPositionCheck.approvalChange, 0);

  const eliteProfile = buildBoardProfile('S', 'Premier League');
  const survivalProfile = buildBoardProfile('F', 'League Two');
  const eliteObjectives = buildBoardObjectives(
    'S',
    'Premier League',
    eliteProfile,
    ['fa-cup', 'carabao-cup', 'europe']
  );
  const survivalObjectives = buildBoardObjectives('F', 'League Two', survivalProfile);
  assert.ok(eliteObjectives.some(objective => objective.competitionId === 'carabao-cup'));
  assert.ok(eliteObjectives.some(objective => objective.competitionId === 'europe'));
  assert.ok(survivalObjectives.some(objective => objective.type === 'max_spend'));
  assert.equal(survivalObjectives.some(objective => objective.competitionId === 'carabao-cup'), false);

  const reviewSeed = initGameData();
  const premierTeams = Object.values(reviewSeed.teams).filter(team => team.division === 'Premier League');
  const eliteTeam = premierTeams.find(team => team.clubClass === 'S');
  const survivalTeam = premierTeams.find(team => team.clubClass === 'D');
  assert.ok(eliteTeam && survivalTeam, 'Expected Premier League elite and survival clubs for board review regression');

  const reviewedLeague = Object.fromEntries(
    premierTeams.map((team, index) => [
      team.id,
      {
        ...team,
        boardProfile: buildBoardProfile(team.clubClass || 'C', 'Premier League'),
        played: 38,
        points: Math.max(22, 82 - (index * 3)),
        wins: Math.max(6, 24 - index),
        draws: 8,
        losses: Math.min(24, 6 + index),
        goalsFor: Math.max(28, 72 - index),
        goalsAgainst: 34 + index,
        transferSpend: 12,
        form: ['W', 'D', 'L', 'W', 'D'],
      },
    ])
  );

  reviewedLeague[eliteTeam!.id] = {
    ...reviewedLeague[eliteTeam!.id],
    boardApproval: 38,
    points: 36,
    wins: 9,
    draws: 9,
    losses: 20,
    goalsFor: 38,
    goalsAgainst: 66,
    transferSpend: 96,
    form: ['L', 'L', 'D', 'L', 'L'],
    manager: {
      ...reviewedLeague[eliteTeam!.id].manager,
      pressureScore: 62,
      replacementRisk: 60,
    },
  };
  reviewedLeague[survivalTeam!.id] = {
    ...reviewedLeague[survivalTeam!.id],
    boardApproval: 38,
    points: 36,
    wins: 9,
    draws: 9,
    losses: 20,
    goalsFor: 38,
    goalsAgainst: 66,
    transferSpend: 4,
    form: ['D', 'L', 'W', 'D', 'L'],
    manager: {
      ...reviewedLeague[survivalTeam!.id].manager,
      pressureScore: 40,
      replacementRisk: 35,
    },
  };

  const eliteReview = runBoardReview(
    reviewedLeague[eliteTeam!.id],
    reviewedLeague,
    buildBoardObjectives('S', 'Premier League', eliteProfile, ['fa-cup', 'carabao-cup', 'europe']),
    {
      isSeasonComplete: true,
      competitions: reviewSeed.competitions,
      players: reviewSeed.players,
    }
  );
  const survivalReview = runBoardReview(
    reviewedLeague[survivalTeam!.id],
    reviewedLeague,
    buildBoardObjectives('D', 'Premier League', buildBoardProfile('D', 'Premier League')),
    {
      isSeasonComplete: true,
      competitions: reviewSeed.competitions,
      players: reviewSeed.players,
    }
  );
  assert.ok(
    eliteReview.nextManager.replacementRisk > survivalReview.nextManager.replacementRisk,
    'Elite underperformance should create higher replacement risk than survival-level underperformance'
  );

  const stressedPlayers = Object.fromEntries(
    Object.values(reviewSeed.players).map(player => {
      if (player.teamId !== eliteTeam!.id) return [player.id, player];
      return [
        player.id,
        {
          ...player,
          age: player.position === 'GK' ? 35 : 33,
          wage: player.wage + 85,
          injuryWeeks: player.position === 'DEF' || player.position === 'MID' ? 2 : 0,
          matchesSuspended: player.position === 'FWD' ? 1 : 0,
        },
      ];
    })
  );
  const balancedPlayers = Object.fromEntries(
    Object.values(reviewSeed.players).map(player => {
      if (player.teamId !== eliteTeam!.id) return [player.id, player];
      return [
        player.id,
        {
          ...player,
          age: 26,
          wage: Math.max(8, Math.round(player.wage * 0.62)),
          injuryWeeks: 0,
          matchesSuspended: 0,
        },
      ];
    })
  );
  const contextTeam = {
    ...reviewedLeague[eliteTeam!.id],
    boardApproval: 56,
    points: 68,
    wins: 20,
    draws: 8,
    losses: 10,
    goalsFor: 62,
    goalsAgainst: 44,
    transferSpend: 24,
    form: ['W', 'D', 'W', 'D', 'W'],
    manager: {
      ...reviewedLeague[eliteTeam!.id].manager,
      boardTrust: 70,
      jobSecurity: 66,
      pressureScore: 39,
      replacementRisk: 32,
    },
  };
  const contextLeague = {
    ...reviewedLeague,
    [eliteTeam!.id]: contextTeam,
  };

  const stressedContextReview = runBoardReview(
    contextTeam,
    contextLeague,
    buildBoardObjectives('S', 'Premier League', eliteProfile, ['fa-cup', 'carabao-cup', 'europe']),
    {
      isSeasonComplete: true,
      competitions: reviewSeed.competitions,
      players: stressedPlayers,
    }
  );
  const balancedContextReview = runBoardReview(
    contextTeam,
    contextLeague,
    buildBoardObjectives('S', 'Premier League', eliteProfile, ['fa-cup', 'carabao-cup', 'europe']),
    {
      isSeasonComplete: true,
      competitions: reviewSeed.competitions,
      players: balancedPlayers,
    }
  );
  const stressedReasonText = stressedContextReview.reasons.join(' ').toLowerCase();
  assert.ok(
    stressedReasonText.includes('squad age profile') ||
      stressedReasonText.includes('wage posture') ||
      stressedReasonText.includes('registration depth'),
    'Board review reasons should surface squad-context risk signals when they are present'
  );
  assert.ok(
    stressedContextReview.nextApproval <= balancedContextReview.nextApproval,
    'Stressed squad context should not produce a better board-approval outcome than a balanced squad context'
  );

  const replacementSeed = initGameData();
  const replacementTeam = Object.values(replacementSeed.teams)
    .find(team => team.division === 'Premier League' && team.clubClass === 'A');
  assert.ok(replacementTeam, 'Expected an upper-tier AI club for manager replacement regression');
  const replacementTable = Object.fromEntries(
    Object.values(replacementSeed.teams).map((team, index) => [
      team.id,
      team.division === 'Premier League'
        ? {
            ...team,
            boardProfile: buildBoardProfile(team.clubClass || 'C', 'Premier League'),
            played: 38,
            points: Math.max(24, 84 - (index * 2)),
            wins: Math.max(7, 25 - index),
            draws: 7,
            losses: Math.min(24, 6 + index),
            goalsFor: Math.max(30, 70 - index),
            goalsAgainst: 34 + index,
            transferSpend: 15,
            form: ['W', 'D', 'L', 'W', 'D'],
          }
        : team,
    ])
  );
  replacementTable[replacementTeam!.id] = {
    ...replacementTable[replacementTeam!.id],
    boardApproval: 14,
    points: 18,
    wins: 4,
    draws: 6,
    losses: 28,
    goalsFor: 28,
    goalsAgainst: 82,
    transferSpend: 98,
    form: ['L', 'L', 'L', 'L', 'L'],
    manager: {
      ...replacementTable[replacementTeam!.id].manager,
      pressureScore: 82,
      replacementRisk: 88,
    },
  };
  const advancedSeason = advanceSeason(
    replacementSeed.players,
    replacementTable,
    replacementSeed.competitions,
    null,
    []
  );
  assert.notEqual(
    advancedSeason.teams[replacementTeam!.id].manager.name,
    replacementTeam!.manager.name,
    'A badly failing AI club should appoint a replacement manager on season rollover'
  );
  const replacementSampleManagers = Object.values(replacementTable)
    .filter(team => team.division === 'Premier League')
    .slice(0, 8)
    .map(team => appointReplacementManager(team, team.division));
  assert.ok(
    new Set(replacementSampleManagers.map(manager => manager.name)).size >= 4,
    'Replacement manager selection should produce varied identities'
  );
  assert.ok(
    new Set(replacementSampleManagers.map(manager => manager.contractYearsRemaining)).size >= 2,
    'Replacement manager selection should produce varied contract lengths'
  );

  useGameStore.getState().initializeGame('T1');
  const liveState = useGameStore.getState();
  const liveFixture = Object.values(liveState.fixtures)
    .find(item => item.homeTeamId !== 'T1' && item.awayTeamId !== 'T1');
  assert.ok(liveFixture, 'Expected a non-user fixture for live energy regression check');

  const homeStarterIds = Object.values(liveState.players)
    .filter(player => player.teamId === liveFixture!.homeTeamId && player.isStarting)
    .map(player => player.id);
  const awayStarterIds = Object.values(liveState.players)
    .filter(player => player.teamId === liveFixture!.awayTeamId && player.isStarting)
    .map(player => player.id);
  const trackedStarterIds = [...homeStarterIds.slice(0, 2), ...awayStarterIds.slice(0, 2)];
  assert.equal(trackedStarterIds.length, 4, 'Expected tracked live-match starters for energy regression check');

  const playersWithKnownEnergy = Object.fromEntries(
    Object.entries(liveState.players).map(([id, player]) => [
      id,
      trackedStarterIds.includes(id) ? { ...player, energy: 50 } : player,
    ])
  );
  useGameStore.setState(prev => ({
    players: playersWithKnownEnergy,
    fixtures: {
      ...prev.fixtures,
      [liveFixture!.id]: {
        ...liveFixture!,
        homeScore: 0,
        awayScore: 0,
        isPlayed: false,
      },
    },
    liveMatches: {
      ...(prev.liveMatches || {}),
      [liveFixture!.id]: {
        initialized: true,
        yellowCardPlayerIds: [],
        sentOffPlayerIds: [],
        sentOffMinutes: {},
        homeGoalMinutes: [],
        awayGoalMinutes: [],
        homeStarterIds,
        awayStarterIds,
      },
    },
  }));
  useGameStore.getState().finishLiveMatch(liveFixture!.id);
  trackedStarterIds.forEach(playerId => {
    assert.equal(
      useGameStore.getState().players[playerId].energy,
      50,
      `finishLiveMatch should not apply a second energy drain to ${playerId}`
    );
  });

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
  const seasonSeedData = initGameData();
  const nextSeason = advanceSeason(
    seededPlayers,
    seasonSeedData.teams,
    seasonSeedData.competitions,
    null,
    []
  );
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

  const migrate = useGameStore.persist.getOptions().migrate as (
    persistedState: unknown,
    version: number
  ) => any;
  const migratedState = migrate({
    currentWeek: 7,
    userTeamId: 'T1',
    teams: {},
    players: {},
    fixtures: {},
    news: ['Board approval update'],
    boardObjectives: [],
  }, 3);
  assert.equal(migratedState.inboxMessages.length, 1);
  assert.equal(migratedState.inboxMessages[0].body, 'Board approval update');

  useGameStore.getState().initializeGame('T1');
  const migrationSeedState = useGameStore.getState();
  const persistedObjectives = migrationSeedState.boardObjectives.map((objective, index) => ({
    ...objective,
    id: `persisted-objective-${index}`,
    met: index === 0,
  }));
  const migratedObjectiveState = migrate({
    currentWeek: migrationSeedState.currentWeek,
    userTeamId: migrationSeedState.userTeamId,
    teams: migrationSeedState.teams,
    players: migrationSeedState.players,
    fixtures: migrationSeedState.fixtures,
    competitions: migrationSeedState.competitions,
    news: migrationSeedState.news,
    inboxMessages: migrationSeedState.inboxMessages,
    boardObjectives: persistedObjectives,
    careerRecord: migrationSeedState.careerRecord,
    liveMatches: migrationSeedState.liveMatches,
  }, 7);
  const objectiveKey = (objective: {
    type: string;
    target: number;
    competitionId?: string;
    targetRound?: string;
  }) => [objective.type, objective.target, objective.competitionId || '', objective.targetRound || ''].join('|');
  const migratedObjectives = (migratedObjectiveState.boardObjectives || []) as Array<{
    id: string;
    met: boolean;
    type: string;
    target: number;
    competitionId?: string;
    targetRound?: string;
  }>;
  const migratedObjectivesByKey = new Map(
    migratedObjectives.map(objective => [objectiveKey(objective), objective])
  );
  persistedObjectives.forEach(objective => {
    const migratedObjective = migratedObjectivesByKey.get(objectiveKey(objective));
    assert.ok(migratedObjective, `Expected migrated objective for ${objective.description}`);
    assert.equal(migratedObjective!.id, objective.id);
    assert.equal(migratedObjective!.met, objective.met);
  });

  const migrationSeed = initGameData();
  const migrationUserTeamId = Object.keys(migrationSeed.teams)[0];
  const migrationRng = createSeededRandomGenerator(20260611);
  let midSeasonState = {
    players: migrationSeed.players,
    teams: migrationSeed.teams,
    fixtures: migrationSeed.fixtures,
    competitions: migrationSeed.competitions,
    currentWeek: 1,
    news: [] as string[],
  };
  for (let week = 1; week <= 8; week += 1) {
    const weekFixtures = Object.values(midSeasonState.fixtures).filter(fixture => fixture.week === week);
    for (const fixture of weekFixtures) {
      const result = quickSimMatch(
        fixture.id,
        midSeasonState.players,
        midSeasonState.teams,
        midSeasonState.fixtures,
        migrationUserTeamId,
        { rng: migrationRng }
      );
      midSeasonState.players = result.players;
      midSeasonState.teams = result.teams;
      midSeasonState.fixtures = { ...midSeasonState.fixtures, [fixture.id]: result.fixture };
    }
    const progression = computeWeeklyProgression(
      midSeasonState.currentWeek,
      midSeasonState.players,
      midSeasonState.teams,
      midSeasonState.fixtures,
      midSeasonState.news,
      migrationUserTeamId,
      migrationRng
    );
    midSeasonState.players = progression.players;
    midSeasonState.teams = progression.teams;
    midSeasonState.currentWeek = progression.currentWeek;
    midSeasonState.news = progression.news;
    const transferResult = computeWeeklyTransfers(
      midSeasonState.players,
      midSeasonState.teams,
      migrationUserTeamId,
      migrationRng
    );
    midSeasonState.players = transferResult.players;
    midSeasonState.teams = transferResult.teams;
  }

  const legacyTeams = Object.fromEntries(
    Object.values(midSeasonState.teams).map(team => [
      team.id,
      {
        id: team.id,
        name: team.name,
        division: team.division,
        clubClass: team.clubClass,
        isExternal: team.isExternal,
        points: team.points,
        goalsFor: team.goalsFor,
        goalsAgainst: team.goalsAgainst,
        wins: team.wins,
        draws: team.draws,
        losses: team.losses,
        played: team.played,
        activeFormation: team.activeFormation,
        form: team.form,
        tactics: team.tactics,
        budget: team.budget,
        lastStartingXI: team.lastStartingXI,
        formationMap: team.formationMap,
      },
    ])
  );
  const migratedMidSeasonState = migrate({
    currentWeek: midSeasonState.currentWeek,
    userTeamId: migrationUserTeamId,
    teams: legacyTeams,
    players: midSeasonState.players,
    fixtures: midSeasonState.fixtures,
    competitions: midSeasonState.competitions,
    news: midSeasonState.news,
    inboxMessages: [],
    boardObjectives: [],
    careerRecord: {
      seasonsManaged: 1,
      totalWins: 0,
      totalDraws: 0,
      totalLosses: 0,
      totalGoalsFor: 0,
      totalGoalsAgainst: 0,
      reputation: 48,
      trophies: [],
      seasonHistory: [],
      consecutiveLowApprovalWeeks: 0,
    },
  }, 7) as any;

  assert.equal(migratedMidSeasonState.currentWeek, midSeasonState.currentWeek);
  assert.ok(migratedMidSeasonState.competitions['carabao-cup'], 'Mid-season migration should preserve Carabao Cup state');
  assert.ok(migratedMidSeasonState.competitions['fa-cup'], 'Mid-season migration should preserve FA Cup state');
  assert.ok(migratedMidSeasonState.competitions.europe, 'Mid-season migration should preserve Europe state');
  assert.ok(migratedMidSeasonState.teams[migrationUserTeamId].boardProfile, 'Mid-season migration should hydrate board profile');
  assert.ok(migratedMidSeasonState.teams[migrationUserTeamId].manager, 'Mid-season migration should hydrate manager context');
  assert.ok(migratedMidSeasonState.boardObjectives.length > 0, 'Mid-season migration should rebuild managed-team board objectives');

  useGameStore.setState({
    currentWeek: migratedMidSeasonState.currentWeek,
    userTeamId: migratedMidSeasonState.userTeamId,
    teams: migratedMidSeasonState.teams,
    players: migratedMidSeasonState.players,
    fixtures: migratedMidSeasonState.fixtures,
    competitions: migratedMidSeasonState.competitions,
    news: migratedMidSeasonState.news,
    inboxMessages: [],
    boardObjectives: migratedMidSeasonState.boardObjectives,
    liveMatches: {},
  });
  useGameStore.getState().setFormation(migrationUserTeamId, useGameStore.getState().teams[migrationUserTeamId].activeFormation);
  const hydratedManagedStarters = Object.values(useGameStore.getState().players).filter(player => (
    player.teamId === migrationUserTeamId &&
    player.isStarting
  ));
  const hydratedMapCount = Object.keys(useGameStore.getState().teams[migrationUserTeamId].formationMap || {}).length;
  assert.ok(
    hydratedManagedStarters.length >= 8 && hydratedManagedStarters.length <= 11,
    `Hydrated managed team should keep a realistic XI core (got ${hydratedManagedStarters.length})`
  );
  assert.equal(
    hydratedMapCount,
    hydratedManagedStarters.length,
    'Hydrated managed team formation map should match starter count'
  );

  const rolloverFromMigratedState = advanceSeason(
    useGameStore.getState().players,
    useGameStore.getState().teams,
    useGameStore.getState().competitions,
    migrationUserTeamId,
    useGameStore.getState().news
  );
  assert.equal(rolloverFromMigratedState.currentWeek, 1);
  assert.ok(rolloverFromMigratedState.competitions['carabao-cup']);
  assert.ok(rolloverFromMigratedState.competitions['fa-cup']);
  assert.ok(rolloverFromMigratedState.competitions.europe);
  assert.ok(rolloverFromMigratedState.teams[migrationUserTeamId].boardProfile);
  assert.ok(rolloverFromMigratedState.teams[migrationUserTeamId].manager);
  assert.equal(
    Object.values(rolloverFromMigratedState.players)
      .filter(player => player.teamId === migrationUserTeamId && player.isStarting)
      .length,
    11,
    'Season rollover from a migrated mid-season save should keep a full managed XI'
  );
  assert.equal(
    Object.keys(rolloverFromMigratedState.teams[migrationUserTeamId].formationMap || {}).length,
    11,
    'Season rollover from a migrated mid-season save should rebuild an 11-slot formation map'
  );

  const duplicateMessages = generateSystemInboxMessages(3, ['Board approval duplicate']);
  const mergedMessages = mergeInboxMessages([], [...duplicateMessages, ...duplicateMessages]);
  assert.equal(mergedMessages.length, 1);
  const cappedMessages = mergeInboxMessages(
    [],
    Array.from({ length: MAX_INBOX_MESSAGES + 12 }, (_, index) => generateSystemInboxMessages(index + 1, [`Board approval ${index}`])[0]).reverse()
  );
  assert.equal(cappedMessages.length, MAX_INBOX_MESSAGES);
  assert.equal(cappedMessages[0].body, `Board approval ${MAX_INBOX_MESSAGES + 11}`);

  useGameStore.getState().initializeGame('T1');
  const inboxState = useGameStore.getState();
  const lineupSuggestion = inboxState.inboxMessages.find(message => message.category === 'lineup_suggestion');
  assert.ok(lineupSuggestion?.action && lineupSuggestion.action.type === 'apply_lineup', 'Expected an actionable lineup suggestion in the inbox');
  const regeneratedAssistantMessages = generateAssistantWeekMessages({
    currentWeek: inboxState.currentWeek,
    userTeamId: inboxState.userTeamId,
    teams: inboxState.teams,
    players: inboxState.players,
    fixtures: inboxState.fixtures,
  });
  const dedupedAssistantMessages = mergeInboxMessages(inboxState.inboxMessages, regeneratedAssistantMessages);
  assert.equal(dedupedAssistantMessages.length, inboxState.inboxMessages.length);

  useGameStore.getState().applyInboxAction(lineupSuggestion!.id);
  const lineupAppliedState = useGameStore.getState();
  const lineupPayload = lineupSuggestion!.action.payload;
  const actualStarters = Object.values(lineupAppliedState.players)
    .filter(player => player.teamId === lineupPayload.teamId && player.isStarting)
    .map(player => player.id)
    .sort();
  assert.deepEqual(actualStarters, [...lineupPayload.startingIds].sort());
  assert.deepEqual(lineupAppliedState.teams[lineupPayload.teamId].formationMap, lineupPayload.formationMap);
  assert.equal(lineupAppliedState.inboxMessages.find(message => message.id === lineupSuggestion!.id)?.isRead, true);
  assert.equal(lineupAppliedState.inboxMessages.find(message => message.id === lineupSuggestion!.id)?.action, undefined);

  const tacticData = initGameData();
  const controlledUserTeamId = Object.keys(tacticData.teams)[0];
  const tacticFixture = Object.values(tacticData.fixtures).find(fixture => (
    fixture.week === 1 &&
    (fixture.homeTeamId === controlledUserTeamId || fixture.awayTeamId === controlledUserTeamId)
  ));
  assert.ok(tacticFixture, 'Expected an opening-week fixture for inbox action checks');
  const controlledOpponentId = tacticFixture!.homeTeamId === controlledUserTeamId
    ? tacticFixture!.awayTeamId
    : tacticFixture!.homeTeamId;
  const controlledUserPlayers = Object.values(tacticData.players)
    .filter(player => player.teamId === controlledUserTeamId)
    .sort((a, b) => b.overallRating - a.overallRating);
  const controlledOpponentPlayers = Object.values(tacticData.players)
    .filter(player => player.teamId === controlledOpponentId)
    .sort((a, b) => b.overallRating - a.overallRating);
  const listedDefender = controlledOpponentPlayers.find(player => player.position === 'DEF');
  assert.ok(listedDefender, 'Expected a listed defender target for transfer advice checks');
  controlledUserPlayers.forEach((player, index) => {
    tacticData.players[player.id] = {
      ...player,
      overallRating: player.position === 'DEF' ? 54 : (index < 11 ? 62 : 56),
      energy: 40,
      isStarting: index < 11,
      isSub: index >= 11 && index < 18,
    };
  });
  controlledOpponentPlayers.forEach((player, index) => {
    tacticData.players[player.id] = {
      ...player,
      overallRating: index < 11 ? 88 : 80,
      isStarting: index < 11,
      isSub: index >= 11 && index < 18,
      isTransferListed: player.id === listedDefender!.id,
      askingPrice: player.id === listedDefender!.id ? 5 : player.askingPrice,
    };
  });
  tacticData.teams[controlledUserTeamId] = {
    ...tacticData.teams[controlledUserTeamId],
    tactics: {
      mentality: 'Balanced',
      passingStyle: 'Mixed',
      tempo: 'Fast',
      defensiveLine: 'High',
      pressing: 'High',
    },
  };
  const trackedTransferTargetId = listedDefender!.id;
  const trackedBudget = tacticData.teams[controlledUserTeamId].budget;
  const controlledMessages = generateAssistantWeekMessages({
    currentWeek: 1,
    userTeamId: controlledUserTeamId,
    teams: tacticData.teams,
    players: tacticData.players,
    fixtures: tacticData.fixtures,
  });
  const tacticSuggestion = controlledMessages.find(message => message.category === 'tactic_suggestion');
  assert.ok(tacticSuggestion?.action && tacticSuggestion.action.type === 'apply_tactics', 'Expected an actionable tactic suggestion');
  const transferSuggestion = controlledMessages.find(message => message.category === 'transfer_advice');
  assert.ok(transferSuggestion, 'Expected a transfer advice inbox item');
  assert.equal(transferSuggestion?.action, undefined);
  assert.equal(tacticData.teams[controlledUserTeamId].budget, trackedBudget);
  assert.equal(tacticData.players[trackedTransferTargetId].teamId, controlledOpponentId);

  useGameStore.setState({
    currentWeek: 1,
    userTeamId: controlledUserTeamId,
    teams: tacticData.teams,
    players: tacticData.players,
    fixtures: tacticData.fixtures,
    news: [],
    inboxMessages: [tacticSuggestion!],
    boardObjectives: [],
    liveMatches: {},
  });
  useGameStore.getState().applyInboxAction(tacticSuggestion!.id);
  const tacticAppliedTeam = useGameStore.getState().teams[controlledUserTeamId];
  Object.entries(tacticSuggestion!.action.payload.tactics).forEach(([key, value]) => {
    assert.equal(tacticAppliedTeam.tactics[key as keyof typeof tacticAppliedTeam.tactics], value);
  });

  const availabilityData = initGameData();
  const availabilityUserTeamId = Object.keys(availabilityData.teams)[0];
  const unavailablePlayer = Object.values(availabilityData.players)
    .find(player => player.teamId === availabilityUserTeamId && !player.isStarting && !player.isSub);
  assert.ok(unavailablePlayer, 'Expected a reserve player for availability checks');
  useGameStore.setState({
    currentWeek: 1,
    userTeamId: availabilityUserTeamId,
    teams: availabilityData.teams,
    players: {
      ...availabilityData.players,
      [unavailablePlayer!.id]: {
        ...unavailablePlayer!,
        injuryWeeks: 2,
        injuryType: 'hamstring strain',
      },
    },
    fixtures: availabilityData.fixtures,
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    liveMatches: {},
  });
  useGameStore.getState().toggleStarting(unavailablePlayer!.id);
  useGameStore.getState().markAsSub(unavailablePlayer!.id);
  const blockedSelectionPlayer = useGameStore.getState().players[unavailablePlayer!.id];
  assert.equal(blockedSelectionPlayer.isStarting, false);
  assert.equal(blockedSelectionPlayer.isSub, false);
  assert.equal(isPlayerUnavailable(blockedSelectionPlayer), true);

  const recoveryProbe = Object.values(availabilityData.players).find(player => player.teamId === availabilityUserTeamId);
  assert.ok(recoveryProbe, 'Expected a player for weekly recovery checks');
  const progressionWithRecovery = computeWeeklyProgression(
    5,
    {
      ...availabilityData.players,
      [recoveryProbe!.id]: {
        ...recoveryProbe!,
        injuryWeeks: 1,
        injuryType: 'ankle knock',
      },
    },
    availabilityData.teams,
    availabilityData.fixtures,
    [],
    availabilityUserTeamId,
    createSeededRandomGenerator(20260412)
  );
  assert.equal(progressionWithRecovery.players[recoveryProbe!.id].injuryWeeks, 0);
  assert.equal(progressionWithRecovery.players[recoveryProbe!.id].injuryType, undefined);
  const recoveryMessages = generateAssistantWeekMessages({
    currentWeek: progressionWithRecovery.currentWeek,
    userTeamId: availabilityUserTeamId,
    teams: progressionWithRecovery.teams,
    players: progressionWithRecovery.players,
    fixtures: availabilityData.fixtures,
    previousPlayers: {
      ...availabilityData.players,
      [recoveryProbe!.id]: {
        ...recoveryProbe!,
        injuryWeeks: 1,
        injuryType: 'ankle knock',
      },
    },
  });
  assert.ok(recoveryMessages.some(message => message.category === 'injury_update' && message.playerId === recoveryProbe!.id));

  const contractData = initGameData();
  const contractUserTeamId = Object.keys(contractData.teams)[0];
  const contractPlayer = Object.values(contractData.players)
    .find(player => player.teamId === contractUserTeamId && player.overallRating >= 78);
  assert.ok(contractPlayer, 'Expected a quality player for contract checks');
  const contractMessages = generateAssistantWeekMessages({
    currentWeek: 36,
    userTeamId: contractUserTeamId,
    teams: contractData.teams,
    players: {
      ...contractData.players,
      [contractPlayer!.id]: {
        ...contractPlayer!,
        contractLeft: 1,
      },
    },
    fixtures: contractData.fixtures,
    previousPlayers: contractData.players,
  });
  const contractWarning = contractMessages.find(message => message.category === 'contract_warning' && message.playerId === contractPlayer!.id);
  assert.ok(contractWarning?.action && contractWarning.action.type === 'renew_contract', 'Expected a contract renewal suggestion');
  useGameStore.setState({
    currentWeek: 36,
    userTeamId: contractUserTeamId,
    teams: contractData.teams,
    players: {
      ...contractData.players,
      [contractPlayer!.id]: {
        ...contractPlayer!,
        contractLeft: 1,
      },
    },
    fixtures: contractData.fixtures,
    news: [],
    inboxMessages: [contractWarning!],
    boardObjectives: [],
    liveMatches: {},
  });
  useGameStore.getState().applyInboxAction(contractWarning!.id);
  assert.equal(
    useGameStore.getState().players[contractPlayer!.id].contractLeft,
    contractWarning!.action.payload.years
  );
  assert.equal(
    useGameStore.getState().inboxMessages.find(message => message.id === contractWarning!.id)?.action,
    undefined
  );
  assert.equal(
    useGameStore.getState().inboxMessages.find(message => message.id === contractWarning!.id)?.isRead,
    true
  );

  const directRenewPlayer = Object.values(contractData.players)
    .find(player => player.teamId === contractUserTeamId && player.id !== contractPlayer!.id);
  assert.ok(directRenewPlayer, 'Expected a second player for direct contract renewal checks');
  const staleContractWarning = {
    ...contractWarning!,
    id: 'assistant-contract-warning-w35-stale-contract',
    week: 35,
    isRead: false,
  };
  useGameStore.setState({
    currentWeek: 36,
    userTeamId: contractUserTeamId,
    teams: contractData.teams,
    players: {
      ...contractData.players,
      [directRenewPlayer!.id]: {
        ...directRenewPlayer!,
        contractLeft: 1,
      },
    },
    fixtures: contractData.fixtures,
    news: [],
    inboxMessages: [
      {
        ...contractWarning!,
        id: 'assistant-contract-warning-w36-direct-renew',
        playerId: directRenewPlayer!.id,
        action: {
          type: 'renew_contract',
          payload: { playerId: directRenewPlayer!.id, years: 3, wage: 77 },
        },
      },
      {
        ...staleContractWarning,
        playerId: directRenewPlayer!.id,
        action: {
          type: 'renew_contract',
          payload: { playerId: directRenewPlayer!.id, years: 2, wage: 70 },
        },
      },
    ],
    boardObjectives: [],
    liveMatches: {},
  });
  const directRenewResult = useGameStore.getState().renewPlayerContract(directRenewPlayer!.id, 4, 88);
  assert.equal(directRenewResult.success, true);
  assert.equal(useGameStore.getState().players[directRenewPlayer!.id].contractLeft, 4);
  assert.equal(useGameStore.getState().players[directRenewPlayer!.id].wage, 88);
  const directRenewWarnings = useGameStore.getState().inboxMessages.filter(message => message.playerId === directRenewPlayer!.id);
  assert.ok(directRenewWarnings.length > 0, 'Expected retained inbox history for direct renewal');
  directRenewWarnings.forEach(message => {
    assert.equal(message.action, undefined);
    assert.equal(message.isRead, true);
  });

  const departureData = initGameData();
  const departureUserTeamId = Object.keys(departureData.teams)[0];
  const departingPlayer = Object.values(departureData.players).find(player => player.teamId === departureUserTeamId);
  assert.ok(departingPlayer, 'Expected a player for season contract rollover checks');
  const seasonAfterDeparture = advanceSeason(
    {
      ...departureData.players,
      [departingPlayer!.id]: {
        ...departingPlayer!,
        contractLeft: 0,
      },
    },
    departureData.teams,
    departureData.competitions,
    departureUserTeamId,
    []
  );
  assert.notEqual(seasonAfterDeparture.players[departingPlayer!.id].teamId, departureUserTeamId);
  assert.ok(seasonAfterDeparture.generatedNews.some(item => item.includes(`leaves ${departureData.teams[departureUserTeamId].name}`)));

  const reportData = initGameData();
  const reportUserTeamId = Object.keys(reportData.teams)[0];
  const reportFixture = Object.values(reportData.fixtures).find(fixture => (
    fixture.week === 1 &&
    (fixture.homeTeamId === reportUserTeamId || fixture.awayTeamId === reportUserTeamId)
  ));
  assert.ok(reportFixture, 'Expected a user fixture for post-match inbox checks');
  const previousReportPlayers = reportData.players;
  const reportResult = quickSimMatch(
    reportFixture!.id,
    reportData.players,
    reportData.teams,
    reportData.fixtures,
    reportUserTeamId,
    { rng: createSeededRandomGenerator(20260410) }
  );
  const postMatchReport = generatePostMatchReportMessage({
    currentWeek: 1,
    userTeamId: reportUserTeamId,
    fixture: reportResult.fixture,
    teams: reportResult.teams,
    players: reportResult.players,
    previousPlayers: previousReportPlayers,
  });
  assert.ok(postMatchReport, 'Expected a post-match report for the user fixture');

  const neutralFixture = Object.values(reportData.fixtures).find(fixture => (
    fixture.homeTeamId !== reportUserTeamId && fixture.awayTeamId !== reportUserTeamId
  ));
  assert.ok(neutralFixture, 'Expected a non-user fixture for post-match filtering');
  const neutralResult = quickSimMatch(
    neutralFixture!.id,
    reportData.players,
    reportData.teams,
    reportData.fixtures,
    null,
    { rng: createSeededRandomGenerator(20260411) }
  );
  assert.equal(
    generatePostMatchReportMessage({
      currentWeek: 1,
      userTeamId: reportUserTeamId,
      fixture: neutralResult.fixture,
      teams: neutralResult.teams,
      players: neutralResult.players,
      previousPlayers: reportData.players,
    }),
    null
  );
};
  runInvariantChecks();
};
