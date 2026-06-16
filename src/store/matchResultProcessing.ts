import { Fixture, GameState, InboxMessage } from '../models/types';
import { resolveCompetitionProgression } from '../core/competitionEngine';
import { LiveMatchState, removeLiveMatchFixture } from './liveMatchHelpers';
import {
  generatePostMatchReportMessage,
  generateSystemInboxMessages,
  mergeInboxMessages,
} from './inboxHelpers';

type SharedPostMatchInput = {
  state: Pick<GameState, 'currentWeek' | 'userTeamId' | 'news' | 'inboxMessages'>;
  updatedPlayers: GameState['players'];
  updatedTeams: GameState['teams'];
  updatedFixtures: GameState['fixtures'];
  updatedCompetitions: GameState['competitions'];
  fixture: Fixture;
  previousPlayers: GameState['players'];
  liveMatches?: Record<string, LiveMatchState>;
};

type SharedPostMatchOutput = {
  fixtures: GameState['fixtures'];
  competitions: GameState['competitions'];
  news: string[];
  liveMatches: Record<string, LiveMatchState>;
  inboxMessages: InboxMessage[];
};

export const applySharedPostMatchResolution = ({
  state,
  updatedPlayers,
  updatedTeams,
  updatedFixtures,
  updatedCompetitions,
  fixture,
  previousPlayers,
  liveMatches,
}: SharedPostMatchInput): SharedPostMatchOutput => {
  const competitionProgression = resolveCompetitionProgression(
    updatedFixtures,
    updatedCompetitions,
    updatedTeams
  );
  const nextLiveMatches = liveMatches
    ? removeLiveMatchFixture(liveMatches, fixture.id)
    : {};
  const postMatchReport = generatePostMatchReportMessage({
    currentWeek: state.currentWeek,
    userTeamId: state.userTeamId,
    fixture,
    teams: updatedTeams,
    players: updatedPlayers,
    previousPlayers,
  });

  return {
    fixtures: competitionProgression.fixtures,
    competitions: competitionProgression.competitions,
    news: competitionProgression.generatedNews.length > 0
      ? [...competitionProgression.generatedNews, ...state.news].slice(0, 20)
      : state.news,
    liveMatches: nextLiveMatches,
    inboxMessages: mergeInboxMessages(
      state.inboxMessages,
      [
        ...(postMatchReport ? [postMatchReport] : []),
        ...generateSystemInboxMessages(state.currentWeek, competitionProgression.generatedNews),
      ]
    ),
  };
};
