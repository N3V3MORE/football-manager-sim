import { computeWeeklyProgression, computeWeeklyTransfers } from '../core/progressionEngine';
import { getSeasonWeekLimit } from '../core/leagueUtils';
import { FREE_AGENT_TEAM_ID, ensureFreeAgentTeam } from '../core/freeAgentPool';
import { pruneInvalidLiveMatches } from './liveMatchHelpers';
import {
  generateAssistantWeekMessages,
  generateSystemInboxMessages,
  getInboxSeason,
  mergeInboxMessages,
} from './inboxHelpers';
import { playCurrentWeekFixtures } from './fixtureResolution';
import type { WeeklyLifecycleState } from './fixtureResolution';
import {
  applyBoardReview,
  applySackingRisk,
  enforceAiRosterSizes,
  generateTransferInboxMessages,
  sanitizeFormationMaps,
} from './weeklyAccounting';
import { resolveWeeklyNegotiationsState } from './transferActions';
import { rolloverSeasonIfNeeded } from './seasonRollover';
import { ensureReferentialIntegrity } from './persistence';

export type { WeeklyLifecycleState };

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
    nextState.userTeamId,
    undefined,
    getSeasonWeekLimit(nextState.fixtures, nextState.competitions)
  );

  nextState = {
    ...nextState,
    currentWeek: progression.currentWeek,
    news: progression.news,
    players: progression.players,
    teams: progression.teams,
  };

  // Resolve user negotiations before AI transfer decisions can act on the same target.
  const negotiationState = resolveWeeklyNegotiationsState(nextState);
  nextState = {
    ...nextState,
    ...negotiationState,
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
  const currentWeekAcquisitions = new Set(transferState.decisions
    .filter(decision => decision.action === 'bought')
    .map(decision => decision.playerId));
  const rosterEnforcedPlayers = enforceAiRosterSizes(nextState.players, nextState.teams, nextState.userTeamId, currentWeekAcquisitions);
  const needsFreeAgentTeam = Object.values(rosterEnforcedPlayers).some(player => player.teamId === FREE_AGENT_TEAM_ID);
  nextState = {
    ...nextState,
    players: rosterEnforcedPlayers,
    teams: needsFreeAgentTeam ? ensureFreeAgentTeam(nextState.teams) : nextState.teams,
  };
  nextState = sanitizeFormationMaps(nextState);

  const boardReview = applyBoardReview(nextState, initialWeek);
  nextState = boardReview.nextState;

  const sackingRisk = applySackingRisk(nextState, initialWeek);
  nextState = sackingRisk.nextState;

  const weekMessages = [
    ...generateSystemInboxMessages(initialWeek, progression.generatedNews, getInboxSeason(nextState.competitions)),
    ...generateTransferInboxMessages(
      transferState.decisions,
      nextState.userTeamId,
      nextState.teams,
      nextState.players,
      getInboxSeason(nextState.competitions)
    ),
    ...boardReview.boardMessages,
    ...sackingRisk.sackMessages,
  ];

  const rolledOverState = rolloverSeasonIfNeeded(nextState, initialWeek, weekMessages);
  if (rolledOverState) return rolledOverState;

  const nextAssistantMessages = generateAssistantWeekMessages({
    currentWeek: nextState.currentWeek,
    season: getInboxSeason(nextState.competitions),
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

/**
 * Repeatedly advance the week until the current season rolls over (or the
 * guard is exhausted). Mirrors the previous inline `skipToEndOfSeason` store
 * action, including the per-iteration referential-integrity fix-up applied by
 * `advanceWeek` in the store.
 */
export const skipToEndOfSeasonState = <TState extends WeeklyLifecycleState>(state: TState): TState => {
  const initialMaxWeek = getSeasonWeekLimit(state.fixtures, state.competitions);
  if (initialMaxWeek <= 0) return state;
  let current = state;
  let guard = initialMaxWeek + 60;
  try {
    while (guard-- > 0) {
      const maxWeek = getSeasonWeekLimit(current.fixtures, current.competitions);
      if (maxWeek <= 0 || current.currentWeek > maxWeek) break;
      const next = advanceWeekState(current);
      const fixedTeams = ensureReferentialIntegrity(next.teams ?? current.teams, next.players ?? current.players);
      current = { ...next, teams: fixedTeams } as TState;
      if (current.currentWeek === 1) break;
    }
  } catch (error) {
    console.warn('skipToEndOfSeason failed before season rollover', error);
  }
  return current;
};
