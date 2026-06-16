import { GameState } from '../models/types';
import { buildRenewedPlayer, clearContractWarningMessages } from './contractActions';
import { applyLineupSuggestionToTeam } from './lineupActions';
import {
  generateAssistantWeekMessages,
  mergeInboxMessages,
  pruneInboxMessagesForManagedTeam,
} from './inboxHelpers';
import { buildManagedTeamObjectives } from './managedTeamObjectives';

type InboxActionState = Pick<
  GameState,
  | 'currentWeek'
  | 'userTeamId'
  | 'teams'
  | 'players'
  | 'fixtures'
  | 'competitions'
  | 'inboxMessages'
  | 'boardObjectives'
>;

type InboxActionPatch = InboxActionState | Partial<InboxActionState>;

export const applyInboxActionState = (
  state: InboxActionState,
  messageId: string
): InboxActionPatch => {
  const message = state.inboxMessages.find(item => item.id === messageId);
  if (!message?.action) return state;

  let nextPlayers = state.players;
  let nextTeams = state.teams;

  if (message.action.type === 'apply_lineup') {
    const { teamId, formationMap, startingIds, subIds } = message.action.payload;
    const team = state.teams[teamId];
    if (!team) return state;

    nextPlayers = applyLineupSuggestionToTeam(state.players, teamId, startingIds, subIds);
    nextTeams = {
      ...state.teams,
      [teamId]: {
        ...team,
        formationMap,
      },
    };
  } else if (message.action.type === 'apply_tactics') {
    const { teamId, tactics } = message.action.payload;
    const team = state.teams[teamId];
    if (!team) return state;

    nextTeams = {
      ...state.teams,
      [teamId]: {
        ...team,
        tactics: { ...team.tactics, ...tactics },
      },
    };
  } else if (message.action.type === 'renew_contract') {
    const { playerId, years, wage } = message.action.payload;
    const player = state.players[playerId];
    if (!player) return state;

    nextPlayers = {
      ...state.players,
      [playerId]: buildRenewedPlayer(player, years, wage),
    };

    return {
      players: nextPlayers,
      teams: nextTeams,
      inboxMessages: clearContractWarningMessages(state.inboxMessages, playerId)
        .map(item => item.id === messageId ? { ...item, isRead: true, action: undefined } : item),
    };
  } else if (message.action.type === 'accept_job_offer') {
    const { teamId } = message.action.payload;
    const nextTeam = state.teams[teamId];
    if (!nextTeam) {
      return {
        inboxMessages: state.inboxMessages.map(item => (
          item.id === messageId ? { ...item, isRead: true, action: undefined } : item
        )),
      };
    }

    const boardObjectives = buildManagedTeamObjectives(nextTeam, state.competitions);
    const carriedMessages = pruneInboxMessagesForManagedTeam(
      state.inboxMessages
        .filter(item => item.category !== 'career_job_offer')
        .map(item => item.id === messageId ? { ...item, isRead: true, action: undefined } : item),
      teamId
    );
    const nextAssistantMessages = generateAssistantWeekMessages({
      currentWeek: state.currentWeek,
      userTeamId: teamId,
      teams: state.teams,
      players: nextPlayers,
      fixtures: state.fixtures,
    });

    return {
      userTeamId: teamId,
      boardObjectives,
      players: nextPlayers,
      teams: nextTeams,
      inboxMessages: mergeInboxMessages(carriedMessages, nextAssistantMessages),
    };
  }

  return {
    players: nextPlayers,
    teams: nextTeams,
    inboxMessages: state.inboxMessages.map(item => (
      item.id === messageId
        ? { ...item, isRead: true, action: undefined }
        : item
    )),
  };
};
