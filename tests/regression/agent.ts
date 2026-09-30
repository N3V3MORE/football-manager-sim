import assert from 'node:assert/strict';
import { compareFixturesChronologically } from '../../src/core/fixtureLifecycle';
import { installAgentGameHandler } from '../../src/dev/agentGameHandler';
import { useGameStore } from '../../src/store/gameStore';
import { initGameData } from '../../src/utils/initGame';
import { runAiPreWeekPolicy } from '../../src/dev/aiPolicy';
import type { AgentGameHandler } from '../../src/dev/agentGameHandler';

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

const withGame = (check: (handler: AgentGameHandler) => void) => {
  const cleanup = installAgentGameHandler();
  try {
    const handler = globalThis.__FM_AGENT__!;
    handler.run('initialize', { teamId: 'T1', seed: 424242 });
    handler.run('applyAssistantActions');
    check(handler);
  } finally { cleanup(); }
};
const assertSuccess = (result: ReturnType<AgentGameHandler['run']>) => assert.equal(result.ok, true, result.error);

export const agentInteractionChecks = [
  { name: 'agent: detached observations and management controls', run: () => withGame(handler => {
    const owned = Object.values(state().players).filter(player => player.teamId === 'T1');
    const page = handler.run('players', { limit: 2 }).data as { players: typeof owned; total: number };
    const next = handler.run('players', { limit: 2, offset: 2 }).data as typeof page;
    assert.equal(page.total, owned.length);
    assert.ok(!page.players.some(player => next.players.some(other => other.id === player.id)));
    const originalStats = { ...state().players[page.players[0].id].stats };
    page.players[0].stats.passing = 1;
    assert.deepEqual(state().players[page.players[0].id].stats, originalStats);
    const raw = handler.run('rawState').data as ReturnType<typeof state>;
    assert.equal(raw.initializeGame, undefined);
    raw.teams.T1.tactics.tempo = 'Slow';
    assert.notEqual(state().teams.T1.tactics.tempo, 'Slow');
    const player = owned.find(item => !item.isStarting)!;
    assertSuccess(handler.run('setTrainingFocus', { playerId: player.id, focus: 'passing' }));
    assert.equal(state().players[player.id].trainingFocus, 'passing');
    assertSuccess(handler.run('setTrainingFocus', { playerId: player.id, focus: null }));
    const snapshot = handler.snapshot() as { formationSlots: { slotKey: string; playerId?: string; roles: string[] }[]; inboxMessages: { body: string }[] };
    assert.ok(snapshot.inboxMessages.every(message => message.body));
    const roleSlot = snapshot.formationSlots.find(slot => slot.roles.some(role => role !== 'default'))!;
    const role = roleSlot.roles.find(item => item !== 'default')!;
    assertSuccess(handler.run('setPlayerRole', { slotKey: roleSlot.slotKey, role }));
    assert.equal(state().teams.T1.playerRoles?.[roleSlot.slotKey], role);
    const slots = snapshot.formationSlots.filter(slot => slot.playerId && state().players[slot.playerId].position !== 'GK');
    assertSuccess(handler.run('swapStartingSlots', { slotA: slots[0].slotKey, slotB: slots[1].slotKey }));
    assert.equal(state().teams.T1.formationMap?.[slots[1].slotKey], slots[0].playerId);
    const reserve = owned.find(item => !item.isStarting && !item.isSub)!;
    const bench = owned.find(item => item.isSub)!;
    assertSuccess(handler.run('markAsSub', { playerId: bench.id }));
    assertSuccess(handler.run('markAsSub', { playerId: reserve.id }));
    const starter = owned.find(item => item.isStarting && item.position === reserve.position)!;
    const slotKey = Object.entries(state().teams.T1.formationMap!).find(([, id]) => id === starter.id)![0];
    assertSuccess(handler.run('swapPlayer', { removeId: starter.id, addId: reserve.id }));
    assert.equal(state().teams.T1.formationMap?.[slotKey], reserve.id);
    assertSuccess(handler.run('toggleStarting', { playerId: reserve.id }));
    assert.equal(state().players[reserve.id].isStarting, false);
    assertSuccess(handler.run('listPlayer', { playerId: reserve.id, askingPrice: 12 }));
    assertSuccess(handler.run('unlistPlayer', { playerId: reserve.id }));
    const target = Object.values(state().players).find(item => item.teamId !== 'T1' && state().teams[item.teamId] && !item.isStarting)!;
    useGameStore.setState({ players: { ...state().players, [target.id]: { ...target, isTransferListed: true, askingPrice: 10 } } });
    assertSuccess(handler.run('approachPlayer', { playerId: target.id }));
    const negotiation = state().pendingNegotiations!.find(item => item.playerId === target.id)!;
    assert.equal(handler.run('submitTransferBid', { negotiationId: negotiation.id, fee: 0, wageOffered: 0 }).ok, false);
    assertSuccess(handler.run('withdrawTransferNegotiation', { negotiationId: negotiation.id }));
    assert.equal(state().pendingNegotiations!.find(item => item.id === negotiation.id)?.status, 'rejected');
  }) },
  { name: 'agent: invalid inputs and rejected transactions are truthful', run: () => withGame(handler => {
    const player = Object.values(state().players).find(item => item.teamId === 'T1')!;
    const [slotKey, starterId] = Object.entries(state().teams.T1.formationMap!)[0];
    for (const result of [
      handler.run('initialize', { teamId: 'unknown' }), handler.run('initialize', { seed: 0.5 }),
      handler.run('changeTeam', { teamId: 'unknown' }), handler.run('markInboxRead', { messageId: 'unknown' }),
      handler.run('advanceWeek', { count: 1e100, allowLargeCount: true }), handler.run('advanceWeek', { count: 1.5 }),
      handler.run('listPlayer', { playerId: player.id, askingPrice: NaN }),
      handler.run('listPlayer', { playerId: player.id, askingPrice: Infinity }),
      handler.run('setTrainingFocus', { playerId: player.id, focus: 'invalid' }),
      handler.run('setFormation', { formation: '4-3-3', teamId: 3 }),
      handler.run('swapPlayer', { removeId: starterId, addId: starterId, slotKey }),
    ]) { assert.equal(result.ok, false); assert.equal(result.changed, false); assert.ok(result.error); }
    const rejected = handler.run('renewContract', { playerId: player.id, years: 3, wage: 0 });
    assert.equal(rejected.ok, false);
    assert.ok(rejected.error);
    assert.equal((rejected.data as { success: boolean }).success, false);
    const target = Object.values(state().players).find(item => item.teamId !== 'T1')!;
    assert.equal(handler.run('buyPlayer', { playerId: target.id, fee: 0, wageOffered: 1 }).ok, false);
  }) },
  { name: 'agent: live management, blocked weeks and extra-time recovery', run: () => withGame(handler => {
    const fixture = Object.values(state().fixtures).find(item => item.week === 1 && (item.homeTeamId === 'T1' || item.awayTeamId === 'T1'))!;
    assertSuccess(handler.run('processLiveMinute', { fixtureId: fixture.id, minute: 1 }));
    const activeState = state();
    state().playMatch(fixture.id);
    assert.equal(state(), activeState, 'Quick sim must preserve an existing live match');
    const rejectedQuickSim = handler.run('quickSimNext', { fixtureId: fixture.id });
    assert.equal(rejectedQuickSim.ok, false);
    assert.equal(rejectedQuickSim.changed, false);
    const blocked = handler.run('advanceWeek', { count: 2 });
    assert.equal(blocked.ok, false);
    assert.equal((blocked.data as { advancedWeeks: number }).advancedWeeks, 0);
    assert.equal(blocked.changed, false);
    assertSuccess(handler.run('setLiveMatchFormation', { fixtureId: fixture.id, formation: '4-4-2' }));
    const live = state().liveMatches[fixture.id];
    const isHome = fixture.homeTeamId === 'T1';
    const currentIds = (isHome ? live.currentHomePlayerIds : live.currentAwayPlayerIds)!;
    const benchIds = (isHome ? live.homeBenchIds : live.awayBenchIds)!;
    const off = currentIds.map(id => state().players[id]).find(item => item.position !== 'GK')!;
    const on = benchIds.map(id => state().players[id]).find(item => item.position === off.position)!;
    assertSuccess(handler.run('makeLiveSubstitutions', { fixtureId: fixture.id, replacements: [{ offPlayerId: off.id, onPlayerId: on.id }] }));
    // Simulate a reloaded tied cup at minute 90, preserving the existing runtime.
    useGameStore.setState({ fixtures: { ...state().fixtures, [fixture.id]: { ...state().fixtures[fixture.id], competitionType: 'domestic_cup', round: 'final', isKnockout: true, homeScore: 0, awayScore: 0 } },
      liveMatches: { ...state().liveMatches, [fixture.id]: { ...state().liveMatches[fixture.id], processedMinutes: Array.from({ length: 90 }, (_, index) => index + 1) } } });
    assertSuccess(handler.run('processLiveMinute', { fixtureId: fixture.id, minute: 91 }));
    const resume = handler.run('liveSimNext', { fixtureId: fixture.id, finish: false });
    assertSuccess(resume);
    assert.equal((resume.data as { minute: number }).minute, 120);
    assert.equal(state().fixtures[fixture.id].isPlayed, false);
    assert.equal((handler.snapshot({ fixtureId: fixture.id }) as { match: { nextMinute: number | null } }).match.nextMinute, null);
    assertSuccess(handler.run('finishLiveMatch', { fixtureId: fixture.id }));
    assert.equal(state().fixtures[fixture.id].isPlayed, true);
    assert.equal(state().liveMatches[fixture.id], undefined);
    assertSuccess(handler.run('advanceWeek'));
  }) },
  { name: 'agent: seeded autoplay and eligible live AI replacements', run: () => withGame(handler => {
    const originalRandom = Math.random;
    const first = handler.run('playWithAI', { seed: 671, maxWeeks: 1 });
    assertSuccess(first);
    assert.equal((first.data as { weeksPlayed: number }).weeksPlayed, 1);
    assert.equal(Math.random, originalRandom);
    Math.random = () => 0.123;
    const second = handler.run('playWithAI', { seed: 671, maxWeeks: 1 });
    assertSuccess(second);
    Math.random = originalRandom;
    assert.equal(first.stateHash, second.stateHash);
    assert.deepEqual(first.data, second.data);
    const fixture = Object.values(state().fixtures).find(item => !item.isPlayed && (item.homeTeamId === 'T1' || item.awayTeamId === 'T1'))!;
    const players = Object.values(state().players).filter(item => item.teamId === 'T1' && item.position === 'MID').slice(0, 3);
    assert.equal(players.length, 3);
    const [off, used, fresh] = players;
    let replacementId: string | undefined;
    const game = { ...state(), players: { ...state().players, [off.id]: { ...off, energy: 1 }, [used.id]: { ...used, overallRating: 99 } },
      liveMatches: { [fixture.id]: { initialized: true, yellowCardPlayerIds: [], sentOffPlayerIds: [], processedMinutes: [45],
        homeStarterIds: [off.id], awayStarterIds: [off.id], currentHomePlayerIds: [off.id], currentAwayPlayerIds: [off.id],
        homeBenchIds: [used.id, fresh.id], awayBenchIds: [used.id, fresh.id], homeMinuteMap: { [used.id]: 10 }, awayMinuteMap: { [used.id]: 10 } } },
      makeLiveSubstitutions: (_id: string, replacements: { onPlayerId: string }[]) => { replacementId = replacements[0].onPlayerId; return { success: true, message: '' }; },
    };
    runAiPreWeekPolicy(game, { seasons: 1, seed: 671, teamId: 'T1', policy: 'passive', stopOnError: true, reportBalanceFlags: false, verbosity: 'quiet' });
    assert.equal(replacementId, fresh.id, 'AI must exclude a used substitute before ranking the bench');
  }) },
];
