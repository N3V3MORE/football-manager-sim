import { InboxMessage } from '../models/types';
import { getSeasonWeekLimit } from '../core/leagueUtils';
import { getSackingApprovalThreshold } from '../core/boardEngine';
import { advanceSeason } from '../core/seasonTransition';
import {
  applySeasonEndToCareer,
  buildSeasonSummary,
  generateJobOfferCandidates,
  getSackingImminentWeek,
} from '../core/careerEngine';
import { generateAssistantWeekMessages } from './inboxAssistant';
import { generateCareerInboxMessages } from './inboxCareerBoard';
import { generateSystemInboxMessages, getInboxSeason, mergeInboxMessages, pruneInboxMessagesForManagedTeam } from './inboxCore';
import type { WeeklyLifecycleState } from './fixtureResolution';

export const rolloverSeasonIfNeeded = <TState extends WeeklyLifecycleState>(
  state: TState,
  initialWeek: number,
  weekMessages: InboxMessage[]
): TState | null => {
  const seasonWeekLimit = getSeasonWeekLimit(state.fixtures, state.competitions);
  if (state.currentWeek <= seasonWeekLimit) return null;

  if (!state.userTeamId) {
    const nextSeason = advanceSeason(
      state.players,
      state.teams,
      state.competitions,
      state.userTeamId,
      state.news
    );

    const nextInboxSeason = getInboxSeason(nextSeason.competitions);

    return {
      ...state,
      currentWeek: nextSeason.currentWeek,
      teams: nextSeason.teams,
      players: nextSeason.players,
      fixtures: nextSeason.fixtures,
      competitions: nextSeason.competitions,
      boardObjectives: nextSeason.boardObjectives,
      news: nextSeason.news,
      liveMatches: {},
      inboxMessages: mergeInboxMessages(pruneInboxMessagesForManagedTeam(state.inboxMessages, null), [
        ...weekMessages,
        ...generateSystemInboxMessages(nextSeason.currentWeek, nextSeason.generatedNews, nextInboxSeason),
      ]),
    };
  }

  const userTeam = state.teams[state.userTeamId];
  const isSacked = state.careerRecord.consecutiveLowApprovalWeeks >= getSackingImminentWeek(userTeam);
  const seasonSummary = buildSeasonSummary(
    state.careerRecord.seasonsManaged + 1,
    userTeam,
    state.teams,
    state.competitions
  );
  if (isSacked) seasonSummary.outcome = 'sacked';

  const { careerRecord: updatedCareer, reputationDelta } = applySeasonEndToCareer(
    state.careerRecord,
    seasonSummary
  );

  const jobOfferTeams = generateJobOfferCandidates(state.teams, state.userTeamId, seasonSummary, updatedCareer.reputation);
  const careerMessages = generateCareerInboxMessages({
    week: initialWeek,
    summary: seasonSummary,
    reputationDelta,
    careerRecord: updatedCareer,
    jobOfferTeams,
    isSacked,
    sackingContext: isSacked
      ? {
          consecutiveLowApprovalWeeks: state.careerRecord.consecutiveLowApprovalWeeks,
          approval: userTeam.boardApproval,
          threshold: getSackingApprovalThreshold(userTeam),
          pressureScore: userTeam.manager.pressureScore,
          replacementRisk: userTeam.manager.replacementRisk,
        }
      : undefined,
  });

  const nextUserTeamId = isSacked ? null : state.userTeamId;
  // Prevent double-counting: the user team already had its season-end review applied
  // via applyBoardReview in the weekly lifecycle. Skip re-review in advanceSeason.
  const skipReviewTeamIds = [state.userTeamId];
  const nextSeason = advanceSeason(
    state.players,
    state.teams,
    state.competitions,
    nextUserTeamId,
    state.news,
    skipReviewTeamIds
  );
  const nextInboxSeason = getInboxSeason(nextSeason.competitions);
  const nextAssistantMessages = nextUserTeamId
    ? generateAssistantWeekMessages({
        currentWeek: nextSeason.currentWeek,
        season: nextInboxSeason,
        userTeamId: nextUserTeamId,
        teams: nextSeason.teams,
        players: nextSeason.players,
        fixtures: nextSeason.fixtures,
      })
    : [];

  return {
    ...state,
    currentWeek: nextSeason.currentWeek,
    teams: nextSeason.teams,
    players: nextSeason.players,
    fixtures: nextSeason.fixtures,
    competitions: nextSeason.competitions,
    boardObjectives: nextSeason.boardObjectives,
    news: nextSeason.news,
    userTeamId: nextUserTeamId,
    careerRecord: updatedCareer,
    liveMatches: {},
    inboxMessages: mergeInboxMessages(
      pruneInboxMessagesForManagedTeam(state.inboxMessages, nextUserTeamId),
      [
        ...weekMessages,
        ...careerMessages,
        ...generateSystemInboxMessages(nextSeason.currentWeek, nextSeason.generatedNews, nextInboxSeason),
        ...nextAssistantMessages,
      ]
    ),
  };
};
