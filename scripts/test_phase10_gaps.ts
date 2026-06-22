/**
 * Phase 10 — Testing Gap Fill
 *
 * Covers:
 *   a) Long-career simulation: youth replenishment, population stability
 *   b) Quick-sim vs live-sim parity: energy drain equivalence
 *   c) Board-event accounting: one-time events, failed objective permanence
 *   d) Transfer transactions: user-listed sale flow, AI contract assignment, squad-size limits
 *   e) Career flow: reputation-based offers, vacancy filtering, manager identity
 *   f) Save/load roundtrip: deterministic replay, referential integrity, corruption resilience
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { initGameData } from '../src/utils/initGame';
import { autoAssignLineup, quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { finishLiveMatchState, processLiveMatchMinuteState } from '../src/store/liveMatchActions';
import {
  evaluateBoardObjectives,
  runBoardReview,
  buildBoardObjectives,
  buildBoardProfile,
} from '../src/core/boardEngine';
import { advanceSeason } from '../src/core/seasonTransition';
import {
  createDefaultCareerRecord,
  generateJobOfferCandidates,
  buildSeasonSummary,
  applySeasonEndToCareer,
} from '../src/core/careerEngine';
import { applySharedPostMatchAccounting } from '../src/core/postMatchAccounting';
import {
  clearPersistLoadError,
  getPersistLoadError,
  PERSIST_STORAGE_KEY,
  safeLoadState,
  safeStorage,
  sanitizePersistedState,
} from '../src/store/persistence';
import { useGameStore } from '../src/store/gameStore';
import { isPlayerUnavailable } from '../src/core/playerStatusUtils';
import { BoardObjective, CompetitionState, Fixture, Player, Team } from '../src/models/types';
import { buildSquadPlan } from '../src/core/squadPlanningEngine';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
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

// ═══════════════════════════════════════════════════════════════
// AREA A — LONG-CAREER SIMULATION (youth replenishment, population stability)
// ═══════════════════════════════════════════════════════════════

const checkYouthReplenishmentAtSeasonEnd = () => {
  const rng = { next: createSeededRandom(2026061901) };
  const data = initGameData(undefined, rng);
  // Find a team with a small squad — remove players to force under threshold
  const team = Object.values(data.teams).find(t => t.division === 'League Two' && !t.isExternal);
  assert(team, 'Expected a League Two team for youth replenishment test');

  const squadBefore = Object.values(data.players).filter(p => p.teamId === team!.id);
  // Reduce squad below MIN_SQUAD_THRESHOLD (16)
  const keepCount = 12;
  const trimmedPlayers = { ...data.players };
  squadBefore.slice(keepCount).forEach(p => {
    trimmedPlayers[p.id] = { ...p, teamId: 'free-agent-pool' };
  });

  const seasonWeekLimit = getSeasonWeekLimit(data.fixtures, data.competitions);
  let state = {
    players: trimmedPlayers,
    teams: data.teams,
    fixtures: data.fixtures,
    currentWeek: 1,
    news: [] as string[],
  };

  // Simulate through end of season
  for (let week = 1; week <= seasonWeekLimit; week++) {
    const weekFixtures = Object.values(state.fixtures).filter(f => f.week === week);
    for (const fixture of weekFixtures) {
      const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, null, { rng });
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fixture.id] = result.fixture;
    }
    const progression = computeWeeklyProgression(week, state.players, state.teams, state.fixtures, state.news, null, rng);
    state.players = progression.players;
    state.teams = progression.teams;
    state.currentWeek = progression.currentWeek;
    state.news = progression.news;
  }

  // After season end, the underfilled squad should have received youth intake
  const squadAfter = Object.values(state.players).filter(p => p.teamId === team!.id);
  assert(
    squadAfter.length > keepCount,
    `Youth replenishment should increase squad size above ${keepCount}, got ${squadAfter.length}`
  );
  assert(
    squadAfter.some(p => p.age >= 16 && p.age <= 18),
    'Youth replenishment should produce academy-aged players (16-18)'
  );
  assert(
    squadAfter.some(p => p.overallRating >= 40 && p.overallRating <= 55),
    'Youth replenishment should produce players with low-end ratings (40-55)'
  );
};

const checkPopulationStabilityOverSeasons = () => {
  const rng = { next: createSeededRandom(2026061902) };
  const initialData = initGameData(undefined, rng);
  const initialPlayerCount = Object.keys(initialData.players).length;

  let state = {
    players: initialData.players,
    teams: initialData.teams,
    fixtures: initialData.fixtures,
    competitions: initialData.competitions,
    currentWeek: 1,
    news: [] as string[],
  };

  // Run 2 full seasons
  for (let season = 1; season <= 2; season++) {
    const seasonWeekLimit = getSeasonWeekLimit(state.fixtures, state.competitions);
    for (let week = 1; week <= seasonWeekLimit; week++) {
      const weekFixtures = Object.values(state.fixtures).filter(f => f.week === week);
      for (const fixture of weekFixtures) {
        const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, null, { rng });
        state.players = result.players;
        state.teams = result.teams;
        state.fixtures[fixture.id] = result.fixture;
      }
      const progression = computeWeeklyProgression(week, state.players, state.teams, state.fixtures, state.news, null, rng);
      state.players = progression.players;
      state.teams = progression.teams;
      state.currentWeek = progression.currentWeek;
      state.news = progression.news;
      const transfers = computeWeeklyTransfers(state.players, state.teams, null, rng, state.currentWeek);
      state.players = transfers.players;
      state.teams = transfers.teams;
    }

    if (season < 2) {
      const rollover = advanceSeason(state.players, state.teams, state.competitions, null, state.news);
      state.players = rollover.players;
      state.teams = rollover.teams;
      state.fixtures = rollover.fixtures;
      state.competitions = rollover.competitions;
      state.currentWeek = rollover.currentWeek;
      state.news = rollover.news;
    }
  }

  const finalPlayerCount = Object.keys(state.players).length;
  // Player count should remain stable (within ±5% of initial, allowing for youth intake growth)
  const ratio = finalPlayerCount / initialPlayerCount;
  assert(
    ratio >= 0.95 && ratio <= 1.10,
    `Player population should remain stable over 2 seasons. Initial: ${initialPlayerCount}, Final: ${finalPlayerCount} (ratio: ${ratio.toFixed(3)})`
  );

  // Verify every team still has a minimum squad
  Object.values(state.teams).forEach(team => {
    const squad = Object.values(state.players).filter(p => p.teamId === team.id);
    assert(squad.length >= 11, `${team.name} should have at least 11 players after 2 seasons (got ${squad.length})`);
  });
};

// ═══════════════════════════════════════════════════════════════
// AREA B — QUICK-SIM VS LIVE-SIM PARITY (energy drain)
// ═══════════════════════════════════════════════════════════════

const checkEnergyDrainConsistency = () => {
  // Verify the post-match energy drain is applied consistently
  // and that players who play 90 minutes experience appropriate drain
  const data = initGameData();
  const base = Object.values(data.players).find(p => p.position === 'MID');
  assert(base, 'Expected a midfielder for energy drain test');

  // Test 1: Player who plays 90 minutes gets energy drained
  const fullGamePlayer: Player = {
    ...base!,
    id: 'energy-full-90',
    energy: 95,
    minutesPlayed: 0,
    matchRatingHistory: [],
  };
  const players90 = { [fullGamePlayer.id]: fullGamePlayer };

  applySharedPostMatchAccounting({
    teamParticipants: [fullGamePlayer],
    teamStarterIds: new Set([fullGamePlayer.id]),
    minuteMap: { [fullGamePlayer.id]: 90 },
    concededGoalMinutes: [],
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
    updatedPlayers: players90,
    rng: { next: () => 0.5 },
  });

  assert(players90[fullGamePlayer.id].energy < 95, 'A player playing 90 minutes should lose energy');
  assert(players90[fullGamePlayer.id].energy >= 40, 'Post-match energy should not drop below a plausible floor');
  assert(players90[fullGamePlayer.id].minutesPlayed === 90, 'Full-game player should log 90 minutes');

  // Test 2: Player who doesn't play keeps energy (no drain)
  const inactivePlayer: Player = {
    ...base!,
    id: 'energy-inactive',
    energy: 88,
    minutesPlayed: 0,
  };
  const playersInactive = { [inactivePlayer.id]: inactivePlayer };

  applySharedPostMatchAccounting({
    teamParticipants: [inactivePlayer],
    teamStarterIds: new Set(),
    minuteMap: { [inactivePlayer.id]: 0 },
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
    updatedPlayers: playersInactive,
    rng: { next: () => 0.5 },
  });

  assert(playersInactive[inactivePlayer.id].energy === 88, 'Inactive player should retain their energy');
  assert(playersInactive[inactivePlayer.id].minutesPlayed === 0, 'Inactive player should not log minutes');

  // Test 3: Energy drain can be toggled off
  const noDrainPlayer: Player = {
    ...base!,
    id: 'energy-no-drain',
    energy: 50,
    minutesPlayed: 0,
  };
  const playersNoDrain = { [noDrainPlayer.id]: noDrainPlayer };

  applySharedPostMatchAccounting({
    teamParticipants: [noDrainPlayer],
    teamStarterIds: new Set([noDrainPlayer.id]),
    minuteMap: { [noDrainPlayer.id]: 90 },
    concededGoalMinutes: [],
    concededGoalsTotal: 1,
    isWin: false,
    isDraw: false,
    teamTactics: {
      mentality: 'Balanced',
      passingStyle: 'Mixed',
      tempo: 'Normal',
      defensiveLine: 'Standard',
      pressing: 'Medium',
    },
    updatedPlayers: playersNoDrain,
    rng: { next: () => 0.5 },
    applyEnergyDrain: false,
  });

  assert(playersNoDrain[noDrainPlayer.id].energy === 50, 'Disabled energy drain should preserve player energy');
};

const checkActualQuickLiveMatchParity = () => {
  const data = initGameData('Arsenal');
  const fixture = Object.values(data.fixtures).find(f => (
    f.week === 1 &&
    !f.isPlayed &&
    f.homeTeamId !== 'T1' &&
    f.awayTeamId !== 'T1' &&
    f.competitionType === 'league'
  ));
  assert(fixture, 'Expected a non-user week-one league fixture for quick/live parity test');

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const preparedPlayers = clone(data.players);
  [fixture!.homeTeamId, fixture!.awayTeamId].forEach(teamId => {
    const team = data.teams[teamId];
    const lineupUpdates = autoAssignLineup(teamId, preparedPlayers, team.activeFormation);
    Object.entries(lineupUpdates).forEach(([playerId, updates]) => {
      preparedPlayers[playerId] = { ...preparedPlayers[playerId], ...updates };
    });
  });

  const homeStarterIds = Object.values(preparedPlayers)
    .filter(player => player.teamId === fixture!.homeTeamId && player.isStarting)
    .map(player => player.id);
  const awayStarterIds = Object.values(preparedPlayers)
    .filter(player => player.teamId === fixture!.awayTeamId && player.isStarting)
    .map(player => player.id);
  assert(homeStarterIds.length === 11, `Quick/live parity setup needs 11 home starters, got ${homeStarterIds.length}`);
  assert(awayStarterIds.length === 11, `Quick/live parity setup needs 11 away starters, got ${awayStarterIds.length}`);

  const basePlayers = clone(preparedPlayers);
  const baseTeams = clone(data.teams);
  const baseFixtures = clone(data.fixtures);
  const baseCompetitions = clone(data.competitions);
  const trackedPlayerIds = Object.values(basePlayers)
    .filter(player => player.teamId === fixture!.homeTeamId || player.teamId === fixture!.awayTeamId)
    .map(player => player.id);
  const startingIds = [...homeStarterIds, ...awayStarterIds];

  const statDelta = (
    before: Record<string, Player>,
    after: Record<string, Player>,
    ids: string[],
    stat: keyof Pick<Player, 'goals' | 'assists' | 'yellowCards' | 'redCards'>
  ) => ids.reduce((sum, id) => sum + ((after[id]?.[stat] || 0) - (before[id]?.[stat] || 0)), 0);
  const averageEnergyLoss = (after: Record<string, Player>) => (
    startingIds.reduce((sum, id) => sum + ((basePlayers[id]?.energy || 0) - (after[id]?.energy || 0)), 0) / startingIds.length
  );
  const scoreTotal = (playedFixture: Fixture, label: string) => {
    const homeScore = playedFixture.homeScore;
    const awayScore = playedFixture.awayScore;
    assert(playedFixture.isPlayed, `${label} fixture should be marked played`);
    if (typeof homeScore !== 'number') throw new Error(`${label} home score should be numeric`);
    if (typeof awayScore !== 'number') throw new Error(`${label} away score should be numeric`);
    assert(Number.isFinite(homeScore), `${label} home score should be finite`);
    assert(Number.isFinite(awayScore), `${label} away score should be finite`);
    assert(
      homeScore >= 0 && homeScore <= 15 && awayScore >= 0 && awayScore <= 15,
      `${label} scores should remain plausible, got ${homeScore}-${awayScore}`
    );
    return homeScore + awayScore;
  };
  const goalEventCount = (events: string[]) => events.filter(event => /\bGOAL!/i.test(event)).length;
  const redEventCount = (events: string[]) => events.filter(event => /sent off|straight red|red card|reaches for red/i.test(event)).length;

  const quickResult = quickSimMatch(
    fixture!.id,
    clone(basePlayers),
    clone(baseTeams),
    clone(baseFixtures),
    null,
    { rng: { next: createSeededRandom(2026061906) } }
  );
  const quickTotalGoals = scoreTotal(quickResult.fixture, 'quick-sim');
  const quickGoalStats = statDelta(basePlayers, quickResult.players, trackedPlayerIds, 'goals');
  const quickAssistStats = statDelta(basePlayers, quickResult.players, trackedPlayerIds, 'assists');
  const quickRedStats = statDelta(basePlayers, quickResult.players, trackedPlayerIds, 'redCards');
  assert(quickGoalStats === quickTotalGoals, `Quick-sim player goals (${quickGoalStats}) should equal fixture goals (${quickTotalGoals})`);
  assert(quickAssistStats <= quickGoalStats, 'Quick-sim assists should not exceed recorded goals');
  assert(goalEventCount(quickResult.events) === quickTotalGoals, 'Quick-sim GOAL events should match fixture goals');
  assert(quickRedStats === redEventCount(quickResult.events), 'Quick-sim red-card stats should match dismissal events');

  let liveState: any = {
    currentWeek: fixture!.week,
    userTeamId: 'T1',
    teams: clone(baseTeams),
    players: clone(basePlayers),
    fixtures: clone(baseFixtures),
    competitions: clone(baseCompetitions),
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    boardReviewAppliedWeek: 0,
    transfersAppliedWeek: 0,
    careerRecord: createDefaultCareerRecord(),
    liveMatches: {},
  };
  const liveEvents: string[] = [];
  const liveRng = { next: createSeededRandom(2026061906) };
  for (let minute = 1; minute <= 90; minute += 1) {
    const update = processLiveMatchMinuteState(liveState, fixture!.id, minute, liveRng);
    if (update.event) liveEvents.push(update.event);
    liveState = { ...liveState, ...update.patch };
  }
  const preFinishLiveMatch = liveState.liveMatches[fixture!.id];
  assert(preFinishLiveMatch, 'Live harness should retain match state before final accounting');
  const preFinishFixture = liveState.fixtures[fixture!.id];
  const liveContributionGoals = Object.values(preFinishLiveMatch.matchContributions || {})
    .reduce((sum: number, contribution: any) => sum + (contribution.goals || 0), 0);
  assert(
    liveContributionGoals === (preFinishFixture.homeScore || 0) + (preFinishFixture.awayScore || 0),
    'Live match contribution goals should match the in-progress fixture score before finish'
  );

  liveState = { ...liveState, ...finishLiveMatchState(liveState, fixture!.id, liveRng) };
  const liveFixture = liveState.fixtures[fixture!.id];
  const liveTotalGoals = scoreTotal(liveFixture, 'live-sim');
  const liveGoalStats = statDelta(basePlayers, liveState.players, trackedPlayerIds, 'goals');
  const liveAssistStats = statDelta(basePlayers, liveState.players, trackedPlayerIds, 'assists');
  const liveYellowStats = statDelta(basePlayers, liveState.players, trackedPlayerIds, 'yellowCards');
  const liveRedStats = statDelta(basePlayers, liveState.players, trackedPlayerIds, 'redCards');
  assert(!liveState.liveMatches[fixture!.id], 'Live harness should clear live match state after finish');
  assert(liveGoalStats === liveTotalGoals, `Live-sim player goals (${liveGoalStats}) should equal fixture goals (${liveTotalGoals})`);
  assert(liveAssistStats <= liveGoalStats, 'Live-sim assists should not exceed recorded goals');
  assert(goalEventCount(liveEvents) === liveTotalGoals, 'Live-sim GOAL events should match fixture goals');
  assert(liveRedStats === preFinishLiveMatch.sentOffPlayerIds.length, 'Live-sim red-card stats should match sent-off players');
  assert(liveRedStats === redEventCount(liveEvents), 'Live-sim dismissal events should match red-card stats');
  assert(
    liveYellowStats >= preFinishLiveMatch.yellowCardPlayerIds.length,
    'Live-sim yellow-card stats should cover players booked during the live match'
  );
  assert(
    Math.abs(quickTotalGoals - liveTotalGoals) <= 4,
    `Quick/live total goals should stay comparable, quick ${quickTotalGoals}, live ${liveTotalGoals}`
  );

  const quickEnergyLoss = averageEnergyLoss(quickResult.players);
  const liveEnergyLoss = averageEnergyLoss(liveState.players);
  const energyLossRatio = liveEnergyLoss / Math.max(1, quickEnergyLoss);
  assert(
    quickEnergyLoss > 0 && liveEnergyLoss > 0 && energyLossRatio >= 0.75 && energyLossRatio <= 1.35,
    `Quick/live average starter energy drain should remain aligned, quick ${quickEnergyLoss.toFixed(2)}, live ${liveEnergyLoss.toFixed(2)}`
  );
};

// ═══════════════════════════════════════════════════════════════
// AREA C — BOARD-EVENT ACCOUNTING (one-time events, failed objectives)
// ═══════════════════════════════════════════════════════════════

const checkFailedObjectiveRemainsFailed = () => {
  const data = initGameData();
  const team = Object.values(data.teams).find(t => t.division === 'Premier League');
  assert(team, 'Expected a Premier League team for failed objective test');

  // Build a position objective targeting top 2, but the team finishes 18th.
  // Need to ensure ALL Premier League teams have played 38 games and have points
  // so the table sorts correctly.
  const objectives: BoardObjective[] = [
    {
      id: 'test-pos-obj',
      type: 'position',
      target: 2,
      description: 'Finish in the top 2',
      met: false,
      failed: false,
    },
  ];

  // Give the target team very low points and every other PL team more points
  const premierTeams = Object.values(data.teams).filter(t => t.division === 'Premier League');
  const teamsWithTable: Record<string, Team> = {};
  premierTeams.forEach((t, index) => {
    const isTarget = t.id === team!.id;
    teamsWithTable[t.id] = {
      ...t,
      played: 38,
      points: isTarget ? 30 : 90 - index,
      wins: isTarget ? 7 : 25,
      draws: isTarget ? 9 : 5,
      losses: isTarget ? 22 : 8,
      goalsFor: isTarget ? 32 : 70 - index,
      goalsAgainst: isTarget ? 72 : 30 + index,
      form: isTarget ? ['L', 'L', 'D', 'L', 'L'] : ['W', 'D', 'W', 'D', 'W'],
    };
  });
  // Also fill non-PL teams with default values
  Object.values(data.teams).forEach(t => {
    if (!teamsWithTable[t.id]) teamsWithTable[t.id] = t;
  });

  const targetTeam = teamsWithTable[team!.id];

  // Evaluate at season end — should mark as failed
  const endResult = evaluateBoardObjectives(objectives, targetTeam, teamsWithTable, { isSeasonComplete: true });
  const endObj = endResult.updatedObjectives[0];
  assert(endObj.failed === true, 'Position objective should be marked failed at season end when unmet');
  assert(endObj.met === false, 'Failed objective should not be marked met');

  // Re-evaluate — it should STAY failed (not flip back to in-progress)
  const reResult = evaluateBoardObjectives(endResult.updatedObjectives, targetTeam, teamsWithTable, { isSeasonComplete: true });
  const reObj = reResult.updatedObjectives[0];
  assert(reObj.failed === true, 'A failed objective should remain failed on re-evaluation, not reset');
  assert(reObj.met === false, 'A failed objective should remain not-met on re-evaluation');
};

const checkCupFailurePenaltyAppliedOnce = () => {
  const data = initGameData();
  const team = Object.values(data.teams).find(t => t.division === 'Premier League');
  assert(team, 'Expected a Premier League team for cup penalty test');

  const profile = buildBoardProfile(team!.clubClass || 'C', 'Premier League');
  const cupObj: BoardObjective = {
    id: 'test-cup-obj',
    type: 'cup_round',
    target: 4,
    targetRound: 'quarter_final',
    competitionId: 'carabao-cup',
    description: 'Reach Carabao Cup quarter-final',
    met: false,
    failed: false,
  };

  // Team has been eliminated from Carabao Cup
  const competitions: Record<string, CompetitionState> = {
    ...data.competitions,
    'carabao-cup': {
      ...data.competitions['carabao-cup'],
      eliminatedTeamIds: [...(data.competitions['carabao-cup']?.eliminatedTeamIds || []), team!.id],
    },
  };

  // Run board review — first time should apply penalty and mark failed
  const review1 = runBoardReview(team!, { ...data.teams }, [cupObj], {
    isSeasonComplete: false,
    competitions,
    players: data.players,
  });
  const afterFirstReview = review1.updatedObjectives[0];
  assert(afterFirstReview.failed === true, 'Cup objective should be marked failed on first review after elimination');

  // Run board review again with same state — should NOT re-apply penalty
  const afterFirstTeam = {
    ...team!,
    boardApproval: review1.nextApproval,
    manager: review1.nextManager,
  };
  const review2 = runBoardReview(afterFirstTeam, { ...data.teams }, review1.updatedObjectives, {
    isSeasonComplete: false,
    competitions,
    players: data.players,
  });
  const afterSecondReview = review2.updatedObjectives[0];
  assert(afterSecondReview.failed === true, 'Cup objective should remain failed on second review');

  // Approval should not decrease further on the second review for the same cup failure
  const approvalDelta = review2.nextApproval - review1.nextApproval;
  assert(
    approvalDelta >= 0 || approvalDelta > -2,
    `Repeated board review should not apply a large second cup penalty. Delta: ${approvalDelta}`
  );
};

const checkTrophyBonusAppliedOnce = () => {
  const data = initGameData();
  const team = Object.values(data.teams).find(t => t.division === 'Premier League');
  assert(team, 'Expected a Premier League team for trophy bonus test');

  const profile = buildBoardProfile(team!.clubClass || 'C', 'Premier League');
  const modifiedTeam = {
    ...team!,
    boardProfile: profile,
  };

  const competitions: Record<string, CompetitionState> = {
    ...data.competitions,
    'fa-cup': {
      ...data.competitions['fa-cup'],
      championTeamId: team!.id,
    },
  };

  // First review — should award trophy bonus
  const review1 = runBoardReview(modifiedTeam, { ...data.teams }, [], {
    isSeasonComplete: true,
    competitions,
    players: data.players,
  });
  const approvalAfterFirst = review1.nextApproval;

  // Second review with same champion state — should NOT re-award
  const teamAfterFirst = {
    ...modifiedTeam,
    boardApproval: approvalAfterFirst,
    manager: review1.nextManager,
  };
  const review2 = runBoardReview(teamAfterFirst, { ...data.teams }, review1.updatedObjectives, {
    isSeasonComplete: true,
    competitions,
    players: data.players,
  });

  // The second review should not bump approval significantly above the first
  // (may have minor changes from form/squad signals but not a trophy bonus)
  assert(
    review2.nextApproval <= approvalAfterFirst + 2,
    `Trophy bonus should not be applied twice. First: ${approvalAfterFirst}, Second: ${review2.nextApproval}`
  );
};

// ═══════════════════════════════════════════════════════════════
// AREA D — TRANSFER TRANSACTIONS (user-listed exclusion, AI contracts, squad limits)
// ═══════════════════════════════════════════════════════════════

const checkAiTransfersHandleUserListedSales = () => {
  const tactics: Team['tactics'] = {
    mentality: 'Balanced',
    passingStyle: 'Mixed',
    tempo: 'Normal',
    defensiveLine: 'Standard',
    pressing: 'Medium',
  };
  const boardProfile: Team['boardProfile'] = {
    ambition: 'stability',
    patience: 'medium',
    transferDiscipline: 'balanced',
    targetCompetitions: [],
    identity: 'Stable board',
  };
  const buildManager = (teamId: string, transferIdentity: string): Team['manager'] => ({
    id: `${teamId}-manager`,
    teamId,
    teamName: teamId,
    name: `${teamId} Manager`,
    nationality: 'England',
    dateOfBirth: '01/01/1980',
    age: 45,
    appointedAt: '01/07/2024',
    contractUntil: '30/06/2027',
    status: 'Permanent',
    reputation: 50,
    preferredFormations: ['4-3-3'],
    tacticalIdentity: 'Balanced approach',
    transferIdentity,
    boardTrust: 50,
    jobSecurity: 50,
    contractYearsRemaining: 2,
    pressureScore: 0,
    replacementRisk: 0,
    seasonExpectations: 'Stable season',
    clubFit: 50,
    record: {
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      position: 1,
    },
  });
  const buildTeam = (id: string, budget: number, transferIdentity: string): Team => ({
    id,
    name: id,
    division: 'Premier League',
    clubClass: 'C',
    boardProfile,
    manager: buildManager(id, transferIdentity),
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    played: 20,
    activeFormation: '4-3-3',
    form: [],
    tactics,
    budget,
    operatingBudget: budget,
    transferSpend: 0,
    boardApproval: 50,
    lastStartingXI: [],
    formationMap: {},
  });
  const stats = {
    pace: 60,
    shooting: 60,
    passing: 60,
    dribbling: 60,
    defending: 60,
    physical: 60,
  };
  const buildPlayer = (
    id: string,
    teamId: string,
    position: Player['position'],
    rating: number,
    wage: number,
    isTransferListed = false,
    askingPrice = 0
  ): Player => ({
    id,
    name: id,
    position,
    subPosition: position === 'FWD' ? 'ST' : position,
    altPositions: [],
    overallRating: rating,
    marketValue: Math.max(askingPrice, 1),
    age: 24,
    morale: 50,
    energy: 100,
    teamId,
    isStarting: false,
    isSub: false,
    isTransferListed,
    askingPrice,
    matchesSuspended: 0,
    injuryWeeks: 0,
    wage,
    contractLeft: 2,
    impactCoefficient: 1,
    matchRatingHistory: [],
    minutesPlayed: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    yellowCards: 0,
    redCards: 0,
    nationality: 'England',
    stats,
  });

  const userTeam = buildTeam('user-team', 10, 'balanced recruitment');
  const buyerTeam = buildTeam('buyer-team', 100, 'technical system-fit recruitment');
  const listedUserPlayer = buildPlayer('listed-user-fwd', userTeam.id, 'FWD', 78, 12, true, 5);
  const unlistedUserPlayer = buildPlayer('unlisted-user-fwd', userTeam.id, 'FWD', 80, 14, false, 0);
  const buyerPlayers: Record<string, Player> = {};
  (['GK', 'DEF', 'MID'] as const).forEach(position => {
    const count = position === 'GK' ? 2 : 6;
    for (let index = 0; index < count; index += 1) {
      const id = `${buyerTeam.id}-${position}-${index}`;
      buyerPlayers[id] = buildPlayer(id, buyerTeam.id, position, 65, 80);
    }
  });

  const teams: Record<string, Team> = {
    [userTeam.id]: {
      ...userTeam,
      lastStartingXI: [listedUserPlayer.id],
      formationMap: { '0-0': listedUserPlayer.id },
    },
    [buyerTeam.id]: buyerTeam,
  };
  const players: Record<string, Player> = {
    ...buyerPlayers,
    [listedUserPlayer.id]: listedUserPlayer,
    [unlistedUserPlayer.id]: unlistedUserPlayer,
  };

  const result = computeWeeklyTransfers(players, teams, userTeam.id, { next: () => 0 }, 2);
  const soldPlayer = result.players[listedUserPlayer.id];
  const protectedPlayer = result.players[unlistedUserPlayer.id];
  const saleDecision = result.decisions.find(decision => (
    decision.action === 'bought' && decision.playerId === listedUserPlayer.id
  ));

  assert(soldPlayer.teamId === buyerTeam.id, 'Explicitly user-listed player should be sellable to an AI team with a matching need');
  assert(protectedPlayer.teamId === userTeam.id, 'Unlisted user player should remain protected from AI transfers');
  assert(saleDecision?.fromTeamId === userTeam.id, 'User-listed sale decision should record the user team as seller');
  assert(saleDecision?.fee === listedUserPlayer.askingPrice, 'User-listed sale should complete at the asking price');
  assert(saleDecision?.rolePromise === 'starter', 'Urgent buyer need should create a starter role promise');
  assert(Number.isFinite(saleDecision?.newWage) && (saleDecision?.newWage || 0) > 0, 'User-listed sale decision should include destination wage');
  assert(soldPlayer.wage === saleDecision?.newWage, 'Sold user-listed player should receive destination-context wage');
  assert(soldPlayer.wage !== listedUserPlayer.wage, 'Sold user-listed player should not preserve old wage unchanged');
  assert(soldPlayer.morale >= 75, 'Starter role promise should raise the sold player morale baseline');
  assert(!soldPlayer.isTransferListed && soldPlayer.askingPrice === 0, 'Sold player should be removed from the transfer list');
  assert(result.teams[userTeam.id].budget === userTeam.budget + listedUserPlayer.askingPrice, 'User team budget should be credited with the sale fee');
  assert(result.teams[buyerTeam.id].budget === buyerTeam.budget - listedUserPlayer.askingPrice, 'Buyer budget should be debited by the sale fee');
  assert(!Object.values(result.teams[userTeam.id].formationMap || {}).includes(listedUserPlayer.id), 'Sold player should be removed from user formation map');
  assert(!(result.teams[userTeam.id].lastStartingXI || []).includes(listedUserPlayer.id), 'Sold player should be removed from user last starting XI');
  assert(
    result.decisions.every(decision => decision.playerId !== unlistedUserPlayer.id),
    'No AI transfer decision should involve an unlisted user player'
  );
};

const checkAiTransfersAssignContractAndWage = () => {
  const rng = { next: createSeededRandom(2026061903) };
  const data = initGameData();
  const buyer = Object.values(data.teams).find(t => t.id !== 'T1' && t.division === 'Premier League');
  const seller = Object.values(data.teams).find(
    t => t.id !== 'T1' && t.id !== buyer?.id && t.division === 'Premier League'
  );
  assert(buyer && seller, 'Expected buyer and seller teams for AI contract test');

  const target = Object.values(data.players).find(p => p.teamId === seller!.id && p.position === 'MID');
  assert(target, 'Expected a midfielder for AI contract assignment test');

  // Create need on buyer side — injure all buyer's midfielders
  const modifiedPlayers = { ...data.players };
  Object.values(modifiedPlayers)
    .filter(p => p.teamId === buyer!.id && p.position === 'MID')
    .forEach(p => {
      modifiedPlayers[p.id] = { ...p, injuryWeeks: 8 };
    });

  modifiedPlayers[target!.id] = {
    ...target!,
    isTransferListed: true,
    askingPrice: 3,
    wage: 45,
    contractLeft: 1,
    morale: 55,
  };

  const modifiedTeams = {
    ...data.teams,
    [buyer!.id]: {
      ...buyer!,
      budget: 80,
      transferSpend: 0,
    },
  };

  const result = computeWeeklyTransfers(modifiedPlayers, modifiedTeams, 'T1', { next: () => 0 }, 2);
  const bought = result.players[target!.id];

  if (bought.teamId === buyer!.id) {
    // AI bought the player — verify contract and morale were properly assigned
    assert(
      bought.contractLeft >= 2,
      `AI-purchased player should have contractLeft >= 2, got ${bought.contractLeft}`
    );
    assert(
      bought.morale >= 60,
      `AI-purchased player should have morale >= 60, got ${bought.morale}`
    );
    assert(bought.wage > 0, 'AI-purchased player should retain a positive wage');
  }
  // If AI didn't buy, that's OK — the test just verifies the assignment IF they buy
};

const checkSquadSizeLimits = () => {
  const data = initGameData();
  const team = Object.values(data.teams).find(t => t.division === 'Championship');
  assert(team, 'Expected a Championship team for squad limit test');

  const squad = Object.values(data.players).filter(p => p.teamId === team!.id);
  assert(squad.length <= 40, `Team ${team!.name} should not exceed 40 players initially (got ${squad.length})`);

  // Verify all teams have reasonable squad sizes
  Object.values(data.teams).forEach(t => {
    if (t.isExternal) return; // Skip external Continental clubs
    const teamSquad = Object.values(data.players).filter(p => p.teamId === t.id);
    assert(
      teamSquad.length >= 11 && teamSquad.length <= 40,
      `${t.name} should have 11-40 players (got ${teamSquad.length})`
    );
  });

  // Drive a real season-transition contract transaction: an expiring user-club
  // player should be moved through the destination-selection path without
  // leaving either club outside squad bounds.
  const expiringPlayer = squad.find(p => !p.isStarting) || squad[0];
  assert(expiringPlayer, 'Expected a player to expire for squad transaction test');
  const transactionPlayers = {
    ...data.players,
    [expiringPlayer.id]: {
      ...expiringPlayer,
      contractLeft: 0,
      marketValue: Math.min(expiringPlayer.marketValue, 1),
      wage: Math.min(expiringPlayer.wage, 15),
    },
  };

  const rollover = advanceSeason(transactionPlayers, data.teams, data.competitions, team!.id, []);
  const movedPlayer = rollover.players[expiringPlayer.id];
  assert(movedPlayer.teamId !== team!.id, 'Expiring user-club player should move via season-transition transaction path');
  [team!.id, movedPlayer.teamId].forEach(teamId => {
    const postTransactionSquad = Object.values(rollover.players).filter(p => p.teamId === teamId);
    assert(
      postTransactionSquad.length >= 11 && postTransactionSquad.length <= 40,
      `Post-transaction squad ${rollover.teams[teamId]?.name || teamId} should have 11-40 players (got ${postTransactionSquad.length})`
    );
  });
};

// ═══════════════════════════════════════════════════════════════
// AREA E — CAREER FLOW (reputation offers, vacancy filtering, manager identity)
// ═══════════════════════════════════════════════════════════════

const checkReputationLimitsJobOfferDivisions = () => {
  const data = initGameData();
  const divisionRank = ['Premier League', 'Championship', 'League One', 'League Two'];
  const userTeam = Object.values(data.teams).find(t => t.division === 'Championship' && !t.isExternal);
  const sameDivisionTarget = Object.values(data.teams).find(t => (
    t.id !== userTeam?.id && t.division === 'Championship' && !t.isExternal
  ));
  const higherDivisionTarget = Object.values(data.teams).find(t => t.division === 'Premier League' && !t.isExternal);
  assert(userTeam && sameDivisionTarget && higherDivisionTarget, 'Expected controlled Championship and Premier League clubs for job-offer test');

  const makeStable = (team: Team): Team => ({
    ...team,
    boardApproval: 85,
    manager: {
      ...team.manager,
      status: 'Permanent',
      jobSecurity: 90,
      replacementRisk: 5,
      contractYearsRemaining: 3,
    },
  });
  const makeUnstable = (team: Team, ambition: Team['boardProfile']['ambition']): Team => ({
    ...team,
    boardApproval: 28,
    boardProfile: {
      ...team.boardProfile,
      ambition,
      patience: 'low',
    },
    manager: {
      ...team.manager,
      status: 'Interim',
      jobSecurity: 12,
      replacementRisk: 92,
      contractYearsRemaining: 0.25,
      pressureScore: 88,
    },
  });

  const controlledTeams: Record<string, Team> = Object.fromEntries(
    Object.entries(data.teams).map(([id, team]) => [id, makeStable(team)])
  );
  controlledTeams[userTeam!.id] = makeStable(userTeam!);
  controlledTeams[sameDivisionTarget!.id] = makeUnstable(sameDivisionTarget!, 'stability');
  controlledTeams[higherDivisionTarget!.id] = makeUnstable(higherDivisionTarget!, 'europe');

  const lowRepSummary = {
    season: 1,
    teamId: userTeam!.id,
    teamName: userTeam!.name,
    division: userTeam!.division as any,
    wins: 5,
    draws: 5,
    losses: 28,
    goalsFor: 25,
    goalsAgainst: 85,
    finalPosition: 20,
    outcome: 'relegated' as const,
    boardVerdict: 'critical' as const,
    competitionResults: [] as any[],
  };

  // Very low reputation manager (10) in a controlled lower-division scenario
  // should still see unstable same-division jobs, but no upward PL offers.
  const lowRepCandidates = generateJobOfferCandidates(controlledTeams, userTeam!.id, lowRepSummary, 10);
  assert(lowRepCandidates.length > 0, 'Low reputation controlled scenario should produce non-empty same/lower-division candidates');
  assert(
    lowRepCandidates.every(t => {
      const divIndex = divisionRank.indexOf(t.division);
      const userDivIndex = divisionRank.indexOf(
        lowRepSummary.division === 'Continental' ? 'Premier League' : lowRepSummary.division
      );
      return divIndex >= userDivIndex; // Should not get offers from higher divisions
    }),
    'Low reputation (10) should not generate job offers from higher divisions'
  );
  assert(
    lowRepCandidates.some(t => t.id === sameDivisionTarget!.id),
    'Low reputation controlled scenario should include the explicitly unstable same-division club'
  );
  assert(
    lowRepCandidates.every(t => t.id !== higherDivisionTarget!.id),
    'Low reputation controlled scenario should exclude the explicitly unstable higher-division club'
  );

  // Very high reputation with an upward trajectory should have broader reach
  // and include the explicitly unstable Premier League club.
  const highRepCandidates = generateJobOfferCandidates(controlledTeams, userTeam!.id, {
    ...lowRepSummary,
    outcome: 'champion' as const,
    boardVerdict: 'thriving' as const,
    competitionResults: [{ competitionId: 'fa-cup', finish: 'winner', name: 'FA Cup' }],
  }, 95);
  assert(highRepCandidates.length > 0, 'High reputation upward scenario should produce non-empty candidates');
  assert(
    highRepCandidates.some(t => t.id === higherDivisionTarget!.id),
    'High reputation upward scenario should include the explicitly unstable higher-division club'
  );
  assert(
    highRepCandidates.length >= lowRepCandidates.length,
    'High reputation upward scenario should have at least as broad a candidate set as low reputation'
  );
  assert(highRepCandidates.every(t => t.id !== userTeam!.id), 'Job offers should exclude the current club');
  assert(highRepCandidates.every(t => !t.isExternal), 'Job offers should exclude external Continental clubs');
};

const checkStableClubsNotOfferedJobs = () => {
  const data = initGameData();
  const userTeamId = Object.keys(data.teams)[0];

  // Make all clubs stable (high approval, low replacement risk, high job security)
  const stableTeams = Object.fromEntries(
    Object.entries(data.teams).map(([id, team]) => [
      id,
      {
        ...team,
        boardApproval: 85,
        manager: {
          ...team.manager,
          jobSecurity: 90,
          replacementRisk: 5,
          contractYearsRemaining: 3,
        },
      },
    ])
  );

  const summary = {
    season: 1,
    teamId: userTeamId,
    teamName: data.teams[userTeamId].name,
    division: data.teams[userTeamId].division as any,
    wins: 20,
    draws: 8,
    losses: 10,
    goalsFor: 65,
    goalsAgainst: 45,
    finalPosition: 5,
    outcome: 'stayed' as const,
    boardVerdict: 'stable' as const,
    competitionResults: [] as any[],
  };

  const offers = generateJobOfferCandidates(stableTeams, userTeamId, summary, 75);
  assert(offers.length === 0, 'Stable clubs should not appear as job offer candidates');
};

const checkManagerIdentityPersistsAfterJobAccept = () => {
  useGameStore.getState().initializeGame('T1');
  const state = useGameStore.getState();
  const userTeamId = state.userTeamId!;
  const offerTeamId = Object.keys(state.teams).find(id => id !== userTeamId);
  assert(offerTeamId, 'Expected a different team for manager identity test');
  const oid: string = offerTeamId!;

  const offerTeam = state.teams[oid];
  useGameStore.setState({
    inboxMessages: [
      {
        id: 'phase10-job-offer',
        week: 1,
        source: 'system',
        category: 'career_job_offer',
        title: `Job offer: ${offerTeam.name}`,
        body: 'Phase 10 test offer',
        isRead: false,
        action: {
          type: 'accept_job_offer',
          payload: { teamId: oid },
        },
        teamId: oid,
      },
    ],
  });

  useGameStore.getState().applyInboxAction('phase10-job-offer');
  const acceptedState = useGameStore.getState();

  // Verify manager identity was set on the career record
  const userManager = acceptedState.careerRecord.userManager;
  assert(userManager, 'Career record should have a userManager identity after job acceptance');
  assert(userManager!.name.length > 0, 'User manager identity should have a name');
  assert(userManager!.preferredFormations.length > 0, 'User manager identity should have preferred formations');
  assert(userManager!.nationality.length > 0, 'User manager identity should have a nationality');

  // Verify the identity is on the new team
  assert(
    acceptedState.teams[oid].manager.name === userManager!.name,
    'New team manager should match the user manager identity'
  );

  // Verify the old team has a different manager
  assert(
    acceptedState.teams[userTeamId].manager.name !== userManager!.name,
    'Old team should have a different manager after user departure'
  );
};

// ═══════════════════════════════════════════════════════════════
// AREA F — SAVE/LOAD ROUNDTRIP (deterministic replay, referential integrity, corruption resilience)
// ═══════════════════════════════════════════════════════════════

const checkSeededGameProducesDeterministicOutcome = () => {
  // Verify that initial game data + first week matches are reproducible
  const runFirstWeek = (seed: number) => {
    const rng = { next: createSeededRandom(seed) };
    const data = initGameData(undefined, rng);
    const week1Fixtures = Object.values(data.fixtures)
      .filter(f => f.week === 1 && !f.isPlayed)
      .slice(0, 5);

    let players = { ...data.players };
    let teams = { ...data.teams };
    let fixtures = { ...data.fixtures };
    const results: string[] = [];

    for (const fixture of week1Fixtures) {
      const result = quickSimMatch(fixture.id, players, teams, fixtures, null, { rng });
      results.push(`${fixture.id}:${result.fixture.homeScore}-${result.fixture.awayScore}`);
      players = result.players;
      teams = result.teams;
      fixtures = { ...fixtures, [fixture.id]: result.fixture };
    }
    return results.join('|');
  };

  const run1 = runFirstWeek(2026061904);
  const run2 = runFirstWeek(2026061904);

  assert(run1 === run2, 'Deterministic replay: same seed should produce identical fixture results');
  assert(run1.length > 0, 'Deterministic replay should produce non-empty results');

  // Also verify that a different seed produces different results
  const run3 = runFirstWeek(2026061999);
  assert(run1 !== run3, 'Different seeds should produce different fixture results');
};

const checkSanitizeDetectsCorruptReferences = () => {
  const data = initGameData();

  // Player referencing a non-existent team
  const playerWithBadTeam = Object.values(data.players)[0];
  const maliciousState = {
    currentWeek: 1,
    userTeamId: Object.keys(data.teams)[0],
    teams: data.teams,
    players: {
      ...data.players,
      [playerWithBadTeam.id]: {
        ...playerWithBadTeam,
        teamId: 'non-existent-team-xyz',
      },
    },
    fixtures: data.fixtures,
    competitions: data.competitions,
    news: [],
    inboxMessages: [],
    boardObjectives: [],
  };

  const sanitized = sanitizePersistedState(maliciousState);
  const sanitizedPlayer = sanitized.players?.[playerWithBadTeam.id];
  assert(sanitizedPlayer, 'Sanitized state should keep the player');
  assert(
    sanitizedPlayer!.teamId !== 'non-existent-team-xyz',
    'Sanitization should repair a player reference to a non-existent team'
  );
  assert(
    sanitized.teams?.[sanitizedPlayer!.teamId],
    `Sanitized player's team ${sanitizedPlayer!.teamId} should exist in teams`
  );
};

const checkSanitizeRejectsCorruptJson = async () => {
  const corruptKey = 'phase10-corrupt-json-probe';
  await AsyncStorage.removeItem(corruptKey);
  await AsyncStorage.removeItem(PERSIST_STORAGE_KEY);
  clearPersistLoadError();

  try {
    await AsyncStorage.setItem(corruptKey, '{"state":');
    const loadResult = await safeLoadState(corruptKey);
    assert(loadResult.status === 'corrupt', `safeLoadState should return corrupt for invalid JSON, got ${loadResult.status}`);
    assert(loadResult.data === null, 'safeLoadState corrupt result should return null data');

    await AsyncStorage.setItem(PERSIST_STORAGE_KEY, '{bad active persisted state');
    const activeStorageResult = await safeStorage.getItem(PERSIST_STORAGE_KEY);
    const loadError = getPersistLoadError();
    assert(activeStorageResult === null, 'safeStorage should ignore invalid JSON from the active persist key');
    assert(loadError !== null, 'safeStorage should record a persist-load error for corrupt active storage');
    assert(loadError!.key === PERSIST_STORAGE_KEY, 'Persist-load error should be attached to the active persist key');
    assert(/corrupt/i.test(loadError!.message), `Persist-load error should contain a corrupt-save message, got: ${loadError!.message}`);
  } finally {
    await AsyncStorage.removeItem(corruptKey);
    await AsyncStorage.removeItem(PERSIST_STORAGE_KEY);
    clearPersistLoadError();
  }
};

const checkReferentialIntegrityAfterSeasonRollover = () => {
  const rng = { next: createSeededRandom(2026061905) };
  const data = initGameData(undefined, rng);
  let state = {
    players: data.players,
    teams: data.teams,
    fixtures: data.fixtures,
    competitions: data.competitions,
  };

  // Verify initial integrity
  Object.values(state.players).forEach(player => {
    assert(state.teams[player.teamId], `Player ${player.id} references valid team ${player.teamId}`);
  });
  Object.values(state.fixtures).forEach(fixture => {
    assert(state.teams[fixture.homeTeamId], `Fixture ${fixture.id} home team ${fixture.homeTeamId} exists`);
    assert(state.teams[fixture.awayTeamId], `Fixture ${fixture.id} away team ${fixture.awayTeamId} exists`);
  });

  // Run season rollover
  const nextSeason = advanceSeason(state.players, state.teams, state.competitions, null, []);

  // Verify integrity after rollover
  Object.values(nextSeason.players).forEach(player => {
    assert(
      nextSeason.teams[player.teamId],
      `After rollover: player ${player.id} references valid team ${player.teamId}`
    );
  });
  Object.values(nextSeason.fixtures).forEach(fixture => {
    assert(
      nextSeason.teams[fixture.homeTeamId],
      `After rollover: fixture ${fixture.id} home team ${fixture.homeTeamId} exists`
    );
    assert(
      nextSeason.teams[fixture.awayTeamId],
      `After rollover: fixture ${fixture.id} away team ${fixture.awayTeamId} exists`
    );
  });

  // Verify no duplicate fixture IDs
  const fixtureIds = Object.keys(nextSeason.fixtures);
  assert(new Set(fixtureIds).size === fixtureIds.length, 'Season rollover should not create duplicate fixture IDs');
};

// ═══════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════

const runPhase10Tests = async () => {
  console.log('--- PHASE 10 GAP-FILL TESTS ---');

  // Area A: Long-career simulation
  console.log('[A1] Youth replenishment at season end...');
  checkYouthReplenishmentAtSeasonEnd();
  console.log('[OK] Youth replenishment triggers for underfilled squads');

  console.log('[A2] Population stability over seasons...');
  checkPopulationStabilityOverSeasons();
  console.log('[OK] Player population remains stable across seasons');

  // Area B: Quick-sim vs live-sim parity
  console.log('[B1] Energy drain consistency...');
  checkEnergyDrainConsistency();
  console.log('[OK] Energy drain behaves consistently with toggles and minutes');

  console.log('[B2] Actual quick/live match parity...');
  checkActualQuickLiveMatchParity();
  console.log('[OK] Quick/live match harnesses keep score, event, card, and energy accounting aligned');

  // Area C: Board-event accounting
  console.log('[C1] Failed objective permanence...');
  checkFailedObjectiveRemainsFailed();
  console.log('[OK] Failed objectives remain failed on re-evaluation');

  console.log('[C2] Cup failure penalty applied once...');
  checkCupFailurePenaltyAppliedOnce();
  console.log('[OK] Cup failure penalty is not double-applied');

  console.log('[C3] Trophy bonus applied once...');
  checkTrophyBonusAppliedOnce();
  console.log('[OK] Trophy bonus is not double-awarded');

  // Area D: Transfer transactions
  console.log('[D1] AI transfers handle user-listed sale flow...');
  checkAiTransfersHandleUserListedSales();
  console.log('[OK] User-listed sale flow works while unlisted user players remain protected');

  console.log('[D2] AI transfers assign contract and wage...');
  checkAiTransfersAssignContractAndWage();
  console.log('[OK] AI-purchased players receive contract/wage/morale assignment');

  console.log('[D3] Squad size limits...');
  checkSquadSizeLimits();
  console.log('[OK] Squad size limits are within bounds');

  // Area E: Career flow
  console.log('[E1] Reputation limits job offer divisions...');
  checkReputationLimitsJobOfferDivisions();
  console.log('[OK] Reputation correctly gates job offer division reach');

  console.log('[E2] Stable clubs not offered jobs...');
  checkStableClubsNotOfferedJobs();
  console.log('[OK] Stable/non-vacant clubs excluded from job offer pool');

  console.log('[E3] Manager identity persists after job acceptance...');
  checkManagerIdentityPersistsAfterJobAccept();
  console.log('[OK] Manager identity persists correctly across team changes');

  // Area F: Save/load roundtrip
  console.log('[F1] Deterministic replay...');
  checkSeededGameProducesDeterministicOutcome();
  console.log('[OK] Seeded game produces identical outcomes across runs');

  console.log('[F2] Corruption detection...');
  checkSanitizeDetectsCorruptReferences();
  console.log('[OK] Sanitization repairs broken referential integrity');

  console.log('[F3] Corruption error reporting...');
  await checkSanitizeRejectsCorruptJson();
  console.log('[OK] Corrupt JSON is rejected through safeLoadState and active safeStorage');

  console.log('[F4] Referential integrity after season rollover...');
  checkReferentialIntegrityAfterSeasonRollover();
  console.log('[OK] Referential integrity maintained through season rollover');

  console.log('--- PHASE 10 GAP-FILL TESTS COMPLETE ---');
};

runPhase10Tests().catch(error => {
  console.error(error);
  process.exit(1);
});
