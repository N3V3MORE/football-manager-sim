import * as fs from 'fs';
import * as path from 'path';
import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { BASE_FORMATION_SLOTS, getSlotsForFormation } from '../src/constants/formations';
import { rebuildFormationMap, rebuildFormationSlotPlayers } from '../src/core/formationMapUtils';
import { hasReachedCompetitionRound } from '../src/core/competitionEngine';
import { buildBoardObjectives, buildBoardProfile } from '../src/core/boardEngine';
import {
  didConcedeInWindow,
  applyWindowedCleanSheets,
  qualifiesForWindowedCleanSheet,
} from '../src/core/postMatchAccounting';
import { advanceSeason } from '../src/core/seasonTransition';
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

const checkFormationSlotLookupUsesExactFormation = () => {
  const threeFiveTwoSlots = getSlotsForFormation('3-5-2');
  assert(threeFiveTwoSlots === BASE_FORMATION_SLOTS['3-5-2'], '3-5-2 should use its exact slot definition');
  assert(threeFiveTwoSlots[0].length === 2, '3-5-2 should render two forwards');
  assert(threeFiveTwoSlots[2].length === 3, '3-5-2 should render a back three');
};

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
  const liveMatchActions = readSource('src/store/liveMatchActions.ts');

  assert(
    /if \(matchYellowCards\.has\(playerId\)\)[\s\S]*addPlayerStat\(updatedPlayers, playerId, 'yellowCards'\);[\s\S]*sendOffPlayer/.test(matchEngine),
    'Quick sim second-yellow branch must add yellow-card stat before red'
  );
  assert(
    /if \(matchYellowCards\.has\(playerId\)\)[\s\S]*addPlayerStat\(updatedPlayers, playerId, 'yellowCards'\);[\s\S]*sendOffPlayer/.test(liveMatchActions),
    'Live sim second-yellow branch must add yellow-card stat before red'
  );
  assert(
    /simulatePossession\([\s\S]*attShape,[\s\S]*defShape[\s\S]*\)/.test(matchEngine),
    'Quick sim must pass formation shape into simulatePossession'
  );
  assert(
    /buildTeamShapeProfile\(homeTeam, homeStarters\)[\s\S]*simulatePossession\([\s\S]*attShape,[\s\S]*defShape[\s\S]*\)/.test(liveMatchActions),
    'Live sim must pass formation shape into simulatePossession'
  );
};

const checkUserTeamProgressionDoesNotAdaptFormation = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams)[0];
  const beforeFormation = userTeam.activeFormation;
  const beforeTactics = JSON.stringify(userTeam.tactics);

  const teams = {
    ...data.teams,
    [userTeam.id]: {
      ...userTeam,
      played: 6,
      goalsFor: 4,
      goalsAgainst: 14,
      form: ['L', 'L', 'L', 'L', 'L'],
    },
  };

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const result = computeWeeklyProgression(1, data.players, teams, data.fixtures, [], userTeam.id);
    assert(
      result.teams[userTeam.id].activeFormation === beforeFormation,
      'User team formation should not be changed by AI tactical adaptation'
    );
    assert(
      JSON.stringify(result.teams[userTeam.id].tactics) === beforeTactics,
      'User team tactics should not be changed by AI tactical adaptation'
    );
  } finally {
    Math.random = originalRandom;
  }
};

const checkManagerProfilesLoaded = () => {
  const data = initGameData();
  const teams = Object.values(data.teams);
  assert(teams.every(team => team.manager && team.manager.teamId === team.id), 'Every team should have a linked manager profile');
  assert(teams.every(team => team.manager.preferredFormations.length > 0), 'Every manager should have at least one preferred formation');
};

const checkDivisionBootstrap = () => {
  const data = initGameData();
  const counts = Object.values(data.teams).reduce<Record<string, number>>((acc, team) => {
    acc[team.division] = (acc[team.division] || 0) + 1;
    return acc;
  }, {});

  assert(counts['Premier League'] === 20, `Expected 20 Premier League teams, got ${counts['Premier League'] || 0}`);
  assert(counts['Championship'] === 24, `Expected 24 Championship teams, got ${counts['Championship'] || 0}`);
  assert(counts['League One'] === 24, `Expected 24 League One teams, got ${counts['League One'] || 0}`);
  assert(counts['League Two'] === 24, `Expected 24 League Two teams, got ${counts['League Two'] || 0}`);
};

const checkPromotionRelegation = () => {
  const data = initGameData();
  const teams = { ...data.teams };

  (['Premier League', 'Championship', 'League One', 'League Two'] as const).forEach(division => {
    const ordered = Object.values(teams)
      .filter(team => team.division === division)
      .sort((a, b) => a.name.localeCompare(b.name));

    ordered.forEach((team, index) => {
      teams[team.id] = {
        ...team,
        points: 1000 - index,
        goalsFor: 1000 - index,
        goalsAgainst: index,
        wins: 30 - index,
        draws: 0,
        losses: index,
        played: 38,
      };
    });
  });

  const nextSeason = advanceSeason(data.players, teams, data.competitions, null, []);
  const nextCounts = Object.values(nextSeason.teams).reduce<Record<string, number>>((acc, team) => {
    acc[team.division] = (acc[team.division] || 0) + 1;
    return acc;
  }, {});

  assert(nextSeason.currentWeek === 1, 'Season rollover should reset the week to 1');
  assert(nextCounts['Premier League'] === 20, 'Premier League should keep 20 teams after promotion/relegation');
  assert(nextCounts['Championship'] === 24, 'Championship should keep 24 teams after promotion/relegation');
  assert(nextCounts['League One'] === 24, 'League One should keep 24 teams after promotion/relegation');
  assert(nextCounts['League Two'] === 24, 'League Two should keep 24 teams after promotion/relegation');

  const championshipTop = Object.values(teams)
    .filter(team => team.division === 'Championship')
    .sort((a, b) => b.points - a.points || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name))
    .slice(0, 3);
  const premierBottom = Object.values(teams)
    .filter(team => team.division === 'Premier League')
    .sort((a, b) => a.points - b.points || a.goalsFor - b.goalsFor || a.name.localeCompare(b.name))
    .slice(0, 3);

  assert(championshipTop.every(team => nextSeason.teams[team.id].division === 'Premier League'), 'Top Championship teams should be promoted');
  assert(premierBottom.every(team => nextSeason.teams[team.id].division === 'Championship'), 'Bottom Premier League teams should be relegated');
};

const checkStaleFormationMapRecoveryModel = () => {
  const data = initGameData();
  const team = Object.values(data.teams)[0];
  const starters = Object.values(data.players).filter(player => player.teamId === team.id && player.isStarting);
  const slots = getSlotsForFormation('4-3-3');
  const staleMap: Record<string, string> = {
    '0-0': starters[0]?.id,
    '0-1': 'missing-player-id',
  };
  const mappedStarterIds = new Set<string>();
  const rendered = slots.map(row => row.map(() => null as string | null));

  slots.forEach((row, rowIndex) => {
    row.forEach((_, colIndex) => {
      const playerId = staleMap[`${rowIndex}-${colIndex}`];
      const mappedStarter = playerId ? starters.find(player => player.id === playerId) : null;
      if (mappedStarter) {
        rendered[rowIndex][colIndex] = mappedStarter.id;
        mappedStarterIds.add(mappedStarter.id);
      }
    });
  });

  const missingStarters = starters.filter(player => !mappedStarterIds.has(player.id));
  rendered.forEach(row => {
    row.forEach((playerId, colIndex) => {
      if (!playerId && missingStarters.length > 0) row[colIndex] = missingStarters.shift()?.id || null;
    });
  });

  const renderedIds = new Set(rendered.flat().filter(Boolean));
  assert(renderedIds.size === Math.min(starters.length, slots.flat().length), 'Stale formation maps should not hide starters');
};

const checkFormationMapRejectsWrongPositions = () => {
  const data = initGameData('Arsenal');
  const team = Object.values(data.teams).find(item => item.name === 'Arsenal');
  assert(team, 'Regression setup needs Arsenal');

  const squad = Object.values(data.players).filter(player => player.teamId === team!.id);
  const keeper = squad.find(player => player.position === 'GK');
  const striker = squad.find(player => player.subPosition === 'ST' || player.position === 'FWD');
  const midfielder = squad.find(player => player.position === 'MID');

  assert(keeper && striker && midfielder, 'Regression setup needs keeper, striker, and midfielder');

  const starters = squad.map(player => ({
    ...player,
    isStarting: [keeper!.id, striker!.id, midfielder!.id].includes(player.id) || player.overallRating >= 80,
  })).filter(player => player.isStarting).slice(0, 11);

  const slots = getSlotsForFormation('4-3-3');
  const corruptedMap = {
    '0-0': keeper!.id,
    '0-2': midfielder!.id,
    '3-0': striker!.id,
  };

  const rebuiltSlots = rebuildFormationSlotPlayers(slots, starters, corruptedMap);
  const rebuiltMap = rebuildFormationMap(slots, starters, corruptedMap);

  assert(rebuiltSlots[3][0]?.position === 'GK', 'Corrupted formation map should put a keeper back in GK');
  assert(rebuiltSlots[0].every(player => player?.position !== 'GK'), 'Corrupted formation map should not leave a keeper in the forward line');
  assert(rebuiltMap['3-0'] === rebuiltSlots[3][0]?.id, 'Rebuilt map should persist the corrected GK slot');
};

const checkActiveCupRoundCountsAsReached = () => {
  const data = initGameData();
  const teamId = Object.keys(data.teams)[0];
  const activeQuarterFinal = {
    id: 'fa-cup' as const,
    name: 'FA Cup',
    shortName: 'FA',
    type: 'domestic_cup' as const,
    season: 1,
    entrantTeamIds: [teamId],
    rounds: [{
      key: 'quarter_final' as const,
      label: 'Quarter-final',
      week: 10,
      entrantTeamIds: [teamId],
      fixtureIds: [],
      byeTeamIds: [],
      winnerTeamIds: [],
      completed: false,
    }],
    currentRound: 'quarter_final' as const,
    eliminatedTeamIds: [],
  };

  assert(
    hasReachedCompetitionRound(activeQuarterFinal, teamId, 'quarter_final'),
    'Active participation in a cup round should count as reaching that board objective round'
  );
};

const checkBoardObjectiveIdsAreStable = () => {
  const profile = buildBoardProfile('A', 'Premier League');
  const first = buildBoardObjectives('A', 'Premier League', profile, ['fa-cup', 'europe']);
  const second = buildBoardObjectives('A', 'Premier League', profile, ['fa-cup', 'europe']);

  assert(
    JSON.stringify(first.map(objective => objective.id)) === JSON.stringify(second.map(objective => objective.id)),
    'Board objective IDs should be stable for the same team class, division, profile, and active competitions'
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
      const seasonWeeks = getSeasonWeekLimit(state.fixtures);

      for (let week = 1; week <= seasonWeeks; week++) {
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

        const transfers = computeWeeklyTransfers(state.players, state.teams, null, undefined, state.currentWeek);
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

const checkSanityMatchScores = () => {
  const data = initGameData();
  const state = {
    players: data.players,
    teams: data.teams,
    fixtures: data.fixtures
  };
  
  let highScores = 0;
  const fixturesToPlay = Object.values(state.fixtures).slice(0, 100);
  
  fixturesToPlay.forEach(fixture => {
    const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures);
    state.players = result.players;
    state.teams = result.teams;
    state.fixtures[fixture.id] = result.fixture;
    
    const combinedGoals = result.fixture.homeScore! + result.fixture.awayScore!;
    assert(combinedGoals < 15, `Unrealistic scoreline detected: ${result.fixture.homeScore} - ${result.fixture.awayScore}`);
    
    if (combinedGoals >= 7) {
      highScores++;
    }
  });

  // Ensure high scoring games exist but are rare (less than 15%)
  assert(highScores <= 15, `Too many high scoring games (7+ goals) detected in 100 matches: ${highScores}%`);
};

const checkZustandStoreLiveMatchCleanup = () => {
  useGameStore.getState().initializeGame('T1');
  const store = useGameStore.getState();
  
  const fixtureId = Object.keys(store.fixtures)[0];
  assert(fixtureId, 'Needs at least one fixture for store test');

  // Trigger Live Match start
  useGameStore.setState(prev => ({
    liveMatches: {
      ...prev.liveMatches,
      [fixtureId]: {
        initialized: true,
        homeStarterIds: [],
        awayStarterIds: [],
        yellowCardPlayerIds: [],
        sentOffPlayerIds: [],
        sentOffMinutes: {},
        homeGoalMinutes: [],
        awayGoalMinutes: []
      }
    }
  }));

  let stateCheck = useGameStore.getState();
  assert(stateCheck.liveMatches && stateCheck.liveMatches[fixtureId], 'Live match should exist in store');

  // Call the store action to finish
  useGameStore.getState().finishLiveMatch(fixtureId);
  
  stateCheck = useGameStore.getState();
  assert(
    !stateCheck.liveMatches || !stateCheck.liveMatches[fixtureId], 
    'Store should perfectly clean up live match state after ending'
  );
};

const checkRosterSizeConstraints = () => {
  const data = initGameData();
  const teams = Object.values(data.teams);
  
  teams.forEach(team => {
    const squad = Object.values(data.players).filter(p => p.teamId === team.id);
    assert(squad.length >= 14, `Team ${team.name} has critically small squad (${squad.length})`);
    assert(squad.length <= 40, `Team ${team.name} has unrealistically large squad (${squad.length})`);
  });
};


const runRegressionChecks = () => {
  console.log('--- ENGINE REGRESSION CHECKS ---');
  checkFormationSlotLookupUsesExactFormation();
  console.log('[OK] Exact formation slot lookup passed');
  checkCleanSheetWindows();
  console.log('[OK] Clean-sheet window checks passed');
  checkLiveSentOffMinutes();
  console.log('[OK] Live sent-off minute check passed');
  checkBranchGuards();
  console.log('[OK] Second-yellow and shape parity guards passed');
  checkUserTeamProgressionDoesNotAdaptFormation();
  console.log('[OK] User team tactical adaptation guard passed');
  checkManagerProfilesLoaded();
  console.log('[OK] Manager profile loading passed');
  checkDivisionBootstrap();
  console.log('[OK] Division bootstrap check passed');
  checkPromotionRelegation();
  console.log('[OK] Promotion and relegation checks passed');
  checkStaleFormationMapRecoveryModel();
  console.log('[OK] Stale formation-map recovery model passed');
  checkFormationMapRejectsWrongPositions();
  console.log('[OK] Wrong-position formation-map recovery passed');
  checkActiveCupRoundCountsAsReached();
  console.log('[OK] Active cup-round objective recognition passed');
  checkBoardObjectiveIdsAreStable();
  console.log('[OK] Stable board objective IDs passed');
  checkSeededFormationDiversity();
  console.log('[OK] Seeded formation diversity check passed');

  checkSanityMatchScores();
  console.log('[OK] Sanity Match Scores check passed');

  checkZustandStoreLiveMatchCleanup();
  console.log('[OK] Zustand Live Match cleanup check passed');

  checkRosterSizeConstraints();
  console.log('[OK] Roster Size constraints check passed');

  console.log('--- REGRESSION CHECKS COMPLETE ---');
};

runRegressionChecks();
