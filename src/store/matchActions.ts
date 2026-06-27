import { resolveCompetitionProgression } from '../core/competitionEngine';
import { quickSimMatch } from '../core/matchEngine';
import { createFixtureEventRandomGenerator } from '../core/random';
import { removeLiveMatchFixture } from './liveMatchHelpers';
import {
  generatePostMatchReportMessage,
  generateSystemInboxMessages,
  mergeInboxMessages,
} from './inboxHelpers';
import type { WeeklyLifecycleState } from './fixtureResolution';

export const playMatchState = (
  state: WeeklyLifecycleState,
  fixtureId: string
): Partial<WeeklyLifecycleState> => {
  const previousPlayers = state.players;
  const seedFixture = state.fixtures[fixtureId];
  const season = seedFixture ? state.competitions[seedFixture.competitionId]?.season || 1 : 1;
  const rng = createFixtureEventRandomGenerator(fixtureId, 0, state.rngState ?? 1, season, 'quick');
  const { players, teams, fixture } = quickSimMatch(fixtureId, state.players, state.teams, state.fixtures, state.userTeamId, { rng });
  const nextFixtures = { ...state.fixtures, [fixtureId]: fixture };
  const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, teams);
  const liveMatches = removeLiveMatchFixture(state.liveMatches || {}, fixtureId);
  const postMatchReport = generatePostMatchReportMessage({
    currentWeek: state.currentWeek,
    season,
    userTeamId: state.userTeamId,
    fixture,
    teams,
    players,
    previousPlayers,
  });

  return {
    players,
    teams,
    fixtures: competitionProgression.fixtures,
    competitions: competitionProgression.competitions,
    news: competitionProgression.generatedNews.length > 0
      ? [...competitionProgression.generatedNews, ...state.news].slice(0, 20)
      : state.news,
    liveMatches,
    inboxMessages: mergeInboxMessages(
      state.inboxMessages,
      [
        ...(postMatchReport ? [postMatchReport] : []),
        ...generateSystemInboxMessages(state.currentWeek, competitionProgression.generatedNews, season),
      ]
    ),
  };
};
