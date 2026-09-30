import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_FORMATION_SLOTS, getSlotsForFormation } from '../../src/constants/formations';
import { isPlayerSlotFit, rebuildFormationMap } from '../../src/core/formationMapUtils';
import { Formation, Team } from '../../src/models/types';
import { useGameStore } from '../../src/store/gameStore';
import { clearPersistLoadError, getPersistLoadError, PERSIST_STORAGE_KEY, safeStorage, sanitizePersistedState, subscribePersistLoadError } from '../../src/store/persistence';

const checkCurrentVersionHydration = async () => {
  await useGameStore.persist.rehydrate();
  useGameStore.getState().initializeGame('T1', 9029);
  const state = useGameStore.getState();
  const player = Object.values(state.players)[0];
  const target = Object.values(state.players).find(item => item.teamId !== state.userTeamId)!;
  const objective = state.boardObjectives[0];
  const keeper = Object.values(state.players).find(item => item.name === 'Alisson')!;
  const saved = {
    ...state,
    players: { ...state.players, [player.id]: { ...player, energy: 73.25 },
      [keeper.id]: { ...keeper, stats: { ...keeper.stats, gk_reflexes: 0, gk_handling: 1 } },
      orphan: { ...player, id: 'orphan', teamId: 'missing' } },
    boardObjectives: state.boardObjectives.map(item => ({ ...item, failed: item.id === objective.id })),
    pendingNegotiations: [{ id: 'round-zero', playerId: target.id, buyerTeamId: state.userTeamId,
      sellerTeamId: target.teamId, currentBid: 0, currentWage: target.wage, askingPrice: 10,
      round: 0, status: 'pending', createdWeek: 1, expiresWeek: 3, source: 'unlisted_approach' }],
  };
  await AsyncStorage.setItem(PERSIST_STORAGE_KEY, JSON.stringify({ state: saved, version: 9 }));
  await useGameStore.persist.rehydrate();
  const restored = useGameStore.getState();
  assert(restored.teams[restored.players.orphan.teamId], 'Current-version hydration should repair broken team references');
  assert(restored.players[player.id].energy === 73.25, 'Hydration must preserve fractional live-match energy');
  assert(restored.boardObjectives.find(item => item.id === objective.id)?.failed, 'Hydration must preserve failed board objectives');
  assert(restored.pendingNegotiations?.[0].round === 0, 'Hydration must preserve initial negotiation round');
  assert(restored.players[keeper.id].stats.gk_reflexes === keeper.stats.gk_reflexes, 'Hydration should restore missing recorded keeper attributes');
  assert(restored.players[keeper.id].stats.gk_handling === keeper.stats.gk_handling, 'Hydration should repair legacy keeper attributes clamped to one');
};

const checkStorageReadFailure = async () => {
  const originalGetItem = AsyncStorage.getItem;
  clearPersistLoadError();
  try {
    AsyncStorage.getItem = async () => { throw new Error('Temporary read failure'); };
    assert(await safeStorage.getItem(PERSIST_STORAGE_KEY) === null, 'Read failure should return no data');
    assert(getPersistLoadError()?.key === PERSIST_STORAGE_KEY, 'Read failure must block automatic fresh initialization');
  } finally {
    AsyncStorage.getItem = originalGetItem;
    clearPersistLoadError();
  }
};

const checkMalformedSaveRecovery = async () => {
  useGameStore.getState().initializeGame('T1', 9029);
  const valid = JSON.parse(JSON.stringify(useGameStore.getState()));
  const validRaw = JSON.stringify({ state: valid, version: 9 });
  const originalWarn = console.warn;
  let errorNotifications = 0;
  const unsubscribe = subscribePersistLoadError(() => { if (getPersistLoadError()) errorNotifications += 1; });
  try {
    console.warn = () => {};
    const invalidSaves = [{}, [], null, { state: {}, version: 9 }, {
      state: { ...valid, competitions: { ...valid.competitions,
        'premier-league': { ...valid.competitions['premier-league'], rounds: [null] } } }, version: 9,
    }];
    for (const invalid of invalidSaves) {
      clearPersistLoadError();
      const raw = JSON.stringify(invalid);
      await AsyncStorage.setItem(PERSIST_STORAGE_KEY, raw);
      await useGameStore.persist.rehydrate();
      assert(getPersistLoadError(), 'Invalid saves must reach the existing recovery screen');
      assert(await AsyncStorage.getItem(PERSIST_STORAGE_KEY) === raw, 'Failed hydration must preserve the original save');
      useGameStore.getState().initializeGame('T2', 9029);
      assert(await AsyncStorage.getItem(PERSIST_STORAGE_KEY) === raw, 'Writes must remain blocked until the user clears the load error');
    }
    assert(errorNotifications === invalidSaves.length, 'Each hydration failure must notify the recovery screen');
    assert(!useGameStore.persist.hasHydrated(), 'Nested sanitizer failure must remain visible even without successful hydration');
    await AsyncStorage.setItem(PERSIST_STORAGE_KEY, validRaw);
    await useGameStore.persist.rehydrate();
    assert(useGameStore.persist.hasHydrated() && !getPersistLoadError(), 'Reloading a valid save must recover');
    assert(useGameStore.getState().userTeamId === 'T1', 'Recovery must restore the existing career');

    await AsyncStorage.setItem(PERSIST_STORAGE_KEY, JSON.stringify({ state: { ...valid, competitions: undefined }, version: 1 }));
    await useGameStore.persist.rehydrate();
    assert(useGameStore.persist.hasHydrated() && !getPersistLoadError(), 'Valid legacy saves must still migrate');
    assert(useGameStore.getState().userTeamId === 'T1', 'Legacy migration must retain the managed club');
    const migrated = JSON.parse((await AsyncStorage.getItem(PERSIST_STORAGE_KEY))!);
    assert(migrated.version === 9, 'Successful legacy hydration must retain the existing save version');

    await AsyncStorage.removeItem(PERSIST_STORAGE_KEY);
    await useGameStore.persist.rehydrate();
    assert(useGameStore.persist.hasHydrated() && !getPersistLoadError(), 'Missing storage must remain a valid first launch');
  } finally {
    console.warn = originalWarn;
    unsubscribe();
    clearPersistLoadError();
    await AsyncStorage.setItem(PERSIST_STORAGE_KEY, validRaw);
    await useGameStore.persist.rehydrate();
  }
};

const FORMATIONS: Formation[] = [
  '4-3-3',
  '3-4-3',
  '3-4-2-1',
  '5-2-3',
  '4-4-2',
  '4-2-3-1',
  '4-2-2-2',
  '4-5-1',
  '3-5-2',
  '4-1-4-1',
  '4-3-2-1',
  '3-2-4-1',
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const withSeededRandom = <T,>(seed: number, task: () => T) => {
  const originalRandom = Math.random;
  Math.random = createSeededRandom(seed);
  try {
    return task();
  } finally {
    Math.random = originalRandom;
  }
};

const teamPlayers = (teamId: string) => (
  Object.values(useGameStore.getState().players).filter(player => player.teamId === teamId)
);

const getStarters = (teamId: string) => (
  teamPlayers(teamId).filter(player => player.isStarting)
);

const validateFormationDefinitions = () => {
  FORMATIONS.forEach(formation => {
    assert(BASE_FORMATION_SLOTS[formation], `Missing slot definition for ${formation}`);
    assert(getSlotsForFormation(formation).flat().length === 11, `${formation} should define exactly 11 slots`);
  });
};

const validateUserLineup = (label: string, team: Team) => {
  const state = useGameStore.getState();
  const starters = getStarters(team.id);
  const starterIds = new Set(starters.map(player => player.id));
  const slots = getSlotsForFormation(team.activeFormation);
  const rebuiltMap = rebuildFormationMap(slots, starters, team.formationMap || {});

  assert(starters.length <= 11, `${label}: ${team.name} has ${starters.length} starters`);
  assert(starters.length === 11, `${label}: ${team.name} should have a full XI selected`);
  assert(starterIds.size === starters.length, `${label}: ${team.name} has duplicate starters`);
  assert(Object.keys(rebuiltMap).length === 11, `${label}: ${team.name} formation map does not cover 11 slots`);

  Object.entries(team.formationMap || {}).forEach(([slotKey, playerId]) => {
    const [rowIndex, colIndex] = slotKey.split('-').map(Number);
    const slot = slots[rowIndex]?.[colIndex];
    const player = state.players[playerId];
    assert(slot, `${label}: ${team.name} stored map has invalid slot ${slotKey}`);
    assert(player?.teamId === team.id, `${label}: ${team.name} stored map has invalid player ${playerId}`);
    assert(player.isStarting, `${label}: ${player.name} is stored in map but not marked starting`);
    assert(isPlayerSlotFit(player, slot), `${label}: ${player.name} is stored in bad slot ${slot.label}`);
  });
  const storedMapIds = Object.values(team.formationMap || {});
  assert(
    new Set(storedMapIds).size === storedMapIds.length,
    `${label}: ${team.name} stored formation map contains duplicate players`
  );

  Object.entries(rebuiltMap).forEach(([slotKey, playerId]) => {
    const [rowIndex, colIndex] = slotKey.split('-').map(Number);
    const slot = slots[rowIndex]?.[colIndex];
    const player = state.players[playerId];
    assert(slot, `${label}: ${team.name} formation map has invalid slot ${slotKey}`);
    assert(player?.teamId === team.id, `${label}: ${team.name} formation map has invalid player ${playerId}`);
    assert(player.isStarting, `${label}: ${player.name} is mapped but not marked starting`);
    assert(isPlayerSlotFit(player, slot), `${label}: ${player.name} is mapped to bad slot ${slot.label}`);
  });
};

const initializeUserTeam = (formation: Formation) => {
  useGameStore.getState().initializeGame('T1');
  const userTeamId = useGameStore.getState().userTeamId;
  assert(userTeamId, 'User team should be selected after initialization');
  useGameStore.getState().setFormation(userTeamId, formation);

  const userTeam = useGameStore.getState().teams[userTeamId];
  assert(userTeam, `Missing initialized user team ${userTeamId}`);
  return userTeam;
};

const checkCorruptedMapRecovery = () => {
  const team = initializeUserTeam('4-3-3');
  const squad = teamPlayers(team.id);
  const keeper = squad.find(player => player.position === 'GK');
  const forward = squad.find(player => player.position === 'FWD');

  assert(keeper && forward, 'Corruption recovery setup needs a keeper and forward');

  useGameStore.setState(state => ({
    teams: {
      ...state.teams,
      [team.id]: {
        ...state.teams[team.id],
        formationMap: {
          '0-0': keeper.id,
          '3-0': forward.id,
        },
      },
    },
  }));

  useGameStore.getState().setFormation(team.id, team.activeFormation);
  validateUserLineup('corrupted map recovery', useGameStore.getState().teams[team.id]);
};

const checkBenchBounds = () => {
  initializeUserTeam('3-4-3');
  const state = useGameStore.getState();
  const userTeamId = state.userTeamId;
  assert(userTeamId, 'User team should exist for bench bounds');

  const userPlayers = teamPlayers(userTeamId);
  const bench = userPlayers.filter(player => player.isSub && !player.isStarting);
  assert(bench.length <= 7, `User bench should not exceed 7 players, got ${bench.length}`);
  validateUserLineup('3-4-3 setup', state.teams[userTeamId]);
};

const checkSwapPlayerKeepsFormationMapUnique = () => {
  const team = initializeUserTeam('4-3-3');
  const mapEntries = Object.entries(team.formationMap || {});
  const matchingSlots = mapEntries
    .map(([slotKey, playerId]) => {
      const [rowIndex, colIndex] = slotKey.split('-').map(Number);
      const slot = getSlotsForFormation(team.activeFormation)[rowIndex]?.[colIndex];
      return { slotKey, playerId, slot };
    })
    .filter(entry => entry.slot?.pos === 'MID');

  assert(matchingSlots.length >= 2, 'Swap uniqueness setup needs two mapped midfielders');

  const source = matchingSlots[0];
  const target = matchingSlots[1];
  useGameStore.getState().swapPlayer(target.playerId, source.playerId, target.slotKey);

  validateUserLineup('swap player map uniqueness', useGameStore.getState().teams[team.id]);
};

const checkPersistedStateSanitization = () => {
  initializeUserTeam('4-3-3');
  const state = useGameStore.getState();
  const sanitized = sanitizePersistedState({
    ...state,
    userTeamId: 'missing-team',
    competitions: {},
  });

  assert(sanitized.userTeamId === null, 'Sanitization should clear a missing user team id');
  assert(
    Object.keys(sanitized.competitions || {}).length > 0,
    'Sanitization should rebuild empty legacy competition state'
  );
};

export const saveChecks = [
  { name: 'save: validate Formation Definitions', run: validateFormationDefinitions },
  { name: 'save: Current Version Hydration', run: checkCurrentVersionHydration },
  { name: 'save: Storage Read Failure', run: checkStorageReadFailure },
  { name: 'save: malformed saves preserve data and recover current and legacy careers', run: checkMalformedSaveRecovery },
  { name: 'save: Corrupted Map Recovery', run: () => withSeededRandom(20260407, checkCorruptedMapRecovery) },
  { name: 'save: Bench Bounds', run: () => withSeededRandom(20260407, checkBenchBounds) },
  { name: 'save: Swap Player Keeps Formation Map Unique', run: () => withSeededRandom(20260407, checkSwapPlayerKeepsFormationMapUnique) },
  { name: 'save: Persisted State Sanitization', run: checkPersistedStateSanitization },
];
