import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { createSeededRandomGenerator } from '../src/core/random';
import { autoAssignLineup } from '../src/core/lineupEngine';
import { useGameStore } from '../src/store/gameStore';
import { safeStorage } from '../src/store/persistence';
import { advanceWeekState } from '../src/store/weekLifecycle';
import { finishLiveMatchState, processLiveMatchMinuteState } from '../src/store/liveMatchActions';

const readCount = (name: string, fallback: number, maximum: number) => {
  const argument = process.argv.find(value => value.startsWith(`--${name}=`));
  if (!argument) return fallback;
  const value = Number(argument.split('=')[1]);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be between 1 and ${maximum}.`);
  return value;
};

const samples = readCount('samples', 7, 30);
const warmups = readCount('warmups', 2, 10);
const seed = readCount('seed', 12091, 2147483647);
const originalRandom = Math.random;
const originalStorageWrite = safeStorage.setItem;
let writes = 0;
let bytes = 0;
safeStorage.setItem = async (_key, value) => {
  writes += 1;
  bytes += Buffer.byteLength(value);
};

type State = ReturnType<typeof useGameStore.getState>;
type BenchmarkCase = { name: string; store?: boolean; run: (state: State, fixtureId: string) => unknown };

const fingerprint = (result: unknown) => {
  const state = result as Partial<State>;
  const semanticState = state.players ? {
    players: state.players, teams: state.teams, fixtures: state.fixtures,
    fixture: (result as { fixture?: unknown }).fixture,
    competitions: state.competitions, currentWeek: state.currentWeek,
    rngState: state.rngState, userTeamId: state.userTeamId,
    boardObjectives: state.boardObjectives, careerRecord: state.careerRecord,
    liveMatches: state.liveMatches,
  } : result;
  return createHash('sha256').update(JSON.stringify(semanticState)).digest('hex').slice(0, 16);
};

try {
  Math.random = createSeededRandomGenerator(seed).next;
  useGameStore.getState().initializeGame('T1', seed);
  const initialized = useGameStore.getState();
  const lineup = autoAssignLineup('T1', initialized.players, initialized.teams.T1.activeFormation);
  for (const [id, patch] of Object.entries(lineup)) initialized.players[id] = { ...initialized.players[id], ...patch };
  const fixture = Object.values(initialized.fixtures).find(value => value.week === 1 && (value.homeTeamId === 'T1' || value.awayTeamId === 'T1'))!;
  const snapshot = JSON.stringify(initialized);
  const cases: BenchmarkCase[] = [
    { name: 'quick match', run: state => quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, 'T1') },
    { name: 'weekly progression', run: state => computeWeeklyProgression(1, state.players, state.teams, state.fixtures, [], 'T1') },
    { name: 'weekly transfers', run: state => computeWeeklyTransfers(state.players, state.teams, 'T1', undefined, 1) },
    { name: 'advance week', run: state => advanceWeekState(state) },
    { name: 'live engine (90 minutes)', run: state => {
      let current = state;
      for (let minute = 1; minute <= 90; minute += 1) current = { ...current, ...processLiveMatchMinuteState(current, fixture.id, minute).patch };
      return { ...current, ...finishLiveMatchState(current, fixture.id) };
    } },
    { name: 'live store (90 minutes)', store: true, run: () => {
      for (let minute = 1; minute <= 90; minute += 1) useGameStore.getState().processMatchMinute(fixture.id, minute);
      useGameStore.getState().finishLiveMatch(fixture.id);
      return useGameStore.getState();
    } },
    { name: 'legacy Sim & Exit', store: true, run: () => {
      for (let minute = 1; minute <= 90; minute += 1) useGameStore.getState().processMatchMinute(fixture.id, minute);
      useGameStore.getState().finishLiveMatch(fixture.id);
      return useGameStore.getState();
    } },
    { name: 'atomic Sim & Exit', store: true, run: () => {
      useGameStore.getState().finishLiveMatch(fixture.id);
      return useGameStore.getState();
    } },
  ];
  const results = [];
  const scenario = process.argv.find(value => value.startsWith('--scenario='))?.slice('--scenario='.length);
  const selected = scenario ? cases.filter(value => value.name.toLowerCase().includes(scenario.toLowerCase())) : cases;
  if (!selected.length) throw new Error('Unknown benchmark scenario');
  for (const benchmark of selected) {
    const timings: number[] = [];
    let expectedFingerprint: string | undefined;
    let expectedDraws: number | undefined;
    let saveWrites = 0;
    let saveBytes = 0;
    for (let sample = -warmups; sample < samples; sample += 1) {
      const state = { ...initialized, ...JSON.parse(snapshot) } as State;
      if (benchmark.store) useGameStore.setState(state);
      let draws = 0;
      const random = createSeededRandomGenerator(seed + 1);
      Math.random = () => { draws += 1; return random.next(); };
      writes = 0;
      bytes = 0;
      const start = performance.now();
      const result = benchmark.run(state, fixture.id);
      const elapsed = performance.now() - start;
      const hash = fingerprint(result);
      if (expectedFingerprint !== undefined && (hash !== expectedFingerprint || draws !== expectedDraws)) throw new Error(`${benchmark.name} is not deterministic.`);
      expectedFingerprint = hash;
      expectedDraws = draws;
      if (sample >= 0) timings.push(elapsed);
      saveWrites = writes;
      saveBytes = bytes;
    }
    timings.sort((left, right) => left - right);
    results.push({ scenario: benchmark.name,
      medianMs: Number(timings[Math.floor(timings.length / 2)].toFixed(2)),
      p95Ms: Number(timings[Math.min(timings.length - 1, Math.ceil(timings.length * 0.95) - 1)].toFixed(2)),
      globalRngDraws: expectedDraws, fingerprint: expectedFingerprint, saveWrites,
      savedMB: Number((saveBytes / 1000000).toFixed(2)) });
  }
  console.log(JSON.stringify({ seed, samples, warmups, node: process.version, platform: process.platform, results }, null, 2));
} finally {
  Math.random = originalRandom;
  safeStorage.setItem = originalStorageWrite;
}
