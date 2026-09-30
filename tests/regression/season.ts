import assert from 'node:assert/strict';
import { createRosterIndex } from '../../src/core/rosterIndex';
import { installAgentGameHandler } from '../../src/dev/agentGameHandler';
import { getInboxSeason } from '../../src/store/inboxCore';
import { initGameData } from '../../src/utils/initGame';
import { getSeasonWeekLimit } from '../../src/core/leagueUtils';
import { quickSimMatch } from '../../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../../src/core/progressionEngine';
import { createSeededRandomGenerator } from '../../src/core/random';
import { resolveCompetitionProgression } from '../../src/core/competitionEngine';
import { Player, Team } from '../../src/models/types';
import { useGameStore } from '../../src/store/gameStore';
import { generateAssistantWeekMessages, generatePostMatchReportMessage, } from '../../src/store/inboxAssistant';
import { generateSystemInboxMessages, MAX_INBOX_MESSAGES, mergeInboxMessages, } from '../../src/store/inboxCore';
import { getSquadPolicy } from '../../src/core/squadPolicy';

const RED_CARD_EVENT_PATTERN = /red card|sent off|straight red|reaches for red/i;

const buildTacticalSetupKey = (team: Team) => (
  [
    team.activeFormation,
    team.tactics.mentality,
    team.tactics.passingStyle,
    team.tactics.tempo,
    team.tactics.defensiveLine,
    team.tactics.pressing,
  ].join('|')
);

export const runSeason = (seed: number) => {
  const rng = createSeededRandomGenerator(seed);
  const data = initGameData(undefined, rng);
  let state = {
    players: data.players,
    teams: data.teams,
    fixtures: data.fixtures,
    competitions: data.competitions,
    currentWeek: 1,
    news: [] as string[],
  };

  let inboxMessages: ReturnType<typeof generateSystemInboxMessages> = [];
  let totalGoals = 0;
  let yellowCards = 0;
  let redCards = 0;
  let redCardLogMismatches = 0;
  let redCardEventsWithoutCard = 0;
  const tacticalChangeCounts = Object.fromEntries(
    Object.values(state.teams).map(team => [team.id, 0])
  ) as Record<string, number>;
  const formationUsage = { back3: 0, back4: 0, back5: 0 };

  for (let week = 1; week <= getSeasonWeekLimit(state.fixtures, state.competitions); week++) {
    assert.ok(week <= 80, 'Season exceeded the bounded week limit');
    const weekStartSetups = Object.fromEntries(
      Object.values(state.teams).map(team => [team.id, buildTacticalSetupKey(team)])
    ) as Record<string, string>;
    const rosterIndex = createRosterIndex(state.players);
    const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);
    for (const fixture of weekFixtures) {
      const previousPlayers = state.players;
      const beforeCards = [...rosterIndex.getPlayers(fixture.homeTeamId, state.players), ...rosterIndex.getPlayers(fixture.awayTeamId, state.players)].reduce(
        (acc, player) => ({ yellow: acc.yellow + player.yellowCards, red: acc.red + player.redCards }),
        { yellow: 0, red: 0 }
      );
      const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, null, { rng, rosterIndex });
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fixture.id] = result.fixture;
      const report = generatePostMatchReportMessage({ currentWeek: state.currentWeek, userTeamId: 'T1', fixture: result.fixture, teams: result.teams, players: result.players, previousPlayers });
      if (report) inboxMessages = mergeInboxMessages(inboxMessages, [report]);
      totalGoals += (result.fixture.homeScore || 0) + (result.fixture.awayScore || 0);

      const afterCards = [...rosterIndex.getPlayers(fixture.homeTeamId, state.players), ...rosterIndex.getPlayers(fixture.awayTeamId, state.players)].reduce(
        (acc, player) => ({ yellow: acc.yellow + player.yellowCards, red: acc.red + player.redCards }),
        { yellow: 0, red: 0 }
      );
      yellowCards += (afterCards.yellow - beforeCards.yellow);
      const redDelta = (afterCards.red - beforeCards.red);
      redCards += redDelta;

      const hasRedEvent = result.events.some(event => RED_CARD_EVENT_PATTERN.test(event));
      if (redDelta > 0 && !hasRedEvent) {
        redCardLogMismatches += 1;
      }
      if (hasRedEvent && redDelta === 0) {
        redCardEventsWithoutCard += 1;
      }
    }

    const competitionProgression = resolveCompetitionProgression(
      state.fixtures,
      state.competitions,
      state.teams,
      rng
    );
    state.fixtures = competitionProgression.fixtures;
    state.competitions = competitionProgression.competitions;
    if (competitionProgression.generatedNews.length > 0) {
      state.news = [...competitionProgression.generatedNews, ...state.news].slice(0, 20);
    }

    const progression = computeWeeklyProgression(
      state.currentWeek,
      state.players,
      state.teams,
      state.fixtures,
      state.news,
      null,
      rng
    );
    state.players = progression.players;
    state.teams = progression.teams;
    state.currentWeek = progression.currentWeek;
    state.news = progression.news;

    const transfers = computeWeeklyTransfers(state.players, state.teams, null, rng, state.currentWeek);
    state.players = transfers.players;
    state.teams = transfers.teams;

    inboxMessages = mergeInboxMessages(inboxMessages, [
      ...generateSystemInboxMessages(week, progression.generatedNews),
      ...generateAssistantWeekMessages({ currentWeek: state.currentWeek, userTeamId: 'T1', teams: state.teams, players: state.players, fixtures: state.fixtures }),
    ]);
    assertWeeklyState(state, inboxMessages, seed);
    Object.values(state.teams).forEach(team => {
      const before = weekStartSetups[team.id];
      const after = buildTacticalSetupKey(team);
      if (before !== after) {
        tacticalChangeCounts[team.id] = (tacticalChangeCounts[team.id] || 0) + 1;
      }
    });

    Object.values(state.teams).forEach(team => {
      if (team.activeFormation.startsWith('3')) formationUsage.back3 += 1;
      else if (team.activeFormation.startsWith('5')) formationUsage.back5 += 1;
      else formationUsage.back4 += 1;
    });
  }

  const matches = Object.values(state.fixtures).length;
  return {
    avgGoalsPerMatch: totalGoals / Math.max(1, matches),
    yellowCards,
    redCards,
    redCardLogMismatches,
    redCardEventsWithoutCard,
    totalTacticalChanges: Object.values(tacticalChangeCounts).reduce((sum, count) => sum + count, 0),
    teamsWithNoTacticalChanges: Object.values(tacticalChangeCounts).filter(count => count === 0).length,
    formationUsage,
  };
};

export const checkSeededSeasons = () => {
  const seasons = [20260513, 20260514, 20260515].map(runSeason);
  const avgGoals = seasons.reduce((sum, season) => sum + season.avgGoalsPerMatch, 0) / seasons.length;
  console.log(`Seeded seasonal average goals: ${avgGoals.toFixed(2)}`);
  const totalYellow = seasons.reduce((sum, season) => sum + season.yellowCards, 0);
  const totalRed = seasons.reduce((sum, season) => sum + season.redCards, 0);
  const redCardLogMismatches = seasons.reduce((sum, season) => sum + season.redCardLogMismatches, 0);
  const redCardEventsWithoutCard = seasons.reduce((sum, season) => sum + season.redCardEventsWithoutCard, 0);
  const avgTacticalChanges = seasons.reduce((sum, season) => sum + season.totalTacticalChanges, 0) / seasons.length;
  const avgTeamsWithNoTacticalChanges = seasons.reduce((sum, season) => sum + season.teamsWithNoTacticalChanges, 0) / seasons.length;
  const formationUsage = seasons.reduce(
    (acc, season) => ({
      back3: acc.back3 + season.formationUsage.back3,
      back4: acc.back4 + season.formationUsage.back4,
      back5: acc.back5 + season.formationUsage.back5,
    }),
    { back3: 0, back4: 0, back5: 0 }
  );

  assert.ok(avgGoals >= 2.4 && avgGoals <= 3.1, `Expected avg goals between 2.4 and 3.1, got ${avgGoals.toFixed(2)}`);
  assert.ok(totalYellow > 0, 'Expected at least one yellow card across threshold runs');
  assert.ok(totalRed > 0, 'Expected at least one red card across threshold runs');
  assert.equal(redCardLogMismatches, 0, 'Red cards should always produce an explicit red-card event message');
  assert.equal(redCardEventsWithoutCard, 0, 'Red-card event messages should only appear when a red card is recorded');
  assert.ok(avgTacticalChanges >= 110, `Expected average tactical changes >= 110, got ${avgTacticalChanges.toFixed(1)}`);
  assert.ok(avgTeamsWithNoTacticalChanges <= 35, `Expected average teams with no tactical changes <= 35, got ${avgTeamsWithNoTacticalChanges.toFixed(1)}`);
  assert.ok(formationUsage.back3 > 0, 'Expected some back-3 usage');
  assert.ok(formationUsage.back5 > 0, 'Expected some back-5 usage');
};
export const assertWeeklyState = (state: { currentWeek: number; players: Record<string, Player>; teams: Record<string, Team>; fixtures: ReturnType<typeof initGameData>['fixtures'] }, inbox: ReturnType<typeof generateSystemInboxMessages>, seed: number) => {
  for (const player of Object.values(state.players)) {
    assert.ok(state.teams[player.teamId], 'Missing roster owner: ' + player.id);
    for (const [key, maximum] of [['energy', 100], ['morale', 100], ['matchesSuspended', Infinity], ['injuryWeeks', Infinity]] as const) {
      assert.ok(Number.isFinite(player[key]) && player[key] >= 0 && player[key] <= maximum, key + ' out of range in ' + seed);
    }
    if (player.injuryWeeks === 0) assert.equal(player.injuryType, undefined);
  }
  for (const team of Object.values(state.teams)) {
    assert.ok(Number.isFinite(team.budget) && team.budget >= 0);
    assert.ok(Number.isFinite(team.transferSpend) && team.transferSpend >= 0);
    assert.ok(Number.isFinite(team.boardApproval) && team.boardApproval >= 0 && team.boardApproval <= 100);
  }
  for (const fixture of Object.values(state.fixtures)) {
    assert.ok(state.teams[fixture.homeTeamId] && state.teams[fixture.awayTeamId]);
    assert.ok(fixture.isPlayed || fixture.week >= state.currentWeek, 'Overdue unplayed fixture: ' + fixture.id);
    if (fixture.isPlayed && fixture.resolution !== 'void') assert.ok(Number.isFinite(fixture.homeScore) && Number.isFinite(fixture.awayScore));
  }
  assert.ok(inbox.length <= MAX_INBOX_MESSAGES);
  assert.equal(new Set(inbox.map(message => message.id)).size, inbox.length);
};

export const runCareer = async (seasons: number, seed: number, teamId: string) => {
  const cleanup = installAgentGameHandler();
  const handler = globalThis.__FM_AGENT__!;
  const reports: { season: number; weeksPlayed: number; population: number }[] = [];
  let unsubscribe = () => {};
  try {
    assert.ok(handler.run('initialize', { teamId, seed }).ok);
    const initial = useGameStore.getState();
    const initialPopulation = Object.keys(initial.players).length;
    const identity = initial.careerRecord.userManager;
    const startingSeason = getInboxSeason(initial.competitions);
    unsubscribe = useGameStore.subscribe((current, previous) => {
      const currentSeason = getInboxSeason(current.competitions);
      if (current.currentWeek !== previous.currentWeek || currentSeason !== getInboxSeason(previous.competitions)) {
        assertWeeklyState(current, current.inboxMessages, seed);
      }
      if (currentSeason <= getInboxSeason(previous.competitions)) return;
      assert.equal(currentSeason, getInboxSeason(previous.competitions) + 1);
      assert.equal(current.currentWeek, 1);
      assert.equal(Object.keys(current.liveMatches).length, 0);
      assert.deepEqual(current.careerRecord.userManager, identity);
      const population = Object.keys(current.players).length;
      if (currentSeason === startingSeason + 1) assert.ok(population >= initialPopulation * 0.95 && population <= initialPopulation * 1.10);
      for (const team of Object.values(current.teams).filter(team => !team.isExternal)) {
        const roster = Object.values(current.players).filter(player => player.teamId === team.id);
        assert.ok(roster.length >= getSquadPolicy(team).structuralMinimum);
      }
      if (current.userTeamId && current.userTeamId === previous.userTeamId) {
        const before = previous.teams[current.userTeamId], after = current.teams[current.userTeamId];
        assert.equal(after.activeFormation, before.activeFormation);
        assert.deepEqual(after.tactics, before.tactics);
        assert.equal(Object.values(current.players).filter(player => player.teamId === after.id && player.isStarting).length, 11);
      }
    });
    for (let year = 0; year < seasons; year += 1) {
      const season = getInboxSeason(useGameStore.getState().competitions);
      let weeksPlayed = 0;
      while (getInboxSeason(useGameStore.getState().competitions) === season) {
        const result = handler.run('playSeason', { reset: false, applyAssistantActions: true, continueOnError: false, maxWeeks: 8 });
        assert.ok(result.ok, result.error);
        const report = result.data as { status: string; weeksPlayed: number; weeklyReports: { errors: number }[]; finalValidation: { status: string; errors: number } };
        assert.notEqual(report.status, 'fail');
        assert.ok(report.weeksPlayed > 0);
        assert.ok(report.weeklyReports.every(week => week.errors === 0));
        assert.equal(report.finalValidation.status, 'pass');
        assert.equal(report.finalValidation.errors, 0);
        weeksPlayed += report.weeksPlayed;
        assert.ok(weeksPlayed <= 80, 'Career season exceeded its bounded week limit');
        // Drain asynchronous autosave work between bounded chunks without resetting the career.
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const current = useGameStore.getState();
      reports.push({ season, weeksPlayed, population: Object.keys(current.players).length });
      await useGameStore.persist.rehydrate();
      assert.equal(getInboxSeason(useGameStore.getState().competitions), season + 1);
      assert.equal(useGameStore.getState().currentWeek, 1);
      assert.deepEqual(useGameStore.getState().careerRecord.userManager, identity);
      const restored = useGameStore.getState();
      assertWeeklyState(restored, restored.inboxMessages, seed);
      assert.equal(Object.keys(restored.players).length, Object.keys(current.players).length);
      assert.equal(restored.rngState, current.rngState);
      if (restored.userTeamId) assert.equal(Object.values(restored.players).filter(player => player.teamId === restored.userTeamId && player.isStarting).length, 11);
    }
    return reports;
  } finally { unsubscribe(); cleanup(); }
};
