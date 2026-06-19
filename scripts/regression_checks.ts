import * as fs from 'fs';
import * as path from 'path';
import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { BASE_FORMATION_SLOTS, getSlotsForFormation } from '../src/constants/formations';
import { rebuildFormationMap, rebuildFormationSlotPlayers } from '../src/core/formationMapUtils';
import { getCompetitionPanelForTeam, hasReachedCompetitionRound } from '../src/core/competitionEngine';
import { buildBoardObjectives, buildBoardProfile } from '../src/core/boardEngine';
import {
  applySharedPostMatchAccounting,
  didConcedeInWindow,
  applyWindowedCleanSheets,
  qualifiesForWindowedCleanSheet,
} from '../src/core/postMatchAccounting';
import { advanceSeason } from '../src/core/seasonTransition';
import { applyTacticalAdaptation } from '../src/core/tacticalAdaptationEngine';
import { InboxMessage, Player, Team } from '../src/models/types';
import { useGameStore } from '../src/store/gameStore';
import { markAsSubState, toggleStartingState } from '../src/store/lineupActions';
import { buyPlayerState } from '../src/store/transferActions';
import { computeMarketValue } from '../src/utils/calendar';
import { applyInboxActionState } from '../src/store/inboxActions';
import { advanceWeekState } from '../src/store/weekLifecycle';
import { finishLiveMatchState, processLiveMatchMinuteState } from '../src/store/liveMatchActions';
import { sanitizePersistedState } from '../src/store/persistence';
import { isPlayerUnavailable } from '../src/core/playerStatusUtils';

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

const checkPossessionFlowIsNotStrictAlternation = () => {
  const matchEngine = readSource('src/core/matchEngine.ts');
  const liveMatchActions = readSource('src/store/liveMatchActions.ts');

  assert(
    !/const isHomeAttacking = \(\(i \+ \(firstAttackIsHome \? 0 : 1\)\) % 2\) === 0;/.test(matchEngine),
    'Quick sim should not use fixed home/away alternating attacks'
  );
  assert(
    !/const isHomeAttacking = \(\(possessionIndex \+ \(firstAttackIsHome \? 0 : 1\)\) % 2\) === 0;/.test(liveMatchActions),
    'Live sim should not use fixed home/away alternating attacks'
  );
};

const checkLiveSubstitutionsApplyBeforeFullTime = () => {
  useGameStore.getState().initializeGame('T1');
  let current = useGameStore.getState();
  const fixture = Object.values(current.fixtures)
    .find(item => item.homeTeamId !== 'T1' && item.awayTeamId !== 'T1');
  assert(fixture, 'Regression setup needs a non-user live fixture');

  const rng = { next: createSeededRandom(20260619) };
  const firstMinute = processLiveMatchMinuteState(current, fixture!.id, 1, rng);
  current = { ...current, ...firstMinute.patch };
  const initializedLiveMatch = current.liveMatches[fixture!.id];
  assert(initializedLiveMatch, 'Live match should initialize lineups');

  const initialHomeStarterIds = initializedLiveMatch.homeStarterIds;
  const initialAwayStarterIds = initializedLiveMatch.awayStarterIds;
  assert(initialHomeStarterIds.length === 11 && initialAwayStarterIds.length === 11, 'Live substitution regression needs full starting XIs');

  for (let minute = 2; minute <= 66; minute += 1) {
    const result = processLiveMatchMinuteState(current, fixture!.id, minute, rng);
    current = { ...current, ...result.patch };
  }

  const liveMatch = current.liveMatches[fixture!.id];
  assert(liveMatch, 'Live match state should exist after minute processing');
  const inspectableLiveMatch = liveMatch as typeof liveMatch & {
    currentHomePlayerIds?: string[];
    currentAwayPlayerIds?: string[];
    homeMinuteMap?: Record<string, number>;
    awayMinuteMap?: Record<string, number>;
  };
  const homeMinuteMap = inspectableLiveMatch.homeMinuteMap || {};
  const awayMinuteMap = inspectableLiveMatch.awayMinuteMap || {};
  const activeIds = [
    ...(inspectableLiveMatch.currentHomePlayerIds || []),
    ...(inspectableLiveMatch.currentAwayPlayerIds || []),
  ];
  const initialStarterIds = new Set([...initialHomeStarterIds, ...initialAwayStarterIds]);

  assert(
    Object.values(homeMinuteMap).some(minutes => minutes > 0 && minutes < 90) ||
      Object.values(awayMinuteMap).some(minutes => minutes > 0 && minutes < 90),
    'Live substitutions should update player minute maps before full time'
  );
  assert(
    activeIds.some(playerId => !initialStarterIds.has(playerId)),
    'Live active XIs should include substitutes before full time'
  );
};

const checkActiveLiveMatchBlocksWeekAdvance = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for active live match regression');
  const fixture = Object.values(data.fixtures).find(item => (
    item.week === 1 &&
    (item.homeTeamId === userTeam!.id || item.awayTeamId === userTeam!.id)
  ));
  assert(fixture, 'Expected week-one Arsenal fixture for active live match regression');
  const homeStarterIds = Object.values(data.players)
    .filter(player => player.teamId === fixture!.homeTeamId)
    .slice(0, 11)
    .map(player => player.id);
  const awayStarterIds = Object.values(data.players)
    .filter(player => player.teamId === fixture!.awayTeamId)
    .slice(0, 11)
    .map(player => player.id);
  assert(homeStarterIds.length === 11 && awayStarterIds.length === 11, 'Active live match regression needs full XIs');

  const state = {
    currentWeek: 1,
    userTeamId: userTeam!.id,
    teams: data.teams,
    players: data.players,
    fixtures: data.fixtures,
    competitions: data.competitions,
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    boardReviewAppliedWeek: 0,
    careerRecord: {
      seasonsManaged: 0,
      totalWins: 0,
      totalDraws: 0,
      totalLosses: 0,
      totalGoalsFor: 0,
      totalGoalsAgainst: 0,
      reputation: 50,
      trophies: [],
      seasonHistory: [],
      consecutiveLowApprovalWeeks: 0,
    },
    liveMatches: {
      [fixture!.id]: {
        initialized: true,
        yellowCardPlayerIds: [],
        sentOffPlayerIds: [],
        homeStarterIds,
        awayStarterIds,
      },
    },
  };

  const result = advanceWeekState(state);
  assert(result.currentWeek === 1, 'Week advance should not skip past an active live match');
  assert(!result.fixtures[fixture!.id].isPlayed, 'Active live fixture should remain unplayed until resolved');
};

const checkStaleLiveMatchRecovery = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for stale live match recovery');
  const currentFixture = Object.values(data.fixtures).find(item => (
    item.week === 1 &&
    !item.isPlayed &&
    item.homeTeamId !== userTeam!.id &&
    item.awayTeamId !== userTeam!.id
  ));
  const futureFixture = Object.values(data.fixtures).find(item => item.week > 1 && !item.isPlayed);
  const playedFixture = Object.values(data.fixtures).find(item => (
    item.id !== currentFixture?.id &&
    item.week === 1
  ));
  assert(currentFixture && futureFixture && playedFixture, 'Expected fixtures for stale live match recovery');

  const homeStarterIds = Object.values(data.players)
    .filter(player => player.teamId === currentFixture!.homeTeamId)
    .slice(0, 11)
    .map(player => player.id);
  const awayStarterIds = Object.values(data.players)
    .filter(player => player.teamId === currentFixture!.awayTeamId)
    .slice(0, 11)
    .map(player => player.id);
  const wrongHomeStarterIds = Object.values(data.players)
    .filter(player => player.teamId !== currentFixture!.homeTeamId)
    .slice(0, 11)
    .map(player => player.id);
  assert(homeStarterIds.length === 11 && awayStarterIds.length === 11, 'Expected full XIs for stale recovery');
  assert(wrongHomeStarterIds.length === 11, 'Expected wrong-team XI for stale recovery');

  const liveMatch = {
    initialized: true,
    yellowCardPlayerIds: [],
    sentOffPlayerIds: [],
    homeStarterIds,
    awayStarterIds,
  };
  const persisted = sanitizePersistedState({
    currentWeek: 1,
    userTeamId: userTeam!.id,
    teams: data.teams,
    players: data.players,
    fixtures: {
      ...data.fixtures,
      [playedFixture!.id]: { ...playedFixture!, isPlayed: true },
    },
    competitions: data.competitions,
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    liveMatches: {
      [currentFixture!.id]: liveMatch,
      missing_fixture: liveMatch,
      [futureFixture!.id]: liveMatch,
      [playedFixture!.id]: liveMatch,
      wrong_team_fixture: {
        ...liveMatch,
        homeStarterIds: wrongHomeStarterIds,
      },
    },
  } as any);

  const persistedLiveMatches = persisted.liveMatches || {};
  assert(persistedLiveMatches[currentFixture!.id], 'Valid current live match should survive rehydration');
  assert(!persistedLiveMatches.missing_fixture, 'Missing-fixture live match should be cleared on rehydration');
  assert(!persistedLiveMatches[futureFixture!.id], 'Wrong-week live match should be cleared on rehydration');
  assert(!persistedLiveMatches[playedFixture!.id], 'Played-fixture live match should be cleared on rehydration');
  assert(!persistedLiveMatches.wrong_team_fixture, 'Invalid-team live match should be cleared on rehydration');

  const advanced = advanceWeekState({
    currentWeek: 1,
    userTeamId: userTeam!.id,
    teams: data.teams,
    players: data.players,
    fixtures: data.fixtures,
    competitions: data.competitions,
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    boardReviewAppliedWeek: 0,
    transfersAppliedWeek: 0,
    careerRecord: {
      seasonsManaged: 0,
      totalWins: 0,
      totalDraws: 0,
      totalLosses: 0,
      totalGoalsFor: 0,
      totalGoalsAgainst: 0,
      reputation: 50,
      trophies: [],
      seasonHistory: [],
      consecutiveLowApprovalWeeks: 0,
    },
    liveMatches: {
      [currentFixture!.id]: {
        ...liveMatch,
        homeStarterIds: wrongHomeStarterIds,
      },
    },
  });
  assert(advanced.currentWeek > 1, 'Invalid stale live match should not block week advance');
  assert(!advanced.liveMatches[currentFixture!.id], 'Invalid stale live match should be cleared during week advance');

  useGameStore.setState({
    currentWeek: 1,
    userTeamId: userTeam!.id,
    teams: data.teams,
    players: data.players,
    fixtures: {
      ...data.fixtures,
      [currentFixture!.id]: { ...currentFixture!, homeScore: null, awayScore: null, isPlayed: false },
    },
    competitions: data.competitions,
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    liveMatches: {
      [currentFixture!.id]: liveMatch,
      missing_fixture: liveMatch,
    },
  });
  const recoveredCount = useGameStore.getState().clearStuckLiveMatches();
  assert(recoveredCount === 2, 'Recovery action should finish valid blockers and clear invalid live matches');
  assert(!useGameStore.getState().liveMatches[currentFixture!.id], 'Recovery action should clear finished live match');
  assert(useGameStore.getState().fixtures[currentFixture!.id].isPlayed, 'Recovery action should finish valid active fixture');
};

const checkDirectFinishCompletesUnprocessedLiveMatch = () => {
  const data = initGameData('Arsenal');
  const fixture = Object.values(data.fixtures).find(item => item.homeTeamId !== 'T1' && item.awayTeamId !== 'T1');
  assert(fixture, 'Expected a non-user fixture for direct finish regression');

  const buildState = () => ({
    currentWeek: 1,
    userTeamId: 'T1',
    teams: data.teams,
    players: data.players,
    fixtures: {
      ...data.fixtures,
      [fixture!.id]: { ...fixture!, homeScore: null, awayScore: null, isPlayed: false },
    },
    competitions: data.competitions,
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    boardReviewAppliedWeek: 0,
    transfersAppliedWeek: 0,
    careerRecord: {
      seasonsManaged: 0,
      totalWins: 0,
      totalDraws: 0,
      totalLosses: 0,
      totalGoalsFor: 0,
      totalGoalsAgainst: 0,
      reputation: 50,
      trophies: [],
      seasonHistory: [],
      consecutiveLowApprovalWeeks: 0,
    },
    liveMatches: {},
  });

  let minuteState: any = buildState();
  const minuteRng = { next: createSeededRandom(20260601) };
  for (let minute = 1; minute <= 90; minute += 1) {
    const result = processLiveMatchMinuteState(minuteState, fixture!.id, minute, minuteRng);
    minuteState = { ...minuteState, ...result.patch };
  }
  const expected: any = finishLiveMatchState(minuteState, fixture!.id, minuteRng);
  const direct: any = finishLiveMatchState(buildState(), fixture!.id, { next: createSeededRandom(20260601) });

  assert(direct.fixtures[fixture!.id].isPlayed, 'Direct finish should mark fixture played');
  assert(!direct.liveMatches[fixture!.id], 'Direct finish should clear live-match state');
  assert(
    direct.fixtures[fixture!.id].homeScore === expected.fixtures[fixture!.id].homeScore &&
      direct.fixtures[fixture!.id].awayScore === expected.fixtures[fixture!.id].awayScore,
    'Direct finish should simulate unprocessed minutes before final accounting'
  );
};

const checkCompetitionPanelHandlesMissingTeam = () => {
  const data = initGameData('Arsenal');
  const team = Object.values(data.teams).find(item => item.name === 'Arsenal');
  assert(team, 'Expected Arsenal for competition panel missing-team regression');

  const panel = getCompetitionPanelForTeam(
    'fa-cup',
    {
      ...data.competitions,
      'fa-cup': {
        ...data.competitions['fa-cup'],
        championTeamId: team!.id,
      },
    },
    data.fixtures,
    {},
    team!.id,
    60
  );

  assert(panel.status === 'Winner', 'Missing-team panel should still report winner status');
  assert(panel.note === 'Your club lifted the trophy', 'Missing-team winner note should use fallback club name');
};

const checkFreezeRecoveryControlsAreVisible = () => {
  const gameStore = readSource('src/store/gameStore.ts');
  const devTools = readSource('components/settings/dev-tools-card.tsx');
  const settings = readSource('app/(tabs)/settings.tsx');

  assert(
    /catch \(error\)[\s\S]*console\.warn/.test(gameStore),
    'skipToEndOfSeason should warn when week advancement fails'
  );
  assert(
    /clearStuckLiveMatches/.test(gameStore) &&
      /Clear Stuck Live Match/.test(devTools) &&
      /clearStuckLiveMatches/.test(settings),
    'Dev tools should expose a stuck live-match recovery action'
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

const checkDisciplineRatesArePlausible = () => {
  const originalRandom = Math.random;
  Math.random = createSeededRandom(20260618);

  try {
    const data = initGameData();
    const state = {
      players: data.players,
      teams: data.teams,
      fixtures: data.fixtures,
    };
    const fixturesToPlay = Object.values(state.fixtures).slice(0, 900);
    let yellowCards = 0;
    let redCards = 0;

    fixturesToPlay.forEach(fixture => {
      const beforeCards = Object.values(state.players).reduce(
        (acc, player) => ({
          yellow: acc.yellow + player.yellowCards,
          red: acc.red + player.redCards,
        }),
        { yellow: 0, red: 0 }
      );
      const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures);
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fixture.id] = result.fixture;
      const afterCards = Object.values(state.players).reduce(
        (acc, player) => ({
          yellow: acc.yellow + player.yellowCards,
          red: acc.red + player.redCards,
        }),
        { yellow: 0, red: 0 }
      );
      yellowCards += afterCards.yellow - beforeCards.yellow;
      redCards += afterCards.red - beforeCards.red;
    });

    const yellowRate = yellowCards / fixturesToPlay.length;
    const redRate = redCards / fixturesToPlay.length;
    assert(
      yellowRate >= 2.5 && yellowRate <= 5.5,
      `Expected plausible yellow-card rate, got ${yellowRate.toFixed(2)} per match`
    );
    assert(
      redRate >= 0.06 && redRate <= 0.35,
      `Expected plausible red-card rate, got ${redRate.toFixed(2)} per match`
    );
  } finally {
    Math.random = originalRandom;
  }
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

const checkManualTransfersRespectWindow = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams).find(team => team.division === 'Premier League');
  const sellerTeam = Object.values(data.teams)
    .find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  assert(userTeam && sellerTeam, 'Expected user and seller teams for manual transfer window regression');

  const target = Object.values(data.players).find(player => player.teamId === sellerTeam!.id && !player.isStarting);
  assert(target, 'Expected a seller player for manual transfer window regression');

  const askingPrice = Math.max(1, Math.min(5, target!.marketValue || 1));
  const players = {
    ...data.players,
    [target!.id]: {
      ...target!,
      isTransferListed: true,
      askingPrice,
    },
  };
  const teams: Record<string, Team> = {
    ...data.teams,
    [userTeam!.id]: {
      ...userTeam!,
      budget: 100,
      transferSpend: 0,
    },
  };

  const result = buyPlayerState(
    {
      currentWeek: 10,
      players,
      teams,
      userTeamId: userTeam!.id,
    },
    target!.id,
    askingPrice,
    target!.wage
  );
  const resultingPlayers = result.patch.players || players;

  assert(!result.result.success, 'Manual transfer purchase should fail outside the transfer window');
  assert(
    resultingPlayers[target!.id].teamId === sellerTeam!.id,
    'Rejected manual transfer should leave the player at the selling club'
  );
};

const checkManualTransfersRejectNonFiniteMoney = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams).find(team => team.division === 'Premier League');
  const sellerTeam = Object.values(data.teams)
    .find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  assert(userTeam && sellerTeam, 'Expected teams for non-finite transfer regression');
  const target = Object.values(data.players).find(player => player.teamId === sellerTeam!.id && !player.isStarting);
  assert(target, 'Expected target player for non-finite transfer regression');

  const players = {
    ...data.players,
    [target!.id]: {
      ...target!,
      isTransferListed: true,
      askingPrice: 5,
    },
  };
  const teams = {
    ...data.teams,
    [userTeam!.id]: {
      ...userTeam!,
      budget: 100,
      transferSpend: 0,
    },
  };
  const result = buyPlayerState(
    {
      currentWeek: 2,
      players,
      teams,
      userTeamId: userTeam!.id,
    },
    target!.id,
    Number.NaN,
    target!.wage
  );
  const nextTeams = result.patch.teams || teams;

  assert(!result.result.success, 'Manual transfer purchase should reject NaN fees');
  assert(nextTeams[userTeam!.id].budget === 100, 'Rejected NaN transfer should not corrupt buyer budget');
};

const checkUnavailableBenchPlayersCanBeRemoved = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams).find(team => team.division === 'Premier League');
  assert(userTeam, 'Expected a user team for unavailable bench regression');

  const benchPlayer = Object.values(data.players)
    .find(player => player.teamId === userTeam!.id && !player.isStarting);
  assert(benchPlayer, 'Expected a bench candidate for unavailable bench regression');

  const players = {
    ...data.players,
    [benchPlayer!.id]: {
      ...benchPlayer!,
      isStarting: false,
      isSub: true,
      injuryWeeks: 2,
    },
  };
  const result = markAsSubState(
    {
      players,
      teams: data.teams,
      userTeamId: userTeam!.id,
    },
    benchPlayer!.id
  );
  const resultingPlayers = result.players || players;
  const squadScreen = readSource('app/(tabs)/squad.tsx');

  assert(
    !resultingPlayers[benchPlayer!.id].isSub,
    'Unavailable bench player should be removable from the bench'
  );
  assert(
    /const bench\s*=\s*sortedSquad\.filter\([^)]*!isPlayerUnavailable/.test(squadScreen),
    'Squad screen bench capacity should ignore unavailable substitutes'
  );
};

const checkRecoveredSelectedBenchDoesNotOverflow = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for recovered bench overflow regression');
  const squad = Object.values(data.players)
    .filter(player => player.teamId === userTeam!.id)
    .sort((a, b) => b.overallRating - a.overallRating);
  assert(squad.length >= 19, 'Recovered bench overflow regression needs a deep squad');

  const starterIds = new Set(squad.slice(0, 11).map(player => player.id));
  const activeSubIds = new Set(squad.slice(11, 18).map(player => player.id));
  const recoveringSub = squad[18];
  const seededPlayers = Object.fromEntries(
    Object.entries(data.players).map(([id, player]) => {
      if (starterIds.has(id)) return [id, { ...player, isStarting: true, isSub: false }];
      if (activeSubIds.has(id)) return [id, { ...player, isStarting: false, isSub: true }];
      if (id === recoveringSub.id) {
        return [id, {
          ...player,
          isStarting: false,
          isSub: true,
          injuryWeeks: 1,
          injuryType: 'ankle knock',
          injuryAppliedWeek: 3,
        }];
      }
      return [id, { ...player, isStarting: false, isSub: false }];
    })
  );

  const progressed = computeWeeklyProgression(
    5,
    seededPlayers,
    data.teams,
    data.fixtures,
    [],
    userTeam!.id,
    { next: createSeededRandom(20260618) }
  );
  const activeSubs = Object.values(progressed.players).filter(player => (
    player.teamId === userTeam!.id &&
    player.isSub &&
    !isPlayerUnavailable(player)
  ));

  assert(activeSubs.length <= 7, `Recovered selected substitute should not create ${activeSubs.length} active bench players`);
};

const checkLineupActionsPreserveBenchLimit = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for bench limit regression');
  const teamPlayers = Object.values(data.players)
    .filter(player => player.teamId === userTeam!.id)
    .sort((a, b) => b.overallRating - a.overallRating);
  const starter = teamPlayers[0];
  assert(starter, 'Expected a starter candidate for bench limit regression');

  const players = Object.fromEntries(Object.entries(data.players).map(([playerId, player]) => {
    if (player.teamId !== userTeam!.id) return [playerId, player];
    const index = teamPlayers.findIndex(candidate => candidate.id === player.id);
    return [
      playerId,
      {
        ...player,
        isStarting: player.id === starter.id,
        isSub: index > 0 && index <= 7,
      },
    ];
  }));

  const result = toggleStartingState(
    { players, teams: data.teams, userTeamId: userTeam!.id },
    starter.id
  );
  const nextPlayers = 'players' in result && result.players ? result.players : players;
  const activeBench = Object.values(nextPlayers)
    .filter(player => player.teamId === userTeam!.id && player.isSub && !player.isStarting);

  assert(activeBench.length <= 7, 'Removing a starter should not create an eighth active substitute');
};

const checkLineupInboxActionFiltersStaleFormationMap = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for stale lineup action regression');
  const teamPlayers = Object.values(data.players)
    .filter(player => player.teamId === userTeam!.id)
    .sort((a, b) => b.overallRating - a.overallRating);
  const startingIds = teamPlayers.slice(0, 11).map(player => player.id);
  const staleStarterId = startingIds[0];
  const subIds = teamPlayers.slice(11, 18).map(player => player.id);
  assert(staleStarterId && subIds.length > 0, 'Expected enough players for stale lineup action regression');

  const message: InboxMessage = {
    id: 'stale-lineup-action',
    week: 1,
    source: 'assistant',
    category: 'lineup_suggestion',
    title: 'Lineup',
    body: 'Lineup',
    isRead: false,
    teamId: userTeam!.id,
    action: {
      type: 'apply_lineup',
      payload: {
        teamId: userTeam!.id,
        startingIds,
        subIds,
        formationMap: Object.fromEntries(startingIds.map((playerId, index) => [`0-${index}`, playerId])),
      },
    },
  };

  const players = {
    ...data.players,
    [staleStarterId]: {
      ...data.players[staleStarterId],
      injuryWeeks: 2,
    },
  };
  const result = applyInboxActionState({
    currentWeek: 1,
    userTeamId: userTeam!.id,
    teams: data.teams,
    players,
    fixtures: data.fixtures,
    competitions: data.competitions,
    inboxMessages: [message],
    boardObjectives: [],
    careerRecord: {
      seasonsManaged: 0,
      totalWins: 0,
      totalDraws: 0,
      totalLosses: 0,
      totalGoalsFor: 0,
      totalGoalsAgainst: 0,
      reputation: 50,
      trophies: [],
      seasonHistory: [],
      consecutiveLowApprovalWeeks: 0,
    },
  }, message.id);
  const nextTeams = result.teams || data.teams;
  const nextPlayers = result.players || players;
  const mappedIds = Object.values(nextTeams[userTeam!.id].formationMap || {});

  assert(!nextPlayers[staleStarterId].isStarting, 'Unavailable stale lineup player should not be selected');
  assert(!mappedIds.includes(staleStarterId), 'Applied lineup map should not retain unavailable non-starters');
};

const checkSeasonReportsUseCompetitionLifecycleAndLeagueTables = () => {
  const detailedReport = readSource('scripts/detailed_season_sim.ts');
  const trackerReport = readSource('scripts/season_tracker.ts');

  [detailedReport, trackerReport].forEach((source, index) => {
    const label = index === 0 ? 'Detailed season report' : 'Season tracker';
    assert(
      /resolveCompetitionProgression/.test(source),
      `${label} should advance knockout competition rounds during season simulation`
    );
    assert(
      /getSeasonWeekLimit\(state\.fixtures,\s*state\.competitions\)/.test(source),
      `${label} should include competition state when calculating season length`
    );
  });

  assert(
    /Object\.values\(state\.teams\)\.filter\(.*division === 'Premier League'/.test(detailedReport.replace(/\s+/g, ' ')),
    'Detailed report should filter the Premier League table to Premier League clubs'
  );
  assert(
    /division:\s*team\.division/.test(trackerReport),
    'Season tracker table rows should include team division'
  );
  assert(
    /team\.played > 0[\s\S]*team\.goalsFor < 20/.test(trackerReport),
    'Season tracker low-scoring audit should ignore inactive external teams'
  );
  assert(
    /red card\|sent off\|straight red\|reaches for red/i.test(detailedReport),
    'Detailed report red-card audit should use the same event pattern as tracker and CI'
  );
};

const checkAiTransferListingsExpireOutsideWindow = () => {
  const data = initGameData();
  const listedPlayer = Object.values(data.players).find(player => !player.isStarting);
  assert(listedPlayer, 'Expected a player for transfer listing expiry regression');

  const players = {
    ...data.players,
    [listedPlayer!.id]: {
      ...listedPlayer!,
      isTransferListed: true,
      askingPrice: Math.max(1, listedPlayer!.marketValue || 1),
    },
  };

  const result = computeWeeklyTransfers(players, data.teams, null, undefined, 5);
  assert(
    !result.players[listedPlayer!.id].isTransferListed,
    'AI transfer listings should expire when the transfer window closes'
  );
  assert(
    result.players[listedPlayer!.id].askingPrice === 0,
    'Expired AI transfer listings should clear the asking price'
  );
};

const checkSeasonEndProgressionUpdatesMatchAbility = () => {
  const data = initGameData();
  const seasonWeekLimit = getSeasonWeekLimit(data.fixtures, data.competitions);
  const player = Object.values(data.players).find(item => item.age <= 22 && item.position !== 'GK');
  assert(player, 'Expected a young outfield player for progression regression');

  const result = computeWeeklyProgression(
    seasonWeekLimit,
    {
      ...data.players,
      [player!.id]: {
        ...player!,
        overallRating: 70,
        marketValue: 1,
        age: 21,
        stats: {
          ...player!.stats,
          pace: 70,
          shooting: 70,
          passing: 70,
          dribbling: 70,
          defending: 70,
          physical: 70,
        },
      },
    },
    data.teams,
    data.fixtures,
    [],
    null,
    { next: () => 0 }
  );
  const progressed = result.players[player!.id];

  assert(progressed.overallRating === 71, 'Young player should gain overall at season end with seeded progression');
  assert(progressed.stats.passing > 70, 'Season-end progression should improve detailed match stats, not just overall');
  assert(
    progressed.marketValue === computeMarketValue(progressed.overallRating, progressed.age),
    'Season-end progression should refresh market value from new rating and age'
  );
};

const checkContractDeparturesPreferViableDestinations = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams).find(team => team.division === 'Premier League');
  assert(userTeam, 'Expected a user team for contract destination regression');
  const departurePlayer = Object.values(data.players).find(player => player.teamId === userTeam!.id);
  assert(departurePlayer, 'Expected a departing player for contract destination regression');

  const sameDivisionTeams = Object.values(data.teams)
    .filter(team => team.id !== userTeam!.id && team.division === userTeam!.division);
  assert(sameDivisionTeams.length >= 2, 'Expected same-division destination teams for contract destination regression');

  const players = {
    ...data.players,
    [departurePlayer!.id]: {
      ...departurePlayer!,
      contractLeft: 0,
      overallRating: 82,
      marketValue: 35,
    },
  };

  const nextSeason = advanceSeason(players, data.teams, data.competitions, userTeam!.id, []);
  const destTeamId = nextSeason.players[departurePlayer!.id].teamId;
  const destTeam = nextSeason.teams[destTeamId];
  const destDivision = destTeam?.division;

  // The player must leave the user team and land on a valid same-division team.
  assert(destTeamId !== userTeam!.id, 'Expired-contract player should leave the user team');
  assert(destTeam, 'Expired-contract player should land on a valid destination team');
  assert(
    destDivision === userTeam!.division,
    `Expired-contract player should land in the same division (${userTeam!.division}), got ${destDivision}`
  );
  // Destination team should be able to afford the player (budget >= marketValue).
  assert(
    destTeam.budget >= (players[departurePlayer!.id].marketValue || 0),
    `Destination team should have sufficient budget (${destTeam.budget}) for the player's market value (${players[departurePlayer!.id].marketValue})`
  );
};

const checkUiContractsMatchEngineState = () => {
  const statsScreen = readSource('app/stats.tsx');
  const hubScreen = readSource('app/(tabs)/index.tsx');
  const settingsScreen = readSource('app/(tabs)/settings.tsx');
  const calendarScreen = readSource('app/calendar.tsx');
  const calendarRow = readSource('components/calendar/calendar-fixture-row.tsx');
  const calendarUtils = readSource('src/utils/calendar.ts');
  const squadScreen = readSource('app/(tabs)/squad.tsx');
  const tacticsScreen = readSource('app/(tabs)/tactics.tsx');

  assert(
    /All-Competition Stats/.test(statsScreen) && /playerTeam\.division === userTeam\.division/.test(statsScreen),
    'Stats screen should honestly label aggregate all-competition leaderboards for the managed division'
  );
  assert(
    /position === 'GK'/.test(hubScreen),
    'Hub clean-sheet leader should use the same goalkeeper filter as Golden Glove stats'
  );
  assert(
    /filter\(team => !team\.isExternal\)/.test(settingsScreen),
    'Team picker should exclude external Continental clubs'
  );
  assert(
    !/2024\/25 Fixtures/.test(calendarScreen) && /formatSeasonLabel/.test(calendarScreen),
    'Calendar screen should render a dynamic season label'
  );
  assert(
    /formatSeasonLabel/.test(calendarUtils),
    'Calendar utilities should expose a season label helper'
  );
  assert(
    /competitionLabel/.test(calendarScreen) && /roundLabel/.test(calendarScreen) && /competitionLabel/.test(calendarRow),
    'Calendar rows should show competition context for cup and Europe fixtures'
  );
  assert(
    /Tap a reserve to designate as sub/.test(squadScreen),
    'Squad empty-bench instruction should match the tap interaction'
  );
  assert(
    !/Conserves 25%|35% more energy|astronomical energy drain|30% better tackling/.test(tacticsScreen),
    'Tactics copy should not claim effects the engine does not implement'
  );
};

const checkValidationCatchesPastUnplayedFixturesAndNonFiniteFinances = () => {
  const validator = readSource('src/dev/agentGameHandler.ts');
  assert(
    /fixture\.week < current\.currentWeek[\s\S]*!fixture\.isPlayed/.test(validator),
    'Agent validation should catch unplayed fixtures left in past weeks'
  );
  assert(
    /Number\.isFinite\(team\.budget\)/.test(validator) && /Number\.isFinite\(team\.transferSpend\)/.test(validator),
    'Agent validation should catch non-finite team finance values'
  );
};

const checkInitialGameSetupCanBeSeeded = () => {
  const summarize = () => {
    const data = initGameData(undefined, { next: createSeededRandom(20260618) });
    return JSON.stringify({
      teamTactics: Object.values(data.teams).slice(0, 8).map(team => [team.id, team.tactics]),
      players: Object.values(data.players).slice(0, 30).map(player => [
        player.id,
        player.morale,
        player.energy,
        player.contractLeft,
      ]),
    });
  };

  assert(
    summarize() === summarize(),
    'Initial game data should be reproducible when supplied the same seeded random generator'
  );
};

const checkStoreInitializesSelectedTeamDefaults = () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    useGameStore.getState().initializeGame('T1');
    const state = useGameStore.getState();
    const userTeam = state.teams[state.userTeamId!];
    const userPlayers = Object.values(state.players).filter(player => player.teamId === userTeam.id);

    assert(userTeam.name === 'Arsenal', 'Regression assumes T1 is Arsenal');
    assert(
      JSON.stringify(userTeam.tactics) === JSON.stringify({
        mentality: 'Balanced',
        passingStyle: 'Mixed',
        tempo: 'Normal',
        defensiveLine: 'Standard',
        pressing: 'Medium',
      }),
      'Selected team should receive user-team default tactics during initialization'
    );
    assert(
      userPlayers.every(player => !player.isStarting && !player.isSub),
      'Selected team players should stay unselected until the user picks a lineup'
    );
  } finally {
    Math.random = originalRandom;
  }
};

const checkTacticalAdaptationRunsOncePerPlayedCount = () => {
  const data = initGameData();
  const team = Object.values(data.teams).find(candidate => candidate.id !== 'T1') as Team | undefined;
  assert(team, 'Expected an AI team for tactical adaptation regression');

  const teams: Record<string, Team> = {
    ...data.teams,
    [team!.id]: {
      ...team!,
      played: 4,
      goalsFor: 8,
      goalsAgainst: 12,
      losses: 4,
      form: ['L', 'L', 'L', 'L'],
      tactics: {
        mentality: 'Attacking',
        passingStyle: 'Direct',
        tempo: 'Fast',
        defensiveLine: 'High',
        pressing: 'High',
      },
      manager: {
        ...team!.manager,
        pressureScore: 75,
      },
    },
  };

  const rng = { next: () => 0 };
  applyTacticalAdaptation(data.players, teams, new Set(), rng);
  const afterFirst = JSON.stringify({
    formation: teams[team!.id].activeFormation,
    tactics: teams[team!.id].tactics,
  });
  applyTacticalAdaptation(data.players, teams, new Set(), rng);
  const afterSecond = JSON.stringify({
    formation: teams[team!.id].activeFormation,
    tactics: teams[team!.id].tactics,
  });

  assert(afterSecond === afterFirst, 'Tactical adaptation should not repeatedly react to the same played count');
};

const checkTacticalAdaptationIgnoresUnavailablePlayers = () => {
  const data = initGameData();
  const team = Object.values(data.teams).find(candidate => (
    candidate.division === 'Premier League' &&
    candidate.id !== 'T1'
  ));
  assert(team, 'Expected AI team for unavailable tactical adaptation regression');
  const defenders = Object.values(data.players)
    .filter(player => player.teamId === team!.id && player.position === 'DEF')
    .sort((a, b) => b.overallRating - a.overallRating);
  assert(defenders.length >= 3, 'Expected defenders for unavailable tactical adaptation regression');

  const injuredIds = defenders.slice(0, Math.max(1, defenders.length - 2)).map(player => player.id);
  const players = {
    ...data.players,
    ...Object.fromEntries(injuredIds.map(playerId => [
      playerId,
      {
        ...data.players[playerId],
        injuryWeeks: 4,
      },
    ])),
  };
  const teams: Record<string, Team> = {
    ...data.teams,
    [team!.id]: {
      ...team!,
      played: 4,
      goalsFor: 7,
      goalsAgainst: 10,
      losses: 3,
      form: ['L', 'L', 'D', 'L'],
      activeFormation: '4-3-3',
      tactics: {
        mentality: 'Attacking',
        passingStyle: 'Direct',
        tempo: 'Fast',
        defensiveLine: 'High',
        pressing: 'High',
      },
      manager: {
        ...team!.manager,
        pressureScore: 80,
        preferredFormations: ['5-2-3'],
      },
    },
  };

  applyTacticalAdaptation(players, teams, new Set(), { next: () => 0 });
  assert(
    !teams[team!.id].activeFormation.startsWith('5'),
    'AI formation adaptation should not choose a back five using injured defensive depth'
  );
};

const checkMatchRatingsIncludeIndividualOutput = () => {
  const base = Object.values(initGameData().players).find(player => player.position === 'FWD');
  assert(base, 'Expected a forward for rating contribution regression');
  const scorer: Player = {
    ...base!,
    id: 'rating-scorer',
    name: 'Rating Scorer',
    goals: 1,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    matchRatingHistory: [],
  };
  const teammate: Player = {
    ...base!,
    id: 'rating-teammate',
    name: 'Rating Teammate',
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    matchRatingHistory: [],
  };
  const players = {
    [scorer.id]: scorer,
    [teammate.id]: teammate,
  };

  applySharedPostMatchAccounting({
    teamParticipants: [scorer, teammate],
    teamStarterIds: new Set([scorer.id, teammate.id]),
    minuteMap: { [scorer.id]: 90, [teammate.id]: 90 },
    concededGoalMinutes: [],
    concededGoalsTotal: 0,
    isWin: true,
    isDraw: false,
    teamTactics: {
      mentality: 'Balanced',
      passingStyle: 'Mixed',
      tempo: 'Normal',
      defensiveLine: 'Standard',
      pressing: 'Medium',
    },
    updatedPlayers: players,
    rng: { next: () => 0.5 },
    playerMatchContributions: {
      [scorer.id]: { goals: 1, assists: 0, yellowCards: 0, redCards: 0 },
    },
  });

  const scorerRating = players[scorer.id].matchRatingHistory.at(-1) || 0;
  const teammateRating = players[teammate.id].matchRatingHistory.at(-1) || 0;
  assert(scorerRating > teammateRating, 'A goalscorer should receive a better match rating than a similar teammate');
};

const checkCleanSheetRatingsUsePlayerWindow = () => {
  const base = Object.values(initGameData().players).find(player => player.position === 'DEF');
  assert(base, 'Expected defender for clean-sheet rating regression');
  const defender: Player = {
    ...base!,
    id: 'rating-clean-window',
    cleanSheets: 0,
    matchRatingHistory: [],
  };
  const players = { [defender.id]: defender };

  applySharedPostMatchAccounting({
    teamParticipants: [defender],
    teamStarterIds: new Set([defender.id]),
    minuteMap: { [defender.id]: 60 },
    concededGoalMinutes: [80],
    concededGoalsTotal: 1,
    isWin: false,
    isDraw: true,
    teamTactics: {
      mentality: 'Balanced',
      passingStyle: 'Mixed',
      tempo: 'Normal',
      defensiveLine: 'Standard',
      pressing: 'Medium',
    },
    updatedPlayers: players,
    rng: { next: () => 0.5 },
  });

  assert(players[defender.id].cleanSheets === 1, 'Defender should receive windowed clean-sheet stat');
  assert(
    (players[defender.id].matchRatingHistory.at(-1) || 0) >= 7.0,
    'Windowed clean sheet should also contribute to defender match rating'
  );
};


const runRegressionChecks = () => {
  console.log('--- ENGINE REGRESSION CHECKS ---');
  checkFormationSlotLookupUsesExactFormation();
  console.log('[OK] Exact formation slot lookup passed');
  checkCleanSheetWindows();
  console.log('[OK] Clean-sheet window checks passed');
  checkLiveSentOffMinutes();
  console.log('[OK] Live sent-off minute check passed');
  checkPossessionFlowIsNotStrictAlternation();
  console.log('[OK] Possession flow variability guard passed');
  checkLiveSubstitutionsApplyBeforeFullTime();
  console.log('[OK] Live in-match substitution check passed');
  checkActiveLiveMatchBlocksWeekAdvance();
  console.log('[OK] Active live match week-advance guard passed');
  checkStaleLiveMatchRecovery();
  console.log('[OK] Stale live-match recovery passed');
  checkDirectFinishCompletesUnprocessedLiveMatch();
  console.log('[OK] Direct live-match finish completion passed');
  checkCompetitionPanelHandlesMissingTeam();
  console.log('[OK] Competition panel missing-team fallback passed');
  checkFreezeRecoveryControlsAreVisible();
  console.log('[OK] Freeze recovery controls passed');
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
  checkDisciplineRatesArePlausible();
  console.log('[OK] Discipline rate plausibility passed');

  checkZustandStoreLiveMatchCleanup();
  console.log('[OK] Zustand Live Match cleanup check passed');

  checkRosterSizeConstraints();
  console.log('[OK] Roster Size constraints check passed');

  checkManualTransfersRespectWindow();
  console.log('[OK] Manual transfer window guard passed');
  checkManualTransfersRejectNonFiniteMoney();
  console.log('[OK] Manual transfer finite money guard passed');
  checkUnavailableBenchPlayersCanBeRemoved();
  console.log('[OK] Unavailable bench player cleanup passed');
  checkRecoveredSelectedBenchDoesNotOverflow();
  console.log('[OK] Recovered selected bench overflow guard passed');
  checkLineupActionsPreserveBenchLimit();
  console.log('[OK] Lineup action bench limit passed');
  checkLineupInboxActionFiltersStaleFormationMap();
  console.log('[OK] Lineup inbox stale formation map check passed');
  checkSeasonReportsUseCompetitionLifecycleAndLeagueTables();
  console.log('[OK] Season reporting lifecycle guards passed');
  checkAiTransferListingsExpireOutsideWindow();
  console.log('[OK] AI transfer listing expiry passed');
  checkSeasonEndProgressionUpdatesMatchAbility();
  console.log('[OK] Season-end player progression ability update passed');
  checkContractDeparturesPreferViableDestinations();
  console.log('[OK] Contract departure destination quality passed');
  checkUiContractsMatchEngineState();
  console.log('[OK] UI data contract checks passed');
  checkInitialGameSetupCanBeSeeded();
  console.log('[OK] Seeded initial game setup passed');
  checkStoreInitializesSelectedTeamDefaults();
  console.log('[OK] Selected team initialization defaults passed');
  checkTacticalAdaptationRunsOncePerPlayedCount();
  console.log('[OK] Tactical adaptation repeat guard passed');
  checkTacticalAdaptationIgnoresUnavailablePlayers();
  console.log('[OK] Tactical adaptation availability check passed');
  checkMatchRatingsIncludeIndividualOutput();
  console.log('[OK] Match rating contribution checks passed');
  checkCleanSheetRatingsUsePlayerWindow();
  console.log('[OK] Windowed clean-sheet rating check passed');
  checkValidationCatchesPastUnplayedFixturesAndNonFiniteFinances();
  console.log('[OK] Agent validation coverage checks passed');

  console.log('--- REGRESSION CHECKS COMPLETE ---');
};

runRegressionChecks();
