import { GameState } from '../models/types';
import { moveUserManagerToTeam } from '../core/careerEngine';
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
  | 'careerRecord'
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
    const eligibleFormationMap = Object.fromEntries(
      Object.entries(formationMap).filter(([, playerId]) => {
        const player = nextPlayers[playerId];
        return player?.teamId === teamId && player.isStarting;
      })
    );
    nextTeams = {
      ...state.teams,
      [teamId]: {
        ...team,
        formationMap: eligibleFormationMap,
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
    const userTeam = state.userTeamId ? state.teams[state.userTeamId] : null;

    // Validation parity with direct contract renewal: player must be on user's
    // team and contract terms must be positive.
    if (!player || !userTeam || player.teamId !== userTeam.id) {
      return {
        inboxMessages: state.inboxMessages.map(item =>
          item.id === messageId ? { ...item, isRead: true, action: undefined } : item
        ),
      };
    }

    if (years <= 0 || wage <= 0) {
      return {
        inboxMessages: state.inboxMessages.map(item =>
          item.id === messageId ? { ...item, isRead: true, action: undefined } : item
        ),
      };
    }

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

    const previousTeamId = state.userTeamId;
    const managerMove = moveUserManagerToTeam(nextTeams, previousTeamId, teamId, state.careerRecord);
    nextTeams = managerMove.teams;

    const boardObjectives = buildManagedTeamObjectives(nextTeams[teamId] || nextTeam, state.competitions);
    const carriedMessages = pruneInboxMessagesForManagedTeam(
      state.inboxMessages
        .filter(item => item.category !== 'career_job_offer')
        .map(item => item.id === messageId ? { ...item, isRead: true, action: undefined } : item),
      teamId
    );
    const nextAssistantMessages = generateAssistantWeekMessages({
      currentWeek: state.currentWeek,
      userTeamId: teamId,
      teams: nextTeams,
      players: nextPlayers,
      fixtures: state.fixtures,
    });

    return {
      userTeamId: teamId,
      careerRecord: managerMove.careerRecord,
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
