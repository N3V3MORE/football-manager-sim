import { Player, Team } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { autoAssignLineup } from '../core/lineupEngine';
import { applyMatchResult } from '../core/teamUtils';
import { isPlayerUnavailable } from '../core/playerStatusUtils';

export type LiveMatchState = {
  initialized: boolean;
  yellowCardPlayerIds: string[];
  sentOffPlayerIds: string[];
  firstAttackIsHome?: boolean;
  sentOffMinutes?: Record<string, number>;
  homeGoalMinutes?: number[];
  awayGoalMinutes?: number[];
  homeStarterIds: string[];
  awayStarterIds: string[];
};

const LIVE_MATCH_MINUTES = 90;

export const getPossessionIndexForMinute = (minute: number) => {
  const current = Math.floor((minute * ENGINE_CONFIG.TOTAL_POSSESSIONS) / LIVE_MATCH_MINUTES);
  const previous = Math.floor(((minute - 1) * ENGINE_CONFIG.TOTAL_POSSESSIONS) / LIVE_MATCH_MINUTES);
  return current > previous ? current - 1 : null;
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

/**
 * Ensures the team has at least 11 eligible starters. Auto-assigns a lineup if needed.
 * NOTE: This function MUTATES the `players` parameter in-place when auto-assigning.
 * Callers should pass a copy of the players record if they need immutability.
 */
export const ensureLiveTeamStarters = (
  teamId: string,
  teams: Record<string, Team>,
  players: Record<string, Player>,
  sentOffPlayers: Set<string>,
  allowAutoAssign: boolean
) => {
  let starters = getEligibleStarters(players, teamId, sentOffPlayers);
  if (!allowAutoAssign || starters.length >= 11) return starters;

  const team = teams[teamId]!;
  const lineupUpdates = autoAssignLineup(teamId, players, team.activeFormation);
  Object.entries(lineupUpdates).forEach(([playerId, updates]) => {
    players[playerId] = { ...players[playerId], ...updates } as Player;
  });
  starters = getEligibleStarters(players, teamId, sentOffPlayers);
  return starters;
};

/**
 * Drains energy from players during live match simulation.
 * NOTE: This function MUTATES the `players` parameter in-place.
 * Callers should pass a copy of the players record if they need immutability.
 */
export const drainLiveMatchEnergy = (players: Record<string, Player>, starters: Player[]) => {
  starters.forEach(player => {
    const current = players[player.id]!;
    players[player.id] = {
      ...current,
      energy: Math.max(0, current.energy - ENGINE_CONFIG.ENERGY_DRAIN_PER_MINUTE),
    } as Player;
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

export const updateTeamStats = (
  team: Team,
  goalsFor: number,
  goalsAgainst: number,
  includeTableStats = true
) => {
  return applyMatchResult(team, goalsFor, goalsAgainst, includeTableStats);
};
