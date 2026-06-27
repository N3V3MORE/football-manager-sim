import { Formation, advanceWeekState, assert, createSeededRandom, finishLiveMatchState, initGameData, makeLiveSubstitutionsState, processLiveMatchMinuteState, sanitizePersistedState, setLiveMatchFormationState, useGameStore } from './shared';

const getUserLiveFixture = (state: any) => {
  const fixture = Object.values(state.fixtures)
    .find((item: any) => item.week === state.currentWeek && (item.homeTeamId === state.userTeamId || item.awayTeamId === state.userTeamId));
  assert(fixture, 'Regression setup needs a user-team live fixture');
  return fixture as any;
};

const getLiveSideKeys = (fixture: any, teamId: string) => {
  const isHome = fixture.homeTeamId === teamId;
  return {
    isHome,
    currentIdsKey: isHome ? 'currentHomePlayerIds' : 'currentAwayPlayerIds',
    benchIdsKey: isHome ? 'homeBenchIds' : 'awayBenchIds',
    minuteMapKey: isHome ? 'homeMinuteMap' : 'awayMinuteMap',
    subEntryKey: isHome ? 'homeSubEntryMinutes' : 'awaySubEntryMinutes',
    goalkeeperKey: isHome ? 'homeGoalkeeperId' : 'awayGoalkeeperId',
    substitutionStateKey: isHome ? 'homeSubstitutionState' : 'awaySubstitutionState',
    activeFormationKey: isHome ? 'homeActiveFormation' : 'awayActiveFormation',
    formationMapKey: isHome ? 'homeFormationMap' : 'awayFormationMap',
  };
};

const processLiveFixtureThroughMinute = (state: any, fixtureId: string, targetMinute: number, seed = 20260627) => {
  let current = state;
  const rng = { next: createSeededRandom(seed) };
  for (let minute = 1; minute <= targetMinute; minute += 1) {
    const result = processLiveMatchMinuteState(current, fixtureId, minute, rng);
    current = { ...current, ...result.patch };
  }
  return current;
};

const chooseOutfieldReplacement = (state: any, liveMatch: any, keys: ReturnType<typeof getLiveSideKeys>) => {
  const activeIds = liveMatch[keys.currentIdsKey] as string[];
  const benchIds = liveMatch[keys.benchIdsKey] as string[];
  const activePlayers = activeIds.map(id => state.players[id]).filter(Boolean);
  const benchPlayers = benchIds.map(id => state.players[id]).filter(Boolean);
  const offPlayer = activePlayers.find((player: any) => player.position !== 'GK');
  const onPlayer = benchPlayers.find((player: any) => player.position === offPlayer?.position && player.position !== 'GK')
    || benchPlayers.find((player: any) => player.position !== 'GK');
  assert(offPlayer && onPlayer, 'Regression setup needs an outfield starter and bench replacement');
  return { offPlayerId: offPlayer.id, onPlayerId: onPlayer.id };
};

const chooseMultipleOutfieldReplacements = (state: any, liveMatch: any, keys: ReturnType<typeof getLiveSideKeys>, count: number) => {
  const activePlayers = (liveMatch[keys.currentIdsKey] as string[])
    .map(id => state.players[id])
    .filter((player: any) => player && player.position !== 'GK');
  const benchPlayers = (liveMatch[keys.benchIdsKey] as string[])
    .map(id => state.players[id])
    .filter((player: any) => player && player.position !== 'GK');
  assert(activePlayers.length >= count && benchPlayers.length >= count, `Regression setup needs ${count} outfield substitution pairs`);
  return Array.from({ length: count }, (_, index) => ({
    offPlayerId: activePlayers[index].id,
    onPlayerId: benchPlayers[index].id,
  }));
};

export const checkLiveSentOffMinutes = () => {
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

export const checkLiveSubstitutionsApplyBeforeFullTime = () => {
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

export const checkUserAiDoesNotSpendLiveSubstitutions = () => {
  useGameStore.getState().initializeGame('T1');
  let current: any = useGameStore.getState();
  const fixture = getUserLiveFixture(current);
  const userKeys = getLiveSideKeys(fixture, current.userTeamId);

  current = processLiveFixtureThroughMinute(current, fixture.id, 66, 20260628);
  const liveMatch = current.liveMatches[fixture.id] as any;
  assert(liveMatch, 'Live match should exist after processing user fixture minutes');

  assert(
    JSON.stringify(liveMatch[userKeys.currentIdsKey]) === JSON.stringify(userKeys.isHome ? liveMatch.homeStarterIds : liveMatch.awayStarterIds),
    'Scheduled AI substitutions should not change the user active XI during live matches'
  );
  const userSubState = liveMatch[userKeys.substitutionStateKey];
  assert(userSubState?.substitutesUsed === 0, 'Scheduled AI substitutions should not spend user substitutes in live matches');
  assert(userSubState?.substitutionWindowsUsed === 0, 'Scheduled AI substitutions should not spend user windows in live matches');
};

export const checkManualLiveSubstitutionAndShapeAreMatchLocal = () => {
  useGameStore.getState().initializeGame('T1');
  let current: any = useGameStore.getState();
  const fixture = getUserLiveFixture(current);
  const userTeamId = current.userTeamId as string;
  const userKeys = getLiveSideKeys(fixture, userTeamId);
  const savedFormationBefore = current.teams[userTeamId].activeFormation;
  const savedFormationMapBefore = JSON.stringify(current.teams[userTeamId].formationMap || {});

  current = processLiveFixtureThroughMinute(current, fixture.id, 45, 20260629);
  const liveBefore = current.liveMatches[fixture.id] as any;
  assert(liveBefore?.[userKeys.activeFormationKey] === savedFormationBefore, 'Live match should initialize with the saved formation');
  assert(Object.keys(liveBefore[userKeys.formationMapKey] || {}).length > 0, 'Live match should initialize a live formation map');

  const replacement = chooseOutfieldReplacement(current, liveBefore, userKeys);
  const subUpdate = makeLiveSubstitutionsState(current, fixture.id, [replacement]);
  assert(subUpdate.result.success, `Manual live substitution should succeed: ${subUpdate.result.message}`);
  current = { ...current, ...subUpdate.patch };

  const liveAfterSub = current.liveMatches[fixture.id] as any;
  const activeIdsAfterSub = liveAfterSub[userKeys.currentIdsKey] as string[];
  assert(!activeIdsAfterSub.includes(replacement.offPlayerId), 'Manual substitution should remove the off-player from the active XI');
  assert(activeIdsAfterSub.includes(replacement.onPlayerId), 'Manual substitution should add the on-player to the active XI');
  assert(liveAfterSub[userKeys.minuteMapKey][replacement.offPlayerId] === 45, 'Off-player minutes should stop at half time');
  assert(liveAfterSub[userKeys.subEntryKey][replacement.onPlayerId] === 45, 'Sub entry minute should be recorded at half time');
  assert(liveAfterSub[userKeys.substitutionStateKey].substitutesUsed === 1, 'Manual substitution should spend one substitute');
  assert(liveAfterSub[userKeys.substitutionStateKey].substitutionWindowsUsed === 0, 'Half-time substitution should not spend a normal window');
  assert(
    Object.values(liveAfterSub[userKeys.formationMapKey]).includes(replacement.onPlayerId),
    'Manual substitution should update the live formation map'
  );
  assert(
    current.teams[userTeamId].activeFormation === savedFormationBefore &&
      JSON.stringify(current.teams[userTeamId].formationMap || {}) === savedFormationMapBefore,
    'Manual live substitution should not mutate saved team formation state'
  );

  const targetFormation: Formation = savedFormationBefore === '4-4-2' ? '4-3-3' : '4-4-2';
  const shapeUpdate = setLiveMatchFormationState(current, fixture.id, userTeamId, targetFormation);
  assert(shapeUpdate.result.success, `Live formation change should succeed: ${shapeUpdate.result.message}`);
  current = { ...current, ...shapeUpdate.patch };
  const liveAfterShape = current.liveMatches[fixture.id] as any;
  assert(liveAfterShape[userKeys.activeFormationKey] === targetFormation, 'Live formation change should update the live formation');
  assert(current.teams[userTeamId].activeFormation === savedFormationBefore, 'Live formation change should not change saved team formation');

  const nextMinute = processLiveMatchMinuteState(current, fixture.id, 46, { next: createSeededRandom(20260630) });
  current = { ...current, ...nextMinute.patch };
  const liveAfterNextMinute = current.liveMatches[fixture.id] as any;
  assert(liveAfterNextMinute[userKeys.activeFormationKey] === targetFormation, 'Live formation should persist into the next processed minute');
};

export const checkManualLiveSubstitutionValidation = () => {
  useGameStore.getState().initializeGame('T1');
  let current: any = useGameStore.getState();
  const fixture = getUserLiveFixture(current);
  const userTeamId = current.userTeamId as string;
  const userKeys = getLiveSideKeys(fixture, userTeamId);

  current = processLiveFixtureThroughMinute(current, fixture.id, 45, 20260631);
  const liveBefore = current.liveMatches[fixture.id] as any;
  const fiveReplacements = chooseMultipleOutfieldReplacements(current, liveBefore, userKeys, 5);
  const fiveUpdate = makeLiveSubstitutionsState(current, fixture.id, fiveReplacements);
  assert(fiveUpdate.result.success, `Five half-time substitutions should be allowed: ${fiveUpdate.result.message}`);
  current = { ...current, ...fiveUpdate.patch };

  const liveAfterFive = current.liveMatches[fixture.id] as any;
  const sixthCandidate = (liveAfterFive[userKeys.benchIdsKey] as string[])
    .find(id => !fiveReplacements.some(replacement => replacement.onPlayerId === id) && current.players[id]?.position !== 'GK');
  const activeOutfielder = (liveAfterFive[userKeys.currentIdsKey] as string[])
    .find(id => current.players[id]?.position !== 'GK');
  assert(sixthCandidate && activeOutfielder, 'Regression setup needs a sixth substitution candidate');
  const sixthOffPlayerId = activeOutfielder as string;
  const sixthOnPlayerId = sixthCandidate as string;
  const sixthUpdate = makeLiveSubstitutionsState(current, fixture.id, [{ offPlayerId: sixthOffPlayerId, onPlayerId: sixthOnPlayerId }]);
  assert(!sixthUpdate.result.success, 'A sixth substitution should be rejected');

  const reEntryUpdate = makeLiveSubstitutionsState(current, fixture.id, [{
    offPlayerId: sixthOffPlayerId,
    onPlayerId: fiveReplacements[0]!.offPlayerId,
  }]);
  assert(!reEntryUpdate.result.success, 'A substituted-off player should not be allowed to re-enter');

  useGameStore.getState().initializeGame('T1');
  current = processLiveFixtureThroughMinute(useGameStore.getState(), getUserLiveFixture(useGameStore.getState()).id, 46, 20260632);
  const normalFixture = getUserLiveFixture(current);
  const normalKeys = getLiveSideKeys(normalFixture, current.userTeamId);
  const liveNormal = current.liveMatches[normalFixture.id] as any;
  const goalkeeperId = liveNormal[normalKeys.goalkeeperKey] as string;
  const nonGoalkeeperBenchId = (liveNormal[normalKeys.benchIdsKey] as string[])
    .find(id => current.players[id]?.position !== 'GK');
  assert(goalkeeperId && nonGoalkeeperBenchId, 'Regression setup needs a goalkeeper and outfield bench player');
  const illegalGoalkeeperUpdate = makeLiveSubstitutionsState(current, normalFixture.id, [{
    offPlayerId: goalkeeperId,
    onPlayerId: nonGoalkeeperBenchId as string,
  }]);
  assert(!illegalGoalkeeperUpdate.result.success, 'Replacing the goalkeeper with an outfielder should be rejected');
};

export const checkLiveMatchSummaryIncludesStatsAndRatings = () => {
  useGameStore.getState().initializeGame('T1');
  let current: any = useGameStore.getState();
  const fixture = getUserLiveFixture(current);
  current = processLiveFixtureThroughMinute(current, fixture.id, 20, 20260633);
  const finished: any = finishLiveMatchState(current, fixture.id, { next: createSeededRandom(20260633) });
  current = { ...current, ...finished };

  const summary = current.fixtures[fixture.id].matchSummary;
  assert(summary, 'Live user fixture should store a match summary after full time');
  assert(summary.homeTeamStats.shots >= summary.homeTeamStats.shotsOnTarget, 'Home shots should be at least shots on target');
  assert(summary.awayTeamStats.shots >= summary.awayTeamStats.shotsOnTarget, 'Away shots should be at least shots on target');
  assert(summary.homeTeamStats.shotsOnTarget >= (current.fixtures[fixture.id].homeScore || 0), 'Home SOT should cover home goals');
  assert(summary.awayTeamStats.shotsOnTarget >= (current.fixtures[fixture.id].awayScore || 0), 'Away SOT should cover away goals');
  assert(summary.playerRows.length >= 22, 'Live match summary should include player rating rows for both teams');
  assert(summary.manOfTheMatchPlayerId, 'Live match summary should select a man of the match');
};

export const checkActiveLiveMatchBlocksWeekAdvance = () => {
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

export const checkStaleLiveMatchRecovery = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for stale live match recovery');
  const currentWeekFixtures = Object.values(data.fixtures).filter(item => (
    item.week === 1 &&
    !item.isPlayed &&
    item.homeTeamId !== userTeam!.id &&
    item.awayTeamId !== userTeam!.id
  ));
  const [currentFixture, gappedMinuteFixture] = currentWeekFixtures;
  const futureFixture = Object.values(data.fixtures).find(item => item.week > 1 && !item.isPlayed);
  const playedFixture = Object.values(data.fixtures).find(item => (
    item.id !== currentFixture?.id &&
    item.id !== gappedMinuteFixture?.id &&
    item.week === 1
  ));
  assert(currentFixture && gappedMinuteFixture && futureFixture && playedFixture, 'Expected fixtures for stale live match recovery');

  const buildLiveMatch = (fixture: typeof currentFixture, processedMinutes?: number[]) => {
    const homeStarterIds = Object.values(data.players)
      .filter(player => player.teamId === fixture!.homeTeamId)
      .slice(0, 11)
      .map(player => player.id);
    const awayStarterIds = Object.values(data.players)
      .filter(player => player.teamId === fixture!.awayTeamId)
      .slice(0, 11)
      .map(player => player.id);
    assert(homeStarterIds.length === 11 && awayStarterIds.length === 11, 'Expected full XIs for stale recovery');
    return {
      initialized: true,
      yellowCardPlayerIds: [],
      sentOffPlayerIds: [],
      homeStarterIds,
      awayStarterIds,
      ...(processedMinutes ? { processedMinutes } : {}),
    };
  };

  const liveMatch = buildLiveMatch(currentFixture, [1, 2]);
  const gappedMinuteLiveMatch = buildLiveMatch(gappedMinuteFixture, [1, 3]);
  const wrongHomeStarterIds = Object.values(data.players)
    .filter(player => player.teamId !== currentFixture!.homeTeamId)
    .slice(0, 11)
    .map(player => player.id);
  assert(wrongHomeStarterIds.length === 11, 'Expected wrong-team XI for stale recovery');
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
      [gappedMinuteFixture!.id]: gappedMinuteLiveMatch,
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
  assert(!persistedLiveMatches[gappedMinuteFixture!.id], 'Non-contiguous processed live minutes should be cleared on rehydration');
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
      [gappedMinuteFixture!.id]: gappedMinuteLiveMatch,
    },
  });
  assert(advanced.currentWeek > 1, 'Invalid stale live match should not block week advance');
  assert(!advanced.liveMatches[currentFixture!.id], 'Invalid stale live match should be cleared during week advance');
  assert(!advanced.liveMatches[gappedMinuteFixture!.id], 'Gapped live match should be cleared during week advance');

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
      [gappedMinuteFixture!.id]: gappedMinuteLiveMatch,
      missing_fixture: liveMatch,
    },
  });
  const recoveredCount = useGameStore.getState().clearStuckLiveMatches();
  assert(recoveredCount === 3, 'Recovery action should finish valid blockers and clear invalid live matches');
  assert(!useGameStore.getState().liveMatches[currentFixture!.id], 'Recovery action should clear finished live match');
  assert(useGameStore.getState().fixtures[currentFixture!.id].isPlayed, 'Recovery action should finish valid active fixture');
};

export const checkDirectFinishCompletesUnprocessedLiveMatch = () => {
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

export const checkZustandStoreLiveMatchCleanup = () => {
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
