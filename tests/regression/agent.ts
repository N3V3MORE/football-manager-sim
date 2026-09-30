import assert from 'node:assert/strict';
import { compareFixturesChronologically } from '../../src/core/fixtureLifecycle';
import { installAgentGameHandler } from '../../src/dev/agentGameHandler';
import { useGameStore } from '../../src/store/gameStore';
import { initGameData } from '../../src/utils/initGame';

const state = () => useGameStore.getState();
export const checkAgentRuntimeBridge = () => {
    const cleanup = installAgentGameHandler();
    try {
    const handler = globalThis.__FM_AGENT__;
    assert.ok(handler, 'Runtime handler should be installed');

    const initialData = initGameData();
    const firstTeamId = Object.keys(initialData.teams)[0];
    assert.ok(firstTeamId, 'Initial data must include at least one team');

    const firstSeededInit = handler.run('initialize', { teamId: firstTeamId, seed: 424242 });
    assert.equal(firstSeededInit.ok, true, firstSeededInit.error || 'Seeded initialize failed');
    const firstHash = firstSeededInit.stateHash;
    const secondSeededInit = handler.run('initialize', { teamId: firstTeamId, seed: 424242 });
    assert.equal(secondSeededInit.ok, true, secondSeededInit.error || 'Repeated seeded initialize failed');
    assert.equal(secondSeededInit.stateHash, firstHash, 'Seeded runtime initialize should reproduce the same state hash');

    const current = state();
    const userTeamId = current.userTeamId;
    assert.ok(userTeamId, 'Runtime initialize should select a user team');

    const managedFutureFixture = Object.values(current.fixtures)
      .filter(fixture => !fixture.isPlayed && fixture.week > current.currentWeek && (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId))
      .sort(compareFixturesChronologically)[0];
    const otherDueFixture = Object.values(current.fixtures)
      .filter(fixture => !fixture.isPlayed && fixture.week <= current.currentWeek && fixture.homeTeamId !== userTeamId && fixture.awayTeamId !== userTeamId)
      .sort(compareFixturesChronologically)[0];
    const managedDueFixture = Object.values(current.fixtures)
      .filter(fixture => !fixture.isPlayed && fixture.week <= current.currentWeek && (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId))
      .sort(compareFixturesChronologically)[0];
    const otherTeam = Object.values(current.teams).find(team => team.id !== userTeamId);
    const otherPlayer = Object.values(current.players).find(player => player.teamId !== userTeamId);
    assert.ok(managedFutureFixture && otherDueFixture && managedDueFixture && otherTeam && otherPlayer, 'Expected fixtures and entities for runtime legality checks');

    const assertRejected = (name: string, result: ReturnType<typeof handler.run>) => {
      assert.equal(result.ok, false, `${name} should be rejected`);
      assert.ok(result.error && result.error.length > 0, `${name} should include an error message`);
    };

    assertRejected('future managed fixture quick sim', handler.run('quickSimNext', { fixtureId: managedFutureFixture.id }));
    assertRejected('other-club due fixture quick sim', handler.run('quickSimNext', { fixtureId: otherDueFixture.id }));
    assertRejected('illegal live minute', handler.run('processLiveMinute', { fixtureId: managedDueFixture.id, minute: 91 }));
    assertRejected('invalid formation', handler.run('setFormation', { teamId: userTeamId, formation: '9-9-9' }));
    assertRejected('other-club formation', handler.run('setFormation', { teamId: otherTeam.id, formation: '4-3-3' }));
    assertRejected('invalid tactics', handler.run('setTactics', { teamId: userTeamId, tactics: { mentality: 'Reckless' } }));
    assertRejected('non-owned player listing', handler.run('listPlayer', { playerId: otherPlayer.id, askingPrice: 1 }));
    assertRejected('non-owned player renewal', handler.run('renewContract', { playerId: otherPlayer.id, years: 2, wage: 50 }));

    const smokeResult = handler.run('smokeCheck');
    assert.equal(smokeResult.ok, true, smokeResult.error || 'Runtime handler smoke check failed');
    } finally { cleanup(); }
    assert.equal(globalThis.__FM_AGENT__, undefined, 'Runtime handler cleanup should remove global hook');
  };
