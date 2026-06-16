import assert from 'node:assert/strict';
import { initGameData } from '../../src/utils/initGame';
import { getSeasonWeekLimit } from '../../src/core/leagueUtils';
import { quickSimMatch } from '../../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../../src/core/progressionEngine';
import { createSeededRandomGenerator } from '../../src/core/random';
import {
  generateAssistantWeekMessages,
  generatePostMatchReportMessage,
  generateSystemInboxMessages,
  MAX_INBOX_MESSAGES,
  mergeInboxMessages,
} from '../../src/store/inboxHelpers';

export const run = () => {
const runStateConsistencyStress = () => {
  const seeds = [20260521, 20260522];

  seeds.forEach(seed => {
    const rng = createSeededRandomGenerator(seed);
    const data = initGameData();
    let state = {
      players: data.players,
      teams: data.teams,
      fixtures: data.fixtures,
      currentWeek: 1,
      news: [] as string[],
      userTeamId: 'T1',
      inboxMessages: [] as ReturnType<typeof generateSystemInboxMessages>,
    };

    const seasonWeekLimit = getSeasonWeekLimit(state.fixtures);
    for (let week = 1; week <= seasonWeekLimit; week++) {
      const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);
      for (const fixture of weekFixtures) {
        const previousPlayers = state.players;
        const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, state.userTeamId, { rng });
        state.players = result.players;
        state.teams = result.teams;
        state.fixtures[fixture.id] = result.fixture;
        const postMatchReport = generatePostMatchReportMessage({
          currentWeek: state.currentWeek,
          userTeamId: state.userTeamId,
          fixture: result.fixture,
          teams: result.teams,
          players: result.players,
          previousPlayers,
        });
        if (postMatchReport) {
          state.inboxMessages = mergeInboxMessages(state.inboxMessages, [postMatchReport]);
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
      state.inboxMessages = mergeInboxMessages(
        state.inboxMessages,
        generateSystemInboxMessages(week, progression.generatedNews)
      );

      const transfers = computeWeeklyTransfers(state.players, state.teams, state.userTeamId, rng);
      state.players = transfers.players;
      state.teams = transfers.teams;
      state.inboxMessages = mergeInboxMessages(
        state.inboxMessages,
        generateAssistantWeekMessages({
          currentWeek: state.currentWeek,
          userTeamId: state.userTeamId,
          teams: state.teams,
          players: state.players,
          fixtures: state.fixtures,
        })
      );

      Object.values(state.players).forEach(player => {
        assert.ok(Number.isFinite(player.energy) && player.energy >= 0 && player.energy <= 100, `Invalid player energy for ${player.id} in seed ${seed}`);
        assert.ok(Number.isFinite(player.morale) && player.morale >= 0 && player.morale <= 100, `Invalid player morale for ${player.id} in seed ${seed}`);
        assert.ok(Number.isFinite(player.matchesSuspended) && player.matchesSuspended >= 0, `Invalid suspension count for ${player.id} in seed ${seed}`);
        assert.ok(Number.isFinite(player.injuryWeeks) && player.injuryWeeks >= 0, `Invalid injury weeks for ${player.id} in seed ${seed}`);
        if (player.injuryWeeks === 0) {
          assert.equal(player.injuryType, undefined, `Unexpected stale injury type for ${player.id} in seed ${seed}`);
        }
      });

      Object.values(state.teams).forEach(team => {
        assert.ok(Number.isFinite(team.budget) && team.budget >= 0, `Invalid team budget for ${team.id} in seed ${seed}`);
        assert.ok(Number.isFinite(team.transferSpend) && team.transferSpend >= 0, `Invalid team transfer spend for ${team.id} in seed ${seed}`);
        assert.ok(Number.isFinite(team.boardApproval) && team.boardApproval >= 0 && team.boardApproval <= 100, `Invalid board approval for ${team.id} in seed ${seed}`);
      });

      Object.values(state.fixtures)
        .filter(fixture => fixture.isPlayed)
        .forEach(fixture => {
          assert.ok(Number.isFinite(fixture.homeScore), `Played fixture ${fixture.id} missing home score in seed ${seed}`);
          assert.ok(Number.isFinite(fixture.awayScore), `Played fixture ${fixture.id} missing away score in seed ${seed}`);
        });

      assert.ok(state.inboxMessages.length <= MAX_INBOX_MESSAGES, `Inbox cap exceeded in seed ${seed}`);
      assert.equal(
        new Set(state.inboxMessages.map(message => message.id)).size,
        state.inboxMessages.length,
        `Inbox dedupe failed in seed ${seed}`
      );
    }
  });
};
  runStateConsistencyStress();
};
