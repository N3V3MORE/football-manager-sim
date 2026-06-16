import assert from 'node:assert/strict';
import { Fixture } from '../src/models/types';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { useGameStore } from '../src/store/gameStore';
import { initGameData } from '../src/utils/initGame';

type CheckStep = {
  name: string;
  status: 'pass' | 'fail';
  detail?: string;
};

const steps: CheckStep[] = [];
const state = () => useGameStore.getState();

const errorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
);

const record = (name: string, fn: () => void) => {
  try {
    fn();
    steps.push({ name, status: 'pass' });
  } catch (error) {
    steps.push({ name, status: 'fail', detail: errorMessage(error) });
    throw error;
  }
};

const getUserFixtures = (excludedFixtureIds = new Set<string>()) => {
  const current = state();
  const userTeamId = current.userTeamId;
  assert.ok(userTeamId, 'User team must be selected');

  return Object.values(current.fixtures)
    .filter(fixture => (
      !fixture.isPlayed &&
      !excludedFixtureIds.has(fixture.id) &&
      (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId)
    ))
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));
};

const assertPlayedFixtureIsValid = (fixture: Fixture) => {
  assert.equal(fixture.isPlayed, true, `${fixture.id} should be played`);
  assert.equal(typeof fixture.homeScore, 'number', `${fixture.id} should have a home score`);
  assert.equal(typeof fixture.awayScore, 'number', `${fixture.id} should have an away score`);
  if (fixture.isKnockout) {
    assert.ok(fixture.winnerTeamId, `${fixture.id} knockout fixture should have a winner`);
  }
};

const assertReferenceIntegrity = () => {
  const current = state();
  Object.values(current.players).forEach(player => {
    assert.ok(current.teams[player.teamId], `Player ${player.id} references missing team ${player.teamId}`);
  });

  Object.values(current.fixtures).forEach(fixture => {
    assert.ok(current.teams[fixture.homeTeamId], `Fixture ${fixture.id} references missing home team`);
    assert.ok(current.teams[fixture.awayTeamId], `Fixture ${fixture.id} references missing away team`);
    if (fixture.isPlayed) assertPlayedFixtureIsValid(fixture);
  });

  const userTeamId = current.userTeamId;
  assert.ok(userTeamId, 'User team must be selected');
  const userTeam = current.teams[userTeamId];
  assert.ok(userTeam, 'User team record must exist');

  Object.entries(userTeam.formationMap || {}).forEach(([slotKey, playerId]) => {
    const player = current.players[playerId];
    assert.ok(player, `Formation slot ${slotKey} references missing player ${playerId}`);
    assert.equal(player.teamId, userTeamId, `Formation slot ${slotKey} references player outside user team`);
  });
};

const printReport = (status: 'pass' | 'fail') => {
  const current = state();
  const userTeamId = current.userTeamId;
  const userTeam = userTeamId ? current.teams[userTeamId] : undefined;
  const playedFixtures = Object.values(current.fixtures).filter(fixture => fixture.isPlayed).length;

  console.log(JSON.stringify({
    status,
    script: 'check:agent',
    checks: steps,
    summary: {
      userTeamId,
      userTeamName: userTeam?.name,
      currentWeek: current.currentWeek,
      seasonWeekLimit: getSeasonWeekLimit(current.fixtures, current.competitions),
      teams: Object.keys(current.teams).length,
      players: Object.keys(current.players).length,
      fixtures: Object.keys(current.fixtures).length,
      playedFixtures,
      inboxMessages: current.inboxMessages.length,
      liveMatches: Object.keys(current.liveMatches || {}).length,
    },
  }, null, 2));
};

try {
  let liveFixtureId = '';
  let quickFixtureId = '';

  record('initialize game', () => {
    const data = initGameData();
    const firstTeamId = Object.keys(data.teams)[0];
    assert.ok(firstTeamId, 'Initial data must include at least one team');

    state().initializeGame(firstTeamId);
    assert.equal(state().userTeamId, firstTeamId);
    assert.ok(Object.keys(state().teams).length > 0, 'Teams should be loaded');
    assert.ok(Object.keys(state().players).length > 0, 'Players should be loaded');
    assert.ok(Object.keys(state().fixtures).length > 0, 'Fixtures should be loaded');
    assert.ok(state().inboxMessages.length > 0, 'Assistant/system inbox should be populated');
  });

  record('apply assistant setup actions', () => {
    const current = state();
    const userTeamId = current.userTeamId;
    assert.ok(userTeamId, 'User team must be selected');

    const setupActions = current.inboxMessages.filter(message => (
      message.action &&
      (message.action.type === 'apply_lineup' || message.action.type === 'apply_tactics') &&
      message.action.payload.teamId === userTeamId
    ));
    assert.ok(setupActions.length > 0, 'Expected at least one assistant setup action');

    setupActions.forEach(message => state().applyInboxAction(message.id));

    const userPlayers = Object.values(state().players).filter(player => player.teamId === userTeamId);
    const starters = userPlayers.filter(player => player.isStarting);
    const substitutes = userPlayers.filter(player => player.isSub);
    assert.ok(starters.length >= 11, `Expected at least 11 starters, got ${starters.length}`);
    assert.ok(substitutes.length <= 7, `Expected at most 7 substitutes, got ${substitutes.length}`);
  });

  record('transfer actions', () => {
    const current = state();
    const userTeamId = current.userTeamId;
    assert.ok(userTeamId, 'User team must be selected');

    const ownPlayer = Object.values(current.players).find(player => player.teamId === userTeamId);
    const targetPlayer = Object.values(current.players).find(player => player.teamId !== userTeamId);
    assert.ok(ownPlayer, 'Expected at least one owned player');
    assert.ok(targetPlayer, 'Expected at least one transfer target');

    state().listPlayerForSale(ownPlayer.id, 1);
    assert.equal(state().players[ownPlayer.id].isTransferListed, true, 'Owned player should be listed');
    state().unlistPlayer(ownPlayer.id);
    assert.equal(state().players[ownPlayer.id].isTransferListed, false, 'Owned player should be unlisted');

    const bidResult = state().buyPlayer(targetPlayer.id, 0, 1);
    assert.equal(typeof bidResult.success, 'boolean');
    assert.ok(bidResult.message.length > 0, 'Transfer result should include a message');
  });

  record('live match path', () => {
    const [fixture] = getUserFixtures();
    assert.ok(fixture, 'Expected an unplayed user fixture for live match');
    liveFixtureId = fixture.id;

    let eventCount = 0;
    for (let minute = 1; minute <= 90; minute += 1) {
      const result = state().processMatchMinute(liveFixtureId, minute);
      if (result.event) eventCount += 1;
    }

    assert.ok(state().liveMatches[liveFixtureId], 'Live match state should exist before finishing');
    state().finishLiveMatch(liveFixtureId);
    assertPlayedFixtureIsValid(state().fixtures[liveFixtureId]);
    assert.ok(!state().liveMatches[liveFixtureId], 'Live match state should be cleaned up after finishing');
    assert.ok(eventCount > 0, 'Live match should emit at least one event');
  });

  record('quick sim path', () => {
    const [fixture] = getUserFixtures(new Set([liveFixtureId]));
    assert.ok(fixture, 'Expected an unplayed user fixture for quick sim');
    quickFixtureId = fixture.id;

    state().playMatch(quickFixtureId);
    assertPlayedFixtureIsValid(state().fixtures[quickFixtureId]);
    assert.ok(!state().liveMatches[quickFixtureId], 'Quick sim should not leave live match state behind');
  });

  record('weekly progression', () => {
    const beforeWeek = state().currentWeek;
    state().advanceWeek();
    assert.ok(state().currentWeek >= beforeWeek, 'Week should not move backwards during early-season smoke check');
    assert.ok(state().news.length > 0, 'Week progression should retain or generate news');
    assert.ok(state().inboxMessages.length > 0, 'Week progression should retain or generate inbox messages');
  });

  record('reference integrity', assertReferenceIntegrity);

  printReport('pass');
  process.exit(0);
} catch (error) {
  printReport('fail');
  console.error(errorMessage(error));
  process.exit(1);
}
