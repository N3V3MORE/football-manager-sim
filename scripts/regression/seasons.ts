import { initGameData } from '../../src/utils/initGame';
import { getSeasonWeekLimit } from '../../src/core/leagueUtils';
import { quickSimMatch } from '../../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../../src/core/progressionEngine';
import { createSeededRandomGenerator } from '../../src/core/random';
import { RED_CARD_EVENT_PATTERN, buildTacticalSetupKey } from './shared';

export const run = (seed: number) => {
const runSeason = (seed: number) => {
  const rng = createSeededRandomGenerator(seed);
  const data = initGameData();
  let state = {
    players: data.players,
    teams: data.teams,
    fixtures: data.fixtures,
    currentWeek: 1,
    news: [] as string[],
  };

  let totalGoals = 0;
  let yellowCards = 0;
  let redCards = 0;
  let redCardLogMismatches = 0;
  let redCardEventsWithoutCard = 0;
  const tacticalChangeCounts = Object.fromEntries(
    Object.values(state.teams).map(team => [team.id, 0])
  ) as Record<string, number>;
  const seasonWeekLimit = getSeasonWeekLimit(state.fixtures);
  const formationUsage = { back3: 0, back4: 0, back5: 0 };

  for (let week = 1; week <= seasonWeekLimit; week++) {
    const weekStartSetups = Object.fromEntries(
      Object.values(state.teams).map(team => [team.id, buildTacticalSetupKey(team)])
    ) as Record<string, string>;
    const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);
    for (const fixture of weekFixtures) {
      const beforeCards = Object.values(state.players).reduce(
        (acc, player) => ({ yellow: acc.yellow + player.yellowCards, red: acc.red + player.redCards }),
        { yellow: 0, red: 0 }
      );
      const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, null, { rng });
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fixture.id] = result.fixture;
      totalGoals += (result.fixture.homeScore || 0) + (result.fixture.awayScore || 0);

      const afterCards = Object.values(state.players).reduce(
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

    const transfers = computeWeeklyTransfers(state.players, state.teams, null, rng);
    state.players = transfers.players;
    state.teams = transfers.teams;

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
  return runSeason(seed);
};
};
