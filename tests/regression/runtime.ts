import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { shallow } from 'zustand/shallow';
import { useGameStore } from '../../src/store/gameStore';
import { safeStorage, PERSIST_STORAGE_KEY } from '../../src/store/persistence';
import { processLiveMatchMinuteState, finishLiveMatchState } from '../../src/store/liveMatchActions';
import { makeLiveSubstitutionsState } from '../../src/store/liveMatchActions';
import { createSeededRandomGenerator } from '../../src/core/random';
import { createRosterIndex } from '../../src/core/rosterIndex';
import { getDecisiveTieScore, resolveFirstLegId } from '../../src/core/matchTieResolution';
import { selectPossessionAttacker, simulatePossession } from '../../src/core/matchRuntime';
import { buildTeamShapeProfile } from '../../src/core/shapeEngine';
import { validateAgentGameState } from '../../src/dev/agentGameHandler';
import { rolloverSeasonIfNeeded } from '../../src/store/seasonRollover';
import { getSeasonWeekLimit } from '../../src/core/leagueUtils';
import { getSackingImminentWeek } from '../../src/core/careerEngine';
import { buildSeasonSummary } from '../../src/core/careerEngine';
import { advanceWeekTransition } from '../../src/store/weekLifecycle';
import { ENGINE_CONFIG } from '../../src/config/engineConfig';

type State = ReturnType<typeof useGameStore.getState>;
const prepare = () => {
  useGameStore.getState().initializeGame('T1', 9029);
  useGameStore.getState().setFormation('T1', '4-3-3');
  const state = useGameStore.getState();
  const fixture = Object.values(state.fixtures).find(item => item.week === 1 && (item.homeTeamId === 'T1' || item.awayTeamId === 'T1'))!;
  return { state, fixture };
};
const clone = (state: State): State => ({ ...state, ...JSON.parse(JSON.stringify(state)) });
const completeSequentially = (state: State, fixtureId: string) => {
  let current = state;
  const processed = current.liveMatches[fixtureId]?.processedMinutes?.length ?? 0;
  for (let minute = processed + 1; minute <= 90; minute += 1) {
    current = { ...current, ...processLiveMatchMinuteState(current, fixtureId, minute).patch };
  }
  const tie = getDecisiveTieScore(current.fixtures[fixtureId], current.fixtures);
  if (tie.isDecisive && (tie.homeScore === tie.awayScore || current.liveMatches[fixtureId]?.extraTimeStarted)) {
    for (let minute = Math.max(processed + 1, 91); minute <= 120 && !current.fixtures[fixtureId].isPlayed; minute += 1) {
      current = { ...current, ...processLiveMatchMinuteState(current, fixtureId, minute).patch };
    }
  }
  return { ...current, ...finishLiveMatchState(current, fixtureId) };
};

const checkAtomicCompletion = async () => {
  const originalWrite = safeStorage.setItem;
  let writes = 0;
  safeStorage.setItem = async () => { writes += 1; };
  try {
    for (const startingMinute of [0, 45, 89]) {
      const { state, fixture } = prepare();
      let current = clone(state);
      for (let minute = 1; minute <= startingMinute; minute += 1) {
        const update = processLiveMatchMinuteState(current, fixture.id, minute);
        assert.equal(update.patch.teams, current.teams, 'Normal minutes must preserve the teams reference');
        current = { ...current, ...update.patch };
      }
      if (startingMinute === 45) {
        const live = current.liveMatches[fixture.id];
        const home = fixture.homeTeamId === current.userTeamId;
        const offPlayerId = (home ? live.currentHomePlayerIds : live.currentAwayPlayerIds)!.find(id => current.players[id].position !== 'GK')!;
        const onPlayerId = (home ? live.homeBenchIds : live.awayBenchIds)!.find(id => current.players[id].position !== 'GK' && !current.players[id].injuryWeeks && !current.players[id].matchesSuspended)!;
        const update = makeLiveSubstitutionsState(current, fixture.id, [{ offPlayerId, onPlayerId }]);
        assert.ok(update.result.success, update.result.message);
        current = { ...current, ...update.patch };
      }
      const expected = completeSequentially(clone(current), fixture.id);
      useGameStore.setState(current);
      writes = 0;
      useGameStore.getState().finishLiveMatch(fixture.id);
      const actual = useGameStore.getState();
      assert.equal(writes, 1, 'Sim & Exit must make one final save');
      assert.deepEqual(actual.players, expected.players);
      assert.deepEqual(actual.teams, expected.teams);
      assert.deepEqual(actual.fixtures, expected.fixtures);
      actual.finishLiveMatch(fixture.id);
      assert.equal(writes, 1, 'Repeated completion must not save');
    }
    for (const startingMinute of [90, 119]) {
      const { state, fixture } = prepare();
      const second = { ...fixture, round: 'semi_final' as const, isKnockout: true };
      let current = { ...clone(state), fixtures: { ...state.fixtures, [fixture.id]: second } };
      for (let minute = 1; minute <= 90; minute += 1) current = { ...current, ...processLiveMatchMinuteState(current, fixture.id, minute).patch };
      const score = current.fixtures[fixture.id];
      const first = { ...second, id: 'aggregate-first', week: 0, dateOrdinal: (second.dateOrdinal ?? 0) - 1,
        homeTeamId: second.awayTeamId, awayTeamId: second.homeTeamId, isPlayed: true,
        homeScore: (score.homeScore ?? 0) + 1, awayScore: (score.awayScore ?? 0) + 1 };
      current = { ...current, fixtures: { ...current.fixtures, [first.id]: first } };
      for (let minute = 91; minute <= startingMinute; minute += 1) current = { ...current, ...processLiveMatchMinuteState(current, fixture.id, minute).patch };
      const expected = completeSequentially(clone(current), fixture.id);
      useGameStore.setState(current);
      writes = 0;
      useGameStore.getState().finishLiveMatch(fixture.id);
      const actual = useGameStore.getState();
      assert.equal(writes, 1, 'Aggregate extra-time completion must save once');
      assert.deepEqual(actual.players, expected.players);
      assert.deepEqual(actual.teams, expected.teams);
      assert.deepEqual(actual.fixtures, expected.fixtures);
    }
    const voidSetup = prepare();
    const shortPlayers = { ...voidSetup.state.players };
    for (const teamId of [voidSetup.fixture.homeTeamId, voidSetup.fixture.awayTeamId]) {
      Object.values(shortPlayers).filter(player => player.teamId === teamId).slice(6).forEach(player => { delete shortPlayers[player.id]; });
    }
    useGameStore.setState({ players: shortPlayers });
    writes = 0;
    useGameStore.getState().finishLiveMatch(voidSetup.fixture.id);
    const voidState = useGameStore.getState();
    assert.equal(voidState.fixtures[voidSetup.fixture.id].resolution, 'void');
    assert.equal(writes, 1, 'A void fixture must finalize once');
    voidState.finishLiveMatch(voidSetup.fixture.id);
    voidState.processMatchMinute(voidSetup.fixture.id, 1);
    voidState.playMatch(voidSetup.fixture.id);
    assert.equal(writes, 1, 'Completed void actions must not save again');
    assert.equal(useGameStore.getState(), voidState);
    const { fixture } = prepare();
    writes = 0;
    for (let minute = 1; minute <= 5; minute += 1) useGameStore.getState().processMatchMinute(fixture.id, minute);
    assert.equal(writes, 5, 'Normal live minutes must retain one autosave each');
    const before = useGameStore.getState();
    before.processMatchMinute(fixture.id, 5);
    before.markInboxMessageRead('missing');
    before.dismissInboxMessage('missing');
    before.withdrawTransferNegotiation('missing');
    before.finishLiveMatch('missing');
    before.advanceWeek();
    assert.equal(writes, 5, 'No-op actions must not persist');
    assert.equal(useGameStore.getState(), before, 'No-op actions must preserve the store reference');
  } finally { safeStorage.setItem = originalWrite; }
};

const checkDoctorCompletionGate = () => {
  const source = readFileSync(new URL('../../scripts/expo_doctor_gate.js', import.meta.url), 'utf8');
  const runDoctor = (status: number, stdout: string, packagePresent = false) => {
    let exitCode: number | undefined;
    const stopped = new Error('Process exited');
    try {
      runInNewContext(source, {
        require: (name: string) => name === 'child_process' ? { spawnSync: (_command: string, args: string[]) => args[0] === 'explain'
          ? { status: packagePresent ? 0 : 1, stdout: packagePresent ? '{}' : `No dependencies found matching ${args[1]}` }
          : { status, stdout } } : path,
        process: { cwd: () => process.cwd(), platform: process.platform, execPath: process.execPath, env: {},
          stdout: { write: () => {} }, exit: (code: number) => { exitCode = code; throw stopped; } },
        console: { error: () => {}, warn: () => {} },
      });
    } catch (error) { if (error !== stopped) throw error; }
    return exitCode;
  };
  assert.equal(runDoctor(0, '18/18 checks passed. No issues detected!'), 0);
  assert.equal(runDoctor(0, 'Error: node expo config exited with non-zero code: 7'), 1);
  const known = "Unexpected error while running 'Check for legacy global CLI installed locally' check:\nFailed to find dependency tree for expo-cli: npm explain failed\n1 check failed, indicating possible issues with the project.";
  assert.equal(runDoctor(1, known), 0, 'Absent legacy-package Doctor bug remains allowed');
  assert.equal(runDoctor(1, known, true), 1, 'Installed legacy packages must fail');
  assert.equal(runDoctor(1, known.replace('1 check failed', '2 checks failed')), 1, 'Uncounted failed checks must fail');
  assert.equal(runDoctor(1, known.replace(/\n1 check failed.*/, '')), 1, 'Incomplete Doctor output must fail');
};

const checkAtomicFailureAndReload = async () => {
  const { fixture } = prepare();
  useGameStore.getState().processMatchMinute(fixture.id, 1);
  await Promise.resolve();
  const preExitSave = await AsyncStorage.getItem(PERSIST_STORAGE_KEY);
  const before = useGameStore.getState();
  const descriptor = Object.getOwnPropertyDescriptor(ENGINE_CONFIG, 'TOTAL_POSSESSIONS')!;
  try {
    Object.defineProperty(ENGINE_CONFIG, 'TOTAL_POSSESSIONS', { configurable: true, get: () => { throw new Error('Interrupted simulation'); } });
    assert.throws(() => before.finishLiveMatch(fixture.id), /Interrupted simulation/);
    assert.equal(useGameStore.getState(), before);
    assert.equal(await AsyncStorage.getItem(PERSIST_STORAGE_KEY), preExitSave);
  } finally { Object.defineProperty(ENGINE_CONFIG, 'TOTAL_POSSESSIONS', descriptor); }
  const originalWrite = AsyncStorage.setItem;
  const originalWarn = console.warn;
  let failures = 0;
  try {
    AsyncStorage.setItem = async () => { throw new Error('Storage unavailable'); };
    console.warn = () => { failures += 1; };
    before.finishLiveMatch(fixture.id);
    await Promise.resolve();
    assert.ok(useGameStore.getState().fixtures[fixture.id].isPlayed);
    assert.equal(failures, 1, 'Storage failures must be handled');
    assert.equal(await AsyncStorage.getItem(PERSIST_STORAGE_KEY), preExitSave);
  } finally { AsyncStorage.setItem = originalWrite; console.warn = originalWarn; }
  await useGameStore.persist.rehydrate();
  const restored = useGameStore.getState();
  assert.equal(restored.fixtures[fixture.id].isPlayed, false);
  assert.deepEqual(restored.liveMatches[fixture.id].processedMinutes, [1]);
  assert.equal(restored.players[restored.liveMatches[fixture.id].homeStarterIds[0]].energy,
    before.players[restored.liveMatches[fixture.id].homeStarterIds[0]].energy);
};

const checkCurrentRosterAndSelectors = () => {
  const { state } = prepare();
  const index = createRosterIndex(state.players);
  const first = Object.values(state.players)[0];
  const next = { ...state.players, [first.id]: { ...first, teamId: 'T2', wage: 123 } };
  index.movePlayer(first.id, first.teamId, 'T2');
  for (const teamId of [first.teamId, 'T2']) assert.deepEqual(index.getPlayers(teamId, next), Object.values(next).filter(player => player.teamId === teamId));
  const own = Object.values(state.players).filter(player => player.teamId === state.userTeamId);
  const other = Object.values(state.players).find(player => player.teamId !== state.userTeamId)!;
  const unrelated = { ...state.players, [other.id]: { ...other, energy: 10 } };
  assert.ok(shallow(own, Object.values(unrelated).filter(player => player.teamId === state.userTeamId)));
  const changed = { ...state.players, [own[0].id]: { ...own[0], energy: 10 } };
  assert.equal(shallow(own, Object.values(changed).filter(player => player.teamId === state.userTeamId)), false);
  const invalidTeam = { ...state.teams.T1, formationMap: { bad: own[0].id } };
  useGameStore.setState({ teams: { ...state.teams, T1: invalidTeam } });
  state.setFormation('T1', invalidTeam.activeFormation);
  assert.equal(useGameStore.getState().teams.T1.formationMap?.bad, undefined, 'Same-formation actions must still repair mappings');
};

const checkRuntimeBehavior = () => {
  const { state, fixture } = prepare();
  const home = state.teams[fixture.homeTeamId], away = state.teams[fixture.awayTeamId];
  const homePlayers = Object.values(state.players).filter(player => player.teamId === home.id && player.isStarting);
  const awayPlayers = Object.values(state.players).filter(player => player.teamId === away.id && player.isStarting);
  const shapeHome = buildTeamShapeProfile(home, homePlayers), shapeAway = buildTeamShapeProfile(away, awayPlayers);
  const rng = createSeededRandomGenerator(42);
  const attacks = Array.from({ length: 30 }, () => selectPossessionAttacker(home, away, homePlayers, awayPlayers, shapeHome, shapeAway, rng));
  assert.ok(attacks.some((value, index) => index > 0 && value === attacks[index - 1]), 'Possession must permit consecutive attacks by the same side');
  const striker = homePlayers.find(player => player.position === 'FWD')!;
  const roleTeam = { ...home, formationMap: { '0-1': striker.id }, playerRoles: { '0-1': 'pressingForward' as const } };
  const outcomes = (team: typeof home) => {
    const random = createSeededRandomGenerator(19);
    return Array.from({ length: 40 }, () => simulatePossession(team, away, homePlayers, awayPlayers, 0, 0, shapeHome, shapeAway, random));
  };
  assert.notDeepEqual(outcomes(home), outcomes(roleTeam), 'Compatible roles must affect possession behavior');
  const broken = { ...fixture, week: 1, isPlayed: false };
  useGameStore.setState({ currentWeek: 2, fixtures: { [fixture.id]: broken }, teams: { ...state.teams, [home.id]: { ...home, budget: NaN, transferSpend: Infinity } } });
  const validation = validateAgentGameState();
  assert.ok(validation.issues.some(issue => /past week/.test(issue.message)));
  assert.ok(validation.issues.some(issue => /budget is not finite/.test(issue.message)));
  assert.ok(validation.issues.some(issue => /transfer spend is not finite/.test(issue.message)));
};

const checkAggregateAndSackingContext = () => {
  const { state, fixture } = prepare();
  const second = { ...fixture, id: 'second', competitionType: 'league' as const, round: 'semi_final' as const, week: 54, dateOrdinal: 370, homeScore: 0, awayScore: 0 };
  const first = { ...second, id: 'first', week: 53, dateOrdinal: 365, homeTeamId: second.awayTeamId, awayTeamId: second.homeTeamId, isPlayed: true, homeScore: 2, awayScore: 1 };
  const fixtures = { first, second };
  const firstId = resolveFirstLegId(second, fixtures);
  assert.equal(firstId, 'first');
  assert.equal(getDecisiveTieScore(second, fixtures, firstId).awayScore, 2);
  assert.equal(getDecisiveTieScore(second, { ...fixtures, first: { ...first, homeScore: 3 } }, firstId).awayScore, 3);
  for (const patience of ['low', 'high'] as const) {
    const team = { ...state.teams.T1, boardProfile: { ...state.teams.T1.boardProfile, patience } };
    const threshold = getSackingImminentWeek(team);
    for (const weeks of [threshold - 1, threshold]) {
      const rollover = rolloverSeasonIfNeeded({ ...state, currentWeek: getSeasonWeekLimit(state.fixtures, state.competitions) + 1,
        teams: { ...state.teams, T1: team }, careerRecord: { ...state.careerRecord, consecutiveLowApprovalWeeks: weeks } }, 54, []);
      assert.ok(rollover);
      assert.equal(rollover.userTeamId === null, weeks === threshold, 'Rollover must apply patience-sensitive sacking thresholds');
    }
  }
};

const checkWeeklyTransitionReporting = () => {
  const { state, fixture } = prepare();
  const summary = buildSeasonSummary(1, state.teams.T1, state.teams, state.competitions);
  const history = Array.from({ length: 10 }, (_, index) => ({ ...summary, season: index + 1 }));
  const final = { ...state, currentWeek: 54, competitions: {},
    fixtures: { [fixture.id]: { ...fixture, week: 54 } },
    careerRecord: { ...state.careerRecord, seasonsManaged: 10, seasonHistory: history } };
  const transition = advanceWeekTransition(final);
  assert.equal(transition.advanced, true);
  assert.equal(transition.rolledOver, true);
  assert.equal(transition.completedFixtures.length, 1);
  assert.equal(transition.completedFixtures[0].isPlayed, true);
  assert.equal(final.fixtures[fixture.id].isPlayed, false, 'Observation must not mutate the input fixture');
  assert.ok(transition.preRolloverState?.fixtures[fixture.id].isPlayed);
  assert.equal(transition.nextState.currentWeek, 1);
  assert.equal(transition.nextState.careerRecord.seasonHistory.length, 10);
  assert.equal(transition.completedSeasonSummary?.season, 11, 'Monotonic career count must detect summaries after history reaches its cap');

  useGameStore.setState(state);
  state.processMatchMinute(fixture.id, 1);
  const blocked = useGameStore.getState().advanceWeek();
  assert.equal(blocked.advanced, false);
  assert.deepEqual(blocked.completedFixtures, []);
  assert.equal(blocked.completedSeasonSummary, null);

  const originalWrite = safeStorage.setItem;
  let saved: Record<string, unknown> | undefined;
  try {
    safeStorage.setItem = async (_key, value) => { saved = JSON.parse(value).state; };
    useGameStore.setState(final);
    const result = useGameStore.getState().advanceWeek();
    assert.equal(result.completedFixtures.length, 1);
    assert.ok(saved);
    assert.equal('completedFixtures' in saved, false);
    assert.equal('preRolloverState' in saved, false, 'Transient observations must stay out of saves');
  } finally { safeStorage.setItem = originalWrite; }
};

export const runtimeChecks = [
  { name: 'career: weekly observations retain rollover fixtures and capped career summaries', run: checkWeeklyTransitionReporting },
  { name: 'tooling: Doctor completes all checks before passing the release gate', run: checkDoctorCompletionGate },
  { name: 'save: atomic exit parity, substitutions, autosaves and no-ops', run: checkAtomicCompletion },
  { name: 'save: interrupted exit and failed write resume the pre-exit save', run: checkAtomicFailureAndReload },
  { name: 'roster: current objects, ordered transfers and narrow selectors', run: checkCurrentRosterAndSelectors },
  { name: 'match: possession, role effects and state validation', run: checkRuntimeBehavior },
  { name: 'career: current aggregate scores and rollover sacking context', run: checkAggregateAndSackingContext },
];
