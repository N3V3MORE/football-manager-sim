import { InboxMessage, Player, Team } from '../models/types';
import { AITransferDecision } from '../core/transferEngine';
import { getSeasonWeekLimit } from '../core/leagueUtils';
import { getSackingApprovalThreshold, runBoardReview } from '../core/boardEngine';
import { FREE_AGENT_TEAM_ID, isPlayableClub } from '../core/freeAgentPool';
import { getSquadPolicy } from '../core/squadPolicy';
import { buildMovedPlayer } from '../core/playerMovement';
import {
  dismissUserManagerFromTeam,
  evaluateSackingRisk,
  generateJobOfferCandidates,
} from '../core/careerEngine';
import { mergeInboxMessages } from './inboxCore';
import {
  generateBoardInboxMessages,
  generateCareerInboxMessages,
  generateSackWarningMessage,
} from './inboxCareerBoard';
import type { WeeklyLifecycleState } from './fixtureResolution';

export const sanitizeFormationMaps = <TState extends WeeklyLifecycleState>(state: TState): TState => {
  let changed = false;
  const teams = Object.fromEntries(Object.entries(state.teams).map(([teamId, team]) => {
    if (!team.formationMap) return [teamId, team];
    const usedPlayerIds = new Set<string>();
    const formationMap = Object.fromEntries(
      Object.entries(team.formationMap).filter(([, playerId]) => {
        const player = state.players[playerId];
        if (player?.teamId !== team.id || !player.isStarting || usedPlayerIds.has(playerId)) return false;
        usedPlayerIds.add(playerId);
        return true;
      })
    );
    if (Object.keys(formationMap).length !== Object.keys(team.formationMap).length) {
      changed = true;
      return [teamId, { ...team, formationMap }];
    }
    return [teamId, team];
  })) as TState['teams'];

  return changed ? { ...state, teams } : state;
};

export const applyBoardReview = <TState extends WeeklyLifecycleState>(state: TState, reviewWeek: number) => {
  if (!state.userTeamId) {
    return { nextState: state, boardMessages: [] as InboxMessage[] };
  }

  const teamBefore = state.teams[state.userTeamId];
  if (!teamBefore) {
    return { nextState: state, boardMessages: [] as InboxMessage[] };
  }

  // Idempotency guard: skip if a review was already applied for the target
  // week (reviewWeek + 1 equals the new currentWeek after weekly progression).
  if (state.boardReviewAppliedWeek === reviewWeek + 1) {
    return { nextState: state, boardMessages: [] as InboxMessage[] };
  }

  const seasonWeekLimit = getSeasonWeekLimit(state.fixtures, state.competitions);
  const review = runBoardReview(
    teamBefore,
    state.teams,
    state.boardObjectives,
    {
      isSeasonComplete: state.currentWeek > seasonWeekLimit,
      competitions: state.competitions,
      players: state.players,
    }
  );

  const nextState = {
    ...state,
    teams: {
      ...state.teams,
      [teamBefore.id]: {
        ...teamBefore,
        boardApproval: review.nextApproval,
        manager: review.nextManager,
      },
    },
    boardObjectives: review.updatedObjectives,
    boardReviewAppliedWeek: reviewWeek + 1,
  };

  return {
    nextState,
    boardMessages: generateBoardInboxMessages({
      week: reviewWeek,
      teamBefore,
      teamAfter: nextState.teams[teamBefore.id],
      objectivesBefore: state.boardObjectives,
      objectivesAfter: nextState.boardObjectives,
    }),
  };
};

export const applySackingRisk = <TState extends WeeklyLifecycleState>(state: TState, initialWeek: number) => {
  const sackMessages: InboxMessage[] = [];
  if (!state.userTeamId) return { nextState: state, sackMessages };

  const team = state.teams[state.userTeamId];
  if (!team) return { nextState: state, sackMessages };

  const { newConsecutiveWeeks, shouldWarn, isSackingImminent } = evaluateSackingRisk(
    team,
    state.careerRecord.consecutiveLowApprovalWeeks
  );
  const lowApprovalThreshold = getSackingApprovalThreshold(team);

  if (shouldWarn || isSackingImminent) {
    sackMessages.push(generateSackWarningMessage(
      initialWeek,
      newConsecutiveWeeks,
      state.userTeamId,
      isSackingImminent,
      {
        approval: team.boardApproval,
        threshold: lowApprovalThreshold,
        pressureScore: team.manager.pressureScore,
        replacementRisk: team.manager.replacementRisk,
      }
    ));
  }

  if (isSackingImminent) {
    const season = state.careerRecord.seasonsManaged + 1;
    const dismissal = dismissUserManagerFromTeam(
      state.teams,
      state.competitions,
      state.userTeamId,
      {
        ...state.careerRecord,
        consecutiveLowApprovalWeeks: newConsecutiveWeeks,
      },
      season
    );
    if (!dismissal) {
      return {
        nextState: {
          ...state,
          careerRecord: {
            ...state.careerRecord,
            consecutiveLowApprovalWeeks: newConsecutiveWeeks,
          },
        },
        sackMessages,
      };
    }

    const jobOfferTeams = generateJobOfferCandidates(
      dismissal.teams,
      state.userTeamId,
      dismissal.summary,
      dismissal.careerRecord.reputation
    );
    const careerMessages = generateCareerInboxMessages({
      week: initialWeek,
      summary: dismissal.summary,
      reputationDelta: dismissal.reputationDelta,
      careerRecord: dismissal.careerRecord,
      jobOfferTeams,
      isSacked: true,
      offersAvailableImmediately: true,
      sackingContext: {
        consecutiveLowApprovalWeeks: newConsecutiveWeeks,
        approval: team.boardApproval,
        threshold: lowApprovalThreshold,
        pressureScore: team.manager.pressureScore,
        replacementRisk: team.manager.replacementRisk,
      },
    });

    return {
      nextState: {
        ...state,
        userTeamId: null,
        teams: dismissal.teams,
        boardObjectives: [],
        careerRecord: dismissal.careerRecord,
        inboxMessages: mergeInboxMessages(state.inboxMessages, careerMessages),
      },
      sackMessages,
    };
  }

  return {
    nextState: {
      ...state,
      careerRecord: {
        ...state.careerRecord,
        consecutiveLowApprovalWeeks: newConsecutiveWeeks,
      },
    },
    sackMessages,
  };
};

/**
 * Gentle ongoing roster-size enforcement for AI teams.
 * Releases the lowest-rated non-starting, non-transfer-listed players
 * from teams that exceed the maximum squad size after transfers.
 * Does not touch the user team.
 */
export const enforceAiRosterSizes = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  userTeamId: string | null,
  protectedPlayerIds = new Set<string>()
): Record<string, Player> => {
  let updatedPlayers = { ...players };
  const aiTeams = Object.values(teams).filter(t => isPlayableClub(t) && t.id !== userTeamId);

  aiTeams.forEach(team => {
    const squad = Object.values(updatedPlayers).filter(p => p.teamId === team.id);
    const policy = getSquadPolicy(team);
    if (squad.length <= policy.maximumSquadSize) return;

    const excess = squad.length - policy.maximumSquadSize;
    // Prioritise releasing: non-starting, non-sub, non-listed, lowest rating first
    const releaseCandidates = [...squad]
      .filter(p => !p.isStarting && !p.isSub && !p.isTransferListed && !protectedPlayerIds.has(p.id))
      .sort((a, b) => a.overallRating - b.overallRating);

    const toRelease = releaseCandidates.slice(0, excess);
    toRelease.forEach(p => {
      updatedPlayers[p.id] = buildMovedPlayer(p, FREE_AGENT_TEAM_ID);
    });
  });

  return updatedPlayers;
};

export const generateTransferInboxMessages = (
  decisions: AITransferDecision[],
  userTeamId: string | null,
  teams: Record<string, Team>,
  players: Record<string, Player>,
  season?: number
): InboxMessage[] => {
  if (!userTeamId) return [];
  const userDivision = teams[userTeamId]?.division;
  if (!userDivision) return [];

  const messages: InboxMessage[] = [];

  decisions
    .filter(d => d.action === 'bought')
    .forEach(decision => {
      const buyer = teams[decision.teamId];
      const seller = decision.fromTeamId ? teams[decision.fromTeamId] : null;
      // Surface transfers relevant to the user's division or notable fees (≥£10m)
      const isSameDivision = buyer?.division === userDivision || seller?.division === userDivision;
      const isNotableFee = (decision.fee || 0) >= 10;
      if (!isSameDivision && !isNotableFee) return;

      const player = players[decision.playerId];
      if (!buyer || !player) return;

      const seasonPrefix = typeof season === 'number' && season > 1 ? `s${season}-` : '';
      const id = `system-transfer_advice-${seasonPrefix}w${decision.week || 0}-${decision.playerId}-${decision.teamId}`;
      messages.push({
        id,
        week: decision.week || 0,
        season,
        source: 'system',
        category: 'transfer_advice',
        title: `${player.name} joins ${buyer.name}`,
        body: `${buyer.name} have signed ${player.name} (${player.position}) from ${seller?.name || 'their previous club'}${decision.fee != null ? ` for GBP ${decision.fee}m` : ''}. ${decision.reason}`,
        isRead: false,
        playerId: decision.playerId,
        teamId: decision.teamId,
      });
    });

  return messages;
};
