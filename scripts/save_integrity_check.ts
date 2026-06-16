import { BASE_FORMATION_SLOTS, getSlotsForFormation } from '../src/constants/formations';
import { isPlayerSlotFit, rebuildFormationMap } from '../src/core/formationMapUtils';
import { Formation, Team } from '../src/models/types';
import { useGameStore } from '../src/store/gameStore';
import { createSeededRandom } from './utils/seededRandom';

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

const validateReferences = (label: string) => {
  const state = useGameStore.getState();

  Object.values(state.players).forEach(player => {
    assert(state.teams[player.teamId]!, `${label}: ${player.name} points to missing team ${player.teamId}`);
  });

  Object.values(state.fixtures).forEach(fixture => {
    assert(state.teams[fixture.homeTeamId]!, `${label}: fixture ${fixture.id} has missing home team ${fixture.homeTeamId}`);
    assert(state.teams[fixture.awayTeamId]!, `${label}: fixture ${fixture.id} has missing away team ${fixture.awayTeamId}`);
  });

  Object.values(state.teams).forEach(team => {
    team.lastStartingXI?.forEach(playerId => {
      const player = state.players[playerId];
      assert(player?.teamId === team.id, `${label}: ${team.name} last XI contains invalid player ${playerId}`);
    });
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
    const slot = slots[rowIndex!]?.[colIndex!];
    const player = state.players[playerId]!;
    assert(slot, `${label}: ${team.name} stored map has invalid slot ${slotKey}`);
    assert(player.teamId === team.id, `${label}: ${team.name} stored map has invalid player ${playerId}`);
    assert(player.isStarting, `${label}: ${player.name} is stored in map but not marked starting`);
    assert(isPlayerSlotFit(player, slot), `${label}: ${player.name} is stored in bad slot ${slot.label}`);
  });

  Object.entries(rebuiltMap).forEach(([slotKey, playerId]) => {
    const [rowIndex, colIndex] = slotKey.split('-').map(Number);
    const slot = slots[rowIndex!]?.[colIndex!];
    const player = state.players[playerId]!;
    assert(slot, `${label}: ${team.name} formation map has invalid slot ${slotKey}`);
    assert(player.teamId === team.id, `${label}: ${team.name} formation map has invalid player ${playerId}`);
    assert(player.isStarting, `${label}: ${player.name} is mapped but not marked starting`);
    assert(isPlayerSlotFit(player, slot), `${label}: ${player.name} is mapped to bad slot ${slot.label}`);
  });
};

const initializeUserTeam = (formation: Formation) => {
  useGameStore.getState().initializeGame('T1');
  const userTeamId = useGameStore.getState().userTeamId;
  assert(userTeamId, 'User team should be selected after initialization');
  useGameStore.getState().setFormation(userTeamId, formation);

  const userTeam = useGameStore.getState().teams[userTeamId]!;
  assert(userTeam, `Missing initialized user team ${userTeamId}`);
  return userTeam;
};

const checkSeasonSkipContinuity = () => {
  const before = initializeUserTeam('4-3-3');
  const beforeTactics = JSON.stringify(before.tactics);
  const beforeFormation = before.activeFormation;

  validateReferences('before skip');
  validateUserLineup('before skip', before);

  useGameStore.getState().skipToEndOfSeason();

  const state = useGameStore.getState();
  const after = state.teams[before.id]!;
  assert(after, `Missing user team after season skip ${before.id}`);
  assert(after.activeFormation === beforeFormation, 'Season skip changed the user formation');
  assert(JSON.stringify(after.tactics) === beforeTactics, 'Season skip changed user tactics');
  assert(state.currentWeek === 1, 'Season skip should roll into a new season at week 1');
  assert(after.played === 0, `Season skip should reset the new season played count, got ${after.played}`);
  assert(Object.values(state.fixtures).every(fixture => !fixture.isPlayed), 'New season fixtures should start unplayed');

  validateReferences('after skip');
  validateUserLineup('after skip', after);
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
        ...state.teams[team.id]!,
        formationMap: {
          '0-0': keeper.id,
          '3-0': forward.id,
        },
      },
    },
  }));

  useGameStore.getState().setFormation(team.id, team.activeFormation);
  validateUserLineup('corrupted map recovery', useGameStore.getState().teams[team.id]!);
};

const checkBenchBounds = () => {
  initializeUserTeam('3-4-3');
  const state = useGameStore.getState();
  const userTeamId = state.userTeamId;
  assert(userTeamId, 'User team should exist for bench bounds');

  const userPlayers = teamPlayers(userTeamId);
  const bench = userPlayers.filter(player => player.isSub && !player.isStarting);
  assert(bench.length <= 7, `User bench should not exceed 7 players, got ${bench.length}`);
  validateUserLineup('3-4-3 setup', state.teams[userTeamId]!);
};

const checkManagerProfilesLoaded = () => {
  const state = useGameStore.getState();
  const teams = Object.values(state.teams);
  assert(teams.length > 0, 'Expected teams to exist before manager validation');
  teams.forEach(team => {
    assert(team.manager, `Missing manager for ${team.name}`);
    assert(team.manager.teamId === team.id, `Manager team linkage broken for ${team.name}`);
    assert(team.manager.teamName === team.name, `Manager team name mismatch for ${team.name}`);
    assert(team.manager.preferredFormations.length > 0, `Manager formations missing for ${team.name}`);
  });
};

const runSaveIntegrityCheck = () => withSeededRandom(20260407, () => {
  console.log('--- SAVE INTEGRITY CHECK ---');
  validateFormationDefinitions();
  console.log('[OK] Formation definitions cover every Formation value');
  checkSeasonSkipContinuity();
  console.log('[OK] Season skip keeps user lineup, tactics, and references intact');
  checkCorruptedMapRecovery();
  console.log('[OK] Corrupted formation maps recover to valid player slots');
  checkBenchBounds();
  console.log('[OK] Bench bounds and 3-4-3 lineup validation passed');
  checkManagerProfilesLoaded();
  console.log('[OK] Manager profiles are loaded for every club');
  console.log('--- SAVE INTEGRITY CHECK COMPLETE ---');
});

runSaveIntegrityCheck();
