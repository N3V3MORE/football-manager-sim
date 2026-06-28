import { Fixture, GameState, Player, Team } from '../models/types';
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

type CompetitionProgressionResult = ReturnType<typeof resolveCompetitionProgression>;

type AppendFixtureResultInput = {
  fixture: Fixture;
  players: Record<string, Player>;
  teams: Record<string, Team>;
  previousPlayers: Record<string, Player>;
  competitionResult?: CompetitionProgressionResult;
};

export const appendFixtureResultToState = (
  state: WeeklyLifecycleState,
  {
    fixture,
    players,
    teams,
    previousPlayers,
    competitionResult,
  }: AppendFixtureResultInput
): Partial<WeeklyLifecycleState> => {
  const generatedNews = competitionResult?.generatedNews ?? [];
  const competitions = competitionResult?.competitions ?? state.competitions;
  const inboxSeason = getInboxSeason(competitions, fixture);
  const postMatchReport = generatePostMatchReportMessage({
    currentWeek: state.currentWeek,
    season: inboxSeason,
    userTeamId: state.userTeamId,
    fixture,
    teams,
    players,
    previousPlayers,
  });
  const inboxUpdates = [
    ...(postMatchReport ? [postMatchReport] : []),
    ...generateSystemInboxMessages(state.currentWeek, generatedNews, inboxSeason),
  ];

  return {
    players,
    teams,
    fixtures: competitionResult?.fixtures ?? { ...state.fixtures, [fixture.id]: fixture },
    competitions,
    news: generatedNews.length > 0
      ? [...generatedNews, ...state.news].slice(0, 20)
      : state.news,
    liveMatches: removeLiveMatchFixture(state.liveMatches || {}, fixture.id),
    inboxMessages: inboxUpdates.length > 0
      ? mergeInboxMessages(state.inboxMessages, inboxUpdates)
      : state.inboxMessages,
  };
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
    const appendPatch = appendFixtureResultToState({
      ...state,
      players: updatedPlayers,
      teams: updatedTeams,
      fixtures: updatedFixtures,
      competitions: updatedCompetitions,
      liveMatches: updatedLiveMatches,
      inboxMessages,
    }, {
      fixture,
      teams,
      players,
      previousPlayers,
    });
    updatedPlayers = appendPatch.players || updatedPlayers;
    updatedTeams = appendPatch.teams || updatedTeams;
    updatedFixtures = appendPatch.fixtures || updatedFixtures;
    updatedLiveMatches = appendPatch.liveMatches || updatedLiveMatches;
    inboxMessages = appendPatch.inboxMessages || inboxMessages;
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
