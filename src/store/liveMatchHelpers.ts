import { Fixture, LiveMatchState, Player, Team, TeamTactics } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { autoAssignLineup } from '../core/lineupEngine';
import { applyMatchResult } from '../core/teamUtils';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import { getCompatiblePlayerRoleForTeamSlot, getRoleEnergyDrainMultiplier } from '../core/playerRoleEngine';

// `LiveMatchState` now lives in the model layer (`models/types/live-match.ts`).
// Re-exported here so existing `from '../store/liveMatchHelpers'` imports keep working.
export type { LiveMatchState } from '../models/types';

export const LIVE_MATCH_MINUTES = 90;
export const LIVE_MATCH_EXTRA_TIME_MINUTES = 120;

export const getPossessionIndexForMinute = (minute: number) => {
  if (minute <= LIVE_MATCH_MINUTES) {
    const current = Math.floor((minute * ENGINE_CONFIG.TOTAL_POSSESSIONS) / LIVE_MATCH_MINUTES);
    const previous = Math.floor(((minute - 1) * ENGINE_CONFIG.TOTAL_POSSESSIONS) / LIVE_MATCH_MINUTES);
    return current > previous ? current - 1 : null;
  }
  if (minute <= LIVE_MATCH_EXTRA_TIME_MINUTES) {
    const extraMinute = minute - LIVE_MATCH_MINUTES;
    const current = Math.floor((extraMinute * ENGINE_CONFIG.EXTRA_TIME_POSSESSIONS) / 30);
    const previous = Math.floor(((extraMinute - 1) * ENGINE_CONFIG.EXTRA_TIME_POSSESSIONS) / 30);
    return current > previous ? ENGINE_CONFIG.TOTAL_POSSESSIONS + current - 1 : null;
  }
  return null;
};

export const getPlayersByIds = (players: Record<string, Player>, ids: string[]) => (
  ids.map(id => players[id]).filter((player): player is Player => Boolean(player))
);

export const getEligibleStarters = (
  players: Record<string, Player>,
  teamId: string,
  sentOffPlayers: Set<string>
) => Object.values(players)
  .filter(player => (
    player.teamId === teamId &&
    player.isStarting &&
    !isPlayerUnavailable(player) &&
    !sentOffPlayers.has(player.id)
  ));

export const ensureLiveTeamStarters = (
  teamId: string,
  teams: Record<string, Team>,
  players: Record<string, Player>,
  sentOffPlayers: Set<string>,
  allowAutoAssign: boolean
) => {
  let starters = getEligibleStarters(players, teamId, sentOffPlayers);
  if (!allowAutoAssign || starters.length >= 11) return starters;

  const team = teams[teamId];
  const lineupUpdates = autoAssignLineup(teamId, players, team.activeFormation);
  Object.entries(lineupUpdates).forEach(([playerId, updates]) => {
    players[playerId] = { ...players[playerId], ...updates };
  });
  starters = getEligibleStarters(players, teamId, sentOffPlayers);
  return starters;
};

const getLiveEnergyDrainPerMinute = (teamTactics: TeamTactics) => {
  const drainMultiplier =
    (teamTactics.tempo === 'Fast' ? ENGINE_CONFIG.TEMPO_FAST_DRAIN_MULTIPLIER : 1.0) *
    (teamTactics.pressing === 'High' ? ENGINE_CONFIG.PRESSING_HIGH_DRAIN_MULTIPLIER : 1.0);
  return (ENGINE_CONFIG.BASE_POST_MATCH_ENERGY_DRAIN / 90) * drainMultiplier;
};

const isTeamWithTactics = (value: Team | TeamTactics): value is Team => (
  'tactics' in value
);

export const drainLiveMatchEnergy = (
  players: Record<string, Player>,
  starters: Player[],
  teamOrTactics: Team | TeamTactics,
  multiplier = 1
) => {
  const team = isTeamWithTactics(teamOrTactics) ? teamOrTactics : undefined;
  const teamTactics: TeamTactics = team ? team.tactics : teamOrTactics as TeamTactics;
  const baseDrain = getLiveEnergyDrainPerMinute(teamTactics) * multiplier;
  starters.forEach(player => {
    const roleDrainMultiplier = team
      ? getRoleEnergyDrainMultiplier(getCompatiblePlayerRoleForTeamSlot(team, player))
      : 1;
    players[player.id] = {
      ...players[player.id],
      energy: Math.max(0, players[player.id].energy - baseDrain * roleDrainMultiplier),
    };
  });
};

export const removeLiveMatchFixture = (
  liveMatches: Record<string, LiveMatchState>,
  fixtureId: string
) => {
  const nextLiveMatches = { ...liveMatches };
  delete nextLiveMatches[fixtureId];
  return nextLiveMatches;
};

type LiveMatchRecoveryContext = {
  currentWeek: number;
  fixtures: Record<string, Fixture>;
  teams: Record<string, Team>;
  players: Record<string, Player>;
};

const liveMatchIdsBelongToTeam = (
  ids: unknown,
  teamId: string,
  players: Record<string, Player>
) => (
  Array.isArray(ids) &&
  ids.length > 0 &&
  ids.every(id => typeof id === 'string' && players[id]?.teamId === teamId)
);

const hasContiguousProcessedMinutes = (processedMinutes: unknown) => {
  if (processedMinutes === undefined) return true;
  if (!Array.isArray(processedMinutes)) return false;
  const sorted = [...new Set(processedMinutes)]
    .filter((minute): minute is number => Number.isInteger(minute) && minute >= 1 && minute <= LIVE_MATCH_EXTRA_TIME_MINUTES)
    .sort((left, right) => left - right);
  if (sorted.length !== processedMinutes.length) return false;
  return sorted.every((minute, index) => minute === index + 1);
};

export const isRecoverableLiveMatch = (
  fixtureId: string,
  liveState: Partial<LiveMatchState> | undefined,
  context: LiveMatchRecoveryContext
) => {
  const fixture = context.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed || fixture.week > context.currentWeek) return false;
  if (!context.teams[fixture.homeTeamId] || !context.teams[fixture.awayTeamId]) return false;

  return Boolean(liveState) &&
    typeof liveState === 'object' &&
    hasContiguousProcessedMinutes(liveState.processedMinutes) &&
    liveMatchIdsBelongToTeam(liveState.homeStarterIds, fixture.homeTeamId, context.players) &&
    liveMatchIdsBelongToTeam(liveState.awayStarterIds, fixture.awayTeamId, context.players);
};

export const pruneInvalidLiveMatches = (
  liveMatches: Record<string, LiveMatchState>,
  context: LiveMatchRecoveryContext
) => Object.fromEntries(
  Object.entries(liveMatches).filter(([fixtureId, liveState]) => (
    isRecoverableLiveMatch(fixtureId, liveState, context)
  ))
) as Record<string, LiveMatchState>;

export const updateTeamStats = (
  team: Team,
  goalsFor: number,
  goalsAgainst: number,
  includeTableStats = true
) => {
  return applyMatchResult(team, goalsFor, goalsAgainst, includeTableStats);
};
