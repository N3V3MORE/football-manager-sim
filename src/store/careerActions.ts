import {
  moveUserManagerToTeam,
} from '../core/careerEngine';
import {
  generateAssistantWeekMessages,
  generateTeamSwitchMessage,
  getInboxSeason,
  mergeInboxMessages,
  pruneInboxMessagesForManagedTeam,
} from './inboxHelpers';
import { buildManagedTeamObjectives } from './managedTeamObjectives';
import type { WeeklyLifecycleState } from './fixtureResolution';

export const changeTeamState = (
  state: WeeklyLifecycleState,
  teamId: string
): Partial<WeeklyLifecycleState> => {
  const nextTeam = state.teams[teamId];
  if (!nextTeam) return state;
  const previousTeamId = state.userTeamId;
  const previousTeam = previousTeamId ? state.teams[previousTeamId] : null;

  const managerMove = moveUserManagerToTeam(
    state.teams,
    previousTeamId,
    teamId,
    state.careerRecord
  );
  const nextTeams = managerMove.teams;

  const nextAssistantMessages = generateAssistantWeekMessages({
    currentWeek: state.currentWeek,
    season: getInboxSeason(state.competitions),
    userTeamId: teamId,
    teams: nextTeams,
    players: state.players,
    fixtures: state.fixtures,
  });

  const switchMessage = previousTeam
    ? generateTeamSwitchMessage(
        state.currentWeek,
        previousTeam.name,
        nextTeam.name,
        nextTeam.division
      )
    : null;

  return {
    userTeamId: teamId,
    teams: nextTeams,
    careerRecord: managerMove.careerRecord,
    boardObjectives: buildManagedTeamObjectives(nextTeams[teamId] || nextTeam, state.competitions),
    inboxMessages: mergeInboxMessages(
      pruneInboxMessagesForManagedTeam(state.inboxMessages, teamId),
      [
        ...(switchMessage ? [switchMessage] : []),
        ...nextAssistantMessages,
      ]
    ),
  };
};
