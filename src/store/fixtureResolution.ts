import { GameState } from '../models/types';
import { resolveCompetitionProgression } from '../core/competitionEngine';
import { quickSimMatch } from '../core/matchEngine';
import { compareFixturesChronologically } from '../core/fixtureLifecycle';
import { createFixtureEventRandomGenerator } from '../core/random';
import { LiveMatchState, removeLiveMatchFixture } from './liveMatchHelpers';
import {
  generatePostMatchReportMessage,
  generateSystemInboxMessages,
  getInboxSeason,
  mergeInboxMessages,
} from './inboxHelpers';

export type WeeklyLifecycleState = GameState & {
  liveMatches: Record<string, LiveMatchState>;
};

export const playCurrentWeekFixtures = <TState extends WeeklyLifecycleState>(state: TState): TState => {
  const weekFixtures = Object.values(state.fixtures).filter(
    fixture => fixture.week <= state.currentWeek && !fixture.isPlayed
  ).sort(compareFixturesChronologically);
  if (weekFixtures.length === 0) return state;

  let updatedPlayers = state.players;
  let updatedTeams = state.teams;
  let updatedFixtures = state.fixtures;
  let updatedCompetitions = state.competitions;
  let updatedLiveMatches = state.liveMatches || {};
  let inboxMessages = state.inboxMessages;

  weekFixtures.forEach(fixtureToPlay => {
    if (updatedLiveMatches[fixtureToPlay.id]) return;
    const previousPlayers = updatedPlayers;
    const rng = createFixtureEventRandomGenerator(
      fixtureToPlay.id,
      0,
      state.rngState ?? 1,
      state.competitions[fixtureToPlay.competitionId]?.season || 1,
      'weekly-quick'
    );
    const { players, teams, fixture } = quickSimMatch(
      fixtureToPlay.id,
      updatedPlayers,
      updatedTeams,
      updatedFixtures,
      state.userTeamId,
      { rng }
    );
    updatedPlayers = players;
    updatedTeams = teams;
    updatedFixtures = { ...updatedFixtures, [fixtureToPlay.id]: fixture };
    updatedLiveMatches = removeLiveMatchFixture(updatedLiveMatches, fixtureToPlay.id);
    const fixtureSeason = getInboxSeason(updatedCompetitions, fixture);

    const postMatchReport = generatePostMatchReportMessage({
      currentWeek: state.currentWeek,
      season: fixtureSeason,
      userTeamId: state.userTeamId,
      fixture,
      teams,
      players,
      previousPlayers,
    });
    if (postMatchReport) {
      inboxMessages = mergeInboxMessages(inboxMessages, [postMatchReport]);
    }
  });

  const competitionProgression = resolveCompetitionProgression(
    updatedFixtures,
    updatedCompetitions,
    updatedTeams
  );
  updatedFixtures = competitionProgression.fixtures;
  updatedCompetitions = competitionProgression.competitions;

  const unresolvedDueFixtures = Object.values(updatedFixtures).filter(
    fixture => fixture.week <= state.currentWeek && !fixture.isPlayed && !updatedLiveMatches[fixture.id]
  );
  if (unresolvedDueFixtures.length > 0) {
    throw new Error(`Cannot advance week with unresolved due fixtures: ${unresolvedDueFixtures.map(fixture => fixture.id).join(', ')}.`);
  }

  if (competitionProgression.generatedNews.length > 0) {
    inboxMessages = mergeInboxMessages(
      inboxMessages,
      generateSystemInboxMessages(
        state.currentWeek,
        competitionProgression.generatedNews,
        getInboxSeason(competitionProgression.competitions)
      )
    );
  }

  return {
    ...state,
    players: updatedPlayers,
    teams: updatedTeams,
    fixtures: updatedFixtures,
    competitions: updatedCompetitions,
    news: competitionProgression.generatedNews.length > 0
      ? [...competitionProgression.generatedNews, ...state.news].slice(0, 20)
      : state.news,
    liveMatches: updatedLiveMatches,
    inboxMessages,
  };
};
