import { GameState, InboxMessage, Player, Team } from '../models/types';
import { resolveCompetitionProgression } from '../core/competitionEngine';
import { quickSimMatch } from '../core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../core/progressionEngine';
import { AITransferDecision } from '../core/transferEngine';
import { getSeasonWeekLimit } from '../core/leagueUtils';
import { getSackingApprovalThreshold, runBoardReview } from '../core/boardEngine';
import { advanceSeason } from '../core/seasonTransition';
import {
  applySeasonEndToCareer,
  buildSeasonSummary,
  evaluateSackingRisk,
  generateJobOfferCandidates,
} from '../core/careerEngine';
import { LiveMatchState, pruneInvalidLiveMatches, removeLiveMatchFixture } from './liveMatchHelpers';
import {
  generateAssistantWeekMessages,
  generateBoardInboxMessages,
  generateCareerInboxMessages,
  generatePostMatchReportMessage,
  generateSackWarningMessage,
  generateSystemInboxMessages,
  mergeInboxMessages,
  pruneInboxMessagesForManagedTeam,
} from './inboxHelpers';

export type WeeklyLifecycleState = GameState & {
  liveMatches: Record<string, LiveMatchState>;
};

const playCurrentWeekFixtures = <TState extends WeeklyLifecycleState>(state: TState): TState => {
  const weekFixtures = Object.values(state.fixtures).filter(
    fixture => fixture.week === state.currentWeek && !fixture.isPlayed
  );
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
    const { players, teams, fixture } = quickSimMatch(
      fixtureToPlay.id,
      updatedPlayers,
      updatedTeams,
      updatedFixtures,
      state.userTeamId
    );
    updatedPlayers = players;
    updatedTeams = teams;
    updatedFixtures = { ...updatedFixtures, [fixtureToPlay.id]: fixture };
    updatedLiveMatches = removeLiveMatchFixture(updatedLiveMatches, fixtureToPlay.id);

    const postMatchReport = generatePostMatchReportMessage({
      currentWeek: state.currentWeek,
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

  if (competitionProgression.generatedNews.length > 0) {
    inboxMessages = mergeInboxMessages(
      inboxMessages,
      generateSystemInboxMessages(state.currentWeek, competitionProgression.generatedNews)
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

const sanitizeFormationMaps = <TState extends WeeklyLifecycleState>(state: TState): TState => {
  let changed = false;
  const teams = Object.fromEntries(Object.entries(state.teams).map(([teamId, team]) => {
    if (!team.formationMap) return [teamId, team];
    const formationMap = Object.fromEntries(
      Object.entries(team.formationMap).filter(([, playerId]) => {
        const player = state.players[playerId];
        return player?.teamId === team.id && player.isStarting;
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

const applyBoardReview = <TState extends WeeklyLifecycleState>(state: TState, reviewWeek: number) => {
  if (!state.userTeamId) {
    return { nextState: state, boardMessages: [] as InboxMessage[] };
  }

  const teamBefore = state.teams[state.userTeamId];
  if (!teamBefore) {
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

const applySackingRisk = <TState extends WeeklyLifecycleState>(state: TState, initialWeek: number) => {
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

const rolloverSeasonIfNeeded = <TState extends WeeklyLifecycleState>(
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
        ...generateSystemInboxMessages(nextSeason.currentWeek, nextSeason.generatedNews),
      ]),
    };
  }

  const userTeam = state.teams[state.userTeamId];
  const isSacked = state.careerRecord.consecutiveLowApprovalWeeks >= 4;
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
  const nextAssistantMessages = nextUserTeamId
    ? generateAssistantWeekMessages({
        currentWeek: nextSeason.currentWeek,
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
        ...generateSystemInboxMessages(nextSeason.currentWeek, nextSeason.generatedNews),
        ...nextAssistantMessages,
      ]
    ),
  };
};

const MAX_AI_SQUAD_SIZE = 28;

/**
 * Gentle ongoing roster-size enforcement for AI teams.
 * Releases the lowest-rated non-starting, non-transfer-listed players
 * from teams that exceed the maximum squad size after transfers.
 * Does not touch the user team.
 */
const enforceAiRosterSizes = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  userTeamId: string | null
): Record<string, Player> => {
  let updatedPlayers = { ...players };
  const aiTeams = Object.values(teams).filter(t => t.id !== userTeamId);

  aiTeams.forEach(team => {
    const squad = Object.values(updatedPlayers).filter(p => p.teamId === team.id);
    if (squad.length <= MAX_AI_SQUAD_SIZE) return;

    const excess = squad.length - MAX_AI_SQUAD_SIZE;
    // Prioritise releasing: non-starting, non-sub, non-listed, lowest rating first
    const releaseCandidates = [...squad]
      .filter(p => !p.isStarting && !p.isSub && !p.isTransferListed)
      .sort((a, b) => a.overallRating - b.overallRating);

    const toRelease = releaseCandidates.slice(0, excess);
    toRelease.forEach(p => {
      updatedPlayers[p.id] = {
        ...p,
        teamId: '__free_agent__',
        isStarting: false,
        isSub: false,
        isTransferListed: false,
        askingPrice: 0,
      };
    });
  });

  return updatedPlayers;
};

const generateTransferInboxMessages = (
  decisions: AITransferDecision[],
  userTeamId: string | null,
  teams: Record<string, Team>,
  players: Record<string, Player>
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

      const id = `system-transfer_advice-w${decision.week || 0}-${decision.playerId}-${decision.teamId}`;
      messages.push({
        id,
        week: decision.week || 0,
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

export const advanceWeekState = <TState extends WeeklyLifecycleState>(state: TState): TState => {
  const initialWeek = state.currentWeek;
  const liveMatches = pruneInvalidLiveMatches(state.liveMatches || {}, {
    currentWeek: state.currentWeek,
    fixtures: state.fixtures,
    teams: state.teams,
    players: state.players,
  });
  const recoveredState = { ...state, liveMatches } as TState;
  const hasActiveCurrentLiveMatch = Object.values(recoveredState.fixtures).some(fixture => (
    fixture.week <= recoveredState.currentWeek &&
    !fixture.isPlayed &&
    Boolean((recoveredState.liveMatches || {})[fixture.id])
  ));
  if (hasActiveCurrentLiveMatch) return recoveredState;

  let nextState = playCurrentWeekFixtures(recoveredState);

  const beforeProgressionPlayers = nextState.players;
  const progression = computeWeeklyProgression(
    nextState.currentWeek,
    nextState.players,
    nextState.teams,
    nextState.fixtures,
    nextState.news,
    nextState.userTeamId
  );

  nextState = {
    ...nextState,
    currentWeek: progression.currentWeek,
    news: progression.news,
    players: progression.players,
    teams: progression.teams,
  };

  // Match the analysis scripts: update week state before transfer decisions.
  const transferState = computeWeeklyTransfers(
    nextState.players,
    nextState.teams,
    nextState.userTeamId,
    undefined,
    nextState.currentWeek
  );
  nextState = {
    ...nextState,
    players: transferState.players,
    teams: transferState.teams,
    transfersAppliedWeek: nextState.currentWeek,
  };
  // Gentle AI roster-size enforcement after transfers
  nextState = {
    ...nextState,
    players: enforceAiRosterSizes(nextState.players, nextState.teams, nextState.userTeamId),
  };
  nextState = sanitizeFormationMaps(nextState);

  const boardReview = applyBoardReview(nextState, initialWeek);
  nextState = boardReview.nextState;

  const sackingRisk = applySackingRisk(nextState, initialWeek);
  nextState = sackingRisk.nextState;

  const weekMessages = [
    ...generateSystemInboxMessages(initialWeek, progression.generatedNews),
    ...generateTransferInboxMessages(
      transferState.decisions,
      nextState.userTeamId,
      nextState.teams,
      nextState.players
    ),
    ...boardReview.boardMessages,
    ...sackingRisk.sackMessages,
  ];

  const rolledOverState = rolloverSeasonIfNeeded(nextState, initialWeek, weekMessages);
  if (rolledOverState) return rolledOverState;

  const nextAssistantMessages = generateAssistantWeekMessages({
    currentWeek: nextState.currentWeek,
    userTeamId: nextState.userTeamId,
    teams: nextState.teams,
    players: nextState.players,
    fixtures: nextState.fixtures,
    previousPlayers: beforeProgressionPlayers,
  });

  return {
    ...nextState,
    inboxMessages: mergeInboxMessages(nextState.inboxMessages, [...weekMessages, ...nextAssistantMessages]),
  };
};
